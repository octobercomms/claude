// Detecting that a tax deadline was paid.
//
// The button on /accounts/deadlines read acct_reconcile_queue, and could
// never have worked: connectors/xero.js:252 feeds that table through
// `.filter(tx => tx.IsReconciled !== true)`, so it holds only bank lines
// nobody has reconciled yet. A payment that was made and then reconciled is
// excluded by construction. On 18 November, with its SQL finally correct, it
// reported "checked 58 deadlines, 0 updated" — and would have said that
// forever.
//
// It now reads Xero directly. What this guards:
//
//   1. Account codes come from the chart of accounts, by name. The old map
//      hardcoded 820 for VAT and 810/820 for PAYE, so one HMRC payment could
//      satisfy either deadline.
//   2. An HMRC payment carrying no account code is reported, not assigned.
//      HMRC collects VAT, PAYE and corporation tax; the name says nothing
//      about which one a payment settles.
//   3. One payment settles one deadline. PAYE and pension are monthly, so
//      with a wide window several payments sit near several due dates, and a
//      naive match marks a month filed that nobody paid.
//
//   node tests/deadline-inference.test.js

const assert = require('assert');

// The module opens a db handle at require time.
const dbPath = require.resolve('../src/db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { query: async () => ({ rows: [], rowCount: 0 }) },
};

const deadlines = require('../src/services/accounts/deadlines');
const { taxCodeMap, classifyPayment, WINDOWS } = deadlines._internals;

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; console.log(`PASS  ${what}`); };

// A chart of accounts shaped like a UK Xero file.
const CHART = [
  { code: '200', name: 'Sales' },
  { code: '404', name: 'Bank Fees' },
  { code: '477', name: 'Wages and Salaries' },
  { code: '814', name: 'Pension Payable' },
  { code: '820', name: 'VAT' },
  { code: '825', name: 'PAYE Payable' },
  { code: '830', name: 'Corporation Tax Payable' },
];

const tx = (over = {}) => ({
  transactionId: over.id || 'tx-1',
  date: new Date(over.date || '2026-02-20'),
  amount: over.amount ?? -500,
  type: 'SPEND',
  isReconciled: true,
  contactName: over.payee || 'HMRC',
  reference: over.reference || '',
  lineItems: over.code ? [{ accountCode: over.code }] : [],
});

ok('tax accounts are found by name, not by a hardcoded number', () => {
  const map = taxCodeMap(CHART);
  assert.strictEqual(map.get('820'), 'VAT');
  assert.strictEqual(map.get('825'), 'PAYE');
  assert.strictEqual(map.get('814'), 'PENSION');
  assert.strictEqual(map.get('830'), 'CT600');
  assert.strictEqual(map.get('477'), undefined,
    'Wages and Salaries is not a tax liability account and must not be read as one');
  assert.strictEqual(map.get('200'), undefined);
});

ok('a chart using different numbers still works', () => {
  // The whole point of reading names: another company's file numbers these
  // differently, and the old hardcoded 820/482/810 would have found nothing.
  const map = taxCodeMap([
    { code: '2202', name: 'VAT Control Account' },
    { code: '2210', name: 'PAYE/NIC Payable' },
    { code: '2230', name: 'Pension Creditor' },
  ]);
  assert.strictEqual(map.get('2202'), 'VAT');
  assert.strictEqual(map.get('2210'), 'PAYE');
  assert.strictEqual(map.get('2230'), 'PENSION');
});

ok('a payment is identified by the account it was coded to', () => {
  const map = taxCodeMap(CHART);
  assert.strictEqual(classifyPayment(tx({ code: '820' }), map).type, 'VAT');
  assert.strictEqual(classifyPayment(tx({ code: '825' }), map).type, 'PAYE');
  assert.strictEqual(classifyPayment(tx({ code: '814' }), map).type, 'PENSION');
});

ok('an HMRC payment with no tax account is reported, never guessed', () => {
  const map = taxCodeMap(CHART);
  const hit = classifyPayment(tx({ payee: 'HMRC', code: '404' }), map);
  assert.strictEqual(hit.type, null,
    'an HMRC payment with nothing saying which tax it is was assigned to one '
    + 'anyway — HMRC collects VAT, PAYE and corporation tax alike');
  assert.strictEqual(hit.ambiguous, true);
});

