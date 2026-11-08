/**
 * The batch pre-flight: what a run is about to do, before it does any of it.
 *
 * The question these tests are really about is WHEN an operator finds out.
 * A thirty-item run that discovers at item nineteen that the client uploaded
 * four photographs instead of six has already spent eighteen renders and an
 * hour, and nobody is watching. So the plan is computed whole and shown, and
 * these pin the three decisions that makes:
 *
 *   - every problem at once, not the first one (binding throws on the first;
 *     a pre-flight has to report the list, because the operator is about to
 *     go and fix them);
 *   - a bad item blocks itself and nothing else (per-item failure must not
 *     fail the batch; the old stills path passed provider errors straight
 *     through, which is wrong for a run of thirty);
 *   - no budget NEVER reads as unaffordable (budgets are opt-in, so no budget
 *     is the ordinary case, and a warning that cries wolf is one people learn
 *     to click past — the same lesson as the cost chip's `over` flag).
 *
 *   node tests/composition-batch.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  planBatch, bindBatch, checkItem, summarise,
} = require('../../shared/compositionBatch.mjs');
const { validate } = require('../../shared/composition.mjs');

// ── fixtures ─────────────────────────────────────────────────────────

const TEMPLATES = path.join(__dirname, '..', '..', 'shared', 'templates');
const montage = () => JSON.parse(fs.readFileSync(path.join(TEMPLATES, 'stills-montage.json'), 'utf8'));
const talkingHead = () => JSON.parse(fs.readFileSync(path.join(TEMPLATES, 'talking-head.json'), 'utf8'));

const still = (n) => ({
  kind: 'clip', url: `${n}.jpg`, duration: 30, width: 1080, height: 1920, fps: 30,
});
const audio = { kind: 'audio', url: 'bed.mp3', duration: 120 };

/** Content that satisfies stills-montage at its minimum. */
const good = () => ({
  stills: [1, 2, 3, 4, 5, 6].map((i) => still(`s${i}`)),
  titles: ['Hackney', '2026'],
  music: audio,
});

const items = (n, content = good()) => Array.from({ length: n }, (_, i) => ({
  content, ref: `post-${i}`,
}));

// ── checking one item ────────────────────────────────────────────────

describe('checkItem', () => {
  it('passes content that satisfies every slot', () => {
    const { ok, problems } = checkItem(montage(), good());
    assert.equal(ok, true, problems.map((p) => p.says).join('; '));
  });

  it('reports EVERY problem at once, not the first', () => {
    // This is the whole reason it does not just call bindTemplate: the binder
    // throws on the first fault, and an operator about to go and fix a batch
    // wants the list.
    const { problems } = checkItem(montage(), { stills: [still('a')] });
    const slots = problems.map((p) => p.slot).sort();
    assert.deepEqual(slots, ['music', 'stills', 'titles']);
  });

  it('counts what is missing in words an operator reads', () => {
    // Not `${kind}s`. That gives "1 audios" and "2 texts", and this string is
    // what sits beside a rejected row while somebody decides what to go and
    // upload.
    const says = (content) => checkItem(montage(), content).problems.map((p) => p.says);
    assert.deepEqual(says({ titles: ['a', 'b'], music: audio }), [
      'needs 6 photographs and has none',
    ]);
    assert.deepEqual(says({ stills: good().stills, music: audio }), [
      'needs 2 lines of text and has none',
    ]);
    assert.deepEqual(says({ stills: good().stills, titles: ['a', 'b'] }), [
      'needs 1 audio track and has none',
    ]);
  });

  it('says how short a slot is, not merely that it is short', () => {
    const [p] = checkItem(montage(), { ...good(), stills: [still('a'), still('b')] }).problems;
    assert.equal(p.says, 'needs 6 photographs and has 2');
    assert.equal(p.need, 6);
    assert.equal(p.got, 2);
  });

  it('catches a source where a line of text belongs', () => {
    const [p] = checkItem(montage(), { ...good(), titles: [still('x'), 'Two'] }).problems;
    assert.match(p.says, /on-screen type, so entry 1 must be a line of text/);
  });

  it('catches audio in a picture slot and a picture in an audio slot', () => {
    const [a] = checkItem(montage(), { ...good(), music: still('x') }).problems;
    assert.equal(a.says, 'wants an audio track and entry 1 is a clip');
    const [b] = checkItem(talkingHead(), { speech: audio, bed: audio }).problems;
    assert.equal(b.says, 'takes clips and entry 1 is an audio track');
  });

  it('catches content naming a slot the template does not have', () => {
    const [p] = checkItem(montage(), { ...good(), nope: [still('z')] }).problems;
    assert.match(p.says, /is not a slot of "stills-montage"/);
    assert.match(p.says, /stills, titles, endcard, music/, 'and says what the slots are');
  });

  it('treats extra content as a note, not a fault', () => {
    // The template says max, the binder takes the first max. An operator who
    // dropped eleven photographs into a slot that uses eight has not made a
    // mistake worth stopping a batch for; it is reported so the sheet can say
    // what was left out.
    const ten = Array.from({ length: 10 }, (_, i) => still(`s${i}`));
    const { ok, problems, unused } = checkItem(montage(), { ...good(), stills: ten });
    assert.equal(ok, true);
    assert.deepEqual(problems, []);
    assert.deepEqual(unused, [{ slot: 'stills', kind: 'still', unused: 2, says: null }]);
  });

  it('does not require an optional slot', () => {
    // `endcard` is min 0: a client with no Design page would otherwise have
    // every one of thirty items blocked.
    assert.equal(checkItem(montage(), good()).ok, true);
    assert.ok(!montage().slots.find((s) => s.id === 'endcard').min);
  });
});

