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
    out.push({ id: String(raw?.id || nextId()), clip, in: secs(a), out: b == null ? null : secs(b), gain });
  }
  return { version: EDL_VERSION, items: out };
}

export function itemDuration(item) {
  if (!item) return 0;
  if (item.out == null) return 0;
  return Math.max(0, num(item.out) - num(item.in));
}

/** Total length of the edit. Items with an unknown duration count as zero. */
export function duration(edl) {
  return (edl?.items || []).reduce((t, it) => t + itemDuration(it), 0);
}

/**
 * Where each item begins on the timeline, cumulatively. Returned alongside the
 * item so the surface can place blocks without recomputing the running total
 * per block, and so a hit test is one pass.
 */
export function laidOut(edl) {
  let at = 0;
  return (edl?.items || []).map((item) => {
    const start = at;
    const len = itemDuration(item);
    at += len;
    return { item, start, end: start + len, length: len };
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
      segments.push({ clip: item.clip, url, start: a, end: null, gain: num(item.gain, 1) });
      continue;
    }
    if (!atLeastMin(a, b)) continue;
    segments.push({ clip: item.clip, url, start: a, end: b, gain: num(item.gain, 1) });
  }
  return segments;
}

export default {
  MIN_ITEM, EDL_VERSION, atLeastMin, clipDuration, emptyEdl, edlFromClips, normalise,
  itemDuration, duration, laidOut, itemAt, move, remove, trim, split, append,
  isWholeClipsInOrder, compile,
};
