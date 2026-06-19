// Stage 4 — grade (the QA loop). Sample frames from the roughcut + read the
// transcript, and have Claude score the cut 0–100. The platform decides what to
// do with the score: below the bar (and under the re-edit cap) it loops back to
// roughcut for a tighter pass; otherwise it advances to export.
//
// Returns { score } so the worker submits it via the grade endpoint. With no
// ANTHROPIC_API_KEY the cut passes through ungraded (score 85).

const fs = require('fs');
const { workPath } = require('../lib/work');
const { probe } = require('../lib/ffmpeg');
const { extractFrames } = require('../lib/video');
const { config } = require('../lib/config');
const { gradeCut } = require('../lib/anthropic');

module.exports = async function grade({ job }, api) {
  const roughcut = workPath(job.project_id, 'roughcut.mp4');
  if (!fs.existsSync(roughcut)) throw new Error('roughcut.mp4 missing — nothing to grade');

  if (!config.anthropicKey) {
    console.log('[grade] ANTHROPIC_API_KEY not set — passing ungraded (85)');
    return { score: 85 };
  }

  const dur = (await probe(roughcut)).duration_s || 0;
  const framesDir = workPath(job.project_id, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });
  const frames = await extractFrames(roughcut, dur || 10, 4, framesDir);
  if (!frames.length) { console.log('[grade] could not sample frames — passing (80)'); return { score: 80 }; }

  let transcript = '';
  try { transcript = fs.readFileSync(workPath(job.project_id, 'transcript.txt'), 'utf8'); } catch { /* none */ }

  const { score, notes, adjust } = await gradeCut(frames, transcript);
  console.log(`[grade] score ${score} — ${notes} (tighten ${adjust.tighten}${adjust.drop_intro ? ', drop intro' : ''})`);
  return { score, feedback: { notes, adjust } };
};