// ── planning a batch ─────────────────────────────────────────────────

describe('planBatch', () => {
  it('separates what can run from what cannot', () => {
    const plan = planBatch({
      template: montage(),
      items: [
        { content: good(), ref: 'a' },
        { content: { stills: [still('x')] }, ref: 'b' },
        { content: good(), ref: 'c' },
      ],
    });
    assert.equal(plan.total, 3);
    assert.equal(plan.runnable, 2);
    assert.equal(plan.blocked, 1);
    assert.deepEqual(plan.items.filter((i) => !i.ok).map((i) => i.ref), ['b']);
  });

  it('carries the caller ref through untouched, so a row links back', () => {
    const plan = planBatch({ template: montage(), items: items(3) });
    assert.deepEqual(plan.items.map((i) => i.ref), ['post-0', 'post-1', 'post-2']);
    assert.deepEqual(plan.items.map((i) => i.index), [0, 1, 2]);
  });

  it('costs the run from what WILL run, not what was submitted', () => {
    // Counting blocked items would overstate the spend and could refuse a
    // batch that fits, which teaches the operator to click past the warning.
    const plan = planBatch({
      template: montage(),
      items: [...items(2), { content: { stills: [] }, ref: 'bad' }],
      perItemUsd: 0.5,
    });
    assert.equal(plan.runnable, 2);
    assert.equal(plan.estUsd, 1);
  });

  it('flags a run that costs more than the month has left', () => {
    const plan = planBatch({
      template: montage(), items: items(30), perItemUsd: 0.28, remainingUsd: 3,
    });
    assert.equal(plan.overBudget, true);
    assert.equal(plan.estUsd, 8.4);
  });

  it('is NOT over budget at exactly the remaining amount', () => {
    const plan = planBatch({
      template: montage(), items: items(30), perItemUsd: 0.28, remainingUsd: 8.4,
    });
    assert.equal(
      plan.overBudget, false,
      'spending the last of an allowance is within it, not over it'
    );
  });

  it('is NEVER over budget when no budget is set', () => {
    // Budgets are opt-in, so no budget is the ordinary case. A missing one
    // must never make a run read as unaffordable.
    for (const remainingUsd of [null, undefined, NaN]) {
      const plan = planBatch({
        template: montage(), items: items(30), perItemUsd: 100, remainingUsd,
      });
      assert.equal(plan.overBudget, false, `remaining ${remainingUsd} made it unaffordable`);
      assert.equal(plan.affordable, null, 'and there is no number of items that "fit"');
    }
  });

  it('says how many WOULD fit, rather than silently doing that many', () => {
    // A runner that quietly does eleven of thirty is indistinguishable from
    // one that is broken.
    const plan = planBatch({
      template: montage(), items: items(30), perItemUsd: 0.28, remainingUsd: 3,
    });
    assert.equal(plan.affordable, 10, '3.00 / 0.28 = 10.7, so ten whole videos');
    assert.equal(plan.runnable, 30, 'and it has NOT truncated the run');
  });

  it('never claims more fit than can run', () => {
    const plan = planBatch({
      template: montage(), items: items(2), perItemUsd: 0.01, remainingUsd: 500,
    });
    assert.equal(plan.affordable, 2);
  });

  it('gives no cost figure when none is known', () => {
    // A new template has no median, and a made-up number is worse than none.
    const plan = planBatch({ template: montage(), items: items(5) });
    assert.equal(plan.estUsd, null);
    assert.equal(plan.perItemUsd, null);
    assert.equal(plan.overBudget, false);
  });

  it('throws on a broken TEMPLATE, because no content fixes that', () => {
    assert.throws(
      () => planBatch({ template: { id: 'x' }, items: items(1) }),
      /is invalid, so no batch can be planned/
    );
  });

  it('does not throw on broken CONTENT, because the rest should still run', () => {
    const plan = planBatch({
      template: montage(),
      items: [{ content: {}, ref: 'empty' }, { content: good(), ref: 'fine' }],
    });
    assert.equal(plan.runnable, 1);
  });

  it('handles an empty batch without inventing a run', () => {
    const plan = planBatch({ template: montage(), items: [] });
    assert.equal(plan.total, 0);
    assert.equal(plan.runnable, 0);
    assert.equal(plan.says, 'Nothing to run.');
  });

  it('survives a malformed item entry', () => {
    const plan = planBatch({ template: montage(), items: [null, undefined, {}] });
    assert.equal(plan.runnable, 0);
    assert.equal(plan.blocked, 3, 'each is blocked, none throws');
  });
});

