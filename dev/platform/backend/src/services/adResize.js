// Ad resize / upscale — take one uploaded image and reshape it into the standard
// paid-social + display ad sizes, generatively expanding (outpainting) the
// background so nothing gets cropped, and upscaling first when the source is too
// small to fill the biggest target sharply.
//
// Built on the same plumbing as the Visualise studio: fal for the generative
// work (data-URI inputs, so an auth-behind upload never needs a public URL) and
// jimp for the canvas maths + seam-free stitch. Model slugs mirror the Visualise
// preset routing and are finalised in the same §11 bake-off; they're constants
// here so swapping a model is a one-line change.
//
// Outputs land on local disk under uploads/<clientId>/ and are served back
// through the existing authed /api/brand/file route (same as ad-creative
// uploads), so no second static server is needed.

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const Jimp = require('jimp');
const pool = require('../db');
const fal = require('../connectors/fal');

const UPLOAD_ROOT = path.join(__dirname, '../../uploads');

// fal model routing (mirrors the Visualise preset; §11 bake-off finalises these).
const EXPAND_MODEL = 'fal-ai/flux-pro/v1/fill';   // outpaint the padded area
const UPSCALE_MODEL = 'fal-ai/clarity-upscaler';  // faithful upscale, no re-render
const FAL_PRICES = { 'fal-ai/flux-pro/v1/fill': 0.05, 'fal-ai/clarity-upscaler': 0.03 };
function priceFor(slug) { return FAL_PRICES[slug] != null ? FAL_PRICES[slug] : 0.10; }

// Working canvas cap for the outpaint — keeps extreme banner ratios (e.g. a
// 728×90 leaderboard) from ballooning into a giant, slow, pixel-capped render.
// The final image is resized to the exact target after stitching.
const MAX_EDGE = 1536;
const m16 = n => Math.max(16, Math.round(n / 16) * 16);

const EXPAND_PROMPT =
  'Photorealistic seamless continuation of the existing image into the empty area. ' +
  'Extend the background, textures, lighting and colours naturally with no visible seam, ' +
  'border, frame, vignette or duplicated subject. Keep the original subject untouched.';

// ── Ad-size catalog ────────────────────────────────────────────────────────────
// Grouped by platform for the picker. Some dimensions repeat across platforms
// (1080² square, 1080×1920 vertical) — kept per-platform so each family reads
// cleanly; generating a repeat just re-runs the same shape.
const AD_SIZES = [
  // Meta / Instagram
  { key: 'meta_feed_1x1',   family: 'Meta / Instagram',        label: 'Feed square',        w: 1080, h: 1080, ratio: '1:1' },
  { key: 'meta_feed_4x5',   family: 'Meta / Instagram',        label: 'Feed portrait',      w: 1080, h: 1350, ratio: '4:5' },
  { key: 'meta_story_9x16', family: 'Meta / Instagram',        label: 'Story / Reel',       w: 1080, h: 1920, ratio: '9:16' },
  { key: 'meta_link_191',   family: 'Meta / Instagram',        label: 'Feed landscape',     w: 1200, h: 628,  ratio: '1.91:1' },
  // Google Display
  { key: 'gd_mrec',         family: 'Google Display',          label: 'Medium rectangle',   w: 300,  h: 250,  ratio: '6:5' },
  { key: 'gd_lrec',         family: 'Google Display',          label: 'Large rectangle',    w: 336,  h: 280,  ratio: '6:5' },
  { key: 'gd_leaderboard',  family: 'Google Display',          label: 'Leaderboard',        w: 728,  h: 90,   ratio: '8:1' },
  { key: 'gd_halfpage',     family: 'Google Display',          label: 'Half-page',          w: 300,  h: 600,  ratio: '1:2' },
  { key: 'gd_mobile',       family: 'Google Display',          label: 'Large mobile banner',w: 320,  h: 100,  ratio: '3.2:1' },
  // LinkedIn
  { key: 'li_single_191',   family: 'LinkedIn',                label: 'Single image',       w: 1200, h: 627,  ratio: '1.91:1' },
  { key: 'li_1x1',          family: 'LinkedIn',                label: 'Square',             w: 1080, h: 1080, ratio: '1:1' },
  { key: 'li_4x5',          family: 'LinkedIn',                label: 'Portrait',           w: 1200, h: 1500, ratio: '4:5' },
  // TikTok / Reels / Shorts
  { key: 'vertical_9x16',   family: 'TikTok / Reels / Shorts', label: 'Full vertical',      w: 1080, h: 1920, ratio: '9:16' },
];