ok('NEST identifies a pension payment on the payee alone', () => {
  const hit = classifyPayment(tx({ payee: 'NEST Pensions', code: null }), new Map());
  assert.strictEqual(hit.type, 'PENSION',
    'NEST collects one thing, so the payee is enough even with no chart');
});

ok('an ordinary supplier payment is not matched to anything', () => {
  const map = taxCodeMap(CHART);
  assert.strictEqual(classifyPayment(tx({ payee: 'Adobe', code: '404' }), map), null);
  assert.strictEqual(classifyPayment(tx({ payee: 'Hetzner', code: '200' }), map), null);
});

ok('a monthly window cannot span two monthly periods', () => {
  // PAYE and pension fall on the 22nd of each month. A window wider than a
  // month on the "before" side means one payment sits inside two deadlines'
  // windows, which is how a month nobody paid gets marked filed.
  for (const type of ['PAYE', 'PENSION']) {
    const w = WINDOWS[type];
    assert.ok(w.before + w.after < 62,
      `the ${type} window spans ${w.before + w.after} days, long enough to `
      + 'cover two monthly periods');
    assert.ok(w.before <= 31,
      `the ${type} window reaches ${w.before} days back, into the previous period`);
  }
  assert.ok(WINDOWS.VAT.before > WINDOWS.PAYE.before,
    'VAT is quarterly and needs a longer reach back than a monthly obligation');
});

// ── the assignment, driven end to end with Xero and the db stubbed ────────
//
// This is the part that can do damage: marking a month filed that nobody
// paid. Everything above is pure; this exercises inferFiledFromPayments
// itself.

const xeroPath = require.resolve('../src/connectors/xero');

function runInfer({ deadlines: rows, transactions, chart = CHART, dryRun = true }) {
  require.cache[xeroPath] = {
    id: xeroPath, filename: xeroPath, loaded: true,
    exports: {
      getValidToken: async () => 'token',
      getChartOfAccounts: async () => chart,
      getAllBankTransactions: async () => transactions,
    },
  };
  const updated = [];
  require.cache[dbPath].exports.query = async (sql, params) => {
    if (/UPDATE acct_tax_deadlines/.test(sql)) {
      updated.push({ id: params[2], filing_date: params[0], amount: params[1] });
      return { rows: [], rowCount: 1 };
    }
    return { rows, rowCount: rows.length };
  };
  // Re-require so the service picks up the stubbed connector.
  delete require.cache[require.resolve('../src/services/accounts/deadlines')];
  const svc = require('../src/services/accounts/deadlines');
  return svc.inferFiledFromPayments({ dryRun }).then(r => ({ ...r, updated }));
}

const dl = (id, type, label, due) => ({
  id, tax_type: type, period_label: label, due_date: new Date(due), status: 'upcoming',
});