// ── the pre-flight sentence ──────────────────────────────────────────

describe('the pre-flight sentence', () => {
  const say = (o) => summarise({
    total: 0, runnable: 0, blocked: 0, estUsd: null, remainingUsd: null, overBudget: false, affordable: null, ...o,
  });

  it('is a sentence, so the operator does not assemble one from five numbers', () => {
    assert.equal(
      say({ total: 30, runnable: 30, estUsd: 8.4 }),
      '30 videos for about $8.40.'
    );
  });

  it('names the shortfall when some items cannot run', () => {
    assert.equal(
      say({ total: 30, runnable: 26, blocked: 4, estUsd: 7.28 }),
      '26 of 30 videos for about $7.28. 4 cannot run yet.'
    );
  });

  it('says what is over and what would fit', () => {
    assert.equal(
      say({ total: 30, runnable: 30, estUsd: 8.4, remainingUsd: 3, overBudget: true, affordable: 10 }),
      '30 videos for about $8.40. That is more than the $3.00 left this month. About 10 would fit.'
    );
  });

  it('does not price a run it has no figure for', () => {
    assert.equal(say({ total: 30, runnable: 30 }), '30 videos.');
  });

  it('says plainly when nothing can run', () => {
    assert.equal(
      say({ total: 3, blocked: 3 }),
      'None of the 3 items can run: every one is missing content.'
    );
  });

  it('gets the singular right', () => {
    assert.equal(say({ total: 1, runnable: 1 }), '1 video.');
  });

  it('prints a large figure without false precision', () => {
    assert.match(say({ total: 400, runnable: 400, estUsd: 112 }), /\$112\./);
  });
});

// ── binding a batch ──────────────────────────────────────────────────

