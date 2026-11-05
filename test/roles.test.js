import { test } from 'node:test';
import assert from 'node:assert/strict';
import { can } from '../server/permissions.js';
import { cleanRoles, pluginsFor } from '../src/roles.js';

const user = (tier = 'user', extra = {}) => ({ id: `${tier}-1`, tier, roles: [], suspended: false, fresh: false, ...extra });

test('people can hold any mix of creative roles', () => {
  assert.deepEqual(cleanRoles(['dancer', 'dj', 'artist', 'dj', 'astronaut']), ['dj', 'artist', 'dancer']);
  const p = pluginsFor(user('user', { roles: ['artist', 'dj', 'dancer'] }));
  assert.ok(p.includes('gallery') && p.includes('station') && p.includes('profile'));
  assert.ok(!p.includes('admin'));
  assert.ok(pluginsFor(user('admin')).includes('admin'));
});

test('only the owner edits a space; hidden and private spaces stay out of view', () => {
  const owner = user('user', { id: 'o' });
  const s = { owner_id: 'o', visibility: 'public', hidden: 0 };
  assert.ok(can(owner, 'space.edit', s));
  assert.ok(!can(user(), 'space.edit', s));
  assert.ok(!can(user('admin'), 'space.edit', s), 'admins moderate, they do not edit');
  assert.ok(can(null, 'space.view', s));
  assert.ok(!can(null, 'space.view', { ...s, hidden: 1 }));
  assert.ok(can(owner, 'space.view', { ...s, visibility: 'private' }));
  assert.ok(!can(user(), 'space.view', { ...s, visibility: 'private' }));
  assert.ok(!can(null, 'space.view', { ...s, visibility: 'members' }));
});

test('admins suspend users but not each other; only the super admin changes tiers, and only when fresh', () => {
  const target = user('user', { id: 't' });
  assert.ok(can(user('admin'), 'user.suspend', target));
  assert.ok(!can(user('admin'), 'user.suspend', user('admin', { id: 'a2' })));
  assert.ok(can(user('super'), 'user.suspend', user('admin', { id: 'a2' })));
  assert.ok(!can(user('admin'), 'user.setTier', target));
  assert.ok(!can(user('super'), 'user.setTier', target), 'needs a fresh password');
  assert.ok(can(user('super', { fresh: true }), 'user.setTier', target));
  assert.ok(!can(user('super', { fresh: true }), 'user.setTier', user('super', { id: 's2' })));
  assert.ok(!can(user('admin', { suspended: true }), 'user.list'));
  assert.ok(!can(user('super'), 'no.such.action'));
});
