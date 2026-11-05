/**
 * Who can do what, shared by the server and the browser.
 *
 * Two separate ideas:
 *
 *   tier            how much authority someone has over the platform:
 *                   'super' (the super admin), 'admin' or 'user'.
 *                   Everyone has exactly one.
 *
 *   creative roles  what kind of creative someone is: DJ, dancer, artist...
 *                   A person holds as many as they like, in any mix, so an
 *                   artist can also be a DJ and a dancer. Roles are a list on
 *                   the user, never an account type, so adding one never
 *                   takes anything away.
 *
 * Each creative role switches on a starter set of plugins (window types).
 * Core plugins are on for everyone.
 */

export const TIERS = ['user', 'admin', 'super'];

export const CREATIVE_ROLES = [
  { id: 'dj', label: 'DJ', plugins: ['station'] },
  { id: 'artist', label: 'Visual artist', plugins: ['gallery'] },
  { id: 'photographer', label: 'Photographer', plugins: ['gallery'] },
  { id: 'designer', label: 'Designer', plugins: ['gallery'] },
  { id: 'dancer', label: 'Dancer', plugins: ['gallery'] },
  { id: 'musician', label: 'Musician / producer', plugins: ['station'] },
  { id: 'writer', label: 'Writer', plugins: [] },
  { id: 'videographer', label: 'Videographer', plugins: ['gallery'] },
  { id: 'curator', label: 'Curator', plugins: ['gallery'] },
  { id: 'promoter', label: 'Promoter', plugins: [] },
];

export const ROLE_IDS = CREATIVE_ROLES.map((r) => r.id);

/** Plugins every signed-in person has, whatever their roles. */
export const CORE_PLUGINS = ['profile', 'portfolio', 'ideas', 'feed', 'roles'];

/** Keep only known roles, once each, in the platform's order. */
export function cleanRoles(roles) {
  const want = new Set(Array.isArray(roles) ? roles : []);
  return ROLE_IDS.filter((id) => want.has(id));
}

/** The plugins someone can use: the core ones, plus those their roles switch on, plus admin tools. */
export function pluginsFor(user) {
  const out = new Set(CORE_PLUGINS);
  for (const id of user?.roles ?? []) for (const p of CREATIVE_ROLES.find((r) => r.id === id)?.plugins ?? []) out.add(p);
  if (user && atLeast(user.tier, 'admin')) out.add('admin');
  return [...out];
}

/** Is this tier at least as high as that one? */
export const atLeast = (tier, min) => TIERS.indexOf(tier) >= TIERS.indexOf(min);