describe('bindBatch', () => {
  it('binds every runnable item to a valid composition', () => {
    const out = bindBatch({ template: montage(), items: items(4), seed: 'b' });
    assert.equal(out.bound, 4);
    assert.equal(out.failed, 0);
    for (const i of out.items) assert.deepEqual(validate(i.comp), []);
  });

  it('lets one bad item block itself and nothing else', () => {
    // Per-item failure must not fail the batch.
    const out = bindBatch({
      template: montage(),
      items: [
        { content: good(), ref: 'a' },
        { content: { stills: [] }, ref: 'b' },
        { content: good(), ref: 'c' },
      ],
      seed: 'b',
    });
    assert.equal(out.bound, 2);
    assert.equal(out.failed, 1);
    const bad = out.items.find((i) => i.ref === 'b');
    assert.equal(bad.comp, null);
    assert.match(bad.error, /needs 6 photographs/, 'and says why, in the row');
  });

  it('varies the batch, because thirty identical videos read as filler', () => {
    const out = bindBatch({ template: montage(), items: items(4), seed: 'b' });
    const firstItem = (c) => c.tracks.flatMap((tr) => tr.items)
      .sort((a, b) => a.at - b.at)[0];
    const lens = out.items.map((i) => firstItem(i.comp).len);
    assert.equal(new Set(lens).size, lens.length, `lengths repeated: ${lens.join(', ')}`);
  });

  it('is reproducible for one seed, so fixing item 7 does not re-cut the rest', () => {
    const fields = (o) => o.items.map((i) => (i.comp
      ? i.comp.tracks.flatMap((tr) => tr.items).map((x) => [x.at, x.len, x.scale])
      : null));
    const a = bindBatch({ template: montage(), items: items(5), seed: 'x' });
    const b = bindBatch({ template: montage(), items: items(5), seed: 'x' });
    assert.deepEqual(fields(a), fields(b));
  });

  it('differs between seeds, so a re-run can be a different cut', () => {
    const first = (o) => o.items[0].comp.tracks.flatMap((tr) => tr.items)[0].len;
    assert.notEqual(
      first(bindBatch({ template: montage(), items: items(2), seed: 'x' })),
      first(bindBatch({ template: montage(), items: items(2), seed: 'y' }))
    );
  });

  it('binds every shipped template in a batch of three', () => {
    // The guard that matters when a template changes: a shape that validates
    // but cannot be bound thirty times is no use.
    const files = fs.readdirSync(TEMPLATES).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 8);
    for (const f of files) {
      const t = JSON.parse(fs.readFileSync(path.join(TEMPLATES, f), 'utf8'));
      const content = {};
      for (const s of t.slots) {
        const n = s.min ?? 1;
        if (!n) continue;
        const made = Array.from({ length: n }, (_, i) => (
          s.kind === 'text' ? `Line ${i + 1}`
            : s.kind === 'audio' ? audio
              : s.kind === 'design' ? { kind: 'design', project: `${s.id}${i}` }
                : still(`${s.id}${i}`)
        ));
        content[s.id] = (s.max === 1) ? made[0] : made;
      }
      const out = bindBatch({ template: t, items: items(3, content), seed: 'ship' });
      assert.equal(out.failed, 0, `${f}: ${out.items.map((i) => i.error).filter(Boolean).join('; ')}`);
      for (const i of out.items) assert.deepEqual(validate(i.comp), [], f);
    }
  });
});

// ── a photograph is not footage ───────────────────────────────────────

describe('a still source', () => {
  const { audioAt } = require('../../shared/compositionPlayback.mjs');
  const { renderGraph } = require('../../shared/compositionRender.mjs');

  const comp = (still) => ({
    version: 1,
    size: { width: 1080, height: 1920 },
    fps: 30,
    sources: {
      p: {
        kind: 'clip', url: '/tmp/p.jpg', duration: 10, width: 1080, height: 1920, fps: 30, still,
      },
    },
    tracks: [{ id: 't0', kind: 'video', items: [{ id: 'i1', at: 0, len: 3, source: 'p', in: 0 }] }],
  });

  it('is marked by the binder, so the renderer never has to guess', () => {
    const out = bindBatch({ template: montage(), items: items(1), seed: 'b' });
    const clips = Object.values(out.items[0].comp.sources).filter((s) => s.kind === 'clip');
    assert.equal(clips.length, 6);
    for (const c of clips) assert.equal(c.still, true, 'a `still` slot produces a still source');
  });

  it('produces no audio in the RENDER, because it has no audio stream', () => {
    // Emitting `[n:a]` for a photograph makes ffmpeg refuse the whole
    // filter_complex with "matches no streams", so one still meant no video.
    assert.equal(renderGraph(comp(true)).audioOut, null);
    assert.ok(renderGraph(comp(false)).audioOut, 'footage still contributes audio');
  });

  it('produces no audio in the PREVIEW either, so the two agree', () => {
    // Preview and render agreeing is the guarantee the composition model is
    // built on. A preview that plays audio the output does not have breaks it
    // in the direction nobody checks, because the preview sounds fine.
    assert.deepEqual(audioAt(comp(true), 1), []);
    assert.equal(audioAt(comp(false), 1).length, 1);
  });

  it('is refused if it is not a boolean, rather than being read as truthy', () => {
    const bad = comp(true);
    bad.sources.p.still = 'yes';
    assert.match(validate(bad).join(' '), /still must be true or false/);
  });

  it('defaults to footage, so every composition written before this is unchanged', () => {
    const old = comp(true);
    delete old.sources.p.still;
    assert.deepEqual(validate(old), []);
    assert.ok(renderGraph(old).audioOut, 'an unmarked clip is footage, as it always was');
  });
});
