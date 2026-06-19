// Thin HTTP client for the platform's worker API. Every call carries the
// WORKER_TOKEN header. The worker only ever talks to the platform through here.

const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { config } = require('./config');

const http = axios.create({
  baseURL: `${config.platformUrl}/api/video/worker`,
  headers: { 'X-Worker-Token': config.workerToken },
  timeout: 120000,
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
});

async function claim() {
  const { data } = await http.post('/claim', { worker_id: config.workerId });
  return data; // { job, project, clips } | { job: null }
}

// Stream a clip to a local path.
async function downloadClip(clipId, destPath) {
  const res = await http.get(`/clips/${clipId}`, { responseType: 'stream' });
  await streamToFile(res.data, destPath);
}

async function getBrandKit(projectId) {
  const { data } = await http.get(`/projects/${projectId}/brandkit`);
  return data; // { style_preset, fonts:[{id,name,role,file_url}], palette:[] }
}

async function downloadBrandAsset(assetId, destPath) {
  const res = await http.get(`/brand-asset/${assetId}/file`, { responseType: 'stream' });
  await streamToFile(res.data, destPath);
}

async function reportProbe(clipId, probe) {
  await http.post(`/clips/${clipId}/probe`, probe);
}

async function completeJob(jobId, body = {}) {
  await http.post(`/jobs/${jobId}/complete`, body);
}

async function submitGrade(jobId, score) {
  const { data } = await http.post(`/jobs/${jobId}/complete`, { stage: 'grade', score });
  return data; // { retried, score }
}

async function failJob(jobId, message) {
  await http.post(`/jobs/${jobId}/fail`, { error: String(message || '').slice(0, 1900) });
}

async function uploadOutput(projectId, filePath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), { filename: `${projectId}-master.mp4`, contentType: 'video/mp4' });
  const { data } = await http.post(`/projects/${projectId}/output`, form, { headers: form.getHeaders() });
  return data; // { output_url }
}

function streamToFile(stream, destPath) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(destPath);
    stream.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    stream.on('error', reject);
  });
}

module.exports = {
  claim, downloadClip, getBrandKit, downloadBrandAsset, reportProbe,
  completeJob, submitGrade, failJob, uploadOutput,
};
