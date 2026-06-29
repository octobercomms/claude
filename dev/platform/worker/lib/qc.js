// Post-render QC gate. Objective, cheap checks (ffprobe + ffmpeg filters, no AI)
// that a finished master is actually deliverable — catches broken renders (blank
// video, dead audio, near-empty cuts) before we upload and ship them. This is
// the deterministic counterpart to the Claude-Vision `grade` stage, which judges
// quality subjectively; here we just block the obviously-broken.
//
// Returns { ok, issues: [{ level: 'error'|'warn', code, detail }] }. `ok` is
// false only if there's an error-level issue; warnings are logged, not fatal.
// Every detector is wrapped so a probe hiccup degrades to "skip the check", never
// a false failure.

const { probe, detectSilence, detectBlack } = require('./ffmpeg');

async function validateMaster(file, { expectCaptions = false } = {}) {
  const issues = [];

  // 1. Readable + has a video stream + non-trivial duration.
  let meta;
  try {
    meta = await probe(file);
  } catch (e) {
    return { ok: false, issues: [{ level: 'error', code: 'unreadable', detail: e.message.slice(0, 200) }] };
  }
  const dur = meta.duration_s || 0;
  if (dur < 0.5) issues.push({ level: 'error', code: 'too_short', detail: `master is ${dur.toFixed(2)}s` });
  if (!meta.width || !meta.height) issues.push({ level: 'error', code: 'no_video', detail: 'no video stream found' });

  // 2. Black frames — a mostly-black master is a broken render; some black is a warning.
  if (dur >= 1) {
    try {
      const black = await detectBlack(file);
      const blackDur = black.reduce((a, s) => a + Math.max(0, s.end - s.start), 0);
      const frac = blackDur / dur;
      if (frac >= 0.5) issues.push({ level: 'error', code: 'mostly_black', detail: `${Math.round(frac * 100)}% of the video is black` });
      else if (frac >= 0.2) issues.push({ level: 'warn', code: 'black_frames', detail: `${Math.round(frac * 100)}% black` });
    } catch { /* detector failed — skip, don't false-fail */ }
  }

  // 3. Dead audio — a fully silent master with no captions has nothing to convey.
  //    With burned-in captions a silent cut can be legitimate, so only warn there.
  if (dur >= 1) {
    try {
      const silence = await detectSilence(file, -50, 0.5); // strict threshold = true silence only
      const silDur = silence.reduce((a, s) => a + Math.max(0, Math.min(s.end, dur) - s.start), 0);
      const frac = silDur / dur;
      if (frac >= 0.98) {
        issues.push({ level: expectCaptions ? 'warn' : 'error', code: 'silent_audio', detail: 'no audible audio across the whole master' });
      }
    } catch { /* detector failed — skip */ }
  }

  return { ok: !issues.some(i => i.level === 'error'), issues };
}

module.exports = { validateMaster };
