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
const m = /\| jq -r '\n([\s\S]*?)\n\s*' --args \$required/.exec(wf);
if (!m) {
  // Name the mistake rather than just failing to find a regex. This exact
  // shape shipped once and died on the runner with "unknown flag: --args".
  if (/--jq\s*'/.test(wf)) {
    console.error('FAIL  the readiness filter is applied by `gh --jq`, which cannot take --args.');
    console.error('      Pipe the PR JSON into the real jq binary instead:');
    console.error("        ready=$(printf '%s' \"$pr_json\" | jq -r '<filter>' --args $required)");
  } else {
    console.error('FAIL  could not find the readiness filter in the workflow.');
  }
  process.exit(1);
}
const FILTER = m[1];

// The comments below explain the very mistake these guards look for, so a
// naive scan matches the prose instead of the code. Strip whole-line comments
// first; a '#' mid-line (as in "#$pr") is not one.
const code = wf.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

// How the filter is INVOKED, not just what it says.
//
// The first version of this fix passed `--args` to `gh pr view --jq`. The
// filter was right and every case below passed, because the test ran it
// through the real jq binary — while the workflow ran it through gh's
// embedded one, which has no way to take positional arguments and died with
// "unknown flag: --args" on the first PR it saw. A test of the expression
// alone cannot catch that, so the invocation is checked too.
const invocation = [
  ['the filter is piped into the real jq binary', /\| jq -r '/.test(code)],
  ['gh is not asked to apply it with --args', !/--jq[\s\S]{0,800}?--args/.test(code)],
  ['the PR JSON is read before being filtered', /pr_json=\$\(gh pr view/.test(code)],
  ['an unreadable PR skips rather than merging', /could not read #\$pr[\s\S]{0,120}?continue/.test(code)],
  ['an unreadable file list skips rather than merging', /could not list changed files[\s\S]{0,120}?continue/.test(code)],

  // A correct gate that is never asked again is still a PR sitting there.
  //
  // GitHub does not trigger workflows from check_suite or check_run events
  // that Actions itself produced, so platform-checks going green never woke
  // this workflow: the only check_suite events arriving came from third-party
  // apps, which finish first. Every PR was therefore evaluated too early,
  // declined correctly, and never reconsidered until the */30 safety net.
  // workflow_run does fire for Actions workflows.
  ['the gate re-runs when Actions CI finishes', /workflow_run:/.test(code)],
  ['and specifically when the platform checks do', /workflows:\s*\[[^\]]*"Platform checks"/.test(code)],
  ['a safety-net schedule is still present', /schedule:/.test(code)],
];
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

// ---------------------------------------------------------------------------
// The deploy hand-off.
//
// This workflow's first run was 2 Sept 2026. Platform push-deploys went from 63
// in August to 1 in October, because a merge made with GITHUB_TOKEN cannot wake
// platform-deploy.yml's `on: push` — GitHub's loop protection. The workflow
// warned about it on every run, into a log nobody opens, for seven weeks.
//
// It now dispatches the deploy itself (workflow_dispatch is exempt from that
// protection). These checks hold the parts that would fail silently again: the
// permission the dispatch needs, the guards that stop it firing on a failed
// merge or a docs-only PR, and the path list staying in step with the deploy's
// own trigger.

const deployWf = fs.readFileSync(require('path').join(__dirname, 'platform-deploy.yml'), 'utf8');
const bare = wf.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');

const asserts = [
  ['the dispatch has the actions: write it needs',
    /permissions:[\s\S]*?actions:\s*write/.test(bare)],
  ['it dispatches platform-deploy on main',
    /gh workflow run platform-deploy\.yml[^\n]*--ref main/.test(bare)],
  ['the dispatch is gated on something needing deploying',
    /if \[ "\$deploy_needed" != "true" \]/.test(bare)],
  ['deploy_needed starts false',
    /deploy_needed=false/.test(bare)],
  ['only a SUCCESSFUL merge can set it',
    /if gh pr merge[\s\S]{0,200}?touches_platform" = "true" \]; then deploy_needed=true/.test(bare)],
  ['a PAT, if set, means no second dispatch',
    /elif \[ "\$HAS_PAT" = "true" \]/.test(bare)],
  ['a failed dispatch is an error, not a shrug',
    /::error::Merged a platform change but could not dispatch/.test(bare)],
  ['the dispatch sits after the loop, so N merges deploy once',
    bare.lastIndexOf('done') < bare.indexOf('gh workflow run platform-deploy.yml')],
];

// The two path lists must agree, or a merge deploys nothing (or everything).
const deployPaths = (deployWf.match(/- '([^']+)'/g) || [])
  .map(s => s.slice(3, -1))
  .filter(p => /\*|\.yml$/.test(p));
const matcher = (bare.match(/grep -qE '\^\(([^']+)\)'/) || [])[1] || '';
for (const p of deployPaths) {
  const stem = p.replace(/\*+$/, '').replace(/\./g, '\\.');
  asserts.push([`the deploy path ${p} is matched by the bot too`, matcher.includes(stem)]);
}
asserts.push(['the deploy actually lists paths to compare against', deployPaths.length >= 3]);

let pass = 0, fail = 0;
for (const [label, good] of invocation.concat(asserts)) {
  good ? pass++ : fail++;
  console.log((good ? 'PASS  ' : 'FAIL  ') + label);
}
console.log();
for (const [label, obj, req, want] of cases) {
  let got;
  try { got = jq(obj, req); } catch (e) { got = 'ERROR: ' + e.message.split('\n')[0]; }
  const good = got === String(want);
  good ? pass++ : fail++;
  console.log((good ? 'PASS  ' : 'FAIL  ') + label.padEnd(58) + got + (good ? '' : `   (wanted ${want})`));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
