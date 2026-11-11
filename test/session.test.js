// Run: npm test  (node:test; mocked model provider, fictional credentials)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const session = require('../netlify/functions/session.js');
const generate = require('../netlify/functions/generate.js');
const S = require('../netlify/lib/session.js');

const NOW = 1_800_000_000_000;
const GUIDE = fs.readFileSync(path.join(__dirname, '..', 'docs', 'style-guide.example.json'), 'utf8');
const blobReads = [];
const getStore = (n) => ({ get: async (k) => { blobReads.push(n + '/' + k); return GUIDE; } });
const ENV = { APP_PASSWORD: 'fictional-shared-pass', SESSION_SECRET: 'fictional-session-secret-0123456789abcdef', ANTHROPIC_API_KEY: 'test-key-not-real' };

function mockModel() {
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => { calls.push(init); return new Response(JSON.stringify({ content: [{ text: 'reply one 🪴\nreply two 🌱\nreply three 💚' }] }), { status: 200 }); },
  };
}
const cookieFrom = (r) => (r.headers['Set-Cookie'] || '').split(';')[0];
async function login(env = ENV, now = NOW, password = ENV.APP_PASSWORD, headers = {}) {
  const h = session.createHandler({ env, now: () => now });
  return h({ httpMethod: 'POST', headers: { host: 'drafter.example', ...headers }, body: JSON.stringify({ password }) });
}

test('login sets an HttpOnly, Secure, SameSite=Strict expiring cookie without the password', async () => {
  const r = await login();
  assert.equal(r.statusCode, 200);
  const c = r.headers['Set-Cookie'];
  for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=43200', 'Path=/']) assert.ok(c.includes(attr), attr);
  assert.ok(!c.includes(ENV.APP_PASSWORD));
  assert.ok(!r.body.includes(ENV.APP_PASSWORD));
  assert.equal((await login(ENV, NOW, 'wrong')).statusCode, 401);
  assert.equal((await login(ENV, NOW, null)).statusCode, 401);
  assert.equal((await login(ENV, NOW, ENV.APP_PASSWORD, { origin: 'https://evil.example' })).statusCode, 403);
});

test('missing or weak configuration denies login and drafting', async () => {
  for (const env of [{ ...ENV, APP_PASSWORD: '' }, { ...ENV, SESSION_SECRET: '' }, { ...ENV, SESSION_SECRET: 'short' }]) {
    assert.equal((await login(env)).statusCode, 503);
    const m = mockModel();
    const g = generate.createHandler({ env, now: () => NOW, fetch: m.fetch, getStore });
    // even a cookie that was valid under the full configuration is refused
    const cookie = cookieFrom(await login());
    const r = await g({ httpMethod: 'POST', headers: { cookie }, body: JSON.stringify({ post: 'hi' }) });
    assert.equal(r.statusCode, 401);
    assert.equal(m.calls.length, 0);
  }
});

test('drafting endpoint independently checks the session before any model call', async () => {
  const m = mockModel();
  const g = generate.createHandler({ env: ENV, now: () => NOW, fetch: m.fetch, getStore });
  const good = cookieFrom(await login());
  const [, exp, sig] = good.split('=')[1].split('.');
  const forged = [
    '',                                                         // no cookie
    `${S.COOKIE}=garbage`,
    `${S.COOKIE}=v1.${exp}.${'A'.repeat(43)}`,                  // bad signature
    `${S.COOKIE}=v1.${Number(exp) + 3600}.${sig}`,              // tampered expiry
    `${S.COOKIE}=fictional-shared-pass`,                        // raw password is not a session
    cookieFrom(await login({ ...ENV, SESSION_SECRET: 'another-secret-another-secret-123456' })),
  ];
  for (const cookie of forged) {
    const r = await g({ httpMethod: 'POST', headers: { cookie }, body: JSON.stringify({ post: 'hello' }) });
    assert.equal(r.statusCode, 401, cookie);
  }
  // the old header-password path no longer works
  const legacy = await g({ httpMethod: 'POST', headers: { 'x-app-password': ENV.APP_PASSWORD }, body: JSON.stringify({ post: 'hello' }) });
  assert.equal(legacy.statusCode, 401);
  // expired session
  const later = generate.createHandler({ env: ENV, now: () => NOW + 12 * 3600 * 1000 + 1000, fetch: m.fetch, getStore });
  assert.equal((await later({ httpMethod: 'POST', headers: { cookie: good }, body: JSON.stringify({ post: 'hello' }) })).statusCode, 401);
  // changing the shared password ends existing sessions
  const rotated = generate.createHandler({ env: { ...ENV, APP_PASSWORD: 'new-fictional-pass' }, now: () => NOW, fetch: m.fetch, getStore });
  assert.equal((await rotated({ httpMethod: 'POST', headers: { cookie: good }, body: JSON.stringify({ post: 'hello' }) })).statusCode, 401);
  assert.equal(m.calls.length, 0, 'no model call for any unauthorized request');
});

