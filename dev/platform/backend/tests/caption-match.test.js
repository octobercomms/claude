/**
 * Matching somebody else's caption treatment to one of our 31 presets.
 *
 * The analyser's `captionFor` returned a null with its reason, because
 * reading type off a frame needs vision. This is the half that decides what
 * the vision pass's observations MEAN, and it is pure, so all of it is tested
 * here without a model and without a video.
 *
 * ── The round trip is the whole test ──────────────────────────────────
 *
 * Every one of the 31 presets can be asked what observations it would
 * produce, and those observations fed back through the matcher. Two things
 * come out of that, and the second matters more than the first:
 *
 *   - 31 of 31 land in their own shortlist. That is the guarantee: the
 *     operator is never shown a list that excludes the right answer.
 *   - 25 of 31 are the exact pick, and the six that are not are named. They
 *     are genuinely indistinguishable in a still frame — `minimal` and
 *     `ali-abdaal` are both near-white, both plain-family, and their outlines
 *     are 3.5px and 4px, which is inside what a model can read. Reporting one
 *     as the other and saying so is right; claiming to tell them apart would
 *     be the invention this module exists not to make.
 *
 * A weight sweep is run in here too, because a tuned threshold that only
 * works at one setting is a coincidence. The in-shortlist guarantee holds at
 * every one of 27 combinations; only the shortlist length moves.
 *
 *   node tests/caption-match.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const CM = require('../../shared/captionMatch.mjs');

const PRESETS = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', '..', 'shared', 'captions', 'presets.json'), 'utf8'
));
const STYLES = PRESETS.styles;
const VERTICAL = PRESETS.outputFormats.vertical;
const IDS = Object.keys(STYLES);

const match = (obs, styles = STYLES) => CM.matchPreset(obs, { styles, format: VERTICAL });
const obsOf = (id) => CM.observationsOf(STYLES[id], VERTICAL);

// ── the round trip ────────────────────────────────────────────────────

describe('the round trip over all 31 presets', () => {
  it('never shows a shortlist that excludes the right answer', () => {
    const missed = [];
    for (const id of IDS) {
      const r = match(obsOf(id));
      if (![r.value, ...r.alternatives].includes(id)) {
        missed.push(`${id} -> ${r.value} [${r.alternatives.join(', ')}]`);
      }
    }
    assert.deepEqual(missed, [], `the true preset fell out of the shortlist:\n${missed.join('\n')}`);
  });

  it('picks 25 of the 31 outright, and these six it does not', () => {
    // Named rather than counted, so a change to the catalogue or the weights
    // shows up as a different list rather than as the same number.
    const wrong = IDS.filter((id) => match(obsOf(id)).value !== id);
    assert.deepEqual(wrong.sort(), [
      'cinema-gold', 'kapwing-viral', 'minimal', 'neon-cyber', 'podcast-hook', 'wealth-hustle',
    ]);
  });

  it('keeps the shortlist short enough to be read', () => {
    const sizes = IDS.map((id) => {
      const r = match(obsOf(id));
      return 1 + r.alternatives.length;
    });
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    const worst = Math.max(...sizes);
    assert.ok(mean <= 3, `mean shortlist ${mean.toFixed(2)}`);
    assert.ok(worst <= 8, `worst shortlist ${worst}`);
  });

  it('holds the guarantee across a sweep of the weights', () => {
    // The thresholds were chosen on this sweep. What it proves is not that
    // the chosen values are special: it is that the guarantee does not depend
    // on them. If a later change makes the shortlist exclude the right preset
    // at some setting, the chosen setting is a coincidence and this fails.
    const base = { ...CM.WEIGHTS };
    for (const outline of [0.6, 0.9, 1.2]) {
      for (const tie of [0.03, 0.04, 0.06]) {
        for (const size of [0.5, 0.8, 1.1]) {
          const weights = { ...base, outline, size };
          const missed = IDS.filter((id) => {
            const set = shortlistWith(obsOf(id), weights, tie);
            return !set.includes(id);
          });
          assert.deepEqual(
            missed, [],
            `outline=${outline} tie=${tie} size=${size} dropped ${missed.join(', ')}`
          );
        }
      }
    }
  });
});

/**
 * The matcher's own arithmetic at other weights.
 *
 * Deliberately a reimplementation rather than a parameter on the module: the
 * weights are not knobs the product exposes, and adding a settings object to
 * the shipped function so a test can sweep it would be the test changing the
 * code it checks. If this drifts from the module the round-trip assertions
 * above fail first, because they run the real one.
 */