function publicSize(s) {
  return { key: s.key, family: s.family, label: s.label, w: s.w, h: s.h, dims: `${s.w}×${s.h}`, ratio: s.ratio };
}
// Catalog grouped by platform family, in catalog order.
function catalog() {
  const groups = [];
  const byFamily = {};
  for (const s of AD_SIZES) {
    if (!byFamily[s.family]) { byFamily[s.family] = { family: s.family, sizes: [] }; groups.push(byFamily[s.family]); }
    byFamily[s.family].sizes.push(publicSize(s));
  }
  return groups;
}
function prices() {
  return { expand: priceFor(EXPAND_MODEL), upscale: priceFor(UPSCALE_MODEL) };
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function toDataUri(pngBuffer) {
  return `data:image/png;base64,${pngBuffer.toString('base64')}`;
}
async function fetchBuffer(url) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 90000, maxContentLength: 60 * 1024 * 1024 });
  return Buffer.from(res.data);
}
function saveOutput(clientId, buffer, sizeKey) {
  const dir = path.join(UPLOAD_ROOT, clientId);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `adsize-${sizeKey}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.png`;
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `/api/brand/file/${clientId}/${filename}`;
}

// Build the outpaint canvas + mask for a target aspect ratio. The whole source
// is placed (never cropped) on a canvas of the target shape; the mask marks the
// padded area white (= generate) and the source black (= keep). Returns null
// when the source already matches the target shape (no outpaint needed).
async function buildExpand(srcImg, targetW, targetH) {
  const W = srcImg.bitmap.width, H = srcImg.bitmap.height;
  const r = targetW / targetH, sr = W / H;
  if (Math.abs(r - sr) / r < 0.012) return null;   // same shape → plain fit

  let cw0, ch0;
  if (r > sr) { ch0 = H; cw0 = H * r; }              // wider target → pad left/right
  else        { cw0 = W; ch0 = W / r; }              // taller target → pad top/bottom

  const longEdge = Math.max(cw0, ch0);
  const capScale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1;
  const cw = m16(cw0 * capScale), ch = m16(ch0 * capScale);

  // Fit the source into the canvas (contain, never upscaled here — the optional
  // pre-upscale step handles low-res sources), centred.
  const fit = Math.min(cw / W, ch / H, 1);
  const sw = Math.max(1, Math.round(W * fit)), sh = Math.max(1, Math.round(H * fit));
  const ox = Math.round((cw - sw) / 2), oy = Math.round((ch - sh) / 2);

  const scaled = srcImg.clone().resize(sw, sh);
  const canvas = new Jimp(cw, ch, 0xffffffff);
  canvas.composite(scaled, ox, oy);
  const mask = new Jimp(cw, ch, 0xffffffff);         // white everywhere = generate
  const hole = new Jimp(sw, sh, 0x000000ff);         // black over the source = keep
  mask.composite(hole, ox, oy);

  return { canvas, mask, cw, ch };
}

// Paste the model's outpaint back over the placed source, keeping every source
// pixel exact and feathering the mask edge so the join is seamless (same D12
// region-lock trick as Visualise).
async function stitch(canvasImg, editedBuf, maskImg) {
  const w = canvasImg.bitmap.width, h = canvasImg.bitmap.height;
  const edited = await Jimp.read(editedBuf);
  edited.resize(w, h);
  const m = maskImg.clone().grayscale().blur(2);
  edited.mask(m, 0, 0);                               // keep model pixels only where mask is white
  return canvasImg.clone().composite(edited, 0, 0);
}

