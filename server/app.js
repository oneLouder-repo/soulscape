/**
 * The API. Every route is in this file, in the order a person meets them:
 * signing in, their own profile and roles, their desk, spaces, signals,
 * then admin and super admin tools.
 *
 * Every change goes through can() in permissions.js first. Every admin
 * action is written to the audit log.
 *
 * Requests that change something must send JSON with the header
 * `x-soulscape: 1`. A form on another site can't set that header, which
 * (with SameSite cookies) keeps other sites from acting as a signed-in person.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { audit, checkAuditChain, now } from './db.js';
import { can } from './permissions.js';
import { HttpError, json, readJson, parseCookies, cookie, clientIp } from './http.js';
import { cleanRoles, pluginsFor, TIERS } from '../src/roles.js';

const scrypt = promisify(scryptCb);
const COOKIE = 'ss_session';
const id = () => randomUUID();
export const digest = (s) => createHash('sha256').update(s).digest('hex');

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function checkPassword(password, stored) {
  if (!stored?.startsWith('scrypt$')) return false;
  const [, salt, want] = stored.split('$');
  const wantBuf = Buffer.from(want, 'base64url');
  const got = await scrypt(String(password), Buffer.from(salt, 'base64url'), wantBuf.length);
  return timingSafeEqual(got, wantBuf);
}

/**
 * A small in-memory rate limit: at most `max` tries per `minutes` for one
 * key (an address plus what they're doing). Enough for one server.
 */
export function limiter(max, minutes) {
  const hits = new Map();
  return (key) => {
    const t = Date.now(), list = (hits.get(key) ?? []).filter((x) => t - x < minutes * 60e3);
    list.push(t);
    hits.set(key, list);
    if (list.length > max) throw new HttpError(429, 'Too many tries. Wait a few minutes and try again.');
  };
}

const HANDLE = /^[a-z0-9_]{2,24}$/;
const RESERVED = new Set(['super', 'admin', 'soulscape', 'api', 'help', 'support']);
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const str = (v, max) => String(v ?? '').trim().slice(0, max);

