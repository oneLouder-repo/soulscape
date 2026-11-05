import { h } from '../ui/dom.js';
import * as L from './layout.js';

/**
 * The desk on screen: draws each window (or stack of windows) from the
 * layout state, and turns pointer drags into layout changes.
 *
 *   const desk = Desk(hostEl, { plugins, ctx, load, save });
 *   desk.open('gallery', spaceId, 'Halftone saints');
 *
 * - Drag a title bar to move a window. Drop it on another window's title
 *   bar to stack them as tabs.
 * - Drag a tab out of its stack's tab strip to unstack it.
 * - Drag the bottom-right corner to resize.
 * - Double-click a title bar to fold it to just the bar.
 *
 * The state lives in layout.js; this file only draws it and listens.
 * Every change is saved (debounced) through `save(desk)`.
 */
export function Desk(host, { plugins, ctx, initial, save }) {
  let state = L.normalise(initial);
  const frames = new Map(); // stack id or window id → { el, body, key }
  const bodies = new Map(); // window id → its rendered content, kept between redraws
  const layer = h('div', { class: 'desk-layer' });
  host.append(layer);
  let saveTimer;

  const view = () => ({ w: layer.clientWidth || innerWidth, h: layer.clientHeight || innerHeight });

  function set(next, { persist = true } = {}) {
    state = next;
    draw();
    if (persist) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => save(state), 500);
    }
    api.onchange?.(state);
  }

  /** One frame per stack (or per lone window); its tabs list the stack's windows. */
  function groups() {
    const out = new Map();
    for (const w of L.paintOrder(state)) {
      const key = w.stack ?? w.id;
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(w);
    }
    return out;
  }

  function draw() {
    const seen = new Set();
    let order = 1;
    for (const [key, members] of groups()) {
      seen.add(key);
      const active = members.find((w) => w.active) ?? members[0];
      let f = frames.get(key);
      if (!f) {
        f = makeFrame(key);
        frames.set(key, f);
        layer.append(f.el);
      }
      const plugin = plugins[active.plugin];
      Object.assign(f.el.style, { left: `${active.x}px`, top: `${active.y}px`, width: `${active.w}px`, height: active.folded ? '' : `${active.h}px`, zIndex: String(order++) });
      f.el.dataset.tone = plugin?.tone ?? 'cream';
      f.el.classList.toggle('folded', !!active.folded);
      f.el.classList.toggle('pinned', !!active.pinned);
      f.el.dataset.win = active.id;
      f.title.textContent = active.title;
      f.pin.setAttribute('aria-pressed', String(!!active.pinned));
      // Tabs only when stacked.
      f.tabs.replaceChildren(...(members.length > 1 ? members.map((w) => tab(w, w === active)) : []));
      f.el.classList.toggle('stacked', members.length > 1);
      // Show the active window's content; keep the others alive but hidden, so a playing track keeps playing.
      for (const w of members) {
        let b = bodies.get(w.id);
        if (!b) {
          b = h('div', { class: 'win-content' });
          bodies.set(w.id, b);
          renderBody(w, b);
        }
        if (b.parentNode !== f.body) f.body.append(b);
        b.hidden = w !== active;
      }
    }
    for (const [key, f] of frames) if (!seen.has(key)) { f.el.remove(); frames.delete(key); }
    const open = new Set(L.windowsOf(state).map((w) => w.id));
    for (const [id, b] of bodies) if (!open.has(id)) { b.remove(); bodies.delete(id); }
  }

  function renderBody(w, el) {
    const plugin = plugins[w.plugin];
    if (!plugin) {
      el.append(h('p', { class: 'muted' }, `This window's plugin (${w.plugin}) isn't available to you.`));
      return;
    }
    const winCtx = { ...ctx, win: w, setTitle: (t) => set(L.rename(state, w.id, t)), close: () => set(L.close(state, w.id)) };
    Promise.resolve(plugin.render(el, winCtx)).catch((err) => el.replaceChildren(h('p', { class: 'error' }, err.message)));
  }

  function tab(w, isActive) {
    const t = h('button', { class: `win-tab${isActive ? ' on' : ''}`, title: w.title }, w.title);
    t.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      set(L.focus(state, w.id));
      dragTab(e, w.id);
    });
    return t;
  }

  function makeFrame(key) {
    const title = h('span', { class: 'win-title' });
    const pin = h('button', { class: 'win-btn', title: 'Keep on top', 'aria-label': 'Keep on top', onclick: (e) => act(e, 'pin') }, '⌃');
    const bar = h('div', { class: 'win-bar' },
      h('span', { class: 'win-grip', 'aria-hidden': 'true' }),
      title,
      h('span', { class: 'win-btns' },
        pin,
        h('button', { class: 'win-btn', title: 'Fold', 'aria-label': 'Fold', onclick: (e) => act(e, 'fold') }, '_'),
        h('button', { class: 'win-btn', title: 'Close', 'aria-label': 'Close', onclick: (e) => act(e, 'close') }, '×')));
    const tabs = h('div', { class: 'win-tabs' });
    const body = h('div', { class: 'win-body' });
    const grow = h('div', { class: 'win-grow', title: 'Resize' });
    const el = h('section', { class: 'win', role: 'dialog', 'data-key': key }, bar, tabs, body, grow);

    const activeId = () => el.dataset.win;
    function act(e, what) {
      e.stopPropagation();
      const id = activeId();
      if (what === 'pin') set(L.toggle(state, id, 'pinned'));
      if (what === 'fold') set(L.toggle(state, id, 'folded'));
      if (what === 'close') set(L.close(state, id));
    }
    el.addEventListener('pointerdown', () => {
      const id = activeId();
      const w = L.windowsOf(state).find((x) => x.id === id);
      if (w && L.paintOrder(state).at(-1)?.id !== id) set(L.focus(state, id), { persist: false });
    });
    bar.addEventListener('dblclick', () => set(L.toggle(state, activeId(), 'folded')));
    bar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.win-btn')) return;
      dragFrame(e, activeId(), el);
    });
    grow.addEventListener('pointerdown', (e) => resizeFrame(e, activeId(), el));
    return { el, body, title, tabs, pin };
  }

  /** Follow the pointer until it's released; `onmove(dx, dy, e)` each step, `onend(e)` at the end. */
  function track(e, onmove, onend) {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const mv = (ev) => onmove(ev.clientX - sx, ev.clientY - sy, ev);
    const up = (ev) => {
      removeEventListener('pointermove', mv);
      removeEventListener('pointerup', up);
      document.body.classList.remove('dragging');
      onend(ev);
    };
    document.body.classList.add('dragging');
    addEventListener('pointermove', mv);
    addEventListener('pointerup', up);
  }

  /** The title bar under the pointer, other than the one being dragged. */
  function barUnder(ev, except) {
    for (const el of document.elementsFromPoint(ev.clientX, ev.clientY)) {
      const frame = el.closest?.('.win');
      if (frame && frame !== except && el.closest('.win-bar, .win-tabs')) return frame;
    }
    return null;
  }

  function dragFrame(e, id, el) {
    const w = L.windowsOf(state).find((x) => x.id === id);
    const start = { x: w.x, y: w.y };
    let target = null;
    track(e, (dx, dy, ev) => {
      el.style.left = `${start.x + dx}px`;
      el.style.top = `${start.y + dy}px`;
      target?.classList.remove('drop-target');
      target = barUnder(ev, el);
      target?.classList.add('drop-target');
    }, (ev) => {
      target?.classList.remove('drop-target');
      const pos = L.clamp({ ...w, x: start.x + ev.clientX - e.clientX, y: start.y + ev.clientY - e.clientY }, view());
      if (target) set(L.stackOnto(L.move(state, id, pos), id, target.dataset.win));
      else set(L.move(state, id, pos));
    });
  }

  function dragTab(e, id) {
    let ghost = null;
    track(e, (dx, dy, ev) => {
      if (!ghost && Math.hypot(dx, dy) > 12) {
        ghost = h('div', { class: 'tab-ghost' }, L.windowsOf(state).find((x) => x.id === id)?.title ?? '');
        document.body.append(ghost);
      }
      if (ghost) Object.assign(ghost.style, { left: `${ev.clientX + 8}px`, top: `${ev.clientY + 8}px` });
    }, (ev) => {
      if (!ghost) return;
      ghost.remove();
      const box = layer.getBoundingClientRect();
      const target = barUnder(ev, null);
      if (target && target.dataset.win !== id && !target.contains(e.target)) set(L.stackOnto(state, id, target.dataset.win));
      else if (!target) set(L.unstack(state, id, { x: ev.clientX - box.left - 40, y: ev.clientY - box.top - 12 }));
    });
  }

  function resizeFrame(e, id, el) {
    const w = L.windowsOf(state).find((x) => x.id === id);
    track(e, (dx, dy) => {
      el.style.width = `${Math.max(L.MIN.w, w.w + dx)}px`;
      el.style.height = `${Math.max(L.MIN.h, w.h + dy)}px`;
    }, (ev) => set(L.resize(state, id, { w: w.w + ev.clientX - e.clientX, h: w.h + ev.clientY - e.clientY })));
  }

  const api = {
    get state() { return state; },
    open(plugin, ref = '', title, size) {
      const p = plugins[plugin];
      const want = { ...(p?.size ?? { w: 420, h: 360 }), ...(size ?? {}) };
      // New windows land beside the front window if there's room, so they don't cover what opened them.
      const front = L.paintOrder(state).at(-1);
      if (front && want.x == null) {
        const v = view();
        const right = front.x + front.w + 16;
        if (right + want.w <= v.w) Object.assign(want, { x: right, y: front.y });
        else Object.assign(want, { x: Math.max(8, Math.min(front.x + 32, v.w - want.w - 8)), y: Math.min(front.y + 32, Math.max(0, v.h - 120)) });
      }
      const r = L.open(state, { plugin, ref, title: title ?? p?.title ?? plugin, ...want });
      set(r.desk);
      return r.id;
    },
    focus: (id) => set(L.focus(state, id)),
    close: (id) => set(L.close(state, id)),
    saveLayoutAs: (name) => set(L.saveLayoutAs(state, name)),
    switchLayout: (name) => { for (const b of bodies.values()) b.remove(); bodies.clear(); set(L.switchLayout(state, name)); },
    deleteLayout: (name) => set(L.deleteLayout(state, name)),
    /** Re-draw every window's content (after signing in, or changing roles). */
    refresh() { for (const b of bodies.values()) b.remove(); bodies.clear(); draw(); },
    onchange: null,
  };
  draw();
  return api;
}
