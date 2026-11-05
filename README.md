# soulscape

A shared desk for creatives. DJs, artists, designers, dancers and everyone in between show their work in windows, open each other's, stack them, and keep their desk exactly how they like it. The look is 90s window chrome in modern colours.

The plan behind it: [soulscape: first-draft platform plan](https://claude.ai/artifact/TiQUdUhLSWf2dAmbc9SMZ9).

Built the same way as Dashi: plain ES modules, HTML and CSS in the browser, Node's built-in SQLite on the server, no framework, no bundler, no dependencies.

## Run it

```
npm start     # http://localhost:5180
npm test      # unit and server tests
```

Node 22.13 or newer. On first start, three example people are added (`kemi@example.com`, `ade@example.com`, `mira@example.com`, password `soulscape-demo`), and the super admin's local sign-in is printed in the terminal.

## What's in phase 1

| Part | Where | What it does |
| --- | --- | --- |
| The desk | `src/desk/` | Draggable windows. Drop one title bar on another to stack them as tabs; drag a tab out to unstack. Resize from the corner, fold with a double-click, pin to keep on top. Named layouts, saved per person and per screen size. |
| Roles | `src/roles.js`, `server/permissions.js` | Three tiers (super admin, admin, user) and creative roles. Anyone can hold any mix of creative roles; each switches on plugins. Every permission check is in `can()` in one file. |
| Plugins | `src/plugins/` | Profile (the dossier card), Who's here, Portfolio, Gallery, Ideas board, Scene feed, My roles, Admin, and a Station placeholder for phase 2. |
| Server | `server/` | `app.js` (every API route), `db.js` (schema and audit log), `http.js` (helpers, security headers, borrowed from Dashi), `index.js` (static files and start-up). |
| Look | `public/theme.css` | Palette tokens from the mood images; each plugin picks a tone. |

## Adding a plugin

1. Write it in `src/plugins/` as `{ title, tone, size, render(el, ctx) }`.
2. List it in `src/plugins/index.js`.
3. Switch it on for one or more creative roles in `src/roles.js` (or add it to `CORE_PLUGINS` for everyone).
4. If it stores its own content, it can use spaces (`/api/spaces`) like Portfolio and Gallery do.

## Security

- The super admin exists only because `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` name them. Nothing in the app can create, promote or demote a super admin. In production the server refuses to start without a password of 16 or more characters.
- Super admin sessions last 8 hours (everyone else: 30 days). Changing someone's tier needs the password typed again within 15 minutes.
- Every admin and super admin action, and every admin sign-in, goes to an audit log whose entries are chained by hash; the Admin window says if an entry was edited.
- Passwords are hashed with scrypt; only a hash of each session id is stored; cookies are HttpOnly and SameSite; every change needs an `x-soulscape` header; there's a strict Content Security Policy; sign-in, sign-up and signals are rate limited.

## Deploy

Same as Dashi: `fly launch --no-deploy --copy-config`, create a volume, set `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` as secrets, then `fly deploy`. The steps are at the top of `fly.toml`. Or build the `Dockerfile` and run it anywhere with a disk mounted at `/data`.

## Next

- Passkey (WebAuthn) sign-in for the super admin, then TOTP for admins.
- Uploads for gallery images (re-encoded, metadata stripped), then audio for phase 2's Station and Sets archive.
- Self-hosted fonts and the design pass on the chrome.
