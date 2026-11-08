/**
 * What a run is about to cost, and whether the month can afford it.
 *
 * The cost chip answers the question you have at the moment you can still
 * decide not to click. For a single run that is the unit price; for a batch
 * it is the unit price times the number of items, which is the figure that
 * stops a thirty-item run surprising somebody.
 *
 * These test `summarise`, which exists as a separate function precisely so
 * it can be tested: a decision written inline in JSX needs a mounted page and
 * a live endpoint to exercise, which makes it a decision a mutation can
 * delete with no test noticing. The repo has already paid for that lesson
 * once, in the strategist's `queueFor`.
 *
 *   node --test tests/featureCost.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The component imports React, so the pure helper is read out of the source
// rather than imported. Keeps this a unit test of the arithmetic without
// standing up a renderer for it.
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'src', 'components', 'FeatureCost.jsx'), 'utf8');

const body = src.match(/export function summarise\(\{[\s\S]*?\n\}/);
assert.ok(body, 'summarise is exported from FeatureCost.jsx');
// eslint-disable-next-line no-new-func
const summarise = new Function(`${body[0].replace('export function', 'return function')}`)();

describe('summarise', () => {
  it('computes the batch total from the unit price', () => {
    const s = summarise({ perCall: 0.28, units: 30, remaining: null });
    assert.equal(s.n, 30);
    assert.ok(Math.abs(s.batchTotal - 8.4) < 1e-9);
  });

  it('has no total for a single run, so the chip shows a per-run price', () => {
    const s = summarise({ perCall: 0.28, units: null, remaining: null });
    assert.equal(s.n, null);
    assert.equal(s.batchTotal, null);
  });

  it('rounds a fractional unit count rather than pricing half an item', () => {
    assert.equal(summarise({ perCall: 1, units: 29.6, remaining: null }).n, 30);
  });

  it('ignores a zero or negative unit count', () => {
    assert.equal(summarise({ perCall: 1, units: 0, remaining: null }).n, null);
    assert.equal(summarise({ perCall: 1, units: -5, remaining: null }).n, null);
  });

  it('survives a missing unit price without inventing a total', () => {
    const s = summarise({ perCall: undefined, units: 30, remaining: 10 });
    assert.equal(s.batchTotal, null);
    assert.equal(s.over, false, 'no price means no judgement about affordability');
  });
});

describe('the over-budget flag', () => {
  it('is set when the run costs more than the month has left', () => {
    assert.equal(summarise({ perCall: 1, units: 30, remaining: 20 }).over, true);
  });

  it('is clear when it fits', () => {
    assert.equal(summarise({ perCall: 1, units: 30, remaining: 50 }).over, false);
  });

  it('is clear at exactly the remaining amount', () => {
    assert.equal(
      summarise({ perCall: 1, units: 30, remaining: 30 }).over, false,
      'spending the last of an allowance is within it, not over it'
    );
  });

  it('is NEVER set when no budget exists', () => {
    // Budgets are opt-in, so no budget is the ordinary case. A missing one
    // must never make a run read as unaffordable, or the warning appears on
    // every client who has not set one and stops being read.
    assert.equal(summarise({ perCall: 100, units: 100, remaining: null }).over, false);
    assert.equal(summarise({ perCall: 100, units: 100, remaining: undefined }).over, false);
  });
});

describe('the zero guard', () => {
  it('money() returns nothing for zero, so a chip never reads "$0"', () => {
    // The chip's presence is the signal that an action spends. A "$0" next to
    // a button makes that signal meaningless, and a feature that has run and
    // cost nothing measurable has nothing useful to say.
    const m = src.match(/function money\(n\) \{[\s\S]*?\n\}/);
    assert.ok(m, 'money is defined in FeatureCost.jsx');
    assert.match(
      m[0], /if \(n === 0\) return null;/,
      `zero must yield null rather than a formatted figure. Found:\n${m[0]}`
    );
  });
});

describe('the currency is stated, not left to be guessed', () => {
  it('names USD in the tooltip', () => {
    // October works in USD, GBP and EUR, and every provider behind this chip
    // bills in USD. The house rule (utils/money.js) is that a number whose
    // currency is implied reads as a fact in whichever currency the reader
    // had in mind, so the figure says which one it is.
    assert.match(src, /in USD,/, 'the title text names the currency');
  });
});

describe('one chip per card', () => {
  it('says so where somebody adding a second one would read it', () => {
    // Transcribe, captions, b-roll, visualise and a batch all spend. Five
    // chips on one card is ambient noise that destroys the only thing the
    // chip is for.
    assert.match(src, /ONE CHIP PER CARD/);
  });
});
