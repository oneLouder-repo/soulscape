/**
 * The desk's state, and every change a person can make to it, as plain
 * functions with no DOM. Each takes a desk and returns a new one, so the
 * desk can be saved, undone or tested without a browser.
 *
 *   desk   = { layout: 'Main', layouts: { Main: { windows: [win, ...] } } }
 *   win    = { id, plugin, ref, title, x, y, w, h, z,
 *              stack, active, folded, pinned }
 *
 * `ref` says what the window shows (a handle, a space id...), never a copy
 * of it, so a friend's gallery always shows their latest work.
 *
 * Stacks: windows that share a `stack` id sit in one frame, as tabs. They
 * share the frame's position and size; the one with `active: true` shows.
 *
 * A person can keep several named layouts ("Main", "Mixing", "Showcase")
 * and switch between them. Desks are saved per screen-size band so a desk
 * built on a big monitor doesn't break on a laptop.
 */

export const BANDS = { wide: 1400, laptop: 1000, tablet: 0 };
export const bandFor = (width) => (width >= BANDS.wide ? 'wide' : width >= BANDS.laptop ? 'laptop' : 'tablet');

export const MIN = { w: 220, h: 120 };
const TITLE_BAR = 30;

let counter = 0;
const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}`;
const clone = (d) => structuredClone(d);

export const emptyDesk = (name = 'Main') => ({ layout: name, layouts: { [name]: { windows: [] } } });

/** The windows of the layout in use. */
export const windowsOf = (desk) => desk.layouts[desk.layout]?.windows ?? [];
const wins = (desk) => desk.layouts[desk.layout].windows;
const find = (desk, id) => wins(desk).find((w) => w.id === id);
/** A window and everything stacked with it. */
const groupOf = (desk, w) => (w.stack ? wins(desk).filter((x) => x.stack === w.stack) : [w]);
const topZ = (desk) => Math.max(0, ...wins(desk).map((w) => w.z));

/** Keep a window's title bar on screen so it can always be grabbed. */
export function clamp(w, view) {
  const out = { ...w };
  out.w = Math.max(MIN.w, Math.min(out.w, view.w));
  out.h = Math.max(MIN.h, Math.min(out.h, view.h));
  out.x = Math.min(Math.max(out.x, 80 - out.w), view.w - 80);
  out.y = Math.min(Math.max(out.y, 0), view.h - TITLE_BAR);
  return out;
}

/**
 * Open a window. If the same thing is already open in this layout, bring it
 * to the front instead of opening it twice.
 */
export function open(desk, { plugin, ref = '', title = plugin, w = 420, h = 360, x, y }) {
  const d = clone(desk);
  const existing = wins(d).find((win) => win.plugin === plugin && win.ref === ref);
  if (existing) return { desk: focus(d, existing.id), id: existing.id };
  const n = wins(d).length;
  const win = { id: newId('w'), plugin, ref, title, x: x ?? 40 + (n % 8) * 28, y: y ?? 24 + (n % 8) * 28, w, h, z: topZ(d) + 1, stack: null, active: true, folded: false, pinned: false };
  wins(d).push(win);
  return { desk: d, id: win.id };
}

/** Bring a window (and its stack) to the front, and make it the stack's visible tab. */
export function focus(desk, id) {
  const d = clone(desk);
  const w = find(d, id);
  if (!w) return d;
  const z = topZ(d) + 1;
  for (const x of groupOf(d, w)) {
    x.z = z;
    x.active = x.id === id;
  }
  return d;
}

/** Move a window; its whole stack moves with it. */
export function move(desk, id, { x, y }) {
  const d = clone(desk);
  const w = find(d, id);
  if (w) for (const s of groupOf(d, w)) Object.assign(s, { x: Math.round(x), y: Math.round(y) });
  return d;
}

export function resize(desk, id, { w: width, h: height }) {
  const d = clone(desk);
  const w = find(d, id);
  if (w) for (const s of groupOf(d, w)) Object.assign(s, { w: Math.max(MIN.w, Math.round(width)), h: Math.max(MIN.h, Math.round(height)) });
  return d;
}

/** Drop one window onto another: it joins that window's stack as the visible tab. */
export function stackOnto(desk, id, targetId) {
  if (id === targetId) return desk;
  let d = clone(desk);
  const w = find(d, id), t = find(d, targetId);
  if (!w || !t) return desk;
  d = leave(d, id);
  const target = find(d, targetId), win = find(d, id);
  target.stack ??= newId('stk');
  Object.assign(win, { stack: target.stack, x: target.x, y: target.y, w: target.w, h: target.h, folded: target.folded });
  return focus(d, id);
}

/** Take a window out of its stack and put it at (x, y). */
export function unstack(desk, id, { x, y } = {}) {
  let d = clone(desk);
  const w = find(d, id);
  if (!w?.stack) return d;
  d = leave(d, id);
  const win = find(d, id);
  if (x != null) Object.assign(win, { x: Math.round(x), y: Math.round(y) });
  return focus(d, id);
}

/** Remove a window from its stack; a stack left with one window stops being a stack. */
function leave(d, id) {
  const w = find(d, id);
  if (!w.stack) return d;
  const others = wins(d).filter((x) => x.stack === w.stack && x.id !== id);
  w.stack = null;
  w.active = true;
  if (others.length === 1) others[0].stack = null;
  if (others.length && !others.some((x) => x.active)) others[0].active = true;
  return d;
}

export function close(desk, id) {
  let d = clone(desk);
  if (!find(d, id)) return d;
  d = leave(d, id);
  d.layouts[d.layout].windows = wins(d).filter((w) => w.id !== id);
  return d;
}

/** Flip `folded` (just the title bar shows) or `pinned` (stays on top). */
export function toggle(desk, id, key) {
  if (key !== 'folded' && key !== 'pinned') return desk;
  const d = clone(desk);
  const w = find(d, id);
  if (w) {
    const value = !w[key];
    for (const s of groupOf(d, w)) s[key] = value;
  }
  return d;
}

export function rename(desk, id, title) {
  const d = clone(desk);
  const w = find(d, id);
  if (w) w.title = String(title).slice(0, 80);
  return d;
}

/** Front-to-back drawing order: pinned windows always above the rest. */
export const paintOrder = (desk) => [...windowsOf(desk)].sort((a, b) => (a.pinned - b.pinned) || (a.z - b.z));

/* ---------- Named layouts ---------- */

export const layoutNames = (desk) => Object.keys(desk.layouts);

/** Save what's on the desk now under a new name, and switch to it. */
export function saveLayoutAs(desk, name) {
  const d = clone(desk);
  const n = String(name).trim().slice(0, 40);
  if (!n) return d;
  d.layouts[n] = clone(d.layouts[d.layout]);
  d.layout = n;
  return d;
}

export function switchLayout(desk, name) {
  if (!desk.layouts[name]) return desk;
  return { ...clone(desk), layout: name };
}

export function deleteLayout(desk, name) {
  const d = clone(desk);
  if (layoutNames(d).length < 2 || !d.layouts[name]) return d;
  delete d.layouts[name];
  if (d.layout === name) d.layout = layoutNames(d)[0];
  return d;
}

/** Make sure a desk loaded from storage has the expected shape. */
export function normalise(desk) {
  if (!desk || typeof desk !== 'object' || !desk.layouts || !Object.keys(desk.layouts).length) return emptyDesk();
  const d = clone(desk);
  if (!d.layouts[d.layout]) d.layout = Object.keys(d.layouts)[0];
  for (const l of Object.values(d.layouts)) l.windows = Array.isArray(l.windows) ? l.windows.filter((w) => w && w.id && w.plugin) : [];
  return d;
}
