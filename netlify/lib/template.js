// template.js — fills {{placeholders}} in a private prompt template.
// Single pass: text inserted for one placeholder is never scanned again, so user
// input containing "{{...}}" can't pull in other values.

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

function placeholders(template) {
  return [...String(template).matchAll(PLACEHOLDER)].map((m) => m[1]);
}

// true when template is a non-empty string using only allowed placeholders
// and including every required one.
function validTemplate(template, allowed, required = allowed) {
  if (typeof template !== 'string' || !template.trim()) return false;
  const used = placeholders(template);
  return used.every((k) => allowed.includes(k)) && required.every((k) => used.includes(k));
}

function fill(template, vars) {
  return template.replace(PLACEHOLDER, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
}

module.exports = { placeholders, validTemplate, fill };
