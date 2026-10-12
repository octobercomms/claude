/**
 * The detector client, tested where it can be: the parts that run without a
 * key, a network or a bill.
 *
 * The field names this parses were taken from Pangram's published pages, not
 * from a live response, because the environment it was written in cannot reach
 * pangram.com. These assertions therefore prove the parser handles the SHAPES
 * it was designed for — flat, nested, fraction, percentage — and not that those
 * are the shapes the provider sends. The first real call settles that, which is
 * why an unreadable response is surfaced on screen rather than swallowed.
 */
const pangram = require('../src/services/pangram');

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log('  ok  ', label);
  else { console.log('  FAIL', label); failures += 1; }
};

console.log('Pricing matches the published rate');
ok(pangram.estimateUsd('w '.repeat(100)) === 0.05, '$0.05 for 100 words');
ok(Math.abs(pangram.estimateUsd('w '.repeat(672)) - 0.336) < 0.0001,
  'a 672-word release is $0.34, as the pricing page implies');
ok(pangram.estimateUsd('') === 0, 'nothing costs nothing');

console.log('\nThe fingerprint is what stops a second bill for the same text');
const a = pangram.fingerprint('The wall is 28 metres tall.');
ok(a === pangram.fingerprint('  The wall is 28 metres tall.  '),
  'surrounding whitespace does not count as a change');
ok(a !== pangram.fingerprint('The wall is 29 metres tall.'),
  'an edited number does');

console.log('\nThe percentage is found in the shapes it was built for');
ok(pangram.readPercentage({ ai_likelihood: 0.82 }) === 82, 'a fraction is scaled');
ok(pangram.readPercentage({ fraction_ai_content: 82 }) === 82, 'a percentage is not');
ok(pangram.readPercentage({ result: { ai_likelihood: 0.82 } }) === 82, 'nested under result');
ok(pangram.readPercentage({ data: { prediction_score: 0.06 } }) === 6, 'nested under data');

console.log('\nAnd an unreadable response is null, never a guess');
ok(pangram.readPercentage({ prediction: 'Likely AI Generated' }) === null,
  'a verdict with no number does not become one');
ok(pangram.readPercentage(null) === null, 'null does not throw');
ok(pangram.readPercentage('nonsense') === null, 'a string does not throw');

console.log('\nPer-sentence scores are captured if they are there');
const segs = pangram.readSegments({
  windows: [{ text: 'A sentence.', ai_likelihood: 0.9 }, { text: 'Another.', ai_likelihood: 0.1 }],
});
ok(segs?.items?.length === 2, 'both windows are read');
ok(segs.items[0].score === 90 && segs.items[1].score === 10, 'each carries its own score');
ok(pangram.readSegments({ ai_likelihood: 0.8 }) === null,
  'a response without them returns null rather than an empty array');

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
