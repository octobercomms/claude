/**
 * Playing an edit decision list back, as a model both the player and its
 * tests can hold.
 *
 * The timeline already knows where every block sits (`laidOut`). What it does
 * not say is what a *player* has to do: which clip is on screen, where inside
 * that clip, when the next hand-off falls, which clip to load before it
 * arrives, and what is on screen during a cross-fade, when two blocks are.
 * All of that is arithmetic over the same laid-out rows, so none of it
 * belongs in a React component where it cannot be tested.
 *
 * One rule runs through the whole file: **the player never shows a frame the
 * render will not contain.** That is why a hand-off lands on the next block's
 * in-point rather than wherever the element happens to be, why stepping a
 * frame across a cut lands on the next block's first frame, and why a
 * transition this preview cannot draw is reported as such instead of being
 * quietly shown as a cut.
 */
import { laidOut, duration, transitionOf, TRANSITIONS } from './edl.mjs';

// Shared with edl.mjs's own comparisons. Durations here are sums of
// floating-point in/out points, so an exact `>=` on a block edge decides
// wrongly at some lengths and rightly at others — the fault that deleted
// blocks in session one.
const EPS = 1e-6;

function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function secs(v, d = 0) { return Math.round(num(v, d) * 1e6) / 1e6; }

/** How far ahead of a hand-off the next clip is loaded and seeked. */
export const PREROLL = 1.2;

/** Fallback frame rate, used only until a clip's real one is measured. */
export const FALLBACK_FPS = 30;

/**
 * Transitions this preview can draw honestly with two stacked video elements.
 *
 * `fade` and `dissolve` are an opacity ramp, which is what ffmpeg's `fade`
 * and `dissolve` do to the pixels. `fadeblack` is the outgoing clip to black
 * and the incoming one up from it, which a black veil over both gives
 * exactly. A wipe is a moving edge; `clip-path` could draw one, but the
 * easing would be this component's guess rather than ffmpeg's, so it is not
 * claimed. A wipe previews as a cut at the midpoint and the player says so.
 */
export const DRAWABLE = ['fade', 'dissolve', 'fadeblack'];

export function canDraw(type) {
  return DRAWABLE.includes(type);
}

/** Every block, with its timeline position. Thin wrapper, kept so callers of
 *  this module never need two imports to do one job. */
export function rows(edl) {
  return laidOut(edl);
}

/** The whole edit's length. */
export function total(edl) {
  return duration(edl);
}

/** Keep a time inside the edit. An empty edit clamps everything to 0. */
export function clampToEdit(edl, t) {
  const end = total(edl);
  if (!(end > 0)) return 0;
  return secs(Math.min(Math.max(0, num(t, 0)), end));
}

function cueOf(row, index, t) {
  const inPoint = num(row.item.in, 0);
  return {
    index,
    item: row.item,
    clip: row.item.clip,
    start: row.start,
    end: row.end,
    length: row.length,
    gain: num(row.item.gain, 1),
    // Where inside the source file this timeline time falls. This is what the
    // element's currentTime is set to, and it is the only mapping in the file
    // that matters for correctness.
    sourceTime: secs(inPoint + (num(t, 0) - row.start)),
    inPoint,
    outPoint: row.item.out == null ? null : num(row.item.out),
  };
}

/**
 * The block that owns a timeline time, and where inside its clip that is.
 *
 * Where two blocks overlap in a cross-fade, this returns the earlier one, the
 * same rule `itemAt` uses, so the timeline's selection and the player's main
 * element never disagree about which block you are on.
 */
export function cueAt(edl, t) {
  const list = rows(edl);
  const time = num(t, 0);
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (time >= r.start - EPS && time < r.end - EPS) return cueOf(r, i, time);
  }
  // Exactly at the end of the edit: the last block, parked on its last moment,
  // rather than nothing. A player that returns null at its own end has no
  // frame to hold on pause.
  if (list.length) {
    const last = list[list.length - 1];
    if (time >= last.end - EPS) return cueOf(last, list.length - 1, last.end - EPS);
  }
  return null;
}

/**
 * What is on screen at a timeline time.
 *
 * Outside a transition that is one block. Inside one it is two, with `blend`
 * running 0 to 1 across the overlap, which is the figure the player feeds to
 * an opacity or a veil. `drawable` is false when the transition is real but
 * this preview cannot draw it faithfully; the caller shows the cut and says
 * which transition the render will apply instead of implying none.
 */
