/**
 * Settings, from environment variables (or a .env file next to
 * package.json; see .env.example). Everything has a default that works
 * on localhost, so `npm start` runs with no setup.
 */
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { readFileSync } from 'node:fs';

const env = process.env;
const root = fileURLToPath(new URL('..', import.meta.url));
const production = env.NODE_ENV === 'production';

export const config = {
  root,
  version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
  production,
  port: Number(env.PORT) || 5180,
  /** http on localhost; https everywhere else (behind the host's TLS). */
  https: env.HTTPS ? env.HTTPS === 'true' : production,
  dataDir: resolve(root, env.DATA_DIR || 'data'),
  /**
   * The super admin is named here and only here. No request to the app can
   * create, promote or demote one. In production the password must be set
   * and long; see server/index.js.
   */
  superAdmin: {
    email: (env.SUPER_ADMIN_EMAIL || 'super@localhost').toLowerCase(),
    name: env.SUPER_ADMIN_NAME || 'Super admin',
    password: env.SUPER_ADMIN_PASSWORD || (production ? '' : 'soulscape-local-only'),
  },
  /** Anyone can sign up (the plan's decision for the alpha). */
  openSignup: env.OPEN_SIGNUP ? env.OPEN_SIGNUP === 'true' : true,
  /** Behind a host's proxy (Fly.io, Render…): read the visitor's address from X-Forwarded-For. */
  trustProxy: env.TRUST_PROXY === 'true',
  /** Everyday sessions last a month; super admin sessions only a working day. */
  sessionDays: Number(env.SESSION_DAYS) || 30,
  superSessionHours: Number(env.SUPER_SESSION_HOURS) || 8,
  /** Changing tiers needs a password typed within this many minutes. */
  freshMinutes: 15,
  maxJsonKb: 512,
  /** Fill the platform with a few example creatives on first start. */
  seedExamples: env.SEED_EXAMPLES ? env.SEED_EXAMPLES === 'true' : !production,
};