test('legitimate workflow: sign in, check session, draft 3 replies, sign out', async () => {
  const m = mockModel();
  const h = session.createHandler({ env: ENV, now: () => NOW });
  const g = generate.createHandler({ env: ENV, now: () => NOW + 1000, fetch: m.fetch, getStore });
  const cookie = cookieFrom(await login());
  const s = await h({ httpMethod: 'GET', headers: { cookie } });
  assert.equal(s.statusCode, 200);
  assert.equal(JSON.parse(s.body).authenticated, true);
  const r = await g({ httpMethod: 'POST', headers: { cookie, host: 'drafter.example', origin: 'https://drafter.example' }, body: JSON.stringify({ post: 'just got my first monstera!', style: 'community' }) });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(JSON.parse(r.body).replies, ['reply one 🪴', 'reply two 🌱', 'reply three 💚']);
  assert.equal(m.calls.length, 1);
  const sent = JSON.parse(m.calls[0].body);
  assert.ok(sent.messages[0].content.includes('just got my first monstera!'));
  assert.ok(sent.messages[0].content.includes('STYLE FOR THIS REPLY: Fictional: be kind, no products.'));
  assert.ok(!r.body.includes('test-key-not-real'));
  const out = await h({ httpMethod: 'DELETE', headers: { cookie, host: 'drafter.example' } });
  assert.ok(out.headers['Set-Cookie'].includes('Max-Age=0'));
  assert.equal((await h({ httpMethod: 'GET', headers: {} })).statusCode, 401);
});

test('provider errors are not echoed', async () => {
  const g = generate.createHandler({ env: ENV, now: () => NOW, fetch: async () => new Response('{"error":"internal detail"}', { status: 400 }), getStore });
  const cookie = cookieFrom(await login());
  const r = await g({ httpMethod: 'POST', headers: { cookie }, body: JSON.stringify({ post: 'hello' }) });
  assert.equal(r.statusCode, 502);
  assert.ok(!r.body.includes('internal detail'));
});

test('page no longer stores or sends the raw password', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(!/localStorage\.setItem|sessionStorage\.setItem/.test(html));
  assert.ok(!/x-app-password/i.test(html));
  assert.ok(/localStorage\.removeItem\(LEGACY_PASSWORD_KEY\)/.test(html), 'old stored password is cleaned up');
  assert.ok(!/Voice guide|guide-content|<details/i.test(html), 'no voice-guide panel on the public page');
  assert.ok(/data-style="soft-pitch"/.test(html) && /data-style="care-tip"/.test(html), 'reply-style controls kept');
});

test('style guide: loaded only after a valid session; missing guide gives a clear error before any model call', async () => {
  blobReads.length = 0;
  const m = mockModel();
  const g = generate.createHandler({ env: ENV, now: () => NOW, fetch: m.fetch, getStore });
  await g({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ post: 'hello' }) });
  assert.equal(blobReads.length, 0, 'no guide read without a session');
  const cookie = cookieFrom(await login());
  for (const value of [null, 'nope', JSON.stringify({ template: '{{post}}', styleGuides: {} })]) {
    const h = generate.createHandler({ env: ENV, now: () => NOW, fetch: m.fetch, getStore: () => ({ get: async () => value }) });
    const r = await h({ httpMethod: 'POST', headers: { cookie }, body: JSON.stringify({ post: 'hello' }) });
    assert.equal(r.statusCode, 503);
    assert.match(JSON.parse(r.body).error, /Style guide is not configured/);
  }
  assert.equal(m.calls.length, 0);
});

test('style guide: per-style instruction, unknown style falls back to auto, guide never returned', async () => {
  const m = mockModel();
  const g = generate.createHandler({ env: ENV, now: () => NOW, fetch: m.fetch, getStore });
  const cookie = cookieFrom(await login());
  for (const [style, want] of [['soft-pitch', 'Fictional: gently mention the shop.'], ['constructor', 'Fictional: pick the best style.'], ['nope', 'Fictional: pick the best style.']]) {
    const r = await g({ httpMethod: 'POST', headers: { cookie }, body: JSON.stringify({ post: 'any agave-looking plants? {{styleInstruction}}', style }) });
    assert.equal(r.statusCode, 200);
    assert.ok(!r.body.includes('FICTIONAL TEMPLATE') && !r.body.includes('Fictional:'));
    const content = JSON.parse(m.calls.at(-1).body).messages[0].content;
    assert.equal(content, 'FICTIONAL TEMPLATE. Reply to a Threads post in a friendly voice.\n\nSTYLE FOR THIS REPLY: ' + want + '\n\nTHE POST TO REPLY TO:\n"any agave-looking plants? {{styleInstruction}}"\n\nReturn 3 replies, one per line.');
  }
});