(async () => {
  // Three consecutive monthly PAYE deadlines, and only ONE payment.
  const oneOfThree = await runInfer({
    deadlines: [
      dl(1, 'PAYE', 'PAYE Jan 2026', '2026-02-22'),
      dl(2, 'PAYE', 'PAYE Feb 2026', '2026-03-22'),
      dl(3, 'PAYE', 'PAYE Mar 2026', '2026-04-22'),
    ],
    transactions: [tx({ id: 'p1', date: '2026-03-20', code: '825', amount: -1200 })],
  });
  ok('one payment settles exactly one monthly deadline', () => {
    assert.strictEqual(oneOfThree.matches.length, 1,
      'a single PAYE payment was spread across more than one month, which '
      + 'marks a period filed that nobody paid');
    assert.strictEqual(oneOfThree.matches[0].period, 'PAYE Feb 2026',
      'the payment should settle the period whose due date it sits closest to');
    assert.strictEqual(oneOfThree.unmatched.length, 2);
  });

  // A payment inside TWO deadlines' windows. Consecutive monthly due dates
  // are ~30 days apart and each window reaches 31 days back and 21 forward,
  // so the windows overlap by about three weeks. Only the one-payment-one-
  // deadline rule stops both months being marked filed off a single payment.
  const overlapping = await runInfer({
    deadlines: [
      dl(1, 'PAYE', 'PAYE Jan 2026', '2026-02-22'),
      dl(2, 'PAYE', 'PAYE Feb 2026', '2026-03-22'),
    ],
    transactions: [tx({ id: 'p1', date: '2026-03-01', code: '825', amount: -1200 })],
  });
  ok('a payment sitting in two windows is claimed by one deadline only', () => {
    assert.strictEqual(overlapping.matches.length, 1,
      'one payment was counted against two months — both would be marked '
      + 'filed although only one was paid');
    assert.strictEqual(overlapping.matches[0].period, 'PAYE Jan 2026',
      'it should go to the due date it sits closest to (7 days after 22 Feb, '
      + 'against 21 days before 22 Mar)');
    assert.strictEqual(overlapping.unmatched.length, 1);
  });

  // Three deadlines, three payments, one per month.
  const threeOfThree = await runInfer({
    deadlines: [
      dl(1, 'PAYE', 'PAYE Jan 2026', '2026-02-22'),
      dl(2, 'PAYE', 'PAYE Feb 2026', '2026-03-22'),
      dl(3, 'PAYE', 'PAYE Mar 2026', '2026-04-22'),
    ],
    transactions: [
      tx({ id: 'p1', date: '2026-02-20', code: '825', amount: -1200 }),
      tx({ id: 'p2', date: '2026-03-20', code: '825', amount: -1250 }),
      tx({ id: 'p3', date: '2026-04-21', code: '825', amount: -1180 }),
    ],
  });
  ok('three payments settle three months, each to its own', () => {
    assert.strictEqual(threeOfThree.matches.length, 3);
    // Dates are Date objects in process; over HTTP they serialise to ISO,
    // which is what the screen slices. Normalise here so the assertion is
    // about the pairing rather than about formatting.
    const iso = (d) => new Date(d).toISOString().slice(0, 10);
    const pairs = threeOfThree.matches.map(m => `${m.period}@${iso(m.paid_on)}`).sort();
    assert.deepStrictEqual(pairs, [
      'PAYE Feb 2026@2026-03-20',
      'PAYE Jan 2026@2026-02-20',
      'PAYE Mar 2026@2026-04-21',
    ], 'each month should take the payment made for it');
  });

  // A reconciled payment is the normal case, and was invisible before.
  const reconciled = await runInfer({
    deadlines: [dl(1, 'PENSION', 'Pension Jan 2026', '2026-02-22')],
    transactions: [{ ...tx({ id: 'n1', date: '2026-02-19', payee: 'NEST', amount: -340 }), isReconciled: true }],
  });
  ok('a payment already reconciled in Xero is still found', () => {
    assert.strictEqual(reconciled.matches.length, 1,
      'the reconciled payment was skipped — this is the whole bug: the old '
      + 'source held unreconciled lines only');
    assert.strictEqual(reconciled.matches[0].reconciled, true);
  });

  // HMRC payment with no tax account: reported, not assigned.
  const vague = await runInfer({
    deadlines: [
      dl(1, 'PAYE', 'PAYE Jan 2026', '2026-02-22'),
      dl(2, 'VAT', 'VAT Q1 2026', '2026-02-07'),
    ],
    transactions: [tx({ id: 'h1', date: '2026-02-18', payee: 'HMRC', code: '404', amount: -2000 })],
  });
  ok('an unidentifiable HMRC payment files nothing and says so', () => {
    assert.strictEqual(vague.matches.length, 0,
      'an HMRC payment with no tax account was assigned to a deadline anyway');
    assert.ok(vague.notes.some(n => /HMRC payment/.test(n)),
      `the ambiguity should be reported; notes were: ${JSON.stringify(vague.notes)}`);
  });

  // A dry run writes nothing.
  ok('a dry run changes no status', () => {
    assert.strictEqual(threeOfThree.updated.length, 0, 'a dry run wrote to the database');
    assert.strictEqual(threeOfThree.inferred, 0);
    assert.strictEqual(threeOfThree.wouldInfer, 3);
  });

  const applied = await runInfer({
    deadlines: [dl(1, 'PENSION', 'Pension Jan 2026', '2026-02-22')],
    transactions: [tx({ id: 'n1', date: '2026-02-19', payee: 'NEST', amount: -340 })],
    dryRun: false,
  });
  ok('applying writes the payment date and a positive amount', () => {
    assert.strictEqual(applied.updated.length, 1);
    assert.strictEqual(applied.inferred, 1);
    assert.strictEqual(applied.updated[0].amount, 340,
      'the amount should be stored positive; Xero reports money out as negative');
  });

  console.log(`\n${passed} passed, 0 failed`);
})().catch(e => { console.error(e.message); process.exit(1); });
