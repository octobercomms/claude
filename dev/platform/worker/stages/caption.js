// Stage 3 — caption. Transcribe the roughcut and build a brand-styled ASS
// caption file (burned in at export). Typography is fixed from the brand kit:
// the caption font is the client's uploaded font (body role preferred), and the
// primary colour is the brand palette — never model-chosen.
//
// If no transcription provider is configured, this stage no-ops cleanly and the
// pipeline still ships a (caption-less) cut.

const fs = require('fs');
const { workPath } = require('../lib/work');
const { config } = require('../lib/config');
const { extractAudioWav } = require('../lib/video');
const { transcribe } = require('../lib/whisper');
const { buildAss } = require('../lib/captions');
const { familyName } = require('../lib/fontname');

module.exports = async function caption({ job }, api) {
  const roughcut = workPath(job.project_id, 'roughcut.mp4');
  if (!fs.existsSync(roughcut)) throw new Error('roughcut.mp4 missing — roughcut must run first');

  if (!config.openaiKey) {
    console.log('[caption] OPENAI_API_KEY not set — skipping captions');
    return;
  }

  const wav = workPath(job.project_id, 'audio.wav');
  await extractAudioWav(roughcut, wav);
  const tr = await transcribe(wav);
  fs.writeFileSync(workPath(job.project_id, 'transcript.txt'), tr.text || '');
  if (!(tr.segments || []).length) { console.log('[caption] no speech detected — no captions'); return; }

  // Brand kit → deterministic caption typography.
  const kit = await api.getBrandKit(job.project_id);
  const fontsDir = workPath(job.project_id, 'fonts');
  fs.mkdirSync(fontsDir, { recursive: true });
  let fontName = 'Arial';
  const chosen = kit.fonts.find(f => f.role === 'body') || kit.fonts.find(f => f.role === 'heading') || kit.fonts[0];
  if (chosen) {
    const fontPath = `${fontsDir}/brand.ttf`;
    try {
      await api.downloadBrandAsset(chosen.id, fontPath);
      fontName = familyName(fontPath) || chosen.name.replace(/\.[^.]+$/, '');
    } catch (e) { console.log(`[caption] brand font download failed (${e.message}) — using ${fontName}`); }
  }
  const primary = kit.palette?.[0] || '#FFFFFF';

  fs.writeFileSync(workPath(job.project_id, 'captions.ass'), buildAss(tr.segments, { fontName, primaryHex: primary }));
  console.log(`[caption] ${tr.segments.length} segments, font "${fontName}", colour ${primary}`);
};
