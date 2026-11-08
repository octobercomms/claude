/**
 * Is this rendered video actually watchable?
 *
 * Thirty unattended renders need a machine verdict before a person looks at
 * them, and the verdict's job is NOT to be a gate. It is to answer one
 * question: which of these thirty should I watch first? A batch where you have
 * to watch all thirty to find the two that are wrong has not saved anybody an
 * afternoon.
 *
 * So there are three levels rather than pass and fail:
 *
 *   fail — something is measurably broken. Black in the middle, a frozen
 *          two seconds, the wrong resolution, a camera move that did not
 *          happen. Watch these first; most are a re-render.
 *   look — something is suspicious but might be intended. A long silent tail,
 *          audio and video of different lengths, a peak close to clipping.
 *   pass — nothing measured is wrong. Still worth a glance; the machine
 *          cannot tell you whether the edit is any good.
 *
 * Everything here is PURE: it takes measurements and returns a verdict. The
 * ffmpeg that produces the measurements lives in
 * `backend/src/services/renderQc.js`, for the same reason the silence cut is
 * split that way — a decision that needs a video file to exercise is a
 * decision no test will exercise.
 *
 * ADVISORY BY CONSTRUCTION, on the reelChecks precedent: "a checklist that
 * blocks gets switched off within a fortnight". Nothing here stops a render
 * being approved. It orders the queue and says why.
 */

/**
 * The numbers, named here rather than left inline so the fingerprint below
 * covers them. A threshold change that moved the words but not the values
 * would otherwise read as the same rule set.
 */
export const QC = {
  // Black is normal at the ends — a fade in and a fade out are the correct
  // way to start and stop. A naive black-frame check fails every properly
  // faded video, so only the middle counts.
  edge_grace_s: 1.0,
  black_min_s: 0.5,

  // A freeze shorter than this is a slow moment; longer is a stuck encode.
  freeze_min_s: 2.0,

  // A tail this silent reads as the audio having run out early.
  tail_silence_s: 1.2,

  // Audio and video should end together. More than this apart and one of them
  // was padded or truncated.
  av_drift_s: 0.5,

  // Close to clipping. −0.5 is the usual delivery ceiling.
  true_peak_db: -0.5,

  // The MOTION FLOOR, and the one check here that is ours rather than
  // borrowed. Mean absolute difference between consecutive sampled frames,
  // 0..255 on a grayscale thumbnail. A deterministic camera move across three
  // seconds moves pixels; a still that should be moving does not. Set low
  // because the moves are deliberately small — 12% scale travel at most — and
  // a floor set high would fail the subtlest of the six motions.
  motion_floor: 0.35,

  // Below this much detail a frame cannot show movement at all. Zoom a solid
  // colour and every pixel is unchanged, so the delta is zero however hard
  // the camera moved. A flat end card is therefore UNMEASURABLE rather than
  // broken, and saying so beats failing it — a check that cries wolf on
  // legitimate output is how a whole checklist gets switched off. Found by
  // running the gate on solid-colour stills and watching it fail a render
  // that was correct.
  detail_floor: 3.0,

  // Loudness is MEASURED AND REPORTED, never graded, because nothing in this
  // pipeline normalises it. `loudnorm` appears in the repo exactly once, in
  // the list of filters scripts/ffmpeg-check.js makes sure ffmpeg still has,
  // and no service uses it; the composition mixer runs amix with
  // normalize=0 on purpose so volume does not change with track count. A
  // loudness check with no loudness normalisation fails almost everything for
  // a reason the operator cannot act on, which is how a checklist gets
  // switched off. The target is here so the figure can be read against
  // something, and it becomes a graded check the day the render normalises.
  loudness_target_lufs: -16,
  loudness_tolerance_lu: 2,
};

const SEVERITY = { pass: 0, look: 1, fail: 2 };

/** The worst of a set of severities. */
function worst(levels) {
  return levels.reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a), 'pass');
}

const round = (n, p = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** p) / 10 ** p : null);

/**
 * Judge one rendered file.
 *
 * `m` is what the measurement service found:
 *   { width, height, fps, videoDuration, audioDuration,
 *     blackRuns: [{ start, end }], freezeRuns: [{ start, end }],
 *     silenceRuns: [{ start, end }], loudnessLufs, truePeakDb,
 *     motion: [{ start, end, delta }] }
 *
 * `expected` is what the composition asked for:
 *   { width, height, fps, duration, movingWindows: [{ start, end, why }] }
 *
 * A measurement that is absent is not a failure. ffprobe can decline to
 * report a frame rate, a file can have no audio by design, and a check with
 * nothing to check on reports `skipped` rather than inventing a verdict —
 * the alternative is a batch where every silent video fails an audio check.
 */
