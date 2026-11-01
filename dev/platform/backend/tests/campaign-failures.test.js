// Two numbers labelled "failed", a hundred pixels apart, neither saying what
// it counted.
//
// 1 November, Indiewalls campaign: the sending strip read
// "✓ 3,605 of 3,628 emailed  ✕ 23 failed" and the button beside it read
// "Retry 203 failed". Both were right. 23 is `first.failed`, the first email
// only; 203 is `first.failed + followups.failed`.
//
// So 180 follow-up sends had failed, and the only place that number appeared
// anywhere on the page was inside a button label. The per-step rows, which
// are where a follow-up failure belongs, printed "sent · scheduled" and
// dropped `failed` on the floor.
//
// Nothing was miscalculated. The page simply never said which population
// each number described, and the one it did not describe was the larger one.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'PressCampaignAnalytics.jsx'), 'utf8');
let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

ok('the strip says which failures it is counting', () => {
  assert.ok(/failed on the first email/.test(src), 'the first-email count names its population');
  assert.ok(!/>✕ \{num\(first\.failed\)\} failed<\/span>/.test(src), 'the bare "N failed" is gone');
});

ok('and the follow-up failures are on the page, not only in a button', () => {
  assert.ok(/totalFailed > first\.failed &&/.test(src), 'a follow-up total shows when there is one');
  assert.ok(/num\(totalFailed - first\.failed\)\} on follow-ups/.test(src), 'and it is the difference, named');
});

ok('each step carries its own failures', () => {
  assert.ok(/const label = s\.failed > 0 \? `\$\{base\} · \$\{num\(s\.failed\)\} failed` : base;/.test(src),
    'a step with failures says so on its own row');
  // The old expression assigned the label directly; if that comes back the
  // per-step count disappears again.
  assert.ok(!/const label = s\.is_first/.test(src), 'the step label goes through the failure check');
});

ok('a failing row reads as failing', () => {
  assert.ok(/color: s\.failed > 0 \? 'var\(--negative\)' : 'var\(--text-subtle\)'/.test(src),
    'the count is in the negative colour when it is not zero');
});

ok('the retry button still covers everything', () => {
  // The fix is labelling, not scope. Retrying only the first email would
  // leave the 180 unsent and make the page honest about the wrong thing.
  assert.ok(/const totalFailed = \(first\.failed \|\| 0\) \+ \(fu\.failed \|\| 0\);/.test(src),
    'the total is still first + follow-ups');
  assert.ok(/`Retry \$\{num\(totalFailed\)\} failed`/.test(src), 'and the button retries all of them');
});

console.log(`${passed} guards`);
console.log('---');
console.log('EVERY FAILURE COUNT SAYS WHAT IT COUNTS');
