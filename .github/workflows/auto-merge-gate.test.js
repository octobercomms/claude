// Guard — the auto-merge gate actually gates.
//
// On 18 Oct 2026 the bot merged three PRs before CI had registered at all and
// declined two that were fully green. One jq expression caused both:
//
//   [.statusCheckRollup[]? | ...] | all(...)
//
// jq's `all` over an EMPTY array is true, so a PR whose checks had not
// registered read as fully green and merged unchecked. And the bot posts its
// own check run against the PR head commit, so that run appears in the rollup
// it is evaluating — in_progress, with no conclusion, falling back to PENDING.
// The gate could therefore only ever pass when nothing at all had registered,
// itself included.
//
// This reads the filter OUT of the workflow file and runs jq against real
// rollup shapes, so what is tested is what will run rather than a copy that
// can drift. Every case below is a state the repo has actually been in, or
// one a plausible edit would produce.
//
// Needs jq, which GitHub runners have. Run: node .github/workflows/auto-merge-gate.test.js

const fs = require('fs');
const { execFileSync } = require('child_process');

const wf = fs.readFileSync(require('path').join(__dirname, 'auto-merge-claude.yml'), 'utf8');
const m = /--json mergeable,statusCheckRollup --jq '\n([\s\S]*?)\n\s*' --args \$required/.exec(wf);
if (!m) { console.error('could not find the readiness filter in the workflow'); process.exit(1); }
const FILTER = m[1];
console.log('--- filter extracted from the workflow ---');
console.log(FILTER.split('\n').map((l) => '  ' + l.trim()).join('\n'));
console.log();

const jq = (obj, required) =>
  execFileSync('jq', ['-r', FILTER, '--args', ...required], { input: JSON.stringify(obj) }).toString().trim();

const ok = (n) => ({ name: n, conclusion: 'SUCCESS' });
const running = (n) => ({ name: n, status: 'IN_PROGRESS', conclusion: null });
const CF = { context: 'Cloudflare Pages', state: 'SUCCESS' };
const REQ = ['backend', 'frontend'];

const cases = [
  // The two real failures, both from this afternoon.
  ['#1693/#1695/#1696: nothing registered — must NOT merge',
    { mergeable: 'MERGEABLE', statusCheckRollup: [] }, REQ, false],
  ['#1697/#1698: green, bot check in progress — must merge',
    { mergeable: 'MERGEABLE', statusCheckRollup: [running('automerge'), ok('backend'), ok('frontend'), CF] }, REQ, true],
  // The race the first fix left open.
  ['Cloudflare up, platform-checks not registered — must NOT merge',
    { mergeable: 'MERGEABLE', statusCheckRollup: [CF] }, REQ, false],
  ['one required check missing — must NOT merge',
    { mergeable: 'MERGEABLE', statusCheckRollup: [ok('backend'), CF] }, REQ, false],
  // Everything that must keep working.
  ['all green — merge',
    { mergeable: 'MERGEABLE', statusCheckRollup: [ok('automerge'), ok('backend'), ok('frontend'), CF] }, REQ, true],
  ['CI still running — hold',
    { mergeable: 'MERGEABLE', statusCheckRollup: [ok('automerge'), running('backend'), running('frontend')] }, REQ, false],
  ['a failure — hold',
    { mergeable: 'MERGEABLE', statusCheckRollup: [{ name: 'backend', conclusion: 'FAILURE' }, ok('frontend'), CF] }, REQ, false],
  ['cancelled is not success — hold',
    { mergeable: 'MERGEABLE', statusCheckRollup: [{ name: 'backend', conclusion: 'CANCELLED' }, ok('frontend'), CF] }, REQ, false],
  ['a conflict — hold',
    { mergeable: 'CONFLICTING', statusCheckRollup: [ok('backend'), ok('frontend'), CF] }, REQ, false],
  ['mergeable UNKNOWN while GitHub computes — hold',
    { mergeable: 'UNKNOWN', statusCheckRollup: [ok('backend'), ok('frontend'), CF] }, REQ, false],
  ['skipped and neutral count as green — merge',
    { mergeable: 'MERGEABLE', statusCheckRollup: [{ name: 'backend', conclusion: 'SKIPPED' }, { name: 'frontend', conclusion: 'NEUTRAL' }, CF] }, REQ, true],
  ['a legacy commit status still pending — hold',
    { mergeable: 'MERGEABLE', statusCheckRollup: [ok('backend'), ok('frontend'), { context: 'Cloudflare Pages', state: 'PENDING' }] }, REQ, false],
  // A docs-only PR runs no platform checks, and must not deadlock.
  ['docs-only PR, nothing required, Cloudflare green — merge',
    { mergeable: 'MERGEABLE', statusCheckRollup: [CF] }, [], true],
  ['docs-only PR with no checks at all — still hold',
    { mergeable: 'MERGEABLE', statusCheckRollup: [] }, [], false],
  ['the bot alone can never satisfy the gate',
    { mergeable: 'MERGEABLE', statusCheckRollup: [ok('automerge')] }, [], false],
];

let pass = 0, fail = 0;
for (const [label, obj, req, want] of cases) {
  let got;
  try { got = jq(obj, req); } catch (e) { got = 'ERROR: ' + e.message.split('\n')[0]; }
  const good = got === String(want);
  good ? pass++ : fail++;
  console.log((good ? 'PASS  ' : 'FAIL  ') + label.padEnd(58) + got + (good ? '' : `   (wanted ${want})`));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
