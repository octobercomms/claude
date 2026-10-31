// A hand-off between screens is a string. `setSocialTab('competitors')`
// and `setSocialTab('compare')` look equally plausible in a diff, and the
// wrong one does nothing at all: the page keeps rendering the screen you
// were on, with no error anywhere. Competitors moving off Review added
// one of these and removed another, so the literals get a guard.
//
// Only the setter bound to useScreen is scanned. A page's own local tab
// state is not a screen and has no business in sections.js.
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pagesDir = path.join(here, '..', 'src', 'pages');
const sectionsSrc = fs.readFileSync(path.join(here, '..', 'src', 'nav', 'sections.js'), 'utf8');

// Tabs declared per section, read straight out of the source so the test
// cannot drift from the file it is guarding.
const tabsBySection = {};
for (const m of sectionsSrc.matchAll(/^\s{2}([a-z_]+):\s*\{$/gm)) {
  const key = m[1];
  const rest = sectionsSrc.slice(m.index);
  const end = rest.search(/^\s{2}\},$/m);
  const body = end === -1 ? rest : rest.slice(0, end);
  const tabs = [...body.matchAll(/\btab:\s*'([a-z_]+)'/g)].map(x => x[1]);
  if (tabs.length) tabsBySection[key] = tabs;
}
assert.ok(Object.keys(tabsBySection).length >= 6,
  `expected sections.js to declare tabs for the client sections, read ${JSON.stringify(Object.keys(tabsBySection))}`);
assert.ok(tabsBySection.shared?.includes('hooks'), 'the shared section should declare the hooks tab');
// Each section's tabs stop at that section. Reading the whole file into
// every section would let `setSocialTab('health')` — an Owned screen —
// through the scan below, which is the mistake the scan exists to catch.
assert.ok(tabsBySection.owned?.includes('health'), 'the owned section should declare the health tab');
assert.ok(!tabsBySection.shared.includes('health'),
  'tabs should be read per section, not across the whole file');

let scanned = 0, checked = 0;
for (const file of fs.readdirSync(pagesDir).filter(f => f.endsWith('.jsx'))) {
  const src = fs.readFileSync(path.join(pagesDir, file), 'utf8');
  // A literal section key only; SettingsPage passes a variable, so its
  // screens are covered by sectionPanel.test.mjs instead.
  const decl = src.match(/const \[\s*[A-Za-z]+\s*,\s*([A-Za-z]+)\s*\] = useScreen\('([a-z_]+)'\)/);
  if (!decl) continue;
  const [, setter, section] = decl;
  const known = tabsBySection[section];
  assert.ok(known, `${file} drives section '${section}', which declares no tabs`);
  scanned++;
  for (const call of src.matchAll(new RegExp(`\\b${setter}\\('([a-z_]+)'\\)`, 'g'))) {
    const tab = call[1];
    checked++;
    assert.ok(known.includes(tab),
      `${file}: ${setter}('${tab}') names no screen in section '${section}' — it would silently do nothing. Declared: ${known.join(', ')}`);
  }
}
assert.ok(scanned >= 5, `expected to scan at least five screen-driven pages, scanned ${scanned}`);
assert.ok(checked >= 10, `expected to check at least ten hand-offs, checked ${checked}`);

// Review's own hand-offs: the loop points forward, never back at competitors.
const social = fs.readFileSync(path.join(pagesDir, 'ClientSocialPage.jsx'), 'utf8');
const overviewCall = social.slice(social.indexOf('<SocialSuiteOverview'));
const props = overviewCall.slice(0, overviewCall.indexOf('/>'));
assert.ok(!/competitor/i.test(props),
  'Shared\'s Review screen should hand the overview no competitor data or action');
assert.ok(/onOpenHookVault=\{\(\) => setSocialTab\('hooks'\)\}/.test(props),
  'the hook vault action should open the hook vault screen, not a modal');

console.log(`ok  screen hand-offs: ${checked} across ${scanned} pages`);
