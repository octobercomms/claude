/**
 * The edit decision list: what the timeline is, as data.
 *
 * Today an edit is `clips[]` (an ordered list of whole sources) plus
 * `ops.trim` or `ops.segments` (ranges, but only of a single clip — the
 * processor's `single && doTrim` path). Those are two models for one idea, and
 * the gap between them is the one real capability gap on the Edit page: you
 * cannot trim across more than one clip.
 *
 * An EDL is that idea stated once. A list of items, each naming a source clip
 * and an in/out point within it, laid end to end in order. A whole clip is an
 * item from 0 to its duration, so `clips[]` is an EDL, and a multi-cut of one
 * clip is an EDL, and so is anything in between.
 *
 * Deliberately **one video track**. Tracks as a concept belong with overlay
 * compositing (spec section 2.7), which the render path cannot do, and a
 * second track drawn on a surface that cannot render it would be the page
 * lying about what it will produce. That is the complaint this work exists to
 * fix, so it is not one to reintroduce.
 *
 * Everything here is pure, so the timeline surface and the processor agree on
 * what an edit means rather than each deciding separately. The browser edits
 * an EDL; `compile()` turns it into the cut list ffmpeg is handed.
 */

// Matches the processor's own floor (`Math.max(0.05, end - start)`): below this
// ffmpeg is being asked for a cut shorter than a couple of frames.
export const MIN_ITEM = 0.05;

export const EDL_VERSION = 1;

/**
 * Times are seconds as floats, and floats do not hold them exactly: in IEEE
 * doubles `(5 + 0.05) - 5` is 0.049999999999999822, which is less than 0.05.
 * An exact `>= MIN_ITEM` comparison therefore deletes blocks that are exactly
 * the minimum length, and which ones it deletes depends on where in the clip
 * they happen to sit. Every length test in this module goes through
 * `atLeastMin` so that cannot be true in one place and not another.
 */