export function sceneAt(edl, t) {
  const list = rows(edl);
  const time = num(t, 0);
  const main = cueAt(edl, time);
  if (!main) return null;

  const nextRow = list[main.index + 1];
  if (nextRow) {
    const trans = transitionOf(nextRow.item);
    // The overlap is exactly the transition's duration, and `laidOut` has
    // already pulled the next block back over this one by it.
    if (trans.type !== 'cut' && trans.dur > 0 && time >= nextRow.start - EPS) {
      const through = (time - nextRow.start) / trans.dur;
      return {
        main,
        incoming: cueOf(nextRow, main.index + 1, time),
        blend: Math.min(1, Math.max(0, through)),
        type: trans.type,
        dur: trans.dur,
        drawable: canDraw(trans.type),
      };
    }
  }
  return { main, incoming: null, blend: 0, type: 'cut', dur: 0, drawable: true };
}

/**
 * Playing forward from `t`, the next timeline time at which the player has to
 * do something: start a blend, or hand over to the next block.
 *
 * Returns null at the end of the edit, which is the signal to stop rather
 * than to look for a block that is not there.
 */
export function nextEventAt(edl, t) {
  const list = rows(edl);
  const time = num(t, 0);
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (r.start > time + EPS) return r.start;   // the next block begins (blend or cut)
    if (r.end > time + EPS && i === list.length - 1) return r.end;  // the edit ends
  }
  return null;
}

/**
 * The block to load into the spare element, and the timeline time to do it
 * at. Loading at the hand-off itself shows a stall; loading a whole edit
 * ahead loads clips that a seek may never reach.
 */
export function prerollAt(edl, t, lead = PREROLL) {
  const list = rows(edl);
  const cue = cueAt(edl, t);
  if (!cue) return null;
  const nextRow = list[cue.index + 1];
  if (!nextRow) return null;
  const at = secs(Math.max(cue.start, nextRow.start - Math.max(0, num(lead, PREROLL))));
  return { at, due: num(t, 0) >= at - EPS, cue: cueOf(nextRow, cue.index + 1, nextRow.start) };
}

/**
 * The timeline time for a source time reported by the element playing a
 * block. The inverse of `cue.sourceTime`, and the thing that keeps the
 * playhead honest: it is derived from the frame the element says it is
 * showing, never from a clock this code runs itself.
 */
export function timelineTime(cue, sourceTime) {
  if (!cue) return 0;
  return secs(cue.start + (num(sourceTime, 0) - cue.inPoint));
}

/** Has the element playing this block run past the block's out point? */
export function reachedEnd(cue, sourceTime) {
  if (!cue) return true;
  if (cue.outPoint == null) return false;
  return num(sourceTime, 0) >= cue.outPoint - EPS;
}

/**
 * One frame forward or back, across block boundaries.
 *
 * The step is taken in the frame rate of the block you are *in*, because
 * clips in one edit need not share one. Crossing a boundary lands on the
 * neighbouring block's first or last frame rather than on a time that block
 * does not contain, which is the whole reason this is not `t ± 1/30`.
 *
 * `fpsOf(clipIndex)` returns a measured rate, or anything falsy for "not
 * measured yet", in which case the fallback is used.
 */
export function stepFrame(edl, t, dir, fpsOf) {
  const list = rows(edl);
  if (!list.length) return 0;
  const step = Number(dir) < 0 ? -1 : 1;
  const rate = (i) => {
    const f = typeof fpsOf === 'function' ? Number(fpsOf(i)) : Number(fpsOf);
    return Number.isFinite(f) && f > 0 ? f : FALLBACK_FPS;
  };

  const cue = cueAt(edl, t);
  if (!cue) return 0;
  const fps = rate(cue.clip);

  // Step on the source's frame grid, and land in the middle of a frame.
  //
  // Both halves matter. The grid is the source's, because that is where the
  // decoder's frames are; adding 1/fps to a timeline time accumulates an
  // offset that has nothing to do with any clip. And the landing is mid-frame
  // because a seek to a frame's exact boundary is a coin flip: measured in
  // Chromium, repeated boundary steps showed the same frame twice and then
  // skipped one. Half a frame in, there is only one frame it can be.
  const here = Math.floor(cue.sourceTime * fps + 1e-6);
  const wantSource = (here + step + 0.5) / fps;
  const want = secs(timelineTime(cue, wantSource));

  if (step > 0) {
    if (want < cue.end - EPS) return want;
    const next = list[cue.index + 1];
    if (!next) {
      // Hold inside the last frame rather than running off the end.
      const lastFps = fps;
      return secs(Math.max(cue.start, cue.end - 0.5 / lastFps));
    }
    return secs(next.start + 0.5 / rate(next.item.clip));
  }

  if (want >= cue.start - EPS) return want;
  const prev = list[cue.index - 1];
  if (!prev) return secs(Math.min(0.5 / fps, Math.max(0, cue.end - EPS)));
  return secs(Math.max(prev.start, prev.end - 0.5 / rate(prev.item.clip)));
}