// ── Main ────────────────────────────────────────────────────────────────────
// Reshape `buffer` into every requested ad size. Upscales the source once up
// front when it's too small to fill the biggest target sharply.
async function resizeImage({ clientId, buffer, sizeKeys, userId = null, saveSource = true }) {
  const requested = AD_SIZES.filter(s => sizeKeys.includes(s.key));
  if (!requested.length) { const e = new Error('Pick at least one ad size.'); e.status = 400; throw e; }

  const original = await Jimp.read(buffer);
  const srcW0 = original.bitmap.width, srcH0 = original.bitmap.height;
  let src = original;
  let srcBuf = await original.getBufferAsync(Jimp.MIME_PNG);   // normalise to PNG for fal
  // Keep the original on disk so a later "retry failed" can re-run without a
  // re-upload. Saved before any upscale, so retries start from the true source.
  let sourceUrl = null;
  if (saveSource) sourceUrl = saveOutput(clientId, srcBuf, 'src');
  let upscaled = false, spend = 0;

  const maxTargetEdge = Math.max(...requested.map(s => Math.max(s.w, s.h)));
  const srcLong = Math.max(srcW0, srcH0);
  // Upscale once when the source can't fill the biggest target without
  // stretching — but not for tiny banner-only requests, and not if it's already
  // large (the upscaler adds cost + softness on already-sharp inputs).
  if (srcLong < maxTargetEdge && srcLong < 3000 && maxTargetEdge >= 800) {
    try {
      const res = await fal.run(UPSCALE_MODEL, { image_url: toDataUri(srcBuf) },
        { feature: 'ad_resize_upscale', clientId, costUsd: priceFor(UPSCALE_MODEL) });
      if (res.url) {
        srcBuf = await fetchBuffer(res.url);
        src = await Jimp.read(srcBuf);
        upscaled = true; spend += priceFor(UPSCALE_MODEL);
      }
    } catch (e) { /* fall back to the original resolution — still produce sizes */ }
  }

  const outputs = [];
  for (const size of requested) {
    try {
      const expand = await buildExpand(src, size.w, size.h);
      let outImg;
      if (!expand) {
        outImg = src.clone().cover(size.w, size.h);   // same shape → scale (+ hair-crop)
      } else {
        const canvasBuf = await expand.canvas.getBufferAsync(Jimp.MIME_PNG);
        const maskBuf = await expand.mask.getBufferAsync(Jimp.MIME_PNG);
        const res = await fal.run(EXPAND_MODEL,
          { image_url: toDataUri(canvasBuf), mask_url: toDataUri(maskBuf), prompt: EXPAND_PROMPT },
          { feature: 'ad_resize_expand', clientId, costUsd: priceFor(EXPAND_MODEL) });
        if (!res.url) throw new Error('The expand model returned no image.');
        const editedBuf = await fetchBuffer(res.url);
        const stitched = await stitch(expand.canvas, editedBuf, expand.mask);
        outImg = stitched.resize(size.w, size.h);
        spend += priceFor(EXPAND_MODEL);
      }
      const outBuf = await outImg.getBufferAsync(Jimp.MIME_PNG);
      const url = saveOutput(clientId, outBuf, size.key);
      outputs.push({ ...publicSize(size), url, method: expand ? 'expanded' : 'fit' });
    } catch (err) {
      outputs.push({ ...publicSize(size), error: err.message });
    }
  }

  return {
    source: {
      width: srcW0, height: srcH0, upscaled,
      upscaled_to: upscaled ? { width: src.bitmap.width, height: src.bitmap.height } : null,
      url: sourceUrl,
    },
    outputs,
    spend_usd: +spend.toFixed(4),
  };
}

