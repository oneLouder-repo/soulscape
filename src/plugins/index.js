/**
 * The plugins: every kind of window soulscape can open. A plugin is
 *
 *   { title, tone, size: { w, h }, render(el, ctx) }
 *
 * `tone` picks its colour from the palette in public/theme.css.
 * `render` fills `el`; ctx gives it { api, me(), open(plugin, ref, title),
 * signedIn(user), win, setTitle(text), close() }.
 *
 * Which plugins a person can use comes from src/roles.js (core plugins for
 * everyone, more for each creative role, admin for admins). To add one:
 * write it, list it here, and switch it on for a role in roles.js.
 */
import { profile, people } from './people.js';
import { portfolio, gallery, ideas } from './spaces.js';
import { feed, roles, station, signin, welcome } from './scene.js';
import { admin } from './admin.js';

export const PLUGINS = { profile, people, portfolio, gallery, ideas, feed, roles, station, signin, welcome, admin };

/** What the start menu offers to open fresh (spaces open from a profile instead). */
export const LAUNCHABLE = ['profile', 'people', 'feed', 'roles', 'station', 'admin'];