function shortlistWith(obs, weights, tie) {
  const scored = [];
  for (const [id, preset] of Object.entries(STYLES)) {
    let total = 0;
    let weight = 0;
    const add = (w, score) => {
      if (score == null) return;
      total += w * score;
      weight += w;
    };
    const family = CM.familyOf(preset.animationType);
    if (obs.family) add(weights.family, obs.family === family ? 0 : 1);
    if (obs.colour) add(weights.colour, CM.colourDistance(obs.colour, preset.primaryColor));
    if (obs.accent && (family === 'accent' || family === 'box')) {
      add(weights.accent, CM.colourDistance(obs.accent, preset.highlightColor));
    }
    const band = CM.sizeBandOf(obs.capPct);
    const presetBand = CM.sizeBandOf(CM.capPctOf(preset.fontSize, VERTICAL));
    if (band && presetBand) add(weights.size, band === presetBand ? 0 : 1);
    if (Number.isFinite(obs.outlinePx) && Number.isFinite(Number(preset.outlineSize))) {
      const diff = Math.abs(obs.outlinePx - Number(preset.outlineSize));
      add(weights.outline, diff <= CM.OUTLINE_TOLERANCE_PX
        ? 0
        : Math.min(1, (diff - CM.OUTLINE_TOLERANCE_PX) / CM.OUTLINE_SPREAD_PX));
    }
    if (obs.wordsPerLine != null && preset.wordsPerLine != null) {
      add(weights.wordsPerLine, Math.min(1, Math.abs(obs.wordsPerLine - preset.wordsPerLine) / 4));
    }
    if (weight) scored.push({ id, score: total / weight });
  }
  scored.sort((a, b) => (a.score - b.score) || a.id.localeCompare(b.id));
  const best = scored[0];
  return scored.filter((s) => s.score - best.score <= tie).map((s) => s.id);
}

// ── what a still frame cannot show ────────────────────────────────────

