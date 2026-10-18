// Guard — the proposal cannot overclaim, and cannot quietly reprice itself.
//
// Three rules here are decisions Daniel made, not preferences, and each one is
// the kind a persuasion engine erodes if nothing holds it:
//
//  1. "No outcome claims until a client has run the method." matchProof's whole
//     job is to surface the most persuasive proof available, and a case study
//     from a different service scores well on sector overlap alone, so under the
//     stricter policy the case study has to be withheld in code rather than
//     asked for politely in a prompt.
//  2. A figure needs its source. "216 pieces of published coverage" with the
//     editorial log named under it is a fact; the same number alone is a claim.
//  3. A price nobody has set stays blank. The figure in a proposal is
//     contractual the moment it is accepted, so an invented one is worse than a
//     missing one, and the document says "to confirm" instead.
//
// No database, no network. Runs in CI.

const m = require('./proposalMethods');
const p = require('./proposals');

let pass = 0;
let fail = 0;

function check(name, got, want) {
  const ok = typeof want === 'function' ? want(got) : got === want;
  if (ok) { pass += 1; console.log('PASS ', name); }
  else { fail += 1; console.log('FAIL ', name, '\n  got:  ', JSON.stringify(got)?.slice(0, 300)); }
}

// ---------------------------------------------------------------------------
// 1. The evidence rule.

const library = [
  { id: 'cs1', kind: 'case_study', title: 'Hartwell', sector_tags: ['architecture'], problem_tags: ['press'] },
  { id: 't1', kind: 'testimonial', title: 'Case Furniture', sector_tags: ['furniture'], problem_tags: ['press'] },
  { id: 'c1', kind: 'credential', title: '22 countries', sector_tags: ['architecture'], problem_tags: ['press'] },
  { id: 'c2', kind: 'credential', title: '216 pieces', sector_tags: ['architecture'], problem_tags: ['press'] },
  { id: 'c3', kind: 'credential', title: '150 outlets', sector_tags: ['architecture'], problem_tags: ['press'] },
  { id: 'c4', kind: 'credential', title: '18 clients', sector_tags: ['architecture'], problem_tags: ['press'] },
  { id: 'p1', kind: 'press', title: 'Wallpaper*', sector_tags: ['architecture'], problem_tags: ['press'] },
];

const full = p.matchProof(library, ['architecture'], ['press'], 'full');
check('an established method gets its case study', full.case_study, 'cs1');
check('and two credentials beside it', full.credentials.length, 2);

const strict = p.matchProof(library, ['architecture'], ['press'], 'no_outcome_claims');
check('a new service gets NO case study', strict.case_study, null);
check('the testimonial survives, because it is true of October', strict.testimonial, 't1');
check('the published coverage survives too', strict.press, 'p1');
check('and the counted record gets the room instead', strict.credentials.length, 4);
check('the withheld item is recorded, not silently dropped', strict.withheld_case_study, 'cs1');
check('the policy travels with the match', strict.evidence_policy, 'no_outcome_claims');

// The default must be the safe-to-ship one for existing callers, and an
// unrecognised value must not quietly unlock case studies.
check('no policy argument behaves as established', p.matchProof(library, ['architecture'], ['press']).case_study, 'cs1');
check('an unknown policy string normalises to established', m.evidencePolicy('whatever'), 'full');
check('and the strict one is preserved', m.evidencePolicy('no_outcome_claims'), 'no_outcome_claims');

// The writing prompt must carry the rule, or Claude will reach for a result.
const strictBlock = p.methodBlock({
  name: 'Serious Buyer Method', evidence_policy: 'no_outcome_claims',
  scarcity: 'Capped at two practices.', tactics: [], strategy: [],
});
check('the prompt is told about the rule', strictBlock, (s) => /EVIDENCE RULE/.test(s));
check('the prompt is told not to imply a result', strictBlock, (s) => /may NOT state or imply a result/.test(s));
check('the scarcity line reaches the prompt', strictBlock, (s) => s.includes('Capped at two practices.'));
check('an established method gets no such rule',
  p.methodBlock({ name: 'Earning Visibility', evidence_policy: 'full', tactics: [], strategy: [] }),
  (s) => !/EVIDENCE RULE/.test(s));

