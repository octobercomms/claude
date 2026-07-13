// fal.ai — single-key media aggregator for the Visualise studio (and, over
// time, the consolidation target for the standalone image accounts). Shaped
// like connectors/replicate.js: key from Settings, submit-then-poll, returns
// output URL(s), logs cost via costLog.
//
// fal's queue API (https://docs.fal.ai): POST the input to
//   https://queue.fal.run/{model-id}
// with header `Authorization: Key <FAL_KEY>`, which returns
//   { request_id, status_url, response_url, cancel_url }.
// Poll status_url until { status: 'COMPLETED' }, then GET response_url for the
// model output. We use the returned status_url / response_url directly rather
// than reconstructing them, so this keeps working if fal changes its paths.
//
// Model slugs are NOT hardcoded here — callers pass the slug (from a preset's
// model_routing), so adding/swapping a model is data, not code.

const axios = require('axios');
const { getSetting } = require('../utils/settings');

const QUEUE_BASE = 'https://queue.fal.run';

async function authHeader() {
  // Trim whitespace and a pasted-in "Key " prefix so a slightly-off paste in
  // Settings doesn't silently become a malformed Authorization header.
  const key = (await getSetting('FAL_KEY') || '').trim().replace(/^Key\s+/i, '');
  if (!key) throw new Error('FAL_KEY not set in Settings');
  return { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
}

// Turn an axios failure into a message that says WHAT fal actually rejected —
// the raw "Request failed with status code 403" is useless to a user. fal puts
// the reason in the response body (a string, or { detail } / { error }).
function falError(err, model, phase) {
  const status = err.response?.status;
  const data = err.response?.data;
  let detail = '';
  if (data != null) {
    detail = typeof data === 'string' ? data
      : (data.detail || data.error || data.message || JSON.stringify(data));
    if (typeof detail !== 'string') detail = JSON.stringify(detail);
  } else {
    detail = err.message || 'unknown error';
  }
  if (detail.length > 400) detail = detail.slice(0, 400) + '…';
  const hint = status === 403
    ? ' — fal returned 403. Usually the FAL_KEY is invalid or lacks access to this model, or the fal account has no billing/credit set up. Check the key at fal.ai → Settings → API keys and that the account can run this model.'
    : status === 401 ? ' — fal auth failed (401): the FAL_KEY looks wrong.'
    : status === 404 ? ` — fal has no model at "${model}" (404): the model slug may be wrong.`
    : status === 422 ? ' — fal rejected the request fields (422): the model expected a different input shape.'
    : '';
  const e = new Error(`fal ${model} ${phase} failed${status ? ` (${status})` : ''}: ${detail}${hint}`);
  e.status = 502;              // to our API this is an upstream failure
  e.falStatus = status || null;
  return e;
}

// Pull the image URL(s) out of a fal result, tolerant of the shapes different
// fal models return ({images:[{url}]}, {image:{url}}, {output:[...]}, a bare
// string, …).
function extractUrls(result) {
  if (!result) return [];
  if (typeof result === 'string') return [result];
  if (Array.isArray(result.images)) return result.images.map(i => (typeof i === 'string' ? i : i?.url)).filter(Boolean);
  if (result.image?.url) return [result.image.url];
  if (typeof result.image === 'string') return [result.image];
  if (Array.isArray(result.output)) return result.output.map(o => (typeof o === 'string' ? o : o?.url)).filter(Boolean);
  if (result.url) return [result.url];
  return [];
}

// Generic call: submit `input` to a fal model by slug, poll to completion,
// return { url, urls, raw, request_id, model }. costUsd (computed by the caller
// from a per-model price × count) is logged if provided.
async function run(model, input = {}, { feature = 'fal', clientId = null, costUsd = null, timeoutMs = 180_000, pollMs = 2500 } = {}) {
  if (!model) throw new Error('fal.run: model slug required');
  const headers = await authHeader();

  // Submit to the queue.
  let submit;
  try {
    ({ data: submit } = await axios.post(`${QUEUE_BASE}/${model}`, input, { headers }));
  } catch (err) { throw falError(err, model, 'submit'); }
  const statusUrl = submit.status_url || `${QUEUE_BASE}/${model}/requests/${submit.request_id}/status`;
  const responseUrl = submit.response_url || `${QUEUE_BASE}/${model}/requests/${submit.request_id}`;

  // Poll until COMPLETED / failed.
  const deadline = Date.now() + timeoutMs;
  let status = submit.status;
  while (status !== 'COMPLETED') {
    if (status === 'ERROR' || status === 'FAILED') throw new Error(`fal ${model} failed: ${status}`);
    if (Date.now() > deadline) throw new Error(`fal ${model} timed out`);
    await new Promise(r => setTimeout(r, pollMs));
    try {
      const { data } = await axios.get(statusUrl, { headers });
      status = data.status;
    } catch (err) { throw falError(err, model, 'poll'); }
  }

  let result;
  try {
    ({ data: result } = await axios.get(responseUrl, { headers }));
  } catch (err) { throw falError(err, model, 'result'); }
  const urls = extractUrls(result);

  if (costUsd != null) {
    require('../services/costLog').recordApiCost({ provider: 'fal', feature, costUsd, clientId, meta: { model, request_id: submit.request_id } });
  }
  return { url: urls[0] || null, urls, raw: result, request_id: submit.request_id, model };
}

// Thin convenience wrappers over run(). The exact fal input field names are
// per-model and finalised during the §11 bake-off (Phases 2/4/5); these pass
// `input` through so callers can shape it, while giving the common jobs a name.
function generate(model, input, opts) { return run(model, input, { feature: 'visualise_generate', ...opts }); }
function inpaint(model, input, opts) { return run(model, input, { feature: 'visualise_inpaint', ...opts }); }
function upscale(model, input, opts) { return run(model, input, { feature: 'visualise_upscale', ...opts }); }

// Cheap "is a key configured?" check for the Settings UI. We don't spend to
// verify — fal has no free auth-probe endpoint — so this only confirms the key
// is present; a real failure surfaces on first use.
async function testCredentials() {
  try {
    await authHeader();
    return { ok: true, message: 'FAL_KEY is set.' };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

module.exports = { run, generate, inpaint, upscale, extractUrls, testCredentials };