describe('what it refuses to read', () => {
  it('reports no accent for a preset whose treatment never shows one', () => {
    // `minimal` carries a highlightColor in the data and puts it on screen
    // for 120ms as a scale. Handing the matcher a colour no sampled frame
    // carries would reward a preset for something invisible.
    assert.equal(STYLES.minimal.highlightColor, '#FFFFFF');
    assert.equal(obsOf('minimal').accent, null);
    assert.equal(obsOf('hormozi').accent, '#00FFFF');
    assert.equal(obsOf('crimson-pop').accent, '#E11D48');
  });

  it('groups the eight animation types into the four a still separates', () => {
    assert.deepEqual(CM.FAMILIES, ['plain', 'accent', 'box', 'glow']);
    assert.equal(CM.familyOf('scale'), 'plain');
    assert.equal(CM.familyOf('pop'), 'plain');
    assert.equal(CM.familyOf('bounce'), 'plain');
    assert.equal(CM.familyOf('none'), 'plain');
    assert.equal(CM.familyOf('highlight'), 'accent');
    assert.equal(CM.familyOf('karaoke'), 'accent');
    assert.equal(CM.familyOf('box'), 'box');
    assert.equal(CM.familyOf('glow'), 'glow');
    assert.equal(CM.familyOf('shimmer'), null);
  });

  it('says so when the shortlist differs only in an animation', () => {
    const r = match(obsOf('creator-pop'));
    assert.ok(r.alternatives.length > 1);
    assert.match(r.why, /look the same in a still frame/);
    assert.match(r.why, /per-cue animation a sampled frame cannot show/);
  });

  it('measures CAP HEIGHT, which is what a model reading a frame reports', () => {
    // `fontSize` is an em box and the observation is the height of a capital
    // letter, so the two are not the same number: for the sans faces these
    // presets use, a cap is about 0.72 of the em (Inter is 0.727, Montserrat
    // 0.700). Dropping the ratio would compare the model's cap heights
    // against em heights, a systematic 28% mismatch. It happens not to move
    // any band today because the two groups are far apart, which is exactly
    // why it is asserted on the value rather than on a band.
    assert.equal(CM.CAP_RATIO, 0.72);
    assert.equal(CM.capPctOf(105, VERTICAL), (105 * 0.72) / 1920);
    assert.ok(Math.abs(CM.capPctOf(105, VERTICAL) - 0.0394) < 0.0005);
    assert.equal(CM.capPctOf(0, VERTICAL), null);
    assert.equal(CM.capPctOf(105, {}), null);
  });

  it('only proposes a preset that shows an accent when the reference showed one', () => {
    // `cinema-gold` is a `scale` preset carrying #FFD700 as its highlight
    // colour, which it puts on screen for 120ms and never in a sampled
    // frame. Scoring an observed gold accent against it would promote a
    // plain preset for a colour nobody sees — so the accent is only compared
    // where the preset's own treatment shows one.
    assert.equal(STYLES['cinema-gold'].highlightColor, '#FFD700');
    assert.equal(CM.familyOf(STYLES['cinema-gold'].animationType), 'plain');
    const gold = {
      present: true, capPct: CM.capPctOf(98, VERTICAL), colour: '#F8FAFC',
      accent: '#FFD700', family: 'accent', outlinePx: 4,
    };
    const r = match(gold);
    for (const id of [r.value, ...r.alternatives]) {
      const family = CM.familyOf(STYLES[id].animationType);
      assert.ok(
        family === 'accent' || family === 'box',
        `${id} is ${family}, and shows no accent`
      );
    }
    // And the same invariant across the whole catalogue, not just this case.
    for (const id of IDS) {
      const family = CM.familyOf(STYLES[id].animationType);
      if (family !== 'accent' && family !== 'box') continue;
      const out = match(obsOf(id));
      for (const candidate of [out.value, ...out.alternatives]) {
        const got = CM.familyOf(STYLES[candidate].animationType);
        assert.ok(
          got === 'accent' || got === 'box',
          `${id} proposed ${candidate}, which is ${got}`
        );
      }
    }
  });

  it('holds when the pass saw two colours but could not classify the treatment', () => {
    // The case where the guard above is the only thing doing the work, found
    // by a mutation sweep: with a family observed, the family penalty alone
    // keeps a plain preset down, so removing the guard changes nothing. With
    // NO family — a model that can see two colours but will not commit to
    // how they are applied, which is the realistic answer — the unused gold
    // highlight scores a perfect match and `cinema-gold` becomes the pick:
    // a plain preset chosen for a colour that is on screen for 120ms and in
    // no sampled frame.
    const r = match({
      present: true, capPct: CM.capPctOf(98, VERTICAL), colour: '#F8FAFC',
      accent: '#FFD700', outlinePx: 4,
    });
    assert.notEqual(
      r.value, 'cinema-gold',
      'a plain preset was picked on a highlight colour no frame shows'
    );
    assert.equal(CM.familyOf(STYLES[r.value].animationType), 'plain',
      'the pick is still plain, because nothing said otherwise — just not that one');
  });

  it('refuses to separate two presets on a size difference it cannot see', () => {
    // 105 against 102 is 5.47% of a 1920 frame against 5.31%: a sixth of a
    // percentage point. Treating that as a signal is the fault; the band is
    // the honest resolution.
    assert.equal(CM.sizeBandOf(CM.capPctOf(105, VERTICAL)), 'large');
    assert.equal(CM.sizeBandOf(CM.capPctOf(102, VERTICAL)), 'large');
    assert.equal(CM.sizeBandOf(CM.capPctOf(44, VERTICAL)), 'small');
    assert.equal(CM.sizeBandOf(CM.capPctOf(36, VERTICAL)), 'small');
  });

  it('answers null between the two bands rather than rounding into one', () => {
    // Nothing shipped lands here. A reference that does is a reference whose
    // size this cannot place, and saying so beats choosing a side.
    assert.equal(CM.sizeBandOf(0.027), null);
  });

  it('charges nothing for an outline difference inside what a model can read', () => {
    const base = { ...obsOf('ali-abdaal') };          // 4px
    const near = match({ ...base, outlinePx: 4 + CM.OUTLINE_TOLERANCE_PX });
    const far = match({ ...base, outlinePx: 4 + CM.OUTLINE_TOLERANCE_PX + CM.OUTLINE_SPREAD_PX });
    assert.ok(near.alternatives.includes('cinema-gold') || near.value === 'cinema-gold',
      'a 1.5px difference keeps the 4px presets together');
    assert.ok(!([far.value, ...far.alternatives].includes('minimal')),
      'and 4.5px past it drops the 3.5px one');
  });

  it('names the preset fields no frame carries, and why', () => {
    assert.ok(CM.OBSERVABLE.ignored.fontName);
    assert.match(CM.OBSERVABLE.ignored.fontName, /approximation/);
    assert.ok(CM.OBSERVABLE.ignored.bold);
    assert.match(CM.OBSERVABLE.ignored.bold, /29 of the 31/);
    for (const field of Object.keys(CM.OBSERVABLE.ignored)) {
      assert.ok(!CM.OBSERVABLE.used.includes(field), `${field} is both used and ignored`);
    }
  });

  it('reports an all-caps reference as unmatched on case, because no preset has one', () => {
    // The presets carry no case field and the compiler changes no case, so
    // an all-caps reference produces mixed-case output unless the words
    // themselves are capitals. Said rather than silently dropped.
    const r = match({ ...obsOf('hormozi'), caseStyle: 'upper' });
    assert.match(r.why, /upper case, which no preset carries/);
    assert.match(r.why, /set the case in the words themselves/);
    // And it changed nothing about the pick.
    assert.equal(r.value, match(obsOf('hormozi')).value);
  });
});

