// Stage 5 — export. Burn the brand captions (if any) into the roughcut, encode
// the delivery-quality vertical master, upload it to the platform, and clean up
// the project's scratch dir.

const fs = require('fs');
const { workPath, cleanup } = require('../lib/work');
const { exportMaster } = require('../lib/video');

module.exports = async function exportStage({ job }, api) {
  const roughcut = workPath(job.project_id, 'roughcut.mp4');
  if (!fs.existsSync(roughcut)) throw new Error('roughcut.mp4 missing — nothing to export');

  const captionsAss = workPath(job.project_id, 'captions.ass');
  const fontsDir = workPath(job.project_id, 'fonts');
  const master = workPath(job.project_id, 'master.mp4');

  await exportMaster(roughcut, {
    captionsAss: fs.existsSync(captionsAss) ? captionsAss : null,
    fontsDir: fs.existsSync(fontsDir) ? fontsDir : null,
  }, master);

  const { output_url } = await api.uploadOutput(job.project_id, master);
  console.log(`[export] master uploaded → ${output_url}`);
  cleanup(job.project_id);
};
