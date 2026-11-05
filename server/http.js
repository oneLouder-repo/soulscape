/** Small helpers for Node's http module, so the server needs no framework. */
import { createReadStream, statSync } from 'node:fs';
import { extname } from 'node:path';
import { config } from './config.js';

export const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function send(res, status, body = '', headers = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

export const json = (res, status, value, headers = {}) =>
  send(res, status, JSON.stringify(value), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });

export const redirect = (res, location, headers = {}) => send(res, 302, '', { location, ...headers });

/** A simple HTML page for messages (sign-in problems and the like). */
export function page(res, status, title, message, link = { href: '/', label: 'Back' }) {
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  send(res, status, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>body{font:16px/1.5 ui-monospace,monospace;max-width:520px;margin:12vh auto;padding:0 20px;background:#141210;color:#F1E6D2}a{color:#E2725B}</style>
<h1>${esc(title)}</h1><p>${esc(message)}</p><p><a href="${esc(link.href)}">${esc(link.label)}</a></p>`, { 'content-type': 'text/html; charset=utf-8' });
}

export function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) { reject(new HttpError(413, 'Too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req, limitBytes) {
  const buf = await readBody(req, limitBytes);
  try {
    return JSON.parse(buf.toString('utf8') || 'null');
  } catch {
    throw new HttpError(400, 'Not JSON');
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name, value, { maxAge, secure, httpOnly = true } = {}) {
  return [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Lax', httpOnly && 'HttpOnly', secure && 'Secure', maxAge != null && `Max-Age=${maxAge}`]
    .filter(Boolean).join('; ');
}

/** Send a file, honouring Range requests (so audio can be skipped through). */
export function sendFile(req, res, file, { type, cache = 'no-cache', headers = {} } = {}) {
  let stat;
  try {
    stat = statSync(file);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    return send(res, 404, 'Not found');
  }
  const base = {
    'content-type': type ?? TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'accept-ranges': 'bytes',
    'cache-control': cache,
    'last-modified': stat.mtime.toUTCString(),
    ...headers,
  };
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range) {
    let start = range[1] === '' ? stat.size - Number(range[2]) : Number(range[1]);
    let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, stat.size - 1);
    if (start > end || start >= stat.size) return send(res, 416, '', { 'content-range': `bytes */${stat.size}` });
    res.writeHead(206, { ...base, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...base, 'content-length': stat.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

/**
 * The visitor's address. Behind a host's proxy (Fly.io, Render, a load
 * balancer) every request comes from the proxy, so with TRUST_PROXY=true the
 * address is read from X-Forwarded-For instead: the last entry, which is the
 * one the proxy itself added (earlier ones are whatever the client sent).
 */
export function clientIp(req) {
  if (config.trustProxy) {
    const hops = String(req.headers['x-forwarded-for'] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (hops.length) return hops.at(-1);
  }
  return req.socket.remoteAddress ?? '?';
}

/**
 * Headers on every response.
 * - CSP: scripts and connections only from this address; no plugins; nobody
 *   else can frame the pages. Styles allow inline (the app sets style
 *   attributes), images and audio allow https (logos and cover art by URL).
 * - HSTS: once on https, browsers never fall back to http.
 */
export const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:", "media-src 'self' data: blob: https:", "font-src 'self' data:",
  "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'",
].join('; ');
export function securityHeaders(res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'same-origin');
  res.setHeader('x-frame-options', 'SAMEORIGIN');
  res.setHeader('content-security-policy', CSP);
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  if (config.https) res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
}