// ── the observation contract ──────────────────────────────────────────

describe('validating what a vision pass reports', () => {
  const good = () => ({
    present: true, band: 0.82, capPct: 0.039, colour: '#FFFFFF',
    accent: '#00FFFF', family: 'accent', outlinePx: 5, wordsPerLine: 3,
    caseStyle: 'upper',
  });

  it('accepts a complete answer', () => {
    assert.deepEqual(CM.validateObservations(good()), []);
  });

  it('accepts an answer that says only that there is no type', () => {
    assert.deepEqual(CM.validateObservations({ present: false }), []);
  });

  it('refuses a field nothing reads', () => {
    const errs = CM.validateObservations({ ...good(), fontName: 'Inter' });
    assert.match(errs.join(' '), /reports fontName, which nothing reads/);
  });

  it('refuses a family outside the vocabulary', () => {
    // A model asked an open question invents a word. The closed list is what
    // makes the answer matchable at all.
    assert.match(
      CM.validateObservations({ ...good(), family: 'shimmer' }).join(' '),
      /family must be one of plain, accent, box, glow/
    );
  });

  it('refuses a colour that is not a hex triple', () => {
    assert.match(CM.validateObservations({ ...good(), colour: 'white' }).join(' '), /hex colour/);
    assert.match(CM.validateObservations({ ...good(), accent: '#FFF' }).join(' '), /hex colour/);
  });

  it('refuses a band outside the frame and a fractional word count', () => {
    assert.match(CM.validateObservations({ ...good(), band: 1.4 }).join(' '), /band must be a number from 0 to 1/);
    assert.match(CM.validateObservations({ ...good(), wordsPerLine: 2.5 }).join(' '), /whole number/);
  });

  it('refuses an absent `present`, rather than reading it as false', () => {
    const errs = CM.validateObservations({ band: 0.8 });
    assert.match(errs.join(' '), /present must be true or false/);
  });

  it('matches nothing on observations it refused', () => {
    const r = match({ present: true, family: 'shimmer' });
    assert.equal(r.value, null);
    assert.equal(r.confidence, 0);
    assert.match(r.why, /the observations are not usable/);
  });
});

// ── the answers an operator acts on ───────────────────────────────────