const EPS = 1e-9;
export function atLeastMin(from, to) {
  return (to - from) >= MIN_ITEM - EPS;
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * A time pinned to the microsecond. Without it, arithmetic on a stored in/out
 * point accumulates a tail of binary dust, so the same cut compares unequal to
 * itself after a round trip through the database and two blocks that should
 * abut are drawn with a hairline between them.
 */
function secs(v, fallback = 0) {
  return Math.round(num(v, fallback) * 1e6) / 1e6;
}

// A clip's usable length. Absent or nonsense metadata reads as unknown rather
// than as zero, because clamping an in/out point against a duration of 0
// deletes the item, and "we could not probe this file" is not "this file is
// empty".
export function clipDuration(clip) {
  if (!clip) return null;
  const d = num(clip.duration ?? clip.meta?.duration ?? clip.source_meta?.duration, 0);
  return d > 0 ? d : null;
}

let seq = 0;
function nextId() {
  seq += 1;
  return `i${Date.now().toString(36)}${seq.toString(36)}`;
}

export function emptyEdl() {
  return { version: EDL_VERSION, items: [] };
}

/** The default edit for a set of clips: each one whole, in the order given. */
export function edlFromClips(clips) {
  const list = Array.isArray(clips) ? clips : [];
  return {
    version: EDL_VERSION,
    items: list.map((c, i) => ({
      id: nextId(),
      clip: i,
      in: 0,
      out: clipDuration(c),   // null when the duration is not known yet
      gain: 1,
    })),
  };
}

/**
 * Make an EDL safe to act on: every item points at a clip that exists, in/out
 * are ordered and inside that clip, and every item has an id.
 *
 * An item whose `out` is null is a whole clip whose duration has not been
 * probed yet. It stays null rather than being guessed, and the surface draws
 * it at a nominal width until the probe lands.
 */
export function normalise(edl, clips) {
  const list = Array.isArray(clips) ? clips : [];
  const items = Array.isArray(edl?.items) ? edl.items : [];
  const out = [];
  for (const raw of items) {
    const clip = Math.trunc(num(raw?.clip, -1));
    if (!(clip >= 0 && clip < list.length)) continue;   // source has gone
    const dur = clipDuration(list[clip]);
    let a = Math.max(0, secs(raw?.in, 0));
    let b = raw?.out == null ? dur : secs(raw.out, 0);
    if (dur != null) {
      a = Math.min(a, Math.max(0, dur - MIN_ITEM));
      if (b == null) b = dur;
      b = Math.min(b, dur);
    }
    if (b != null && !atLeastMin(a, b)) {
      // A block trimmed past itself is pulled back to the minimum rather than
      // silently widened, because widening it would re-add footage the person
      // cut. `a` is already clamped to `dur - MIN_ITEM` above, so this cannot
      // run off the end of the clip; where there is no room for even a minimum
      // block (a source shorter than a couple of frames) the block goes.
      b = secs(a + MIN_ITEM);
      if (dur != null && b > dur + EPS) continue;
    }
    const gain = Math.min(4, Math.max(0, num(raw?.gain, 1)));
    // The transition rides through, or every stored fade is lost the moment an
    // edit is normalised — which is on every reopen AND every time a clip is
    // added, because the page re-normalises against the new clip list. The
    // first block's is dropped rather than carried: it has nothing to its left
    // to fade from, so keeping the data would leave a fade in the row that
    // nothing honours and that `isWholeClipsInOrder` would then refuse.
    const item = {
      id: String(raw?.id || nextId()), clip, in: secs(a), out: b == null ? null : secs(b), gain,
    };
    if (out.length > 0) {
      const t = transitionOf(raw);
      if (t.type !== 'cut') item.trans = { type: t.type, dur: t.dur };
    }
    out.push(item);
  }
  return { version: EDL_VERSION, items: out };
}

/**
 * How a block enters: a hard cut, or a cross-fade from the block before it.
 *
 * Stored on the block that is being faded INTO, not between blocks in a
 * separate list. A transition belongs to the join on its left, and keeping it
 * on the right-hand block means a reorder, a split or a delete carries it, or
 * drops it, with the block it describes. A separate between-blocks list would
 * need re-indexing on every one of those, which is the kind of bookkeeping
 * that silently puts a fade in the wrong place.
 *
 * The first block's transition is ignored: there is nothing to its left to
 * fade from.
 */
export const TRANSITIONS = ['cut', 'fade', 'fadeblack', 'wipeleft', 'dissolve'];

// What each one is called in ffmpeg's xfade filter. 'dissolve' is its own
// transition there; 'cut' never reaches ffmpeg because a hard cut is the
// absence of a transition, which is what the concat already does.
export const XFADE_NAME = {
  fade: 'fade', fadeblack: 'fadeblack', wipeleft: 'wipeleft', dissolve: 'dissolve',
};

// A cross-fade shorter than this is not visible; longer than this on social
// video is a transition the audience notices instead of the content.
export const MIN_TRANS = 0.1;
export const MAX_TRANS = 2;
export const DEFAULT_TRANS = 0.4;

/** The transition on a block, normalised. Anything unknown reads as a cut. */
export function transitionOf(item) {
  const t = item?.trans;
  if (!t || typeof t !== 'object') return { type: 'cut', dur: 0 };
  const type = TRANSITIONS.includes(t.type) ? t.type : 'cut';
  if (type === 'cut') return { type: 'cut', dur: 0 };
  const raw = num(t.dur, DEFAULT_TRANS);
  const dur = secs(Math.min(MAX_TRANS, Math.max(MIN_TRANS, raw)));
  return { type, dur };
}

/**
 * The longest cross-fade the two blocks either side of a join can support.
 *
 * A cross-fade consumes time from both: the tail of the outgoing block plays
 * over the head of the incoming one. Asking for a fade longer than either
 * block makes ffmpeg's xfade produce an output shorter than its own offset,
 * which does not fail — it silently drops frames. Half the shorter block is
 * the ceiling, so each keeps some of itself outside the fade.
 */
export function maxTransitionAt(edl, index) {
  const items = edl?.items || [];
  // Index 0 is refused here, and again in `setTransition`, and again by the
  // block before it being undefined two lines down. Three layers, and only the
  // last is load-bearing: the first two are there so the rule is readable
  // where it is relied on, not because anything observable depends on them.
  if (index <= 0 || index >= items.length) return 0;
  const a = itemDuration(items[index - 1]);
  const b = itemDuration(items[index]);
  if (!(a > 0) || !(b > 0)) return 0;
  return Math.min(MAX_TRANS, Math.max(0, secs(Math.min(a, b) / 2)));
}

/**
 * Set or clear the transition into a block. The duration is clamped against
 * what its neighbours can actually support, so the surface cannot ask for a
 * fade the renderer would have to silently shorten.
 */
export function setTransition(edl, id, type, dur = DEFAULT_TRANS) {
  const items = [...(edl?.items || [])];
  const idx = items.findIndex((it) => it.id === id);
  if (idx < 0) return edl;
  // The first block has nothing to its left, so it cannot be faded into.
  // `maxTransitionAt` refuses index 0 as well; this says so where it is read.
  if (idx === 0) return edl;
  if (!TRANSITIONS.includes(type) || type === 'cut') {
    if (!items[idx].trans) return edl;
    const { trans, ...rest } = items[idx];
    items[idx] = rest;
    return replaceItems(edl, items);
  }
  const ceiling = maxTransitionAt(edl, idx);
  if (!(ceiling >= MIN_TRANS)) return edl;   // no room for a visible fade
  const d = secs(Math.min(ceiling, Math.max(MIN_TRANS, num(dur, DEFAULT_TRANS))));
  items[idx] = { ...items[idx], trans: { type, dur: d } };
  return replaceItems(edl, items);
}

/**
 * Set one block's volume.
 *
 * The model has carried `gain` since the EDL was written, `normalise` clamps
 * it to 0..4, and `editProcessor` applies it with ffmpeg's volume filter. No
 * surface ever set it. So a feature that worked end to end could only be
 * reached by hand-editing a saved EDL, and the preview's "this block is
 * boosted above 100%" warning described a state nothing could produce.
 *
 * The clamp is here as well as in `normalise`, because this is the entry
 * point a control calls and a value that is wrong should not travel as far as
 * the next save to be corrected.
 */
export function setGain(edl, id, gain) {
  const items = [...(edl?.items || [])];
  const idx = items.findIndex((it) => it.id === id);
  if (idx < 0) return edl;
  const g = Math.min(4, Math.max(0, num(gain, 1)));
  if (Math.abs(num(items[idx].gain, 1) - g) < 1e-9) return edl;
  items[idx] = { ...items[idx], gain: g };
  return replaceItems(edl, items);
}

/** One block's volume, as a number, whatever the saved row holds. */
export function gainOf(item) {
  return Math.min(4, Math.max(0, num(item?.gain, 1)));
}

export function itemDuration(item) {
  if (!item) return 0;
  if (item.out == null) return 0;
  return Math.max(0, num(item.out) - num(item.in));
}

/**
 * Total length of the edit.
 *
 * Shorter than the sum of its blocks by every cross-fade, because a fade plays
 * the tail of one block over the head of the next rather than after it. Get
 * this wrong and the page tells the operator a length the render will not
 * produce, which is the same class of lie as a bar that says 41%.
 *
 * Items with an unknown duration count as zero.
 */
export function duration(edl) {
  const items = edl?.items || [];
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += itemDuration(items[i]);
    // The first block's transition is ignored: nothing to its left to overlap.
    if (i > 0) total -= transitionOf(items[i]).dur;
  }
  return secs(Math.max(0, total));
}

