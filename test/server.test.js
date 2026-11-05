import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, checkAuditChain } from '../server/db.js';
import { makeServer } from '../server/index.js';
import { config } from '../server/config.js';

let server, base, db;
before(async () => {
  db = openDb(':memory:');
  const made = makeServer(db);
  await made.app.ensureSuper();
  server = made.server;
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

/** A tiny browser: keeps its own cookie. */
function browser() {
  let jar = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(jar && { cookie: jar }), ...(body !== undefined && { 'content-type': 'application/json', 'x-soulscape': '1' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) jar = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
  };
}

test('sign up with several roles, keep a desk, publish and get a like', async () => {
  const kemi = browser(), ade = browser();
  let r = await kemi('POST', '/api/signup', { email: 'k@x.test', handle: 'kemi', name: 'Kemi', password: 'long-enough-1', roles: ['dj', 'artist', 'dancer'] });
  assert.equal(r.status, 201);
  assert.deepEqual(r.data.user.roles, ['dj', 'artist', 'dancer']);
  assert.ok(r.data.user.plugins.includes('gallery') && r.data.user.plugins.includes('station'));

  r = await kemi('PUT', '/api/desk/wide', { desk: { layout: 'Main', layouts: { Main: { windows: [{ id: 'w1', plugin: 'feed' }] } } } });
  assert.equal(r.status, 200);
  r = await kemi('GET', '/api/desk/wide');
  assert.equal(r.data.desk.layouts.Main.windows[0].plugin, 'feed');

  r = await kemi('POST', '/api/spaces', { plugin: 'gallery', title: 'Saints', content: { items: [{ id: 'a', title: 'One' }] } });
  assert.equal(r.status, 201);
  const spaceId = r.data.space.id;

  await ade('POST', '/api/signup', { email: 'a@x.test', handle: 'ade', password: 'long-enough-2', roles: ['writer'] });
  r = await ade('POST', '/api/spaces', { plugin: 'gallery', title: 'Nope' });
  assert.equal(r.status, 403, 'a writer has no gallery yet');
  r = await ade('PUT', `/api/spaces/${spaceId}`, { title: 'Mine now' });
  assert.equal(r.status, 403);
  await ade('POST', '/api/signals', { kind: 'like', spaceId });
  await ade('POST', '/api/signals', { kind: 'like', spaceId });
  r = await ade('GET', `/api/spaces/${spaceId}`);
  assert.equal(r.data.space.likes, 1, 'liking twice counts once');
  await ade('POST', '/api/signals', { kind: 'collab', handle: 'kemi', body: 'Zine together?' });
  r = await kemi('GET', '/api/feed');
  assert.ok(r.data.feed.some((f) => f.kind === 'collab' && f.from_handle === 'ade'));
});

test('changes need the header, and reserved handles are refused', async () => {
  const res = await fetch(`${base}/api/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
  const r = await browser()('POST', '/api/signup', { email: 's@x.test', handle: 'super', password: 'long-enough-3' });
  assert.equal(r.status, 400);
});

test('the super admin makes an admin only after typing the password again, and it is audited', async () => {
  const sup = browser(), mod = browser();
  const signup = await mod('POST', '/api/signup', { email: 'm@x.test', handle: 'mod', password: 'long-enough-4' });
  const modId = signup.data.user.id;
  let r = await mod('GET', '/api/admin/users');
  assert.equal(r.status, 403);

  r = await sup('POST', '/api/login', { email: config.superAdmin.email, password: config.superAdmin.password });
  assert.equal(r.data.user.tier, 'super');
  // Signing in counts as fresh; age the session to check the re-auth path.
  db.prepare('UPDATE sessions SET fresh_until = 0').run();
  r = await sup('POST', `/api/admin/users/${modId}/tier`, { tier: 'admin' });
  assert.equal(r.status, 403);
  assert.match(r.data.error, /password again/);
  r = await sup('POST', '/api/reauth', { password: config.superAdmin.password });
  assert.equal(r.status, 200);
  r = await sup('POST', `/api/admin/users/${modId}/tier`, { tier: 'admin' });
  assert.equal(r.status, 200);
  r = await sup('POST', `/api/admin/users/${modId}/tier`, { tier: 'super' });
  assert.equal(r.status, 400, 'nobody becomes super through the app');

  r = await sup('GET', '/api/admin/audit');
  assert.ok(r.data.entries.some((e) => e.action === 'set-tier' && e.target === 'mod'));
  assert.equal(r.data.brokenAt, null);
  db.prepare("UPDATE audit_log SET detail = 'edited' WHERE action = 'set-tier'").run();
  assert.ok(checkAuditChain(db), 'an edited entry is caught');
});

test('static files are served, and nothing outside public/ and src/ is', async () => {
  let res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  res = await fetch(`${base}/src/desk/layout.js`);
  assert.equal(res.status, 200);
  res = await fetch(`${base}/src/../server/app.js`);
  assert.equal(res.status, 404);
  res = await fetch(`${base}/%2e%2e/package.json`);
  assert.equal(res.status, 404);
});
