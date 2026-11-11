// Browser test of the real page against the real functions (mocked model, fictional guide).
// Needs Playwright and Chrome/Chromium; skipped when Playwright isn't installed.
//   npx -y playwright@1 install chromium   (once)   then: npm test
// Set CHROME_PATH to use an installed Chrome instead of Playwright's Chromium.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

let chromium = null;
try { ({ chromium } = require('playwright')); } catch { /* skipped below */ }

const ROOT = path.join(__dirname, '..');
const ENV = { APP_PASSWORD: 'fictional-shared-pass', SESSION_SECRET: 'fictional-session-secret-0123456789abcdef', ANTHROPIC_API_KEY: 'test-key-not-real' };

async function startSite() {
  const guide = fs.readFileSync(path.join(ROOT, 'docs', 'style-guide.example.json'), 'utf8');
  let modelCalls = 0;
  const fetch = async () => { modelCalls++; return new Response(JSON.stringify({ content: [{ text: 'monstera tax 🥰\nlove it 😍\nso pretty 🌿' }] }), { status: 200 }); };
  const session = require('../netlify/functions/session.js').createHandler({ env: ENV });
  const generate = require('../netlify/functions/generate.js').createHandler({ env: ENV, fetch, getStore: () => ({ get: async () => guide }) });
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(fs.readFileSync(path.join(ROOT, 'index.html'))); }
    const fn = req.url === '/api/session' ? session : req.url === '/api/generate' ? generate : null;
    if (!fn) { res.writeHead(404); return res.end(); }
    const r = await fn({ httpMethod: req.method, headers: req.headers, body });
    res.writeHead(r.statusCode, r.headers); res.end(r.body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://localhost:${server.address().port}/`, calls: () => modelCalls };
}

test('sign-in, drafting and sign-out (failure keeps the session and says so; success ends it)', { skip: !chromium && 'Playwright not installed', timeout: 60000 }, async () => {
  const site = await startSite();
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(site.base);
    await page.waitForSelector('#password-screen', { state: 'visible' });
    await page.fill('#password-input', ENV.APP_PASSWORD); await page.click('#password-submit');
    await page.waitForSelector('#main-app', { state: 'visible' });
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0, 'nothing stored in the browser');
    assert.equal(await page.evaluate(() => document.cookie), '', 'session cookie not readable by scripts');

    await page.fill('#post-input', 'just got my first monstera!'); await page.click('#generate-btn');
    await page.waitForSelector('.reply-card');
    assert.equal(await page.locator('.reply-card').count(), 3);

    // Sign-out failures: server error, then network error
    for (const fail of [(route) => route.fulfill({ status: 500, body: '{}' }), (route) => route.abort('failed')]) {
      await page.route('**/api/session', (route) => (route.request().method() === 'DELETE' ? fail(route) : route.continue()));
      await page.click('#logout');
      await page.waitForSelector('#logout-error', { state: 'visible' });
      assert.match(await page.textContent('#logout-error'), /Sign-out failed/);
      assert.ok(await page.isVisible('#main-app'), 'app stays open; not shown as signed out');
      assert.equal((await ctx.cookies()).length, 1, 'session cookie still present');
      await page.reload(); await page.waitForSelector('#main-app', { state: 'visible' });
      await page.unroute('**/api/session');
    }

    // Successful sign-out (retry works)
    await page.click('#logout');
    await page.waitForSelector('#password-screen', { state: 'visible' });
    assert.ok(!(await page.isVisible('#logout-error')));
    assert.equal((await ctx.cookies()).length, 0, 'cookie cleared by the server');
    await page.reload(); await page.waitForSelector('#password-screen', { state: 'visible' });
    assert.equal(site.calls(), 1);
  } finally {
    await browser.close(); site.server.close();
  }
});