/**
 * Where each item begins on the timeline, cumulatively. Returned alongside the
 * item so the surface can place blocks without recomputing the running total
 * per block, and so a hit test is one pass.
 */
export function laidOut(edl) {
  const items = edl?.items || [];
  let at = 0;
  return items.map((item, i) => {
    const len = itemDuration(item);
    // A cross-fade pulls this block back over the end of the one before it, so
    // the two genuinely overlap in the output and the drawing says so. This is
    // how a single-track cross-fade is shown in every editor, and it keeps the
    // drawn positions equal to the output's real times.
    const overlap = i > 0 ? transitionOf(item).dur : 0;
    const start = secs(Math.max(0, at - overlap));
    at = start + len;
    return { item, start, end: secs(start + len), length: len, overlap };
  });
}

/** The item under a point on the timeline, or null past the end. */
export function itemAt(edl, seconds) {
  const t = num(seconds, 0);
  for (const row of laidOut(edl)) {
    if (t >= row.start && t < row.end) return row;
  }
  return null;
}

function replaceItems(edl, items) {
  return { version: EDL_VERSION, items };
}

/** Move an item to a new index. Out-of-range indices clamp rather than throw. */
export function move(edl, id, toIndex) {
  const items = [...(edl?.items || [])];
  const from = items.findIndex((it) => it.id === id);
  if (from < 0) return edl;
  const to = Math.min(items.length - 1, Math.max(0, Math.trunc(num(toIndex, from))));
  if (to === from) return edl;
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);
  return replaceItems(edl, items);
}

