// Stage 2 — roughcut. Trim dead air from each clip (silencedetect → keep the
// spoken segments), normalise every kept segment to the vertical master format,
// and concat them into roughcut.mp4.
//
// Re-edit loop: when the grade stage sent us back here (the project already has
// a score), tighten the trim a notch so the next pass is punchier.

const fs = require('fs');
const { workPath } = require('../lib/work');
const { probe, detectSilence, keptSegments } = require('../lib/ffmpeg');
const { encodeSegment, concatPieces } = require('../lib/video');

module.exports = async function roughcut({ job, project, clips }, api) {
  const aggressive = project.score != null ? 1 : 0; // a prior grade → tighten
  const pieces = [];
  let idx = 0;

  for (const c of clips) {
    const src = workPath(job.project_id, `src-${String(c.position).padStart(3, '0')}-${c.id}.mp4`);
    if (!fs.existsSync(src)) await api.downloadClip(c.id, src); // ingest may have run elsewhere

    const dur = c.duration_s || (await probe(src)).duration_s || 0;
    let kept;
    try { kept = keptSegments(dur, await detectSilence(src), aggressive); }
    catch { kept = []; }
    if (!kept.length) kept = [{ start: 0, end: dur || 0 }]; // fallback: whole clip

    for (const seg of kept) {
      if (!(seg.end > seg.start)) continue;
      const out = workPath(job.project_id, `piece-${String(idx).padStart(3, '0')}.mp4`);
      await encodeSegment(src, seg.start, seg.end, out);
      pieces.push(out);
      idx++;
    }
  }

  if (!pieces.length) throw new Error('Roughcut produced no usable segments');
  await concatPieces(pieces, workPath(job.project_id, 'roughcut.mp4'));
  console.log(`[roughcut] ${pieces.length} segments → roughcut.mp4${aggressive ? ' (re-edit, tightened)' : ''}`);
};
