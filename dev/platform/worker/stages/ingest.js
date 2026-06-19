// Stage 1 — ingest. Download each clip to the project work dir and ffprobe it,
// reporting duration/dimensions back so the rest of the pipeline (and the UI)
// know what they're working with.

const { workPath } = require('../lib/work');
const { probe } = require('../lib/ffmpeg');

module.exports = async function ingest({ job, clips }, api) {
  if (!clips || !clips.length) throw new Error('No clips to ingest');
  for (const c of clips) {
    const dest = workPath(job.project_id, `src-${String(c.position).padStart(3, '0')}-${c.id}.mp4`);
    await api.downloadClip(c.id, dest);
    const p = await probe(dest);
    await api.reportProbe(c.id, p);
    console.log(`[ingest] clip ${c.id} ${p.width}x${p.height} ${p.duration_s ? p.duration_s.toFixed(1) + 's' : '?'}`);
  }
};
