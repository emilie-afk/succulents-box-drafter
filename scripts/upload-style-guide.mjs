// Uploads the private style guide to this site's Netlify Blobs store "private-config".
// This changes production configuration: run it only with the owner's approval.
//
//   NETLIFY_SITE_ID=<site id> NETLIFY_AUTH_TOKEN=<token> \
//     node scripts/upload-style-guide.mjs /path/outside/the/repo/style-guide.json
//
// Keep the real JSON outside this repository and outside any published folder.
// Prints only sizes and a fingerprint, never the guide.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { getStore } from '@netlify/blobs';

const require = createRequire(import.meta.url);
const { parseGuide, KEY } = require('../netlify/lib/style-guide.js');
const { STORE } = require('../netlify/lib/private-config.js');

const file = process.argv[2];
const siteID = process.env.NETLIFY_SITE_ID;
const token = process.env.NETLIFY_AUTH_TOKEN;
if (!file || !siteID || !token) {
  console.error('Usage: NETLIFY_SITE_ID=... NETLIFY_AUTH_TOKEN=... node scripts/upload-style-guide.mjs <file>');
  process.exit(2);
}
const raw = readFileSync(file, 'utf8');
if (!parseGuide(raw)) { console.error('Invalid style guide file (see docs/style-guide.example.json for the shape).'); process.exit(1); }
const value = JSON.stringify(JSON.parse(raw));
const fp = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const store = getStore({ name: STORE, siteID, token });
await store.set(KEY, value);
const back = await store.get(KEY, { type: 'text' });
if (back !== value) { console.error('Uploaded, but the read-back did not match. Try again in a minute.'); process.exit(1); }
console.log(`Uploaded ${KEY} (${Buffer.byteLength(value)} bytes, fingerprint ${fp(value)}).`);
