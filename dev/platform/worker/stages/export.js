// Stage 5 — export. Burn the brand captions (if any) into the roughcut, encode
// the delivery-quality vertical master, upload it to the platform, and clean up
// the project's scratch dir.

const fs = require('fs');
const { workPath, cleanup } = require('../lib/work');
const { exportMaster } = require('../lib/video');
const { validateMaster } = require('../lib/qc');

module.exports = async function exportStage({ job }, api) {
  const roughcut = workPath(job.project_id, 'roughcut.mp4');
  if (!fs.existsSync(roughcut)) throw new Error('roughcut.mp4 missing — nothing to export');

  const captionsAss = workPath(job.project_id, 'captions.ass');
  const fontsDir = workPath(job.project_id, 'fonts');
  const master = workPath(job.project_id, 'master.mp4');
  const hasCaptions = fs.existsSync(captionsAss);

  await exportMaster(roughcut, {
    captionsAss: hasCaptions ? captionsAss : null,
    fontsDir: fs.existsSync(fontsDir) ? fontsDir : null,
  }, master);

  // Objective post-render QC: never ship a blank/dead/empty master. Warnings are
  // logged; error-level issues fail the job (surfaced in video_jobs.error) so a
  // broken render is caught here instead of reaching the client.
  const qc = await validateMaster(master, { expectCaptions: hasCaptions });
  for (const i of qc.issues) {
    (i.level === 'error' ? console.error : console.warn)(`[export][qc] ${i.level}: ${i.code} — ${i.detail}`);
  }
  if (!qc.ok) {
    const errs = qc.issues.filter(i => i.level === 'error').map(i => `${i.code} (${i.detail})`).join('; ');
    throw new Error(`post-render QC failed — not shipping: ${errs}`);
  }

  const { output_url } = await api.uploadOutput(job.project_id, master);
  console.log(`[export] master uploaded → ${output_url}`);
  cleanup(job.project_id);
};