export function createApp(db) {
  const q = (sql) => db.prepare(sql);
  const signInLimit = limiter(10, 15);
  const signalLimit = limiter(60, 10);

  /** A user row as the API shows it to its owner (and to admins). */
  const rolesOf = (userId) => q('SELECT role FROM user_roles WHERE user_id = ?').all(userId).map((r) => r.role);
  const withRoles = (u) => u && { ...u, roles: cleanRoles(rolesOf(u.id)) };
  const publicUser = (u) => u && { id: u.id, handle: u.handle, name: u.name, bio: u.bio, roles: u.roles ?? cleanRoles(rolesOf(u.id)), tier: u.tier === 'user' ? undefined : u.tier };
  const meJson = (u) => u && { ...publicUser(u), email: u.email, tier: u.tier, plugins: pluginsFor(u) };

  function setRoles(userId, roles) {
    q('DELETE FROM user_roles WHERE user_id = ?').run(userId);
    for (const r of cleanRoles(roles)) q('INSERT INTO user_roles (user_id, role) VALUES (?, ?)').run(userId, r);
  }

  /** Make sure the super admin named in the settings exists, with the settings' password. */
  async function ensureSuper() {
    const { email, name, password } = config.superAdmin;
    if (!password) return;
    const hash = await hashPassword(password);
    const u = q('SELECT * FROM users WHERE email = ?').get(email);
    if (u) q("UPDATE users SET tier = 'super', password_hash = ?, suspended = 0 WHERE id = ?").run(hash, u.id);
    else q("INSERT INTO users (id, email, handle, name, password_hash, tier, created_at) VALUES (?, ?, 'super', ?, ?, 'super', ?)").run(id(), email, name, hash, now());
    // Anyone else marked super (an old setting) goes back to admin.
    q("UPDATE users SET tier = 'admin' WHERE tier = 'super' AND email != ?").run(email);
  }

  /* ---------- Sessions ---------- */

  function startSession(res, user, { fresh = false } = {}) {
    const raw = randomBytes(32).toString('base64url');
    const life = user.tier === 'super' ? config.superSessionHours * 3600e3 : config.sessionDays * 864e5;
    q('INSERT INTO sessions (id, user_id, expires_at, fresh_until, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(digest(raw), user.id, Date.now() + life, fresh ? Date.now() + config.freshMinutes * 60e3 : 0, now());
    res.setHeader('set-cookie', cookie(COOKIE, raw, { maxAge: Math.floor(life / 1000), secure: config.https }));
  }

  /** Who is asking: { session, user } where user carries tier, roles and fresh. */
  function who(req) {
    const raw = parseCookies(req.headers.cookie)[COOKIE];
    if (!raw) return { session: null, user: null };
    const s = q('SELECT * FROM sessions WHERE id = ?').get(digest(raw));
    if (!s || s.expires_at < Date.now()) return { session: null, user: null };
    const u = withRoles(q('SELECT * FROM users WHERE id = ?').get(s.user_id));
    if (!u) return { session: null, user: null };
    return { session: s, user: { ...u, suspended: !!u.suspended, fresh: s.fresh_until > Date.now() } };
  }

  const need = (user) => {
    if (!user) throw new HttpError(401, 'Sign in first.');
    if (user.suspended) throw new HttpError(403, 'This account is suspended.');
    return user;
  };
  const allow = (ok, message = 'Not allowed.') => {
    if (!ok) throw new HttpError(403, message);
  };

  const spaceJson = (s) => s && { id: s.id, owner: publicUser(withRoles(q('SELECT * FROM users WHERE id = ?').get(s.owner_id))), plugin: s.plugin, title: s.title, visibility: s.visibility, hidden: !!s.hidden, content: JSON.parse(s.json), updatedAt: s.updated_at,
    likes: q("SELECT COUNT(*) AS n FROM signals WHERE kind = 'like' AND space_id = ?").get(s.id).n };

  /* ---------- Routes ---------- */

  async function handle(req, res, path) {
    const method = req.method;
    const changes = method !== 'GET' && method !== 'HEAD';
    if (changes && req.headers['x-soulscape'] !== '1') throw new HttpError(403, 'Missing request header.');
    const body = changes ? (await readJson(req, config.maxJsonKb * 1024)) ?? {} : null;
    const { session, user } = who(req);
    const ip = clientIp(req);
    let m;

    // Signing in and out.
    if (path === '/api/session' && method === 'GET') return json(res, 200, { user: meJson(user), version: config.version });

    if (path === '/api/signup' && method === 'POST') {
      allow(config.openSignup, 'Sign-up is closed for now.');
      signInLimit(`signup:${ip}`);
      const email = str(body.email, 200).toLowerCase(), handle = str(body.handle, 24).toLowerCase(), name = str(body.name, 80);
      const password = String(body.password ?? '');
      if (!EMAIL.test(email)) throw new HttpError(400, 'That email address doesn\'t look right.');
      if (!HANDLE.test(handle) || RESERVED.has(handle)) throw new HttpError(400, 'Handles are 2 to 24 lowercase letters, numbers or underscores, and a few words are kept back.');
      if (password.length < 10) throw new HttpError(400, 'Passwords need at least 10 characters.');
      if (q('SELECT 1 FROM users WHERE email = ? OR handle = ?').get(email, handle)) throw new HttpError(409, 'That email or handle is already taken.');
      const userId = id();
      q('INSERT INTO users (id, email, handle, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(userId, email, handle, name || handle, await hashPassword(password), now());
      setRoles(userId, body.roles);
      const u = withRoles(q('SELECT * FROM users WHERE id = ?').get(userId));
      startSession(res, u);
      return json(res, 201, { user: meJson(u) });
    }

    if (path === '/api/login' && method === 'POST') {
      signInLimit(`login:${ip}`);
      const email = str(body.email, 200).toLowerCase();
      const u = q('SELECT * FROM users WHERE email = ?').get(email);
      const ok = u && await checkPassword(body.password, u.password_hash);
      if (!ok) throw new HttpError(401, 'That email and password don\'t match.');
      if (u.tier !== 'user') audit(db, u.id, 'sign-in', u.email, { ip });
      startSession(res, withRoles(u), { fresh: true });
      return json(res, 200, { user: meJson(withRoles(u)) });
    }

    if (path === '/api/logout' && method === 'POST') {
      if (session) q('DELETE FROM sessions WHERE id = ?').run(session.id);
      res.setHeader('set-cookie', cookie(COOKIE, '', { maxAge: 0, secure: config.https }));
      return json(res, 200, { ok: true });
    }

    /** Type the password again to make the session fresh for a few minutes (before tier changes). */
    if (path === '/api/reauth' && method === 'POST') {
      need(user);
      signInLimit(`reauth:${ip}`);
      if (!await checkPassword(body.password, q('SELECT password_hash FROM users WHERE id = ?').get(user.id).password_hash)) throw new HttpError(401, 'Wrong password.');
      q('UPDATE sessions SET fresh_until = ? WHERE id = ?').run(Date.now() + config.freshMinutes * 60e3, session.id);
      return json(res, 200, { ok: true });
    }

    // Your own profile and creative roles.
    if (path === '/api/me' && method === 'PUT') {
      need(user);
      q('UPDATE users SET name = ?, bio = ? WHERE id = ?').run(str(body.name ?? user.name, 80) || user.handle, str(body.bio ?? user.bio, 2000), user.id);
      if (body.roles) setRoles(user.id, body.roles);
      return json(res, 200, { user: meJson(withRoles(q('SELECT * FROM users WHERE id = ?').get(user.id))) });
    }

    // Your desk: window layouts, one per screen-size band.
    if ((m = path.match(/^\/api\/desk\/(wide|laptop|tablet)$/))) {
      need(user);
      if (method === 'GET') {
        const row = q('SELECT json FROM desks WHERE user_id = ? AND band = ?').get(user.id, m[1]);
        return json(res, 200, { desk: row ? JSON.parse(row.json) : null });
      }
      if (method === 'PUT') {
        const text = JSON.stringify(body.desk ?? null);
        q(`INSERT INTO desks (user_id, band, json, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (user_id, band) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`).run(user.id, m[1], text, now());
        return json(res, 200, { ok: true });
      }
    }

    // People and their spaces.
    if ((m = path.match(/^\/api\/people\/([a-z0-9_]+)$/)) && method === 'GET') {
      const u = withRoles(q('SELECT * FROM users WHERE handle = ? AND suspended = 0').get(m[1]));
      if (!u) throw new HttpError(404, 'Nobody by that handle.');
      const spaces = q('SELECT * FROM spaces WHERE owner_id = ? ORDER BY updated_at DESC').all(u.id).filter((s) => can(user, 'space.view', s));
      return json(res, 200, { person: publicUser(u), spaces: spaces.map((s) => ({ id: s.id, plugin: s.plugin, title: s.title })) });
    }

    if (path === '/api/people' && method === 'GET') {
      const rows = q("SELECT * FROM users WHERE suspended = 0 AND tier != 'super' ORDER BY created_at DESC LIMIT 200").all();
      return json(res, 200, { people: rows.map((u) => publicUser(withRoles(u))) });
    }

    if (path === '/api/spaces' && method === 'POST') {
      need(user);
      const plugin = str(body.plugin, 40);
      allow(can(user, 'space.create', plugin), 'Your roles don\'t include that kind of space yet.');
      const spaceId = id();
      q('INSERT INTO spaces (id, owner_id, plugin, title, json, visibility, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(spaceId, user.id, plugin, str(body.title, 120) || 'Untitled', JSON.stringify(body.content ?? {}), ['public', 'members', 'private'].includes(body.visibility) ? body.visibility : 'public', now());
      return json(res, 201, { space: spaceJson(q('SELECT * FROM spaces WHERE id = ?').get(spaceId)) });
    }

    if ((m = path.match(/^\/api\/spaces\/([\w-]+)$/))) {
      const s = q('SELECT * FROM spaces WHERE id = ?').get(m[1]);
      if (!s || !can(user, 'space.view', s)) throw new HttpError(404, 'Not found.');
      if (method === 'GET') return json(res, 200, { space: spaceJson(s) });
      if (method === 'PUT') {
        need(user);
        allow(can(user, 'space.edit', s), 'Only the owner can change this.');
        q('UPDATE spaces SET title = ?, json = ?, visibility = ?, updated_at = ? WHERE id = ?').run(
          str(body.title ?? s.title, 120) || 'Untitled', body.content ? JSON.stringify(body.content) : s.json,
          ['public', 'members', 'private'].includes(body.visibility) ? body.visibility : s.visibility, now(), s.id);
        return json(res, 200, { space: spaceJson(q('SELECT * FROM spaces WHERE id = ?').get(s.id)) });
      }
    }

    // Signals: likes, comments, follows, collab requests.
    if (path === '/api/signals' && method === 'POST') {
      need(user);
      allow(can(user, 'signal.send'));
      signalLimit(`signal:${user.id}`);
      const kind = body.kind;
      if (!['like', 'comment', 'follow', 'collab'].includes(kind)) throw new HttpError(400, 'Unknown kind of signal.');
      const space = body.spaceId ? q('SELECT * FROM spaces WHERE id = ?').get(body.spaceId) : null;
      if (body.spaceId && (!space || !can(user, 'space.view', space))) throw new HttpError(404, 'Not found.');
      const to = space ? space.owner_id : q('SELECT id FROM users WHERE handle = ?').get(str(body.handle, 24))?.id;
      if (!to) throw new HttpError(404, 'Nobody by that handle.');
      if (to === user.id && kind !== 'comment') throw new HttpError(400, 'That one is for other people.');
      const text = str(body.body, 2000);
      if ((kind === 'comment' || kind === 'collab') && !text) throw new HttpError(400, 'Write something first.');
      try {
        q('INSERT INTO signals (id, kind, from_id, to_id, space_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id(), kind, user.id, to, space?.id ?? null, text, now());
      } catch (e) {
        if (!/UNIQUE/.test(e.message)) throw e; // Liking or following twice is fine.
      }
      return json(res, 201, { ok: true });
    }

    if ((m = path.match(/^\/api\/spaces\/([\w-]+)\/comments$/)) && method === 'GET') {
      const s = q('SELECT * FROM spaces WHERE id = ?').get(m[1]);
      if (!s || !can(user, 'space.view', s)) throw new HttpError(404, 'Not found.');
      const rows = q("SELECT s.body, s.created_at, u.handle, u.name FROM signals s JOIN users u ON u.id = s.from_id WHERE s.kind = 'comment' AND s.space_id = ? ORDER BY s.created_at").all(s.id);
      return json(res, 200, { comments: rows });
    }

    /** The scene feed: what the people you follow did, and what was sent to you. */
    if (path === '/api/feed' && method === 'GET') {
      need(user);
      const rows = q(`SELECT s.kind, s.body, s.created_at, s.space_id, f.handle AS from_handle, f.name AS from_name, t.handle AS to_handle, sp.title AS space_title
        FROM signals s JOIN users f ON f.id = s.from_id JOIN users t ON t.id = s.to_id LEFT JOIN spaces sp ON sp.id = s.space_id
        WHERE s.to_id = ? OR s.from_id IN (SELECT to_id FROM signals WHERE kind = 'follow' AND from_id = ?)
        ORDER BY s.created_at DESC LIMIT 100`).all(user.id, user.id);
      return json(res, 200, { feed: rows });
    }

    // Admin tools.
    if (path === '/api/admin/users' && method === 'GET') {
      need(user);
      allow(can(user, 'user.list'));
      const rows = q('SELECT * FROM users ORDER BY created_at DESC').all();
      return json(res, 200, { users: rows.map((u) => ({ ...publicUser(withRoles(u)), email: u.email, tier: u.tier, suspended: !!u.suspended, createdAt: u.created_at })) });
    }

    if ((m = path.match(/^\/api\/admin\/users\/([\w-]+)\/suspend$/)) && method === 'POST') {
      need(user);
      const target = q('SELECT * FROM users WHERE id = ?').get(m[1]);
      if (!target) throw new HttpError(404, 'Not found.');
      allow(can(user, 'user.suspend', target));
      const on = body.suspended !== false;
      q('UPDATE users SET suspended = ? WHERE id = ?').run(on ? 1 : 0, target.id);
      if (on) q('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      audit(db, user.id, on ? 'suspend' : 'unsuspend', target.handle, str(body.reason, 500));
      return json(res, 200, { ok: true });
    }

    if ((m = path.match(/^\/api\/admin\/spaces\/([\w-]+)\/hide$/)) && method === 'POST') {
      need(user);
      allow(can(user, 'space.hide'));
      const s = q('SELECT * FROM spaces WHERE id = ?').get(m[1]);
      if (!s) throw new HttpError(404, 'Not found.');
      q('UPDATE spaces SET hidden = ? WHERE id = ?').run(body.hidden === false ? 0 : 1, s.id);
      audit(db, user.id, body.hidden === false ? 'unhide-space' : 'hide-space', s.id, str(body.reason, 500));
      return json(res, 200, { ok: true });
    }

    if ((m = path.match(/^\/api\/admin\/users\/([\w-]+)\/tier$/)) && method === 'POST') {
      need(user);
      const target = q('SELECT * FROM users WHERE id = ?').get(m[1]);
      if (!target) throw new HttpError(404, 'Not found.');
      if (user.tier === 'super' && !user.fresh) throw new HttpError(403, 'Type your password again first.');
      allow(can(user, 'user.setTier', target));
      const tier = body.tier;
      if (!TIERS.includes(tier) || tier === 'super') throw new HttpError(400, 'Tier must be user or admin.');
      q('UPDATE users SET tier = ? WHERE id = ?').run(tier, target.id);
      q('DELETE FROM sessions WHERE user_id = ?').run(target.id); // They sign in again with their new tier.
      audit(db, user.id, 'set-tier', target.handle, `${target.tier} → ${tier}`);
      return json(res, 200, { ok: true });
    }

    if (path === '/api/admin/audit' && method === 'GET') {
      need(user);
      allow(can(user, 'audit.read'));
      const rows = q('SELECT a.seq, a.at, a.action, a.target, a.detail, u.handle AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.seq DESC LIMIT 500').all();
      return json(res, 200, { entries: rows, brokenAt: checkAuditChain(db) });
    }

    throw new HttpError(404, 'No such route.');
  }

  return { handle, ensureSuper, setRoles, who };
}
