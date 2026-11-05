import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/desk/layout.js';

const openThree = () => {
  let d = L.emptyDesk();
  const ids = [];
  for (const p of ['gallery', 'station', 'ideas']) {
    const r = L.open(d, { plugin: p, ref: `${p}-1` });
    d = r.desk;
    ids.push(r.id);
  }
  return { d, ids };
};

test('opening the same thing twice focuses it instead', () => {
  const { d, ids } = openThree();
  const r = L.open(d, { plugin: 'gallery', ref: 'gallery-1' });
  assert.equal(r.id, ids[0]);
  assert.equal(L.windowsOf(r.desk).length, 3);
  assert.equal(L.paintOrder(r.desk).at(-1).id, ids[0]);
});

test('stacking puts windows in one frame and moving it moves them all', () => {
  const { d, ids } = openThree();
  let s = L.stackOnto(d, ids[1], ids[0]);
  const [a, b] = [ids[0], ids[1]].map((id) => L.windowsOf(s).find((w) => w.id === id));
  assert.ok(a.stack && a.stack === b.stack);
  assert.equal(b.active, true);
  assert.equal(a.active, false);
  s = L.move(s, ids[0], { x: 300, y: 200 });
  for (const w of L.windowsOf(s).filter((w) => w.stack === a.stack)) assert.deepEqual([w.x, w.y], [300, 200]);
});

test('unstacking the second-last window dissolves the stack', () => {
  const { d, ids } = openThree();
  let s = L.stackOnto(d, ids[1], ids[0]);
  s = L.unstack(s, ids[1], { x: 500, y: 50 });
  for (const w of L.windowsOf(s)) assert.equal(w.stack, null);
  assert.deepEqual(L.windowsOf(s).find((w) => w.id === ids[1]).x, 500);
});

test('closing the visible tab shows another one', () => {
  const { d, ids } = openThree();
  let s = L.stackOnto(L.stackOnto(d, ids[1], ids[0]), ids[2], ids[0]);
  s = L.close(s, ids[2]);
  const left = L.windowsOf(s);
  assert.equal(left.length, 2);
  assert.equal(left.filter((w) => w.active).length, 1);
});

test('pinned windows paint above everything else', () => {
  const { d, ids } = openThree();
  const s = L.toggle(d, ids[0], 'pinned');
  assert.equal(L.paintOrder(L.focus(s, ids[2])).at(-1).id, ids[0]);
});

test('named layouts copy, switch and delete', () => {
  const { d } = openThree();
  let s = L.saveLayoutAs(d, 'Mixing');
  assert.equal(s.layout, 'Mixing');
  s = L.close(s, L.windowsOf(s)[0].id);
  assert.equal(L.windowsOf(s).length, 2);
  s = L.switchLayout(s, 'Main');
  assert.equal(L.windowsOf(s).length, 3);
  s = L.deleteLayout(s, 'Main');
  assert.deepEqual(L.layoutNames(s), ['Mixing']);
  assert.deepEqual(L.layoutNames(L.deleteLayout(s, 'Mixing')), ['Mixing'], 'the last layout stays');
});

test('clamp keeps the title bar reachable and normalise repairs junk', () => {
  const c = L.clamp({ x: -5000, y: -40, w: 100, h: 9000 }, { w: 1200, h: 800 });
  assert.ok(c.x > -c.w && c.y === 0 && c.w === L.MIN.w && c.h === 800);
  assert.deepEqual(L.normalise(null), L.emptyDesk());
  assert.equal(L.windowsOf(L.normalise({ layout: 'x', layouts: { A: { windows: [null, { id: 'w', plugin: 'feed' }] } } })).length, 1);
  assert.equal(L.bandFor(1600), 'wide');
  assert.equal(L.bandFor(1200), 'laptop');
});
