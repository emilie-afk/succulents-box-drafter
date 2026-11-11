// style-guide.js — the private reply-drafting guide: voice rules, catalog and
// recommendation rules, examples, per-style instructions and the prompt template.
// Stored in Netlify Blobs (store "private-config", key "drafter-style-guide");
// never in Git or the published site. Shape: docs/style-guide.example.json.

const { readPrivateConfig } = require('./private-config');
const { validTemplate, fill } = require('./template');

const KEY = 'drafter-style-guide';

function parseGuide(raw) {
  let g;
  try { g = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (!g || typeof g !== 'object') return null;
  if (!validTemplate(g.template, ['styleInstruction', 'post'])) return null;
  const sg = g.styleGuides;
  if (!sg || typeof sg !== 'object' || typeof sg.auto !== 'string') return null;
  if (Object.values(sg).some((v) => typeof v !== 'string')) return null;
  return g;
}

async function loadGuide(event, deps) {
  const raw = await readPrivateConfig(event, KEY, deps);
  return raw == null ? null : parseGuide(raw);
}

// Unknown styles fall back to "auto", as before.
function buildPrompt(g, post, style) {
  const own = Object.prototype.hasOwnProperty.call(g.styleGuides, style);
  const styleInstruction = (own && g.styleGuides[style]) || g.styleGuides.auto;
  return fill(g.template, { styleInstruction, post });
}

module.exports = { loadGuide, parseGuide, buildPrompt, KEY };