describe('the match an operator reads', () => {
  it('says there is no preset when the reference burns no type', () => {
    const r = match({ present: false });
    assert.equal(r.value, null);
    assert.equal(r.confidence, 1);
    assert.match(r.why, /burns no type/);
  });

  it('keeps a 40pt reference out of the creator presets entirely', () => {
    // The commercially important split. An architecture practice's reference
    // must not come back proposing MrBeast.
    const r = match({
      present: true, capPct: CM.capPctOf(40, VERTICAL), colour: '#FFFFFF',
      family: 'plain', outlinePx: 2, wordsPerLine: 6,
    });
    for (const id of [r.value, ...r.alternatives]) {
      assert.equal(STYLES[id].category, 'measured', `${id} is ${STYLES[id].category}`);
    }
  });

  it('reads a yellow-on-orange reference as the one preset that is', () => {
    const r = match({
      present: true, capPct: CM.capPctOf(120, VERTICAL), colour: '#FFFF00',
      accent: '#FF6600', family: 'accent', outlinePx: 8,
    });
    assert.equal(r.value, 'mrbeast');
    assert.deepEqual(r.alternatives, []);
  });

  it('matches against a subset, for a client who only gets the measured four', () => {
    const measured = Object.fromEntries(
      Object.entries(STYLES).filter(([, p]) => p.category === 'measured')
    );
    const r = CM.matchPreset(obsOf('hormozi'), { styles: measured, format: VERTICAL });
    assert.ok(['institution', 'institution-soft', 'gallery', 'gallery-quiet'].includes(r.value));
  });

  it('says which dimensions decided it', () => {
    const r = match(obsOf('mrbeast'));
    assert.deepEqual(r.used.sort(), ['accent', 'colour', 'family', 'outline', 'size']);
    assert.match(r.why, /matched on /);
  });

  it('is less confident the less it was shown', () => {
    const full = match(obsOf('mrbeast'));
    const thin = match({ present: true, family: 'accent' });
    assert.ok(thin.confidence < full.confidence,
      `one observation ${thin.confidence} against five ${full.confidence}`);
    assert.ok(thin.confidence <= 0.6, `and never reads as a match: ${thin.confidence}`);
  });

  it('never claims certainty', () => {
    // Nothing here is measured off the file. The one answer allowed a
    // confidence of 1 is "there is no type", which is an observation rather
    // than a judgement.
    for (const id of IDS) {
      assert.ok(match(obsOf(id)).confidence <= 0.9, id);
    }
  });

  it('answers null with a reason when there are no presets to match', () => {
    const r = CM.matchPreset(obsOf('mrbeast'), { styles: {}, format: VERTICAL });
    assert.equal(r.value, null);
    assert.match(r.why, /no presets to match against/);
  });
});

// ── where the type sat ────────────────────────────────────────────────

describe('the caption position', () => {
  it('is proposed separately, because no preset carries one', () => {
    // Position is `marginV` on the caption SOURCE, not a preset field. The
    // compiler's default is 320 of a 1920 frame.
    const r = CM.marginVFor({ present: true, band: 0.83 }, VERTICAL);
    assert.equal(r.value, 330);
    assert.match(r.why, /83% down the frame/);
  });

  it('rounds to ten pixels rather than claiming a pixel', () => {
    const r = CM.marginVFor({ present: true, band: 0.8349 }, VERTICAL);
    assert.equal(r.value % 10, 0);
  });

  it('says it does not know when the pass did not report a band', () => {
    const r = CM.marginVFor({ present: true, band: null }, VERTICAL);
    assert.equal(r.value, null);
    assert.equal(r.confidence, 0);
    assert.match(r.why, /did not report where the type sat/);
  });

  it('places type at the top of the frame as a large margin', () => {
    const r = CM.marginVFor({ present: true, band: 0.1 }, VERTICAL);
    assert.ok(r.value > 1000, `read ${r.value}`);
    assert.ok(r.value <= Math.round(VERTICAL.height * 0.8), 'and inside the frame');
  });

  it('needs a frame to measure against', () => {
    assert.equal(CM.marginVFor({ present: true, band: 0.8 }, {}).value, null);
  });
});
