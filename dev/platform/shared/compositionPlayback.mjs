/**
 * Composition playback model: what is on screen at time t.
 *
 * The compositor and the renderer both need to agree on which items are
 * visible, their source times, their layering, and their transition blend
 * at every point in the timeline. This module is the single source of that
 * truth.
 *
 * The renderer (compositionRender.mjs) produces an ffmpeg filter_complex
 * that encodes the same decisions as filter parameters. The browser
 * compositor calls this module per frame and draws accordingly. Agreement
 * tests assert both sides match on fixture compositions.
 *
 * Pure. No I/O, no DOM, no side effects.
 */

import {
  secs, EPS, itemEnd, overlaps as findOverlaps, topmostAt, duration,
  itemTransformAt,
} from './composition.mjs';

/**
 * The scene at a timeline time: every active layer, bottom to top.
 *
 * Each layer has the item, its track, the source time to show, and an
 * opacity value that accounts for transitions and the item's own opacity.
 *
 * Transitions: when two items overlap on the same track, the earlier
 * one fades out and the later one fades in. The blend is linear across
 * the overlap duration, matching ffmpeg's xfade default curve.
 */
export function sceneAt(comp, t) {
  const layers = [];

  for (let ti = 0; ti < comp.tracks.length; ti++) {
    const track = comp.tracks[ti];
    if (track.kind !== 'video') continue;

    const sorted = [...track.items].sort((a, b) => a.at - b.at);
    const trackOvs = findOverlaps({ ...track, items: sorted });

    for (const item of sorted) {
      const end = itemEnd(item);
      if (t < item.at - EPS || t >= end + EPS) continue;

      const inPt = item.in || 0;
      const sourceTime = secs(inPt + (t - item.at));
      let opacity = item.opacity != null ? item.opacity : 1;

      // Check if this item is in a transition overlap
      for (const ov of trackOvs) {
        const [a, b] = ov.items;
        if (item.id !== a.id && item.id !== b.id) continue;

        if (t >= ov.from - EPS && t < ov.to + EPS) {
          const progress = ov.duration > EPS
            ? Math.max(0, Math.min(1, (t - ov.from) / ov.duration))
            : 0;

          const transType = b.trans?.type || 'fade';

          if (item.id === a.id) {
            // Outgoing item
            opacity *= transitionOutOpacity(transType, progress);
          } else {
            // Incoming item
            opacity *= transitionInOpacity(transType, progress);
          }
        }
      }

      layers.push({
        item,
        track,
        trackIndex: ti,
        sourceTime: Math.max(0, sourceTime),
        opacity,
        sourceId: item.source,
        // Where and how big to draw it, from the SAME function the render
        // graph derives its filter expressions from. Two implementations of
        // one description drift, which is the whole reason this module and
        // compositionRender.mjs both read the model rather than each other.
        //
        // scale is a multiplier of the frame, pos is a fraction of it, both
        // already interpolated for this moment. The compositor multiplies
        // out to pixels; the renderer puts the same arithmetic in an ffmpeg
        // expression. Agreement is asserted at this level and not on pixels,
        // because overlay x/y are integer pixels and scale dimensions are
        // integer and even, while canvas drawImage is sub-pixel.
        transform: itemTransformAt(item, t),
      });
    }
  }

  return { layers, t };
}

/**
 * Active audio at a timeline time.
 *
 * Returns every audio-producing item whose range covers t, with the
 * source time and effective gain.
 */
export function audioAt(comp, t) {
  const result = [];

  for (const track of comp.tracks) {
    for (const item of track.items) {
      const src = comp.sources[item.source];
      if (!src) continue;
      const hasAudio = src.kind === 'clip' || src.kind === 'audio';
      if (!hasAudio) continue;

      const end = itemEnd(item);
      if (t < item.at - EPS || t >= end + EPS) continue;

      const inPt = item.in || 0;
      const sourceTime = secs(inPt + (t - item.at));
      const gain = item.gain != null ? item.gain : 1;

      result.push({
        item,
        track,
        sourceId: item.source,
        sourceTime: Math.max(0, sourceTime),
        gain,
      });
    }
  }

  return result;
}

