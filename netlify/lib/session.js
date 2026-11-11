// session.js — expiring, server-verified sessions for the shared-password login.
//
// After a correct password the browser receives an HttpOnly cookie holding
// "v1.<expiry>.<signature>". It contains no password, can't be read by page
// scripts, and is checked by every protected function on its own.
//
// Signing key = HMAC(SESSION_SECRET, sha256(APP_PASSWORD)), so changing either
// APP_PASSWORD or SESSION_SECRET in Netlify ends every existing session.
// Missing configuration (APP_PASSWORD unset, SESSION_SECRET unset or shorter
// than 32 characters) denies every protected request.

const crypto = require('crypto');

const COOKIE = 'sbx_drafter_session';
const SESSION_TTL_S = 12 * 60 * 60;

function configured(env) {
  return !!(env.APP_PASSWORD && env.SESSION_SECRET && String(env.SESSION_SECRET).length >= 32);
}

function signingKey(env) {
  const pw = crypto.createHash('sha256').update(String(env.APP_PASSWORD)).digest('hex');
  return crypto.createHmac('sha256', String(env.SESSION_SECRET)).update('drafter-session:' + pw).digest();
}

function sign(env, payload) {
  return crypto.createHmac('sha256', signingKey(env)).update(payload).digest('base64url');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function checkPassword(env, password) {
  if (!configured(env)) return false;
  return safeEqual(typeof password === 'string' ? password : '', String(env.APP_PASSWORD));
}

function issue(env, nowMs = Date.now()) {
  const exp = Math.floor(nowMs / 1000) + SESSION_TTL_S;
  const payload = 'v1.' + exp;
  return { value: payload + '.' + sign(env, payload), expiresAt: exp * 1000 };
}

function readCookie(headers, name) {
  const raw = (headers && (headers.cookie || headers.Cookie)) || '';
  for (const part of String(raw).split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

// Returns { expiresAt } for a valid session, otherwise null.
function verify(env, headers, nowMs = Date.now()) {
  if (!configured(env)) return null;
  const v = readCookie(headers, COOKIE);
  const m = /^v1\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(v);
  if (!m) return null;
  const exp = Number(m[1]);
  if (!(exp * 1000 > nowMs) || exp * 1000 > nowMs + (SESSION_TTL_S + 60) * 1000) return null;
  if (!safeEqual(m[2], sign(env, 'v1.' + m[1]))) return null;
  return { expiresAt: exp * 1000 };
}

function setCookie(value) {
  return `${COOKIE}=${value}; Path=/; Max-Age=${SESSION_TTL_S}; HttpOnly; Secure; SameSite=Strict`;
}
function clearCookie() {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

// Cross-site state-changing requests are refused (defence in depth next to SameSite=Strict).
function sameOrigin(headers) {
  const origin = headers && (headers.origin || headers.Origin);
  if (!origin) return true;
  const host = headers['x-forwarded-host'] || headers.host || headers.Host;
  try { return new URL(origin).host === host; } catch { return false; }
}

module.exports = { COOKIE, SESSION_TTL_S, configured, checkPassword, issue, verify, setCookie, clearCookie, sameOrigin, safeEqual };
