import { h, ago } from '../ui/dom.js';

/**
 * Admin console. Admins see everyone and can suspend users. The super
 * admin also makes and removes admins (after typing their password again)
 * and reads the audit log.
 */
export const admin = {
  title: 'Admin',
  tone: 'ink',
  size: { w: 640, h: 480 },
  async render(el, { api, me, open }) {
    const isSuper = me().tier === 'super';
    const status = h('p', { class: 'muted', 'aria-live': 'polite' });

    /** Run a change; if the server wants a fresh password first, ask for it and try once more. */
    async function act(fn) {
      try {
        await fn();
      } catch (e) {
        if (!/password again/.test(e.message)) return (status.textContent = e.message);
        const password = prompt('Type your password again to change tiers.');
        if (!password) return;
        try {
          await api.post('/api/reauth', { password });
          await fn();
        } catch (err) { return (status.textContent = err.message); }
      }
      status.textContent = 'Done.';
      draw();
    }

    async function draw() {
      const { users } = await api.get('/api/admin/users');
      const table = h('table', { class: 'grid' },
        h('thead', {}, h('tr', {}, ['Person', 'Email', 'Tier', 'Joined', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, users.map((u) => h('tr', { class: u.suspended ? 'off' : '' },
          h('td', {}, h('button', { class: 'linkish', onclick: () => open('profile', u.handle) }, u.name), h('div', { class: 'muted' }, `@${u.handle}`)),
          h('td', {}, u.email),
          h('td', {}, u.tier, u.suspended && h('div', { class: 'error' }, 'suspended')),
          h('td', {}, ago(u.createdAt)),
          h('td', {}, h('div', { class: 'btn-row' },
            u.tier !== 'super' && u.id !== me().id && (isSuper || u.tier === 'user') && h('button', { class: 'btn', onclick: () => act(async () => {
              const reason = u.suspended ? '' : prompt('Reason (kept in the audit log)') ?? '';
              await api.post(`/api/admin/users/${u.id}/suspend`, { suspended: !u.suspended, reason });
            }) }, u.suspended ? 'Restore' : 'Suspend'),
            isSuper && u.tier !== 'super' && h('button', { class: 'btn', onclick: () => act(() => api.post(`/api/admin/users/${u.id}/tier`, { tier: u.tier === 'admin' ? 'user' : 'admin' })) },
              u.tier === 'admin' ? 'Remove admin' : 'Make admin')))))));
      let log = null;
      if (isSuper) {
        const { entries, brokenAt } = await api.get('/api/admin/audit');
        log = h('section', {}, h('h3', {}, 'Audit log'),
          h('p', { class: brokenAt ? 'error' : 'muted' }, brokenAt ? `The log has been changed at entry ${brokenAt}.` : 'Every entry checks out.'),
          h('ul', { class: 'list audit' }, entries.map((e) => h('li', {}, h('code', {}, e.at.slice(0, 16).replace('T', ' ')), ` ${e.actor ?? '?'} ${e.action} ${e.target}`, e.detail && h('span', { class: 'muted' }, ` (${e.detail})`)))));
      }
      el.replaceChildren(h('h3', {}, 'People'), table, status, log);
    }
    await draw();
  },
};