// ── Persistence + bulk download ───────────────────────────────────────────────
// A filename stem from a source image name ("Hero Shot.png" → "hero-shot").
function nameStem(n) {
  return String(n || 'image').replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'image';
}
// Map a served output URL (/api/brand/file/<clientId>/<filename>) back to disk,
// with a traversal guard.
function diskPathForOutput(url) {
  const m = String(url || '').match(/^\/api\/brand\/file\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  const base = path.join(UPLOAD_ROOT, m[1]);
  const p = path.join(base, m[2]);
  return p.startsWith(base + path.sep) ? p : null;
}

// Save a completed run so it can be reopened / bulk-downloaded later.
async function recordBatch({ clientId, createdBy = null, sourceCount = 0, sizeCount = 0, result = {} }) {
  const spend = result.spend_usd || 0;
  const { rows } = await pool.query(
    `INSERT INTO ad_resize_batches (client_id, created_by, source_count, size_count, spend_usd, result)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
    [clientId, createdBy, sourceCount, sizeCount, spend, JSON.stringify(result)]
  );
  return rows[0];
}

// Recent runs for a client — light rows for the history list (thumb + counts).
async function listBatches(clientId) {
  const { rows } = await pool.query(
    `SELECT b.id, b.created_at, b.source_count, b.size_count, b.spend_usd, b.result,
            u.username AS created_by_name
       FROM ad_resize_batches b
       LEFT JOIN users u ON u.id = b.created_by
      WHERE b.client_id = $1
      ORDER BY b.created_at DESC
      LIMIT 100`,
    [clientId]
  );
  return rows.map(r => {
    const items = r.result?.items || [];
    let thumb = null, outputCount = 0, failedCount = 0, retryableFailed = 0;
    for (const it of items) {
      const hasSource = !!(it.source?.url);
      for (const o of (it.outputs || [])) {
        if (o.error) { failedCount++; if (hasSource) retryableFailed++; }
        else if (o.url) { outputCount++; if (!thumb) thumb = o.url; }
      }
    }
    return {
      id: r.id, created_at: r.created_at, created_by_name: r.created_by_name,
      source_count: r.source_count, size_count: r.size_count, spend_usd: Number(r.spend_usd),
      output_count: outputCount, failed_count: failedCount, retryable_failed: retryableFailed,
      thumb, names: items.map(it => it.name).filter(Boolean),
    };
  });
}

async function getBatch(id) {
  const { rows } = await pool.query('SELECT * FROM ad_resize_batches WHERE id = $1', [id]);
  return rows[0] || null;
}

async function deleteBatch(batch) {
  for (const it of (batch.result?.items || [])) {
    for (const o of (it.outputs || [])) {
      const p = o.url && diskPathForOutput(o.url);
      if (p) fs.promises.unlink(p).catch(() => {});
    }
    const sp = it.source?.url && diskPathForOutput(it.source.url);
    if (sp) fs.promises.unlink(sp).catch(() => {});
  }
  await pool.query('DELETE FROM ad_resize_batches WHERE id = $1', [batch.id]);
}

// Re-run only the failed sizes in a saved batch, using each image's stored
// source (no re-upload). Successful outputs are untouched; failed ones are
// replaced in place. Returns { recovered, still_failed, skipped, batch }.
async function retryBatch(batch, { userId = null } = {}) {
  const result = batch.result || {};
  const items = result.items || [];
  let addedSpend = 0, recovered = 0, stillFailed = 0, skipped = 0;

  for (const item of items) {
    const failedKeys = (item.outputs || []).filter(o => o.error).map(o => o.key);
    if (!failedKeys.length) continue;
    const srcPath = item.source?.url && diskPathForOutput(item.source.url);
    if (!srcPath || !fs.existsSync(srcPath)) {
      item.retry_note = 'Original image is no longer available — re-upload this one to retry.';
      skipped += failedKeys.length;
      continue;
    }
    delete item.retry_note;
    let out;
    try {
      out = await resizeImage({
        clientId: batch.client_id, buffer: fs.readFileSync(srcPath),
        sizeKeys: failedKeys, userId, saveSource: false,
      });
    } catch (e) {
      item.retry_note = e.message;
      stillFailed += failedKeys.length;
      continue;
    }
    addedSpend += out.spend_usd || 0;
    const byKey = {};
    for (const o of out.outputs) { byKey[o.key] = o; if (o.error) stillFailed++; else recovered++; }
    item.outputs = (item.outputs || []).map(o => (byKey[o.key] ? byKey[o.key] : o));
  }

  result.spend_usd = +((result.spend_usd || 0) + addedSpend).toFixed(4);
  await pool.query('UPDATE ad_resize_batches SET result = $1, spend_usd = $2 WHERE id = $3',
    [JSON.stringify(result), result.spend_usd, batch.id]);
  return { recovered, still_failed: stillFailed, skipped, batch: await getBatch(batch.id) };
}

// Build a .zip of every output in a batch. Many-image runs get one folder per
// source image; single-image runs are flat. Returns a Buffer (empty → caller
// 404s).
async function zipBatch(batch) {
  const JSZip = require('jszip');
  const zip = new JSZip();
  const items = batch.result?.items || [];
  const many = items.length > 1;
  const used = new Set();
  let added = 0;
  for (const it of items) {
    const stem = nameStem(it.name);
    for (const o of (it.outputs || [])) {
      if (o.error || !o.url) continue;
      const p = diskPathForOutput(o.url);
      if (!p || !fs.existsSync(p)) continue;
      let name = many ? `${stem}/${o.key}.png` : `${stem}-${o.key}.png`;
      let i = 2;
      while (used.has(name)) { name = (many ? `${stem}/${o.key}-${i}` : `${stem}-${o.key}-${i}`) + '.png'; i++; }
      used.add(name);
      zip.file(name, fs.readFileSync(p));
      added++;
    }
  }
  if (!added) return Buffer.alloc(0);
  return zip.generateAsync({ type: 'nodebuffer' });
}

module.exports = {
  catalog, prices, resizeImage, AD_SIZES, priceFor,
  recordBatch, listBatches, getBatch, deleteBatch, zipBatch, retryBatch,
};
