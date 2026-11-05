import { h, ago } from '../ui/dom.js';
import { CREATIVE_ROLES } from '../roles.js';

const VERB = { like: 'liked', comment: 'commented on', follow: 'followed', collab: 'asked to collab with' };

/** The scene feed: signals sent to you, and what the people you follow did. */
export const feed = {
  title: 'Scene feed',
  tone: 'coral',
  size: { w: 380, h: 420 },
  async render(el, { api, open }) {
    const { feed: rows } = await api.get('/api/feed');
    el.replaceChildren(rows.length ? h('ul', { class: 'list feed' }, rows.map((r) => h('li', {},
      h('button', { class: 'linkish', onclick: () => open('profile', r.from_handle) }, r.from_name), ` ${VERB[r.kind]} `,
      r.space_title ? h('em', {}, r.space_title) : h('span', {}, `@${r.to_handle}`),
      r.body && h('div', { class: 'quote' }, r.body),
      h('div', { class: 'muted' }, ago(r.created_at))))) : h('p', { class: 'muted' }, 'Quiet for now. Follow a few people from "Who\'s here" and their activity shows up here.'));
  },
};

/** Your name, bio and creative roles: as many roles as you need, in any mix. */
export const roles = {
  title: 'My roles',
  tone: 'marker',
  size: { w: 380, h: 460 },
  render(el, { api, me, signedIn }) {
    const u = me();
    const name = h('input', { value: u.name, maxLength: 80, 'aria-label': 'Name' });
    const bio = h('textarea', { rows: 3, maxLength: 2000, 'aria-label': 'Bio' }, u.bio ?? '');
    const boxes = CREATIVE_ROLES.map((r) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: r.id, checked: u.roles.includes(r.id) }), r.label));
    const status = h('p', { class: 'muted', 'aria-live': 'polite' });
    el.replaceChildren(h('form', { class: 'stack-form', onsubmit: async (e) => {
      e.preventDefault();
      try {
        const { user } = await api.put('/api/me', { name: name.value, bio: bio.value, roles: boxes.map((b) => b.firstChild).filter((c) => c.checked).map((c) => c.value) });
        status.textContent = 'Saved. Your start menu now shows the plugins your roles switch on.';
        signedIn(user);
      } catch (err) { status.textContent = err.message; }
    } },
      h('label', {}, 'Name', name), h('label', {}, 'Bio', bio),
      h('fieldset', {}, h('legend', {}, 'Creative roles (pick as many as fit)'), h('div', { class: 'checks' }, boxes)),
      h('button', { class: 'btn primary' }, 'Save'), status));
  },
};

/** The Station arrives in phase 2; for now it says so, in the 808 look. */
export const station = {
  title: 'Station',
  tone: 'stripes',
  size: { w: 420, h: 300 },
  render(el, { me }) {
    el.replaceChildren(h('div', { class: 'station-soon' },
      h('div', { class: 'steps', 'aria-hidden': 'true' }, Array.from({ length: 16 }, (_, i) => h('span', { class: `step s${Math.floor(i / 4)}` }))),
      h('h3', {}, `${me()?.name ?? 'Your'} station`),
      h('p', {}, 'Recorded sets, scheduled premieres everyone hears in sync, and your sets archive arrive in phase 2.')));
  },
};

/** Signing in or up. Shown to visitors. */
export const signin = {
  title: 'Sign in',
  tone: 'phosphor',
  size: { w: 360, h: 440 },
  render(el, { api, signedIn }) {
    let mode = 'in';
    const draw = () => {
      const f = (name, label, type = 'text', extra = {}) => h('label', {}, label, h('input', { name, type, required: true, ...extra }));
      const status = h('p', { class: 'error', 'aria-live': 'polite' });
      const form = h('form', { class: 'stack-form', onsubmit: async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        try {
          const { user } = await api.post(mode === 'in' ? '/api/login' : '/api/signup', data);
          signedIn(user);
        } catch (err) { status.textContent = err.message; }
      } },
        mode === 'up' && f('name', 'Name', 'text', { required: false, maxLength: 80 }),
        mode === 'up' && f('handle', 'Handle', 'text', { pattern: '[a-z0-9_]{2,24}', title: '2 to 24 lowercase letters, numbers or underscores' }),
        f('email', 'Email', 'email', { autocomplete: 'email' }),
        f('password', 'Password', 'password', { minLength: mode === 'up' ? 10 : 1, autocomplete: mode === 'in' ? 'current-password' : 'new-password' }),
        h('button', { class: 'btn primary' }, mode === 'in' ? 'Sign in' : 'Make my desk'),
        status,
        h('button', { type: 'button', class: 'linkish', onclick: () => { mode = mode === 'in' ? 'up' : 'in'; draw(); } },
          mode === 'in' ? 'New here? Sign up' : 'Have an account? Sign in'));
      el.replaceChildren(form);
    };
    draw();
  },
};

/** What soulscape is, for visitors. */
export const welcome = {
  title: 'soulscape',
  tone: 'stripes',
  size: { w: 440, h: 300 },
  render(el) {
    el.replaceChildren(h('div', { class: 'welcome' },
      h('h2', {}, 'A shared desk for creatives'),
      h('p', {}, 'DJs, artists, designers, dancers and everyone in between: show your work in windows, open other people\'s, stack them, and keep the desk just how you like it.'),
      h('p', { class: 'muted' }, 'Drag a title bar to move a window. Drop it on another title bar to stack them. Double-click to fold.')));
  },
};
