import { h, ago } from '../ui/dom.js';

/**
 * The three phase-1 kinds of space: portfolio, gallery and ideas board.
 * ref = the space's id. The owner sees an editor; everyone else sees the
 * work, likes and comments.
 */

function footer(space, { api, me, open }) {
  const likes = h('span', {}, `${space.likes} like${space.likes === 1 ? '' : 's'}`);
  const list = h('ul', { class: 'comments' });
  const load = async () => {
    const { comments } = await api.get(`/api/spaces/${space.id}/comments`);
    list.replaceChildren(...comments.map((c) => h('li', {},
      h('button', { class: 'linkish', onclick: () => open('profile', c.handle) }, c.name), ' ',
      h('span', { class: 'muted' }, ago(c.created_at)), h('div', {}, c.body))));
  };
  const input = h('input', { type: 'text', placeholder: 'Say something kind and useful', maxLength: 2000, 'aria-label': 'Comment' });
  const form = h('form', { class: 'comment-form', onsubmit: async (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    await api.post('/api/signals', { kind: 'comment', spaceId: space.id, body: input.value });
    input.value = '';
    load();
  } }, input, h('button', { class: 'btn' }, 'Post'));
  load();
  return h('footer', { class: 'space-footer' },
    h('div', { class: 'btn-row' },
      h('button', { class: 'linkish', onclick: () => open('profile', space.owner.handle) }, `by ${space.owner.name}`),
      likes,
      me() && me().id !== space.owner.id && h('button', { class: 'btn', onclick: async () => {
        await api.post('/api/signals', { kind: 'like', spaceId: space.id });
        likes.textContent = 'Liked';
      } }, '♥ Like')),
    list, me() && form);
}

/** A list of items (title + note) the owner can add to, reorder and remove. */
function itemEditor(items, onSave, { addLabel }) {
  const wrap = h('div', { class: 'editor' });
  const draw = () => {
    wrap.replaceChildren(
      ...items.map((it, i) => h('div', { class: 'editor-row' },
        h('input', { value: it.title, 'aria-label': 'Title', oninput: (e) => { it.title = e.target.value; } }),
        h('input', { value: it.note ?? '', 'aria-label': 'Note', oninput: (e) => { it.note = e.target.value; } }),
        h('button', { class: 'win-btn', title: 'Move up', onclick: () => { if (i) { [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); } } }, '↑'),
        h('button', { class: 'win-btn', title: 'Remove', onclick: () => { items.splice(i, 1); draw(); } }, '×'))),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: () => { items.push({ id: crypto.randomUUID(), title: '', note: '' }); draw(); } }, addLabel),
        h('button', { class: 'btn primary', onclick: () => onSave(items) }, 'Save')));
  };
  draw();
  return wrap;
}

function spacePlugin({ title, tone, size, view, addLabel, key = 'items' }) {
  return {
    title, tone, size,
    async render(el, ctx) {
      const { api, win, me, setTitle } = ctx;
      let { space } = await api.get(`/api/spaces/${win.ref}`);
      setTitle(space.title);
      const mine = me()?.id === space.owner.id;
      let editing = false;
      const draw = () => {
        const items = space.content[key] ?? [];
        el.replaceChildren(
          mine && h('div', { class: 'btn-row right' }, h('button', { class: 'btn', onclick: () => { editing = !editing; draw(); } }, editing ? 'Done' : 'Edit')),
          editing
            ? itemEditor(structuredClone(items), async (next) => {
              ({ space } = await api.put(`/api/spaces/${space.id}`, { content: { ...space.content, [key]: next } }));
              editing = false;
              draw();
            }, { addLabel })
            : view(space, items),
          !editing && footer(space, ctx));
      };
      draw();
    },
  };
}

export const portfolio = spacePlugin({
  title: 'Portfolio', tone: 'cream', size: { w: 460, h: 440 }, addLabel: '+ Add work',
  view: (s, items) => h('ol', { class: 'portfolio' }, items.length ? items.map((it, i) => h('li', {},
    h('span', { class: 'index' }, String(i + 1).padStart(2, '0')), h('div', {}, h('strong', {}, it.title), h('div', { class: 'muted' }, it.note)))) : h('li', { class: 'muted' }, 'Nothing here yet.')),
});

export const gallery = spacePlugin({
  title: 'Gallery', tone: 'olive', size: { w: 560, h: 480 }, addLabel: '+ Add a piece',
  view: (s, items) => h('div', { class: `gallery frame-${s.content.frame ?? 'ornate'}` }, items.length ? items.map((it) => h('figure', {},
    h('div', { class: 'frame' }, it.url ? h('img', { src: it.url, alt: it.title, loading: 'lazy' }) : h('div', { class: 'frame-blank', 'aria-hidden': 'true' })),
    h('figcaption', {}, h('strong', {}, it.title), h('div', { class: 'muted' }, it.note)))) : h('p', { class: 'muted' }, 'No pieces yet.')),
});

export const ideas = spacePlugin({
  title: 'Ideas board', tone: 'sage', size: { w: 480, h: 420 }, addLabel: '+ Pin an idea', key: 'cards',
  view: (s, cards) => h('div', { class: 'pinboard' }, cards.length ? cards.map((c, i) => h('div', { class: `pin tone-${c.tone ?? ['sand', 'sage', 'coral', 'pink'].at(i % 4)}` }, c.text ?? c.title, c.note && h('div', { class: 'muted' }, c.note))) : h('p', { class: 'muted' }, 'An empty board. Pin the first idea.')),
});
