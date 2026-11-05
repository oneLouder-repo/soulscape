/**
 * soulscape in the browser: load who's signed in, load their desk, and
 * draw the taskbar along the bottom.
 *
 * Visitors get a fixed desk (welcome, sign in, who's here). Signed-in
 * people get their own saved desk, one per screen-size band, kept on the
 * server and in this browser so it appears instantly.
 */
import { h } from './ui/dom.js';
import { api } from './api.js';
import { Desk } from './desk/Desk.js';
import { bandFor, emptyDesk, layoutNames, normalise } from './desk/layout.js';
import { PLUGINS, LAUNCHABLE } from './plugins/index.js';
import { pluginsFor } from './roles.js';

const root = document.getElementById('app');
let me = null;
let desk = null;

const band = () => bandFor(innerWidth);
const localKey = () => `soulscape.desk.${me?.id ?? 'visitor'}.${band()}`;
const readLocal = () => { try { return JSON.parse(localStorage.getItem(localKey())); } catch { return null; } };
const writeLocal = (d) => { try { localStorage.setItem(localKey(), JSON.stringify(d)); } catch { /* private window: fine */ } };

/** Only the plugins this person may use (plus the visitor ones when signed out). */
function allowedPlugins() {
  const ids = me ? [...pluginsFor(me), 'people', 'gallery', 'portfolio', 'ideas'] : ['welcome', 'signin', 'people', 'profile', 'gallery', 'portfolio', 'ideas'];
  return Object.fromEntries(ids.filter((id) => PLUGINS[id]).map((id) => [id, PLUGINS[id]]));
}

async function boot() {
  ({ user: me } = await api.get('/api/session'));
  root.replaceChildren();
  const surface = h('main', { class: 'desk', 'aria-label': 'Desk' });
  const taskbar = h('nav', { class: 'taskbar', 'aria-label': 'Taskbar' });
  root.append(surface, taskbar);

  let initial;
  if (me) {
    initial = readLocal();
    const server = await api.get(`/api/desk/${band()}`).catch(() => ({ desk: null }));
    if (server.desk) initial = server.desk;
  }
  const isNew = !initial;
  initial = normalise(initial ?? emptyDesk());

  desk = Desk(surface, {
    plugins: allowedPlugins(),
    initial,
    ctx: { api, me: () => me, open: (p, ref, title) => desk.open(p, ref, title), signedIn },
    save: (d) => {
      if (!me) return;
      writeLocal(d);
      api.put(`/api/desk/${band()}`, { desk: d }).catch(() => {});
    },
  });

  if (isNew) firstDesk();
  // A link like /@kemi opens that person's profile.
  const at = location.pathname.match(/^\/@([a-z0-9_]+)$/);
  if (at) desk.open('profile', at[1]);

  drawTaskbar(taskbar);
  desk.onchange = () => drawTaskbar(taskbar);
}

/** What a desk starts with. */
function firstDesk() {
  if (!me) {
    desk.open('welcome', '', undefined, { x: 32, y: 32 });
    desk.open('signin', '', undefined, { x: 500, y: 60 });
    desk.open('people', '', undefined, { x: 900, y: 40 });
    return;
  }
  desk.open('profile', me.handle, undefined, { x: 32, y: 24 });
  desk.open('feed', '', undefined, { x: 500, y: 40 });
  desk.open('people', '', undefined, { x: 900, y: 56 });
  if (!me.roles.length) desk.open('roles', '', undefined, { x: 520, y: 120 });
}

/** After signing in, or changing roles: start again so the start menu and windows catch up. */
function signedIn(user) {
  me = user;
  return boot();
}

function drawTaskbar(bar) {
  const d = desk.state;
  const start = h('details', { class: 'start' },
    h('summary', { class: 'start-btn' }, 'soulscape'),
    h('div', { class: 'start-menu' },
      me ? LAUNCHABLE.filter((id) => allowedPlugins()[id]).map((id) => h('button', { onclick: (e) => {
        e.target.closest('details').open = false;
        desk.open(id, id === 'profile' ? me.handle : '', id === 'profile' ? undefined : PLUGINS[id].title);
      } }, PLUGINS[id].title)) : h('button', { onclick: () => desk.open('signin') }, 'Sign in'),
      me && h('hr'),
      me && h('button', { onclick: async () => { await api.post('/api/logout'); me = null; boot(); } }, 'Sign out')));

  const windows = h('div', { class: 'task-windows' }, d.layouts[d.layout].windows.map((w) =>
    h('button', { class: 'task-win', title: w.title, onclick: () => desk.focus(w.id) }, w.title)));

  const layouts = me && h('select', { class: 'layouts', 'aria-label': 'Layout', onchange: (e) => {
    const v = e.target.value;
    if (v === '__new') {
      const name = prompt('Name this layout (it starts as a copy of what is on your desk now)');
      if (name) desk.saveLayoutAs(name); else drawTaskbar(bar);
    } else if (v === '__delete') {
      if (confirm(`Delete the layout "${d.layout}"?`)) desk.deleteLayout(d.layout); else drawTaskbar(bar);
    } else desk.switchLayout(v);
  } }, layoutNames(d).map((n) => h('option', { value: n, selected: n === d.layout }, n)),
  h('option', { value: '__new' }, '+ Save as new layout'),
  layoutNames(d).length > 1 && h('option', { value: '__delete' }, '− Delete this layout'));

  const clock = h('span', { class: 'clock' }, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  bar.replaceChildren(...[start, windows, layouts, me && h('span', { class: 'who' }, `@${me.handle}`), clock].filter(Boolean));
}

setInterval(() => { const c = document.querySelector('.clock'); if (c) c.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }, 30e3);

boot().catch((err) => {
  root.replaceChildren(h('p', { class: 'error' }, `soulscape couldn't start: ${err.message}`));
});

