// What the bulk report delete will and will not do.
//
// This is the one endpoint in the product where being wrong is irreversible:
// it removes rows and the PDF files on disk behind them, in one request, with
// no undo. So the rules are pinned here rather than trusted to survive a
// refactor.
//
// The rule that matters most is the first: a report with status 'sent' is a
// record of something a client actually received, and no caller, parameter or
// future convenience may bulk-delete one. A request naming it is refused
// whole — not trimmed down to the subset that happens to qualify, which would
// delete rows the caller never reviewed.
//
//   node tests/bulk-delete-reports.test.js

const { checkBulkDelete, DELETABLE_STATUSES } = require('../src/routes/reports');

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, detail ? `\n  ${detail}` : ''); }
};

const allowed = (statuses, expected = 1) => !checkBulkDelete({ statuses, expected }).error;

// ── What may never be deleted in bulk ───────────────────────────────────
check('a sent report can never be bulk deleted',
  !allowed(['sent']),
  'it is the record of something a client received');

check('naming sent alongside deletable statuses refuses the whole request',
  !allowed(['skipped_no_recipients', 'sent']),
  'a partial delete would remove rows the caller never reviewed');

check('sending, generated and generating are not deletable either',
  !allowed(['sending']) && !allowed(['generated']) && !allowed(['generating']));

check('an unknown status is refused rather than ignored',
  !allowed(['nonsense']) && !allowed(['skipped_no_recipients', 'nonsense']));

check('the deletable list does not contain sent',
  !DELETABLE_STATUSES.includes('sent'),
  'if this ever changes, the rule above is gone');

// ── What may ────────────────────────────────────────────────────────────
check('the nine: skipped_no_recipients is deletable', allowed(['skipped_no_recipients']));
check('failed is deletable', allowed(['failed']));
check('pending is deletable', allowed(['pending']));
check('several deletable statuses together are fine',
  allowed(['skipped_no_recipients', 'failed', 'pending']));

// ── The count check ─────────────────────────────────────────────────────
// The caller states what they saw. The route compares it with what is there
// before deleting, so a scheduled run landing between looking and clicking
// stops the delete rather than silently widening it.
check('a missing expected_count is refused',
  !!checkBulkDelete({ statuses: ['failed'] }).error);
check('a non-integer expected_count is refused',
  !allowed(['failed'], '12') && !allowed(['failed'], 1.5) && !allowed(['failed'], null));
check('a negative expected_count is refused', !allowed(['failed'], -1));
check('zero is a legitimate expectation', allowed(['failed'], 0));

// ── Nothing named ───────────────────────────────────────────────────────
check('an empty status list is refused, not read as "everything"',
  !allowed([]) && !allowed(undefined) && !allowed(null),
  'the dangerous default would be to delete all of them');
check('a bare string is not read as one status',
  !allowed('skipped_no_recipients'));

// ── The refusal says why ────────────────────────────────────────────────
check('refusing a sent report names it',
  /sent/.test(checkBulkDelete({ statuses: ['sent'], expected: 1 }).error || ''));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
