/**
 * Every permission check on the platform, in one readable place.
 *
 *   can(actor, action, target)  → true or false
 *
 * `actor` is the signed-in user ({ id, tier, roles, suspended, fresh }), or
 * null for a visitor. `fresh` is true when they typed their password in the
 * last few minutes (config.freshMinutes). `target` depends on the action.
 *
 * If an action isn't listed here, nobody can do it.
 */
import { atLeast, pluginsFor } from '../src/roles.js';

const active = (a) => !!a && !a.suspended;
const isAdmin = (a) => active(a) && atLeast(a.tier, 'admin');
const isSuper = (a) => active(a) && a.tier === 'super';

const RULES = {
  /** Spaces (a portfolio, gallery, ideas board...). target: the space. */
  'space.view': (a, s) => !s.hidden && (s.visibility === 'public' || (active(a) && s.visibility === 'members')) || a?.id === s.owner_id || isAdmin(a),
  'space.create': (a, plugin) => active(a) && pluginsFor(a).includes(plugin),
  'space.edit': (a, s) => active(a) && a.id === s.owner_id,
  /** Admins can hide a space after a report; they can't change what's in it. */
  'space.hide': (a) => isAdmin(a),

  /** Likes, comments, follows, collab requests. target: the space or user it's about. */
  'signal.send': (a) => active(a),

  /** Moderation. target: the user being acted on. */
  'user.list': (a) => isAdmin(a),
  'user.suspend': (a, u) => isAdmin(a) && a.id !== u.id && u.tier === 'user' || (isSuper(a) && u.tier === 'admin'),

  /**
   * Making or removing admins: the super admin only, only with a fresh
   * password, and never on another super admin (those come from the
   * server's settings, not from the app).
   */
  'user.setTier': (a, u) => isSuper(a) && !!a.fresh && u.tier !== 'super',

  /** The audit log of every admin action. */
  'audit.read': (a) => isSuper(a),
};

export function can(actor, action, target) {
  const rule = RULES[action];
  return rule ? !!rule(actor, target) : false;
}

export const ACTIONS = Object.keys(RULES);
