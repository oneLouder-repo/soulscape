/**
 * Starts the web server: the API under /api, the browser code under /src,
 * and the pages and styles in public/. Nothing else on disk is served.
 */
import { createServer } from 'node:http';
import { join, normalize, sep } from 'node:path';
import { config } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { seed } from './seed.js';
import { HttpError, send, json, sendFile, securityHeaders } from './http.js';

/** Turn a URL path into a file inside `dir`, or null if it would step outside it. */
function inside(dir, urlPath) {
  const file = normalize(join(dir, decodeURIComponent(urlPath)));
  return file.startsWith(dir + sep) ? file : null;
}

export function makeServer(db) {
  const app = createApp(db);
  const pub = join(config.root, 'public');
  const src = join(config.root, 'src');

  const server = createServer(async (req, res) => {
    securityHeaders(res);
    const path = new URL(req.url, 'http://x').pathname;
    try {
      if (path === '/healthz') return send(res, 200, 'ok');
      if (path.startsWith('/api/')) return await app.handle(req, res, path);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      if (path.startsWith('/src/')) {
        const file = inside(src, path.slice(4));
        return file ? sendFile(req, res, file) : send(res, 404, 'Not found');
      }
      // Every other address is the desk (index.html) or a file in public/.
      const file = path === '/' || path.startsWith('/@') ? join(pub, 'index.html') : inside(pub, path);
      return file ? sendFile(req, res, file) : send(res, 404, 'Not found');
    } catch (err) {
      if (err instanceof HttpError) return json(res, err.status, { error: err.message });
      console.error(err);
      return json(res, 500, { error: 'Something went wrong on the server.' });
    }
  });
  return { server, app };
}

export async function start() {
  if (config.production && config.superAdmin.password.length < 16) {
    throw new Error('Set SUPER_ADMIN_PASSWORD to a passphrase of at least 16 characters before running in production.');
  }
  const db = openDb(config.dataDir);
  const { server, app } = makeServer(db);
  await app.ensureSuper();
  if (config.seedExamples) await seed(db, app);
  server.listen(config.port, () => {
    console.log(`soulscape ${config.version} on http://localhost:${config.port}`);
    if (!config.production) console.log(`Super admin: ${config.superAdmin.email} / ${config.superAdmin.password}`);
  });
  return server;
}