export function judge(m = {}, expected = {}) {
  const checks = [];
  const add = (c) => { checks.push(c); return c; };

  // ── the frame itself ───────────────────────────────────────────────
  if (m.width && m.height && expected.width && expected.height) {
    const ok = m.width === expected.width && m.height === expected.height;
    add({
      id: 'resolution',
      level: ok ? 'pass' : 'fail',
      says: ok
        ? `${m.width}×${m.height}`
        : `${m.width}×${m.height}, but the composition is ${expected.width}×${expected.height}`,
    });
  } else {
    add({ id: 'resolution', level: 'skipped', says: 'no resolution reported' });
  }

  if (Number.isFinite(m.fps) && Number.isFinite(expected.fps)) {
    // A tenth of a frame, because 30000/1001 is 29.97 and not 30.
    const ok = Math.abs(m.fps - expected.fps) <= 0.1;
    add({
      id: 'fps',
      level: ok ? 'pass' : 'fail',
      says: ok ? `${round(m.fps, 2)} fps` : `${round(m.fps, 2)} fps, not the ${expected.fps} asked for`,
    });
  } else {
    add({ id: 'fps', level: 'skipped', says: 'no frame rate reported' });
  }

  // ── black in the middle ────────────────────────────────────────────
  //
  // Leading and trailing black is a fade and is correct. Only a run that
  // starts after the grace window and ends before it counts.
  const dur = Number.isFinite(m.videoDuration) ? m.videoDuration : expected.duration;
  const midBlack = (m.blackRuns || []).filter((r) => {
    const len = r.end - r.start;
    if (len < QC.black_min_s) return false;
    if (r.start < QC.edge_grace_s) return false;
    if (Number.isFinite(dur) && r.end > dur - QC.edge_grace_s) return false;
    return true;
  });
  add({
    id: 'black',
    level: midBlack.length ? 'fail' : 'pass',
    says: midBlack.length
      ? `black for ${round(midBlack[0].end - midBlack[0].start)}s at ${round(midBlack[0].start)}s`
      : 'no black in the middle',
    at: midBlack.length ? round(midBlack[0].start) : null,
  });

  // ── which spans the picture is too flat to say anything about ──────
  //
  // Shared by the freeze and motion checks below, because the same fact
  // disqualifies both: a solid colour cannot show movement, and it cannot
  // show a stuck encode either. A flat end card is unmeasurable, not broken.
  const median = (xs) => {
    const sorted = xs.filter(Number.isFinite).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  };
  const flatSpans = [];
  if ((m.motion || []).length) {
    for (const sample of m.motion) {
      if (!Number.isFinite(sample.detail) || sample.detail >= QC.detail_floor) continue;
      const last = flatSpans[flatSpans.length - 1];
      if (last && Math.abs(last.end - sample.start) < 1e-6) last.end = sample.end;
      else flatSpans.push({ start: sample.start, end: sample.end });
    }
  }
  const inFlatSpan = (r) => flatSpans.some((f) => r.start >= f.start - 0.5 && r.end <= f.end + 0.5);

  // ── a stuck frame ──────────────────────────────────────────────────
  //
  // A freeze inside a span with no detail is only "frozen" in the sense that
  // a grey card is frozen. Downgraded to `look` rather than skipped, because
  // a stuck encode on a mostly-flat video is still possible and a person
  // glancing at it will see which it is in a second. A freeze on a picture
  // that HAS detail stays a failure: nothing legitimate holds a textured
  // frame still for two seconds in these templates.
  const freezes = (m.freezeRuns || []).filter((r) => r.end - r.start >= QC.freeze_min_s);
  const freezeFlat = freezes.length > 0 && freezes.every(inFlatSpan);
  add({
    id: 'freeze',
    level: !freezes.length ? 'pass' : freezeFlat ? 'look' : 'fail',
    says: !freezes.length
      ? 'nothing frozen'
      : `frozen for ${round(freezes[0].end - freezes[0].start)}s at ${round(freezes[0].start)}s`
        + (freezeFlat ? ', where the picture is flat anyway' : ''),
    at: freezes.length ? round(freezes[0].start) : null,
  });

  // ── the camera move actually happened ──────────────────────────────
  //
  // Ours rather than borrowed, and the reason it exists: a transform that
  // silently did not apply, or an image-to-video call that returned a still,
  // produces a file that passes every other check here. A montage of six
  // photographs with no movement is not the video the template promised.
  const windows = expected.movingWindows || [];
  if (!windows.length) {
    add({ id: 'motion', level: 'skipped', says: 'nothing was asked to move' });
  } else if (!(m.motion || []).length) {
    add({ id: 'motion', level: 'skipped', says: 'motion was not measured' });
  } else {
    const still = [];
    let flat = 0;
    for (const w of windows) {
      // The samples the measurement covers that overlap this window.
      const inside = m.motion.filter((s) => s.end > w.start && s.start < w.end);
      if (!inside.length) continue;
      // Median, not mean, for both: one hard cut inside the window would drag
      // a mean above the floor and hide a shot that never moved.
      const d = median(inside.map((s) => s.delta));
      if (d == null) continue;
      // A frame with no detail cannot show movement. Skip rather than fail.
      const detail = median(inside.map((s) => s.detail));
      if (detail != null && detail < QC.detail_floor) { flat += 1; continue; }
      if (d < QC.motion_floor) still.push({ ...w, median: round(d, 3) });
    }
    const measured = windows.length - flat;
    add({
      id: 'motion',
      level: still.length ? 'fail' : 'pass',
      says: still.length
        ? `${still.length} shot${still.length === 1 ? '' : 's'} that should move did not`
          + ` (first at ${round(still[0].start)}s${still[0].why ? `, ${still[0].why}` : ''})`
        : measured === 0
          ? `${windows.length} moving shot${windows.length === 1 ? '' : 's'}, too flat to measure`
          : `all ${measured} moving shot${measured === 1 ? '' : 's'} moved`
            + (flat ? `, ${flat} too flat to measure` : ''),
      at: still.length ? round(still[0].start) : null,
    });
  }

  // ── audio ──────────────────────────────────────────────────────────
  if (!Number.isFinite(m.audioDuration)) {
    add({ id: 'audio', level: 'skipped', says: 'no audio track' });
  } else {
    if (Number.isFinite(dur)) {
      const drift = Math.abs(m.audioDuration - dur);
      add({
        id: 'drift',
        level: drift > QC.av_drift_s ? 'look' : 'pass',
        says: drift > QC.av_drift_s
          ? `audio and video are ${round(drift)}s apart`
          : 'audio and video end together',
      });
    }

    // A silent tail reads as the audio having run out before the picture.
    const tail = (m.silenceRuns || []).find((r) => (
      Number.isFinite(dur) && r.end >= dur - 0.05 && r.end - r.start > QC.tail_silence_s
    ));
    add({
      id: 'tail',
      level: tail ? 'look' : 'pass',
      says: tail
        ? `${round(tail.end - tail.start)}s of silence at the end`
        : 'no silent tail',
      at: tail ? round(tail.start) : null,
    });

    if (Number.isFinite(m.truePeakDb)) {
      add({
        id: 'peak',
        level: m.truePeakDb > QC.true_peak_db ? 'look' : 'pass',
        says: `true peak ${round(m.truePeakDb, 1)} dB`
          + (m.truePeakDb > QC.true_peak_db ? `, above the ${QC.true_peak_db} ceiling` : ''),
      });
    }

    // Reported, never graded. See the note on loudness_target_lufs.
    if (Number.isFinite(m.loudnessLufs)) {
      const off = m.loudnessLufs - QC.loudness_target_lufs;
      add({
        id: 'loudness',
        level: 'info',
        says: `${round(m.loudnessLufs, 1)} LUFS`
          + (Math.abs(off) > QC.loudness_tolerance_lu
            ? `, ${round(Math.abs(off), 1)} LU ${off > 0 ? 'louder' : 'quieter'} than ${QC.loudness_target_lufs}`
            : ''),
      });
    }
  }

  const graded = checks.filter((c) => SEVERITY[c.level] != null);
  const verdict = worst(graded.map((c) => c.level));

  return {
    verdict,
    checks,
    says: summarise(verdict, checks),
    // What the review sheet sorts on. Worst first, and within a level the
    // one with more wrong than the others, so the operator's first click is
    // the most broken video rather than the first one submitted.
    rank: SEVERITY[verdict] * 100 + graded.filter((c) => c.level !== 'pass').length,
  };
}

