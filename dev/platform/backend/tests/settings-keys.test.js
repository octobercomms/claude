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

// Read from the whole frontend tree, not one named file.
//
// This used to read SettingsPage.jsx alone. On 31 Oct 2026 the catalogue was
// lifted out of that page into settings/catalogue.js so the search palette
// could find a credential by name, and this test went to zero keys — at which
// point "every field the page offers is one the server will store" passed
// vacuously, because there were no fields to check. The canary below is the
// only thing that noticed.
//
// So the scan no longer cares which file holds the list. Moving it again
// breaks nothing here.
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.jsx?$/.test(e.name) ? [full] : [];
  });
}
const frontendSrc = path.join(__dirname, '..', '..', 'frontend', 'src');
const page = walk(frontendSrc).map(f => fs.readFileSync(f, 'utf8')).join('\n');
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

// The canary. It is the reason the silent half of this test was caught when
// the catalogue moved, so it stays first and it stays loud.
check('the frontend declares some settings keys', unique.length > 20, `found ${unique.length}`);
check('the server has an allowlist', allowed.length > 20, `found ${allowed.length}`);

const missing = unique.filter(k => !allowed.includes(k));
check('every field the page offers is one the server will store', missing.length === 0,
  missing.length ? `these would save silently and persist nothing: ${missing.join(', ')}\n  `
    + 'Add them to SETTINGS_KEYS in backend/src/routes/settings.js.' : '');

// And the other direction, which this test never checked: a key the server
// will store that nothing offers. Not a failure — several are set from a
// panel of their own rather than the credential catalogue — but worth
// printing, because a key on the allowlist with no field is either a field
// somebody forgot to add or an allowlist entry nobody needs.
const orphans = allowed.filter(k => !unique.includes(k));
if (orphans.length) {
  console.log(`NOTE  ${orphans.length} allowlisted key(s) have no field in the catalogue: ${orphans.join(', ')}`);
}

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