/**
 * Transition opacity curves.
 *
 * These match ffmpeg's xfade behaviour:
 * - fade/dissolve: linear crossfade (out = 1-progress, in = progress)
 * - fadeblack: out fades to black first half, in fades from black second half
 * - wipeleft: hard edge moving left (out = step at progress, in = step at progress)
 */
function transitionOutOpacity(type, progress) {
  switch (type) {
    case 'fadeblack':
      return progress < 0.5 ? 1 - 2 * progress : 0;
    case 'wipeleft':
      return 1;  // full opacity, the wipe is spatial not opacity-based
    case 'fade':
    case 'dissolve':
    default:
      return 1 - progress;
  }
}

function transitionInOpacity(type, progress) {
  switch (type) {
    case 'fadeblack':
      return progress < 0.5 ? 0 : 2 * (progress - 0.5);
    case 'wipeleft':
      return 1;  // full opacity, the wipe is spatial not opacity-based
    case 'fade':
    case 'dissolve':
    default:
      return progress;
  }
}

export { transitionOutOpacity, transitionInOpacity };

/**
 * The primary video cue at a timeline time, for seeking a video element.
 *
 * Returns the topmost video item and its source time. When a transition
 * is in progress, also returns the secondary (outgoing) item.
 */
export function cueAt(comp, t) {
  const scene = sceneAt(comp, t);
  if (!scene.layers.length) return null;

  // The topmost layer is the primary
  const primary = scene.layers[scene.layers.length - 1];
  let secondary = null;

  // If there are two layers on the same track (transition), the lower is secondary
  if (scene.layers.length >= 2) {
    const penult = scene.layers[scene.layers.length - 2];
    if (penult.trackIndex === primary.trackIndex) {
      secondary = penult;
    }
  }

  return {
    primary,
    secondary,
    t,
  };
}

/**
 * What to preload: the next item that will need a video element.
 *
 * Looks ahead by `lookahead` seconds (default 1.5) and returns the first
 * item whose start falls in that window and is not already active.
 */
export function prerollAt(comp, t, lookahead = 1.5) {
  const activeIds = new Set();
  for (const track of comp.tracks) {
    if (track.kind !== 'video') continue;
    for (const item of track.items) {
      if (t >= item.at - EPS && t < itemEnd(item) + EPS) {
        activeIds.add(item.id);
      }
    }
  }

  const horizon = t + lookahead;
  let earliest = null;

  for (const track of comp.tracks) {
    if (track.kind !== 'video') continue;
    for (const item of track.items) {
      if (activeIds.has(item.id)) continue;
      if (item.at > t && item.at <= horizon) {
        if (!earliest || item.at < earliest.item.at) {
          earliest = {
            item,
            track,
            sourceId: item.source,
            sourceTime: item.in || 0,
          };
        }
      }
    }
  }

  return earliest;
}

/**
 * Total duration of the composition.
 */
export { duration };

/**
 * Step one frame forward or backward from a given time.
 */
export function stepFrame(comp, t, dir, fps) {
  const rate = fps || comp.fps || 30;
  const frameDur = 1 / rate;
  const next = secs(t + dir * frameDur);
  return Math.max(0, Math.min(next, duration(comp)));
}

/**
 * Timecode string from seconds, at the composition's frame rate.
 */
export function timecode(seconds, fps) {
  const s = Math.max(0, Number(seconds) || 0);
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  if (fps && fps > 0) {
    const f = Math.floor((s % 1) * fps);
    const frame = f >= Math.round(fps) ? Math.round(fps) - 1 : f;
    return `${pad(mm)}:${pad(ss)}:${pad(frame)}`;
  }
  return `${pad(mm)}:${pad(ss)}.${pad(Math.floor((s % 1) * 100))}`;
}