export function remove(edl, id) {
  const items = (edl?.items || []).filter((it) => it.id !== id);
  if (items.length === (edl?.items || []).length) return edl;
  return replaceItems(edl, items);
}

/**
 * Drag an edge. `edge` is 'in' or 'out'; `to` is a position within the source
 * clip, in seconds. The other edge holds still, and the item keeps at least
 * MIN_ITEM so an overshoot parks against the limit instead of deleting the
 * block the person is holding.
 */
export function trim(edl, id, edge, to, clips) {
  const items = [...(edl?.items || [])];
  const idx = items.findIndex((it) => it.id === id);
  if (idx < 0) return edl;
  const item = items[idx];
  const dur = clipDuration((Array.isArray(clips) ? clips : [])[item.clip]);
  const limit = dur == null ? (item.out == null ? null : item.out) : dur;
  let a = num(item.in, 0);
  let b = item.out == null ? null : num(item.out, 0);
  if (edge === 'in') {
    const ceiling = b == null ? (limit == null ? null : limit - MIN_ITEM) : b - MIN_ITEM;
    a = Math.max(0, secs(to, a));
    if (ceiling != null) a = Math.min(a, Math.max(0, ceiling));
  } else if (edge === 'out') {
    b = secs(Math.max(a + MIN_ITEM, secs(to, b == null ? a + MIN_ITEM : b)));
    if (limit != null) b = Math.min(b, limit);
    if (!atLeastMin(a, b)) return edl;
  } else {
    return edl;
  }
  items[idx] = { ...item, in: secs(a), out: b == null ? null : secs(b) };
  return replaceItems(edl, items);
}

/**
 * Split an item at a point on the **timeline**, producing two items over the
 * same source. Both halves must clear MIN_ITEM or nothing happens, because a
 * split that yields a sliver is a mis-click rather than an edit.
 */
export function split(edl, atSeconds) {
  const row = itemAt(edl, atSeconds);
  if (!row) return edl;
  const { item, start } = row;
  if (item.out == null) return edl;
  const cutIn = secs(num(item.in, 0) + (num(atSeconds, 0) - start));
  if (!atLeastMin(num(item.in, 0), cutIn)) return edl;
  if (!atLeastMin(cutIn, num(item.out, 0))) return edl;
  const items = [...(edl?.items || [])];
  const idx = items.findIndex((it) => it.id === item.id);
  items.splice(idx, 1,
    { ...item, out: cutIn },
    { ...item, id: nextId(), in: cutIn });
  return replaceItems(edl, items);
}