// ---------------------------------------------------------------------------
// 2. A figure needs its source.

const refuses = async (label, fields, match) => {
  try { await p.saveProof(null, fields); fail += 1; console.log('FAIL ', label, '\n  got:   no error'); }
  catch (e) {
    if (match.test(e.message)) { pass += 1; console.log('PASS ', label); }
    else { fail += 1; console.log('FAIL ', label, '\n  got:  ', e.message); }
  }
};

(async () => {
  await refuses('a figure with no source is refused',
    { kind: 'credential', title: 'Pieces of coverage', body: 'Since 2023.', figure: '216' },
    /source/i);

  // ---------------------------------------------------------------------------
  // 3. Prices: set, missing, and never invented.

  const method = {
    id: 'x', slug: 'advanced', name: 'Earning Visibility · Advanced', version: 3,
    prices: { GBP: { monthly: 1870, setup: 0, gocardless_url: 'https://pay.gocardless.com/abc' } },
    objectives: {}, kpis: {}, strategy: [], tactics: [], stages: [], includes: [],
  };

  const gbp = m.snapshot(method, 'GBP');
  check('the set price is carried', gbp.monthly, 1870);
  check('with its symbol', gbp.symbol, '£');
  check('and is not flagged missing', gbp.price_missing, false);
  check('the mandate link is captured at draft time', gbp.gocardless_url, 'https://pay.gocardless.com/abc');

  const usd = m.snapshot(method, 'USD');
  check('an unset currency yields no price rather than a converted one', usd.monthly, null);
  check('and says so', usd.price_missing, true);
  check('with the right symbol regardless', usd.symbol, '$');
  check('and no mandate link to send them to', usd.gocardless_url, undefined);

  // A converted price would be wrong, not merely approximate: £1,870 and $1,870
  // are different prices for different markets on purpose.
  check('nothing derives a USD figure from the GBP one', usd.monthly, (v) => v !== 1870 && v == null);

  // The snapshot is what makes an old proposal still read as it was sent.
  const improved = { ...method, version: 4, prices: { GBP: { monthly: 2400, setup: 0 } } };
  check('a later reprice does not reach back into the old snapshot', gbp.monthly, 1870);
  check('while a new snapshot sees it', m.snapshot(improved, 'GBP').monthly, 2400);

  // Acceptance follows the signed document, not today's method.
  check('the mandate link comes from the snapshot first',
    m.gocardlessUrl(gbp, { prices: { GBP: { gocardless_url: 'https://pay.gocardless.com/CHANGED' } } }),
    'https://pay.gocardless.com/abc');

  // ---------------------------------------------------------------------------
  // 4. A content change bumps the version; a price change does not, because a
  //    sent proposal's reading of the method has not changed.

  const before = { objectives: { short: 'a' }, kpis: {}, strategy: [], tactics: [], stages: [] };
  check('rewriting the objectives bumps the version',
    m.contentChanged(before, { ...before, objectives: { short: 'b' } }), true);
  check('rewriting the tactics bumps it',
    m.contentChanged(before, { ...before, tactics: [{ heading: 'press', items: ['x'] }] }), true);
  check('a reprice does not', m.contentChanged(before, { ...before }), false);

  // ---------------------------------------------------------------------------
  // 5. A GoCardless link must be https, since it takes a bank mandate.

  try {
    m.cleanPrices({ GBP: { monthly: 1, gocardless_url: 'http://pay.gocardless.com/x' } });
    fail += 1; console.log('FAIL  an http mandate link is refused\n  got:   no error');
  } catch (e) {
    check('an http mandate link is refused', /https/i.test(e.message), true);
  }
  check('an https one is kept',
    m.cleanPrices({ GBP: { monthly: 1, gocardless_url: 'https://pay.gocardless.com/x' } }).GBP.gocardless_url,
    'https://pay.gocardless.com/x');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
