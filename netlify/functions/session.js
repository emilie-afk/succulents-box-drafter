// /api/session — shared-password login with an expiring, server-verified session.
//   POST   { password }  → sets an HttpOnly session cookie (12 h)
//   GET                  → 200 { authenticated: true, expiresAt } or 401
//   DELETE               → signs out (clears the cookie)
// The password is never stored in the browser.

const S = require('../lib/session');

function json(statusCode, body, extra = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
    body: JSON.stringify(body),
  };
}

function createHandler(deps = {}) {
  const env = deps.env || process.env;
  const now = deps.now || Date.now;

  return async (event) => {
    const headers = event.headers || {};
    if (!S.configured(env)) return json(503, { error: 'Sign-in is not configured.' });

    if (event.httpMethod === 'GET') {
      const s = S.verify(env, headers, now());
      return s ? json(200, { authenticated: true, expiresAt: s.expiresAt }) : json(401, { authenticated: false });
    }

    if (event.httpMethod === 'POST') {
      if (!S.sameOrigin(headers)) return json(403, { error: 'Forbidden' });
      let body = {};
      try { body = event.body ? JSON.parse(event.body) : {}; } catch { return json(400, { error: 'Invalid JSON body' }); }
      if (!S.checkPassword(env, body.password)) return json(401, { error: 'Wrong password' });
      const s = S.issue(env, now());
      return json(200, { authenticated: true, expiresAt: s.expiresAt }, { 'Set-Cookie': S.setCookie(s.value) });
    }

    if (event.httpMethod === 'DELETE') {
      if (!S.sameOrigin(headers)) return json(403, { error: 'Forbidden' });
      return json(200, { authenticated: false }, { 'Set-Cookie': S.clearCookie() });
    }

    return json(405, { error: 'Method not allowed' }, { Allow: 'GET, POST, DELETE' });
  };
}

exports.handler = createHandler();
exports.createHandler = createHandler;
