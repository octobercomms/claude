/**
 * Magnetic snap engine for the composition timeline.
 *
 * Pure functions — no side effects, no DOM. Works in both Node.js and
 * browser. Given a proposed timeline position and a composition, returns
 * the nearest snap target if one is within the configurable threshold.
 *
 * Usage from the timeline drag handler:
 *
 *   import { findSnap } from '@shared/snap.mjs';
 *
 *   const result = findSnap(
 *     { trackId, itemId, edge: 'start', time: proposedTime },
 *     composition,
 *     { threshold: 0.1, playhead: currentPlayhead }
 *   );
 *   // result.snapped === true  => use result.time
 *   // result.snapped === false => use proposal.time (no nearby target)
 */

const DEFAULT_THRESHOLD = 0.1; // seconds

/**
 * Collect every snap-worthy point from the composition.
 *
 * @param {object} composition - A composition object (see composition.mjs).
 * @param {object} [options]
 * @param {string} [options.excludeItemId] - Item id to exclude (the dragged item).
 * @param {Set}    [options.ignoreItems]   - Additional item ids to skip.
 * @param {number} [options.playhead]      - Current playhead position in seconds.
 * @returns {{ time: number, label: string }[]} Sorted by time, deduplicated.
 */
export function collectSnapPoints(composition, options = {}) {
  const excludeId = options.excludeItemId || null;
  const ignoreItems = options.ignoreItems || null;
  const points = [];

  // 1. Timeline start (zero)
  points.push({ time: 0, label: 'start' });

  // 2. Playhead
  if (options.playhead != null && Number.isFinite(options.playhead)) {
    points.push({ time: options.playhead, label: 'playhead' });
  }

  // 3. Composition markers (if present)
  if (Array.isArray(composition.markers)) {
    for (const m of composition.markers) {
      if (m != null && Number.isFinite(m.time)) {
        points.push({ time: m.time, label: m.label || 'marker' });
      }
    }
  }

  // 4. Every item's start and end edges (except the excluded/ignored items)
  if (Array.isArray(composition.tracks)) {
    for (const track of composition.tracks) {
      if (!Array.isArray(track.items)) continue;
      for (const item of track.items) {
        if (item.id === excludeId) continue;
        if (ignoreItems && ignoreItems.has(item.id)) continue;
        const start = item.at;
        const end = item.at + item.len;
        points.push({ time: start, label: `item-start` });
        points.push({ time: end,   label: `item-end` });
      }
    }
  }

  // Deduplicate by time (keep the first label encountered) and sort
  const seen = new Map();
  for (const p of points) {
    // Round to microsecond to avoid IEEE duplicates
    const key = Math.round(p.time * 1e6);
    if (!seen.has(key)) {
      seen.set(key, p);
    }
  }

  const unique = Array.from(seen.values());
  unique.sort((a, b) => a.time - b.time);
  return unique;
}

/**
 * Find the nearest snap target for a proposed timeline position.
 *
 * @param {object} proposal
 * @param {string} proposal.trackId  - Track the item lives on.
 * @param {string} proposal.itemId   - The item being dragged.
 * @param {'start'|'end'|'both'} proposal.edge - Which edge is being positioned.
 * @param {number} proposal.time     - Proposed position in seconds.
 * @param {object} composition       - The current composition.
 * @param {object} [options]
 * @param {number} [options.threshold] - Max distance in seconds (default 0.1).
 * @param {number} [options.playhead]  - Current playhead position.
 * @param {Set}    [options.ignoreItems] - Additional item ids to skip.
 * @returns {{ snapped: boolean, time: number, snapTo?: string }}
 */
export function findSnap(proposal, composition, options = {}) {
  const threshold = options.threshold != null ? options.threshold : DEFAULT_THRESHOLD;
  const time = proposal.time;

  if (!composition || !Number.isFinite(time)) {
    return { snapped: false, time: time || 0 };
  }

  const points = collectSnapPoints(composition, {
    excludeItemId: proposal.itemId,
    ignoreItems: options.ignoreItems,
    playhead: options.playhead,
  });

  // Find the closest point within threshold. A linear scan is fine — the
  // points array is sorted, so we could binary-search, but even with
  // hundreds of items the array is at most ~2*N entries and the constant
  // factor of a linear scan over a small typed comparison is negligible
  // at these sizes. If profiling ever shows this matters, swap to bisect.

  let bestDist = Infinity;
  let bestPoint = null;

  for (let i = 0; i < points.length; i++) {
    const dist = Math.abs(points[i].time - time);
    if (dist < bestDist) {
      bestDist = dist;
      bestPoint = points[i];
    }
    // Once we've passed the proposal time and the distance is growing,
    // no point searching further (array is sorted).
    if (points[i].time > time && dist > bestDist) break;
  }

  if (bestPoint && bestDist <= threshold) {
    return { snapped: true, time: bestPoint.time, snapTo: bestPoint.label };
  }

  return { snapped: false, time };
}
