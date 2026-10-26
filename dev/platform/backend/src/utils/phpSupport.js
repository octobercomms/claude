// When each PHP branch stops getting security fixes.
//
// This exists because October ships WordPress plugins to client sites and has
// no way of knowing what those sites run. On 21 Oct 2026 two unauthenticated
// RCEs in PHP itself (CVE-2026-109618 and CVE-2026-109619, CVSSv4 9.2) were
// published with working proof-of-concept exploits demonstrated through
// WordPress. The fix exists only for 8.2 and above; every branch below that is
// end of life and will never receive it.
//
// The dates are PHP's own published lifecycle. 8.2 is the trap: it is "current
// enough" to sound safe and stops receiving fixes on 31 December 2026, which
// is why the plugins in this repo now declare 8.3 rather than 8.2.
//
// Add a row when a new branch ships. A branch that is not listed is treated as
// unknown rather than guessed at, because inventing a date here would quietly
// mark a live site as safe.
const SECURITY_SUPPORT_ENDS = {
  '8.2': '2026-12-31',
  '8.3': '2027-12-31',
  '8.4': '2028-12-31',
  '8.5': '2029-12-31',
};

const DAY = 24 * 60 * 60 * 1000;

/** '8.3.36' or '8.3' -> '8.3'. Anything unparseable returns null. */
function branchOf(version) {
  const m = /^(\d+)\.(\d+)/.exec(String(version || '').trim());
  return m ? `${m[1]}.${m[2]}` : null;
}

/**
 * How a PHP version stands today.
 *
 * Returns { branch, state, endsOn, daysLeft }. state is one of:
 *   'unknown'  — not a version string, or a branch newer than this table
 *   'eol'      — no longer receives security fixes
 *   'ending'   — fixes stop within `soonDays`
 *   'supported'
 */
function phpSupport(version, now = new Date(), soonDays = 120) {
  const branch = branchOf(version);
  if (!branch) return { branch: null, state: 'unknown', endsOn: null, daysLeft: null };

  const ends = SECURITY_SUPPORT_ENDS[branch];
  if (!ends) {
    // Below the lowest branch in the table is end of life by definition; above
    // it is a release this table has not been told about yet.
    const [maj, min] = branch.split('.').map(Number);
    const lowest = Object.keys(SECURITY_SUPPORT_ENDS)[0].split('.').map(Number);
    const belowTable = maj < lowest[0] || (maj === lowest[0] && min < lowest[1]);
    return {
      branch,
      state: belowTable ? 'eol' : 'unknown',
      endsOn: null,
      daysLeft: null,
    };
  }

  // End of day on the published date: a branch is supported through it.
  const endsAt = new Date(`${ends}T23:59:59Z`).getTime();
  const daysLeft = Math.floor((endsAt - now.getTime()) / DAY);
  const state = daysLeft < 0 ? 'eol' : (daysLeft <= soonDays ? 'ending' : 'supported');
  return { branch, state, endsOn: ends, daysLeft };
}

module.exports = { SECURITY_SUPPORT_ENDS, branchOf, phpSupport };
