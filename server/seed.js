/**
 * A few example creatives, so a fresh local copy has people to visit.
 * Runs once, on an empty database, and never in production unless
 * SEED_EXAMPLES=true. Every example signs in with the password below.
 */
import { randomUUID } from 'node:crypto';
import { now } from './db.js';
import { hashPassword } from './app.js';

export const EXAMPLE_PASSWORD = 'soulscape-demo';

const PEOPLE = [
  { handle: 'kemi', name: 'Kemi A.', bio: 'Painter by day, selector by night. Dances when nobody is filming.', roles: ['artist', 'dj', 'dancer'],
    spaces: [
      { plugin: 'gallery', title: 'Halftone saints', content: { frame: 'ornate', items: [
        { id: 'g1', title: 'Saint of the low end', note: 'Acrylic and screenprint, 2025' },
        { id: 'g2', title: 'Cameo for Yaa', note: 'Ink on paper' },
        { id: 'g3', title: 'Bassbin altar', note: 'Mixed media' },
      ] } },
      { plugin: 'ideas', title: 'Zine about sound systems', content: { cards: [
        { id: 'i1', title: 'Photograph every speaker stack at carnival', tone: 'sand' },
        { id: 'i2', title: 'Interview the builders, not just the selectors', tone: 'sage' },
        { id: 'i3', title: 'Looking for a designer to collab on layout', tone: 'coral' },
      ] } },
    ] },
  { handle: 'ade', name: 'Ade O.', bio: 'Producer and DJ. Broken beat, dub, anything with an 808 in it.', roles: ['dj', 'musician'],
    spaces: [
      { plugin: 'portfolio', title: 'Selected work', content: { items: [
        { id: 'p1', title: 'Night bus EP', note: 'Four tracks, self-released' },
        { id: 'p2', title: 'Resident, Low End Theory', note: 'Monthly since 2023' },
      ] } },
    ] },
  { handle: 'mira', name: 'Mira T.', bio: 'Designer. Type, posters, interfaces that look like 1997.', roles: ['designer'], spaces: [] },
];

export async function seed(db, app) {
  if (db.prepare("SELECT COUNT(*) AS n FROM users WHERE tier = 'user'").get().n > 0) return;
  const hash = await hashPassword(EXAMPLE_PASSWORD);
  for (const p of PEOPLE) {
    const id = randomUUID();
    db.prepare('INSERT INTO users (id, email, handle, name, bio, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, `${p.handle}@example.com`, p.handle, p.name, p.bio, hash, now());
    app.setRoles(id, p.roles);
    for (const s of p.spaces) {
      db.prepare('INSERT INTO spaces (id, owner_id, plugin, title, json, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), id, s.plugin, s.title, JSON.stringify(s.content), now());
    }
  }
  console.log(`Example people added: ${PEOPLE.map((p) => `${p.handle}@example.com`).join(', ')} (password: ${EXAMPLE_PASSWORD})`);
}
