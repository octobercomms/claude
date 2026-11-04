/**
 * Source-to-timeline and timeline-to-source mapping.
 *
 * This is the part most likely to kill the project (editor-composition-model.md
 * §The mapping). A transcript taken from a source clip has timings in that
 * clip's timebase. With absolute `at` and `in`, the mapping is a lookup rather
 * than a sum.
 *
 * Three cases are decided, not discovered:
 *   1. A word in a region that was cut out maps to nothing.
 *   2. A word inside an overlap maps to the uppermost item's timeline time.
 *   3. A word straddling a cut belongs to the item its midpoint falls in.
 *
 * This module lives in shared/, and the browser compositor and the renderer
 * both call it. Two implementations would drift.
 */

import { secs, EPS, itemEnd, topmostAt } from './composition.mjs';

/**
 * Map a source-time to zero or more timeline positions.
 *
 * Given a source id and a time `t` within that source, returns every
 * timeline position where that source-time appears. Each result carries the
 * item and the mapped timeline time.
 *
 * When the same source-time falls in an overlap region, the caller gets
 * multiple results. Use `sourceToTimelineOne()` for the decided "uppermost
 * wins" rule.
 */
export function sourceToTimeline(comp, sourceId, t) {
  const results = [];
  for (const track of comp.tracks) {
    for (const item of track.items) {
      if (item.source !== sourceId) continue;
      const inPt = item.in || 0;
      if (t >= inPt - EPS && t < inPt + item.len + EPS) {
        results.push({
          item,
          track,
          timelineTime: secs(item.at + (t - inPt)),
        });
      }
    }
  }
  return results;
}

/**
 * Map a source-time to one timeline position, applying the overlap rule.
 *
 * When a source-time appears in multiple items (because the same clip is
 * used more than once), returns the mapping through the uppermost item at
 * the mapped time.
 *
 * Returns null when the source-time is in a cut-out region (no item covers it).
 */
export function sourceToTimelineOne(comp, sourceId, t) {
  const all = sourceToTimeline(comp, sourceId, t);
  if (all.length === 0) return null;
  if (all.length === 1) return all[0].timelineTime;

  // Multiple mappings: pick the one through the topmost item
  for (const r of all) {
    const top = topmostAt(comp, r.timelineTime);
    if (top && top.item.id === r.item.id) return r.timelineTime;
  }
  // Fallback: last mapping (highest track) if topmost didn't match
  return all[all.length - 1].timelineTime;
}

/**
 * Map a timeline time back to a source position.
 *
 * Given a timeline time `t`, returns the source id and source-time for the
 * topmost video item at that point. Returns null at gaps.
 */
export function timelineToSource(comp, t) {
  const top = topmostAt(comp, t);
  if (!top) return null;
  const { item } = top;
  const inPt = item.in || 0;
  return {
    sourceId: item.source,
    sourceTime: secs(inPt + (t - item.at)),
    item,
    track: top.track,
  };
}

/**
 * Map a word span (from/to in source-time) to a timeline span, applying
 * the three decided rules:
 *
 *   1. Cut out: if neither the midpoint nor any edge falls in an item, null.
 *   2. Overlap: belongs to whichever item is topmost at the mapped midpoint.
 *   3. Straddling a cut: belongs to the item its midpoint falls in.
 *
 * Returns { from, to } in timeline-time, or null.
 */
export function mapWordSpan(comp, sourceId, wordFrom, wordTo) {
  const mid = (wordFrom + wordTo) / 2;
  const midMappings = sourceToTimeline(comp, sourceId, mid);

  // Rule 1: cut out
  if (midMappings.length === 0) return null;

  // Rule 3 (straddling) is handled by using the midpoint: if the word
  // straddles a cut, the midpoint determines which item it belongs to.

  let chosen = midMappings[0];

  if (midMappings.length > 1) {
    // Rule 2: overlap. Pick the topmost item at the mapped midpoint.
    for (const r of midMappings) {
      const top = topmostAt(comp, r.timelineTime);
      if (top && top.item.id === r.item.id) {
        chosen = r;
        break;
      }
    }
  }

  const inPt = chosen.item.in || 0;
  const from = secs(chosen.item.at + (wordFrom - inPt));
  const to = secs(chosen.item.at + (wordTo - inPt));

  // Clamp to the item's range on the timeline
  const clampFrom = Math.max(from, chosen.item.at);
  const clampTo = Math.min(to, itemEnd(chosen.item));

  if (clampTo <= clampFrom + EPS) return null;

  return { from: clampFrom, to: clampTo };
}

/**
 * Map an entire transcript (array of { word, from, to }) against a
 * composition. Returns a new array with timeline-mapped `from`/`to`, or
 * the word omitted when it falls in a cut-out region.
 */
export function mapTranscript(comp, sourceId, words) {
  const result = [];
  for (const w of words) {
    const span = mapWordSpan(comp, sourceId, w.from, w.to);
    if (span) {
      result.push({ ...w, from: span.from, to: span.to });
    }
  }
  return result;
}
