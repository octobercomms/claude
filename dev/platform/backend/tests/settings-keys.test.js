// Guard — every settings field the UI offers is one the server will store.
//
// routes/settings.js saves by walking an allowlist, SETTINGS_KEYS. A key that
// is not on it is skipped: the endpoint answers 200 with an empty `updated`,
// the page says "Saved", the Set badge never appears and the value never left
// the browser. There is no error anywhere, so the only way to find out is to
// come back later and notice the field is still empty.
//
// That is exactly how PIPELINE_FROM shipped on 19 Oct 2026. The field was added
// to SettingsPage.jsx and not to the array, Daniel saved his address twice, and
// both times the UI reported success.
//
// So this reads the keys the Settings page declares straight out of the JSX and
// checks each one against the array the server actually honours. It needs no
// database and no network.

const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'SettingsPage.jsx'), 'utf8');
const route = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'routes', 'settings.js'), 'utf8');

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, detail ? `\n  ${detail}` : ''); }
};

// Settings fields are object literals shaped { key: 'SCREAMING_SNAKE', label: … }.
// React's own `key={…}` prop is JSX rather than an object literal, so it cannot
// match, and neither can a lowercase field name.
const declared = [...page.matchAll(/\{\s*key:\s*'([A-Z][A-Z0-9_]+)'\s*,\s*label:/g)]
  .map(m => m[1]);
const unique = [...new Set(declared)];

// The allowlist, read from the array literal rather than by requiring the
// route, which would drag in the database and the whole express app.
const block = route.match(/const SETTINGS_KEYS = \[([\s\S]*?)\n\];/);
const allowed = block ? [...block[1].matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map(m => m[1]) : [];

check('the Settings page declares some keys', unique.length > 20, `found ${unique.length}`);
check('the server has an allowlist', allowed.length > 20, `found ${allowed.length}`);

const missing = unique.filter(k => !allowed.includes(k));
check('every field the page offers is one the server will store', missing.length === 0,
  missing.length ? `these would save silently and persist nothing: ${missing.join(', ')}\n  `
    + 'Add them to SETTINGS_KEYS in backend/src/routes/settings.js.' : '');

// The two from the incident, named, so a regression says what it broke.
for (const k of ['PIPELINE_FROM', 'PIPELINE_REPLY_TO']) {
  check(`${k} is saveable`, allowed.includes(k));
}

// And the runtime half: the endpoint must report what it ignored, so a key
// that slips past this test still fails loudly rather than silently.
check('the save endpoint reports ignored keys',
  /const ignored = Object\.keys\(req\.body/.test(route) && /ignored,?\s*\}\)/.test(route));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
