/**
 * Talking to the server. Every change sends the `x-soulscape` header the
 * server asks for (see server/app.js), and errors come back as thrown
 * Errors with the server's own message.
 */
async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json', 'x-soulscape': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `The server said ${res.status}.`), { status: res.status });
  return data;
}

export const api = {
  get: (path) => call('GET', path),
  post: (path, body = {}) => call('POST', path, body),
  put: (path, body = {}) => call('PUT', path, body),
};