/**
 * Settle onto the frame that is actually on screen.
 *
 * Pausing leaves the two slightly apart: the element's `currentTime` is where
 * playback stopped, and the picture is the last frame it painted, which can
 * be the next one along. Half a frame of disagreement is invisible until you
 * step, and then every step is out by one. Snapping the playhead to the
 * middle of the painted frame, and seeking the element there, makes pausing
 * put the picture, the playhead and the timecode on the same frame.
 */
export function snapToFrame(cue, sourceTime, fps) {
  if (!cue) return 0;
  const f = Number.isFinite(fps) && fps > 0 ? fps : FALLBACK_FPS;
  const src = Number.isFinite(Number(sourceTime)) ? num(sourceTime) : cue.sourceTime;
  const centred = (Math.floor(src * f + 1e-6) + 0.5) / f;
  const t = timelineTime(cue, centred);
  // Never let the snap push the playhead into the next block: a settle is a
  // correction of a fraction of a frame, not a move.
  return secs(Math.min(Math.max(t, cue.start), Math.max(cue.start, cue.end - 0.5 / f)));
}

/**
 * The frame number a time falls in, on a clip's own grid.
 *
 * `floor`, never `round`: a playhead sitting at 1.9 frames is in frame 1, and
 * rounding it to 2 is the timecode disagreeing with the picture, which is the
 * one thing this whole piece of work exists to prevent.
 */
export function frameIndex(seconds, fps) {
  const f = Number.isFinite(fps) && fps > 0 ? fps : FALLBACK_FPS;
  return Math.floor(num(seconds, 0) * f + 1e-6);
}

/**
 * How to apply a block's gain.
 *
 * `HTMLMediaElement.volume` is capped at 1, and the EDL allows up to 4, so a
 * boosted block cannot be previewed by volume alone. A Web Audio gain node
 * would do it and is not built: it ties each element permanently to an audio
 * graph, which the two-element hand-off would have to carry, and that is a
 * bigger change than the problem. So `needsAudioGraph` is the player's cue to
 * say the block is louder than the preview can play it, which is the honest
 * alternative to showing the cap and calling it the output.
 */
export function volumeFor(gain) {
  const g = Math.min(4, Math.max(0, num(gain, 1)));
  return {
    gain: g,
    volume: Math.min(1, g),
    needsAudioGraph: g > 1 + EPS,
    muted: g <= EPS,
  };
}

/**
 * A frame rate from two frames the browser says it presented.
 *
 * `requestVideoFrameCallback` hands back `mediaTime` and `presentedFrames`
 * per painted frame. Dividing the frames painted by the media time between
 * them gives the clip's real rate without decoding anything ourselves, and it
 * works for 29.97 as readily as for 30. Too short a gap is refused: two
 * callbacks 1/30s apart divide by a number small enough that a millisecond of
 * jitter reads as 40fps.
 */
export function rateFrom(a, b) {
  if (!a || !b) return null;
  const dt = num(b.mediaTime) - num(a.mediaTime);
  const df = num(b.presentedFrames) - num(a.presentedFrames);
  if (!(dt > 0.08) || !(df > 0)) return null;
  const fps = df / dt;
  if (!Number.isFinite(fps) || fps < 1 || fps > 480) return null;
  // Snap to the rates real footage uses, so a measurement of 29.9712 does not
  // make a frame step that drifts a frame every few hundred.
  //
  // The nearest candidate, not the first within tolerance: 30 and 29.97 are
  // 0.1% apart, so a first-match loop over an ascending list turns an exact
  // 30 into 29.97 and the step is then wrong on every clip shot at 30.
  const COMMON = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];
  let best = null;
  for (const c of COMMON) {
    const off = Math.abs(fps - c) / c;
    if (off < 0.02 && (best === null || off < best.off)) best = { c, off };
  }
  return best ? best.c : Math.round(fps * 1000) / 1000;
}

/**
 * How far the frame on screen is from the time asked for, in frames.
 *
 * The preview's own honesty check. Chromium seeks `currentTime` precisely, so
 * this is 0 and the playhead and the picture agree. Where a browser seeks to
 * keyframes instead, this is large, and the player reports the time it is
 * actually showing rather than the one it was asked for.
 */
export function driftFrames(wantSourceTime, shownMediaTime, fps) {
  const f = Number.isFinite(fps) && fps > 0 ? fps : FALLBACK_FPS;
  // `Number(null)` is 0 and 0 is finite, so a bare finite check reports a
  // confident drift of minus four seconds when nothing was reported at all.
  // Same trap as the null timestamps in the filmstrip and the waveform.
  if (shownMediaTime == null || !Number.isFinite(Number(shownMediaTime))) return null;
  return Math.round((num(shownMediaTime) - num(wantSourceTime)) * f);
}

export { TRANSITIONS };
