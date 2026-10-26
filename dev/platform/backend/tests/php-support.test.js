// Which PHP versions are still getting security fixes.
//
// On 21 Oct 2026 two unauthenticated RCEs in PHP (CVE-2026-109618 and
// CVE-2026-109619, CVSSv4 9.2) were published with working exploits
// demonstrated through WordPress. The fix exists for 8.2 and above only.
// Everything below that is end of life and will never receive it.
//
// The trap this table exists to avoid: 8.2 sounds current and stops receiving
// fixes on 31 December 2026. Recommending it in October 2026 would be
// recommending nine more weeks of cover, which is why the plugins in this repo
// declare 8.3.
//
//   node tests/php-support.test.js

const { phpSupport, branchOf, SECURITY_SUPPORT_ENDS } = require('../src/utils/phpSupport');

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, detail ? `\n  ${detail}` : ''); }
};

const NOW = new Date('2026-10-26T12:00:00Z');
const at = (v, now = NOW) => phpSupport(v, now);

check('a full version reduces to its branch',
  branchOf('8.3.36') === '8.3' && branchOf('8.3') === '8.3');
check('and nonsense does not',
  branchOf('') === null && branchOf('garbage') === null && branchOf(null) === null);

// --- the versions October's plugins used to declare --------------------------
for (const v of ['7.0.33', '7.4.33', '8.0.30', '8.1.31']) {
  check(`PHP ${v} is end of life`, at(v).state === 'eol', JSON.stringify(at(v)));
}

// --- the one that looks safe and is not --------------------------------------
check('8.2 is not end of life yet', at('8.2.35').state === 'ending', JSON.stringify(at('8.2.35')));
check('but it is counted in days, not years',
  at('8.2.35').daysLeft > 0 && at('8.2.35').daysLeft < 90,
  `${at('8.2.35').daysLeft} days left on 26 Oct 2026`);
check('and it names the date', at('8.2.35').endsOn === '2026-12-31');

// --- what the plugins declare now --------------------------------------------
check('8.3 is supported', at('8.3.36').state === 'supported', JSON.stringify(at('8.3.36')));
check('and has more than a year to run', at('8.3.36').daysLeft > 365, String(at('8.3.36').daysLeft));
check('8.4 and 8.5 are supported',
  at('8.4.1').state === 'supported' && at('8.5.12').state === 'supported');

// --- the boundary ------------------------------------------------------------
check('a branch is supported through its last day',
  at('8.2.0', new Date('2026-12-31T23:00:00Z')).state === 'ending',
  JSON.stringify(at('8.2.0', new Date('2026-12-31T23:00:00Z'))));
check('and end of life the day after',
  at('8.2.0', new Date('2027-01-01T12:00:00Z')).state === 'eol',
  JSON.stringify(at('8.2.0', new Date('2027-01-01T12:00:00Z'))));

// --- what it refuses to guess ------------------------------------------------
//
// A branch newer than this table is unknown rather than assumed safe, because
// inventing a date here marks a live client site as fine when nobody checked.
check('a release this table has not been told about is unknown',
  at('8.9.0').state === 'unknown' && at('9.0.0').state === 'unknown',
  JSON.stringify([at('8.9.0'), at('9.0.0')]));
check('but anything below the table is end of life, not unknown',
  at('5.6.40').state === 'eol' && at('7.2.0').state === 'eol');
check('and an empty or malformed version is unknown',
  at('').state === 'unknown' && at('garbage').state === 'unknown' && at(undefined).state === 'unknown');

// --- the table itself --------------------------------------------------------
check('every date in the table is a real one',
  Object.values(SECURITY_SUPPORT_ENDS).every(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))),
  JSON.stringify(SECURITY_SUPPORT_ENDS));
check('and the branches run in order, each outliving the last',
  Object.entries(SECURITY_SUPPORT_ENDS).every(([, d], i, a) => i === 0 || d > a[i - 1][1]),
  JSON.stringify(SECURITY_SUPPORT_ENDS));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
