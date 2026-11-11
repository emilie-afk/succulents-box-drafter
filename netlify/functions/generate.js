// Netlify serverless function.
// Runs at /.netlify/functions/generate when the frontend POSTs to it.
// Keeps the Anthropic API key and the private style guide on the server.
// The style guide (voice rules, catalog, examples, per-style instructions) is
// private configuration in Netlify Blobs — see scripts/upload-style-guide.mjs.

const { loadGuide, buildPrompt } = require('../lib/style-guide');
const S = require('../lib/session');

const COMMON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: COMMON_HEADERS,
    body: JSON.stringify(body)
  };
}

function createHandler(deps = {}) {
  const env = deps.env || process.env;
  const now = deps.now || Date.now;
  const fetchImpl = deps.fetch || fetch;

  return async (event) => {
    if (event.httpMethod !== 'POST') {
      return respond(405, { error: 'Use POST' });
    }

    // Session check — independent of the login function, before any model call.
    // No valid session (or missing APP_PASSWORD / SESSION_SECRET) → 401.
    const headers = event.headers || {};
    // (The cookie is SameSite=Strict, so cross-site pages can't send it.)
    if (!S.verify(env, headers, now())) {
      return respond(401, { error: 'Not signed in' });
    }

    // Private guide, loaded only after the session check. Missing → clear error, no model call.
    const guide = await loadGuide(event, deps);
    if (!guide) {
      return respond(503, { error: 'Style guide is not configured on the server. Ask an admin to upload it.' });
    }

    // Parse body
    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (e) {
      return respond(400, { error: 'Invalid JSON body' });
    }

    const post = (body.post || '').toString().trim();
    const style = (body.style || 'auto').toString();
    if (!post) {
      return respond(400, { error: 'Missing post text' });
    }
    if (post.length > 2000) {
      return respond(400, { error: 'Post too long (max 2000 chars)' });
    }

    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return respond(500, { error: 'Server not configured' });
    }

    const prompt = buildPrompt(guide, post, style);


    try {
      const apiRes = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!apiRes.ok) {
        console.error('Anthropic API error status', apiRes.status);
        return respond(502, { error: 'Drafting failed (status ' + apiRes.status + '). Try again.' });
      }

      const data = await apiRes.json();
      const text = (data.content && data.content[0] && data.content[0].text) || '';
      const replies = text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && line.length < 200)
        .slice(0, 3);

      return respond(200, { replies });
    } catch (err) {
      return respond(500, { error: 'Server error. Try again.' });
    }
  };
}

exports.handler = createHandler();
exports.createHandler = createHandler;
