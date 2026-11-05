/**
 * The database: one SQLite file, using the SQLite built into Node (22.13+),
 * so there is nothing to install or run beside the app. Back it up by
 * copying the data folder.
 *
 *   users       everyone who can sign in; tier is 'user', 'admin' or 'super'
 *   user_roles  each person's creative roles, as many as they like
 *   sessions    signed-in browsers (only a hash of each session id is kept)
 *   desks       each person's window layouts, per screen size
 *   spaces      what people publish: a portfolio, gallery, ideas board...
 *   signals     likes, comments, follows and collab requests
 *   audit_log   every admin and super admin action, each entry chained to
 *               the one before by a hash, so an edited entry shows
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  handle TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  tier TEXT NOT NULL DEFAULT 'user' CHECK (tier IN ('user', 'admin', 'super')),
  crew TEXT,
  suspended INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  PRIMARY KEY (user_id, role)
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  fresh_until INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS desks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  band TEXT NOT NULL,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, band)
);
CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plugin TEXT NOT NULL,
  title TEXT NOT NULL,
  json TEXT NOT NULL DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'members', 'private')),
  hidden INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('like', 'comment', 'follow', 'collab')),
  from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  space_id TEXT REFERENCES spaces(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_like ON signals (from_id, space_id) WHERE kind = 'like';
CREATE UNIQUE INDEX IF NOT EXISTS one_follow ON signals (from_id, to_id) WHERE kind = 'follow';
CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
`;

export function openDb(dir) {
  const file = dir === ':memory:' ? ':memory:' : (mkdirSync(dir, { recursive: true }), join(dir, 'soulscape.db'));
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export const now = () => new Date().toISOString();

const entryHash = (e) => createHash('sha256').update([e.prev_hash, e.at, e.actor_id ?? '', e.action, e.target, e.detail].join('\n')).digest('hex');

/** Write one line to the audit log, chained to the line before it. */
export function audit(db, actorId, action, target = '', detail = '') {
  const prev = db.prepare('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1').get();
  const e = { at: now(), actor_id: actorId, action, target: String(target), detail: typeof detail === 'string' ? detail : JSON.stringify(detail), prev_hash: prev?.hash ?? 'start' };
  e.hash = entryHash(e);
  db.prepare('INSERT INTO audit_log (at, actor_id, action, target, detail, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(e.at, e.actor_id, e.action, e.target, e.detail, e.prev_hash, e.hash);
}

/** Walk the audit log; returns the first line whose hash doesn't match, or null when it's intact. */
export function checkAuditChain(db) {
  let prev = 'start';
  for (const e of db.prepare('SELECT * FROM audit_log ORDER BY seq').all()) {
    if (e.prev_hash !== prev || entryHash(e) !== e.hash) return e.seq;
    prev = e.hash;
  }
  return null;
}
