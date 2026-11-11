// private-config.js — reads private configuration (the style guide) from this
// site's Netlify Blobs store "private-config". Only this site's functions and
// people with access to the Netlify site can read it; it is not in Git and not
// in the published files. Upload with scripts/upload-style-guide.mjs.
//
// Classic functions (exports.handler) must call connectLambda(event) before
// using Blobs. Reads use the default (eventual) consistency: strong reads are
// not available in this mode. A changed guide is picked up within about a minute.

const STORE = 'private-config';
const CACHE_MS = 60 * 1000;
const cache = new Map();

async function readPrivateConfig(event, key, deps = {}) {
  try {
    if (deps.getStore) return await deps.getStore(STORE).get(key, { type: 'text' });
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const blobs = require('@netlify/blobs');
    if (event && event.blobs) blobs.connectLambda(event);
    const value = await blobs.getStore(STORE).get(key, { type: 'text' });
    if (value != null) cache.set(key, { value, at: Date.now() });
    return value;
  } catch {
    return null;
  }
}

function _clearCache() { cache.clear(); }

module.exports = { readPrivateConfig, STORE, _clearCache };
