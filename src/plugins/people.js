import { h } from '../ui/dom.js';
import { CREATIVE_ROLES, pluginsFor } from '../roles.js';

const roleLabel = (id) => CREATIVE_ROLES.find((r) => r.id === id)?.label ?? id;
const SPACE_KINDS = { portfolio: 'Portfolio', gallery: 'Gallery', ideas: 'Ideas board' };

/**
 * Profile card, styled after the "subject dossier": a person's file, with
 * labelled rows, their roles, and their spaces to open. ref = handle.
 */
export const profile = {
  title: 'Profile',
  tone: 'phosphor',
  size: { w: 440, h: 460 },
  async render(el, { api, win, open, me, setTitle }) {
    const { person, spaces } = await api.get(`/api/people/${encodeURIComponent(win.ref)}`);
    setTitle(`FILE: ${person.handle.toUpperCase()}`);
    const mine = me()?.id === person.id;
    const row = (k, v) => h('div', { class: 'dossier-row' }, h('span', {}, k), h('span', {}, v));
    const status = h('p', { class: 'muted', 'aria-live': 'polite' });
    const send = async (kind, body) => {
      try {
        await api.post('/api/signals', { kind, handle: person.handle, body });
        status.textContent = kind === 'follow' ? 'Following.' : 'Request sent.';
      } catch (e) { status.textContent = e.message; }
    };
    const kinds = mine ? pluginsFor(me()).filter((p) => SPACE_KINDS[p]) : [];
    el.replaceChildren(h('div', { class: 'dossier' },
      h('div', { class: 'dossier-head' }, h('div', { class: 'dossier-portrait', 'aria-hidden': 'true' }, person.name.slice(0, 1)),
        h('div', {}, h('div', { class: 'dossier-name' }, person.name), h('div', { class: 'muted' }, `@${person.handle}`))),
      row('FUNCTION', person.roles.length ? person.roles.map(roleLabel).join(' / ') : '—'),
      person.tier && row('CLEARANCE', person.tier.toUpperCase()),
      row('SPACES', String(spaces.length)),
      person.bio && h('p', { class: 'dossier-bio' }, person.bio),
      h('div', { class: 'dossier-label' }, 'OPEN A SPACE'),
      h('div', { class: 'chip-row' }, spaces.length
        ? spaces.map((s) => h('button', { class: 'chip', onclick: () => open(s.plugin, s.id, s.title) }, `${SPACE_KINDS[s.plugin] ?? s.plugin}: ${s.title}`))
        : h('span', { class: 'muted' }, 'Nothing published yet.')),
      !mine && me() && h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => send('follow') }, 'Follow'),
        h('button', { class: 'btn primary', onclick: () => {
          const text = prompt(`What would you like to make with ${person.name}?`);
          if (text) send('collab', text);
        } }, 'Request to collab')),
      mine && h('div', {}, h('div', { class: 'dossier-label' }, 'NEW SPACE'), h('div', { class: 'chip-row' },
        kinds.map((k) => h('button', { class: 'chip', onclick: async () => {
          const title = prompt(`Name your new ${SPACE_KINDS[k].toLowerCase()}`);
          if (!title) return;
          const { space } = await api.post('/api/spaces', { plugin: k, title, content: {} });
          open(k, space.id, space.title);
        } }, `+ ${SPACE_KINDS[k]}`)))),
      status));
  },
};

/** Everyone on the platform, filterable by role. */
export const people = {
  title: "Who's here",
  tone: 'sand',
  size: { w: 380, h: 420 },
  async render(el, { api, open }) {
    const { people: list } = await api.get('/api/people');
    const filter = h('select', { 'aria-label': 'Filter by role' }, h('option', { value: '' }, 'Every role'), CREATIVE_ROLES.map((r) => h('option', { value: r.id }, r.label)));
    const ul = h('ul', { class: 'list' });
    const draw = () => ul.replaceChildren(...list.filter((p) => !filter.value || p.roles.includes(filter.value)).map((p) =>
      h('li', {}, h('button', { class: 'linkish', onclick: () => open('profile', p.handle) }, p.name), ' ',
        h('span', { class: 'muted' }, `@${p.handle}`), h('div', { class: 'tags' }, p.roles.map((r) => h('span', { class: 'tag' }, roleLabel(r)))))));
    filter.addEventListener('change', draw);
    draw();
    el.replaceChildren(h('div', { class: 'search-bar' }, filter), ul);
  },
};