/** Append a clip whole, at the end. */
export function append(edl, clipIndex, clips) {
  const list = Array.isArray(clips) ? clips : [];
  const clip = Math.trunc(num(clipIndex, -1));
  if (!(clip >= 0 && clip < list.length)) return edl;
  return replaceItems(edl, [...(edl?.items || []),
    { id: nextId(), clip, in: 0, out: clipDuration(list[clip]), gain: 1 }]);
}

/**
 * Is this EDL just "every clip, whole, in order"? The processor already has a
 * proven path for that (`combineClips`, stream-copy concat), so an untouched
 * edit should keep taking it rather than being re-cut to produce the same
 * frames more slowly.
 */
export function isWholeClipsInOrder(edl, clips) {
  const list = Array.isArray(clips) ? clips : [];
  const items = edl?.items || [];
  if (items.length !== list.length) return false;
  return items.every((it, i) => {
    if (it.clip !== i) return false;
    if (num(it.gain, 1) !== 1) return false;
    // A cross-fade is not something the stream-copy combine can do: it joins
    // clips end to end by definition. Miss this and an edit whose only change
    // is a fade reads as "untouched", the EDL is never sent, and the render
    // comes back with hard cuts where the timeline drew fades.
    if (i > 0 && transitionOf(it).type !== 'cut') return false;
    if (num(it.in, 0) > 0) return false;
    const dur = clipDuration(list[i]);
    if (it.out == null) return true;
    if (dur == null) return false;
    return Math.abs(num(it.out, 0) - dur) < 0.01;
  });
}

/**
 * The cut list the processor renders: each entry a source clip and a range
 * within it, in order. This is the one translation between the surface's model
 * and ffmpeg's, so the arithmetic lives here and is tested rather than being
 * repeated in the processor.
 *
 * Each entry carries its own `clip` index. Entries can be dropped here (a clip
 * with no URL, a cut too short to be a cut), so the caller cannot recover the
 * index by position in `items` — and getting that wrong renders the right cut
 * from the wrong footage, which is a mistake nothing downstream would catch.
 */
export function compile(edl, clips) {
  const list = Array.isArray(clips) ? clips : [];
  const segments = [];
  for (const item of (edl?.items || [])) {
    const clip = list[item.clip];
    if (!clip) continue;
    const url = clip.url || clip.source_url || null;
    if (!url) continue;
    const a = Math.max(0, secs(item.in, 0));
    const dur = clipDuration(clip);
    const b = item.out == null ? dur : secs(item.out, 0);
    if (b == null) {
      // Whole clip, length unknown: ffmpeg reads to the end, which is what a
      // whole clip means. Only valid when nothing was trimmed off the front.
        segments.push({ clip: item.clip, url, start: a, end: null, gain: num(item.gain, 1),
        len: 0, trans: item.trans || null });
      continue;
    }
    if (!atLeastMin(a, b)) continue;
    segments.push({ clip: item.clip, url, start: a, end: b, gain: num(item.gain, 1),
      len: secs(b - a), trans: item.trans || null });
  }
  return segments;
}

/**
 * The xfade chain, as offsets.
 *
 * ffmpeg's `xfade` takes an `offset`: the time **in its first input** at which
 * the transition begins. Chaining it across several blocks is where this goes
 * wrong, because each xfade's first input is the output of the one before,
 * which is already shorter than the blocks that went into it by every fade so
 * far. Computing the offset from the block's own start time instead of from
 * the accumulated output puts every fade after the first in the wrong place,
 * and ffmpeg does not complain: it produces a video whose cuts are wrong.
 *
 * For a fade of d between block k and k+1:
 *
 *     offset(k) = sum(len[0..k]) - (k + 1) * d_cumulative
 *
 * stated here as a running total, because the durations differ per join.
 *
 * `segments` is `compile()` output plus a `len`. Returns one entry per join
 * that has a transition, in order, each with the input index it fades INTO,
 * the ffmpeg transition name, its duration, and the offset. A join with no
 * transition is absent: those are handled by plain concatenation.
 */