/**
 * One line, for the row.
 *
 * Separate and exported because what the operator is told is a decision in
 * its own right and deserves a test rather than living inside a return.
 */
export function summarise(verdict, checks = []) {
  const bad = checks.filter((c) => c.level === 'fail');
  const odd = checks.filter((c) => c.level === 'look');
  if (verdict === 'fail') {
    return bad.length === 1
      ? `Broken: ${bad[0].says}.`
      : `Broken: ${bad[0].says}, and ${bad.length - 1} other problem${bad.length === 2 ? '' : 's'}.`;
  }
  if (verdict === 'look') {
    return odd.length === 1
      ? `Worth a look: ${odd[0].says}.`
      : `Worth a look: ${odd[0].says}, and ${odd.length - 1} other${odd.length === 2 ? '' : 's'}.`;
  }
  return 'Nothing measurably wrong.';
}

/**
 * Which parts of a composition were asked to move.
 *
 * Read off the timeline rather than passed in, so the motion check cannot
 * drift from what the renderer was actually told to do. An item carries a
 * transform when it has an animated scale or position — which is exactly what
 * a camera-move preset sets — and `beat` names the preset, so a failure can
 * say "push-in" rather than "something".
 */
export function movingWindows(comp) {
  const out = [];
  for (const track of comp?.tracks || []) {
    if (track.kind !== 'video') continue;
    for (const item of track.items || []) {
      const src = comp.sources?.[item.source];
      // Captions are burned by a filter and have no picture of their own.
      if (src?.kind === 'captions') continue;
      const animated = ['scale', 'pos', 'crop', 'rot']
        .some((k) => item[k] && typeof item[k] === 'object' && ('from' in item[k] || 'to' in item[k]));
      if (!animated) continue;
      out.push({
        start: item.at,
        end: item.at + item.len,
        why: item.beat || null,
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** A stable fingerprint of the rule set, so a threshold change is visible. */
function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export const QC_FINGERPRINT = fnv1a(JSON.stringify(QC));