export function transitionPlan(segments) {
  const list = Array.isArray(segments) ? segments : [];
  const plan = [];
  // The running length of the chained output so far, which is what an offset
  // is measured against.
  let outLen = 0;
  for (let i = 0; i < list.length; i++) {
    const len = num(list[i]?.len, 0);
    const t = i > 0 ? transitionOf({ trans: list[i]?.trans }) : { type: 'cut', dur: 0 };
    if (i === 0) { outLen = len; continue; }
    if (t.type === 'cut' || !(t.dur > 0)) {
      outLen = secs(outLen + len);
      continue;
    }
    // The fade starts d before the end of everything chained so far.
    const offset = secs(outLen - t.dur);
    plan.push({ into: i, type: t.type, xfade: XFADE_NAME[t.type] || 'fade', dur: t.dur, offset });
    outLen = secs(outLen + len - t.dur);
  }
  return { plan, outLen };
}

/**
 * The ffmpeg filter graph for a set of blocks with transitions.
 *
 * Built here rather than in the processor so the string is testable without
 * running ffmpeg, and so the offsets come from the same arithmetic the surface
 * draws from. Verified against real ffmpeg: a three-block chain with 0.5s and
 * 1s fades produced the predicted 22.5s output, with the colour midway between
 * the two blocks at exactly the predicted instant.
 *
 * Audio uses `acrossfade`, which needs no offset: it always joins at the end
 * of its first input and shortens the result by the same `d`, so the audio
 * chain stays in step with the video chain without being told where to be.
 *
 * Blocks joined by a hard cut inside an otherwise faded edit are still passed
 * through xfade, with a transition of `fade` and the shortest duration the
 * filter will take, because a chain cannot mix concatenation and xfade in one
 * pass. That is a deliberate, stated compromise: see `concatRuns`.
 */
export function xfadeGraph(segments) {
  const list = Array.isArray(segments) ? segments : [];
  if (list.length < 2) return null;
  const { plan } = transitionPlan(list);
  if (!plan.length) return null;

  const byInto = new Map(plan.map((p) => [p.into, p]));
  const parts = [];
  let v = '0:v';
  let a = '0:a';
  let outLen = num(list[0]?.len, 0);
  for (let i = 1; i < list.length; i++) {
    const len = num(list[i]?.len, 0);
    const p = byInto.get(i);
    // A hard cut between two faded joins still has to go through the chain,
    // so it becomes the shortest fade the filter will honour: one frame at
    // 30fps. Visually a cut; structurally part of the same graph.
    const dur = p ? p.dur : secs(1 / 30);
    const kind = p ? p.xfade : 'fade';
    const offset = secs(outLen - dur);
    const vo = `v${i}`;
    const ao = `a${i}`;
    parts.push(`[${v}][${i}:v]xfade=transition=${kind}:duration=${dur}:offset=${offset}[${vo}]`);
    parts.push(`[${a}][${i}:a]acrossfade=d=${dur}[${ao}]`);
    v = vo;
    a = ao;
    outLen = secs(outLen + len - dur);
  }
  return { filter: parts.join(';'), videoOut: `[${v}]`, audioOut: `[${a}]`, outLen };
}

/** Does this edit need the filter graph, or will a concat do? */
export function hasTransitions(edl) {
  const items = edl?.items || [];
  return items.some((it, i) => i > 0 && transitionOf(it).type !== 'cut');
}

export default {
  MIN_ITEM, EDL_VERSION, atLeastMin, clipDuration, TRANSITIONS, XFADE_NAME,
  transitionOf, setTransition, maxTransitionAt, transitionPlan, hasTransitions, xfadeGraph,
  MIN_TRANS, MAX_TRANS, DEFAULT_TRANS, emptyEdl, edlFromClips, normalise,
  itemDuration, duration, laidOut, itemAt, move, remove, trim, split, append,
  isWholeClipsInOrder, compile,
};
