// Paid → Launch. Everything an AM needs to build the batch by hand.
//
// Launch has always said it was "a manual export with the pre-launch
// checklist". It rendered a checklist and a card promising direct API launch
// later. There was no export: no download button, no spreadsheet, nothing.
// A page that describes a capability it does not have is worse than an empty
// one, because you plan around it.
//
// So this is the export. One zip holding the copy as a spreadsheet and every
// rendered asset, named so a row in the sheet and a file on disk can be
// matched without opening either.
//
// Two things about the assets are worth knowing before reading the code.
//
// Images come from two places. An upload is written to this box and carries
// a local /api/brand/file/<client>/<name> path. A generated image keeps the
// URL the provider returned, which is a CDN link belonging to Ideogram,
// Replicate or Adobe. The first is a file read; the second is a fetch that
// can fail, and those URLs are not permanent. An old batch may well export
// with half its images gone.
//
// Which is why a short zip is never silent. Anything missing is listed in
// MISSING.txt inside the zip and counted in the response headers, so the AM
// finds out at download time rather than halfway through building the
// campaign.

const fs = require('fs');
const path = require('path');
const pool = require('../db');

const UPLOAD_ROOT = process.env.UPLOAD_ROOT || path.join(__dirname, '..', '..', 'uploads');

// How long to wait on one provider CDN before giving up on that asset. A
// batch of sixteen must not hang the request because one host is slow.
const FETCH_TIMEOUT_MS = 20000;
// A rendered ad is a few hundred KB. The ceiling is here so a bad URL
// answering with something enormous cannot exhaust memory.
const MAX_ASSET_BYTES = 60 * 1024 * 1024;

// RFC 4180: quote anything holding a comma, quote, newline or carriage
// return, and double the quotes inside. Ad copy contains all four — a body
// with "See more" in it and a line break is the ordinary case, not the edge
// one, so getting this wrong corrupts the common row rather than a rare one.
function csvCell(value) {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  // A leading BOM, so Excel on Windows opens a UTF-8 file as UTF-8 rather
  // than mangling every curly quote in the copy.
  return '﻿' + [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// A filename stem from a headline: readable in a finder window, safe on
// every filesystem, and short enough that the path stays under the limits
// Windows still enforces.
function slug(text, fallback) {
  const s = String(text || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return s || fallback;
}

function extFor(url, mediaType) {
  const clean = String(url || '').split('?')[0];
  const ext = path.extname(clean).toLowerCase();
  if (/^\.(png|jpe?g|webp|gif|mp4|mov|webm)$/.test(ext)) return ext;
  return mediaType === 'video' ? '.mp4' : '.png';
}

// A local upload, or null for anything else. The prefix check and the
// startsWith guard together stop a crafted url walking out of the client's
// own folder.
function diskPathFor(url) {
  const m = String(url || '').match(/^\/api\/brand\/file\/([^/]+)\/([^/]+)$/);
  if (!m) return null;
  const base = path.join(UPLOAD_ROOT, m[1]);
  const p = path.join(base, m[2]);
  return p.startsWith(base + path.sep) ? p : null;
}

async function fetchRemote(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_ASSET_BYTES) throw new Error('larger than the 60MB cap');
    if (!buf.length) throw new Error('empty response');
    return buf;
  } finally { clearTimeout(timer); }
}

async function readAsset(url) {
  const local = diskPathFor(url);
  if (local) {
    if (!fs.existsSync(local)) throw new Error('file is no longer on disk');
    return fs.promises.readFile(local);
  }
  if (/^https?:\/\//i.test(url || '')) return fetchRemote(url);
  throw new Error('unrecognised asset location');
}

const CSV_HEADERS = [
  'Ref', 'Framework', 'Angle', 'Headline', 'Body', 'CTA',
  'Visual concept', 'Notes', 'Shown to client', 'Aspect ratio', 'Media', 'Provider', 'File',
];

// Load the batch, its concepts and their assets. Ordered so the CSV reads in
// the same order as the Draft grid, which is the order the AM reviewed them
// in; a spreadsheet shuffled against the screen is a spreadsheet nobody
// trusts.
async function loadBatch(batchId) {
  const { rows: batches } = await pool.query(
    'SELECT * FROM ad_creative_batches WHERE id = $1', [batchId]);
  if (!batches.length) return null;
  const { rows: creatives } = await pool.query(
    'SELECT * FROM ad_creatives WHERE batch_id = $1 ORDER BY created_at, id', [batchId]);
  const ids = creatives.map(c => c.id);
  // aspect_ratio before id in the ordering, because a render of three sizes
  // inserts three rows in one statement and they therefore share a
  // created_at to the microsecond. Falling straight through to the uuid made
  // the row order random, so exporting the same batch twice produced two
  // different spreadsheets. Sorting on something a person recognises makes
  // the sheet reproducible and groups a concept's sizes predictably.
  const { rows: images } = ids.length
    ? await pool.query(
        `SELECT * FROM ad_creative_images WHERE creative_id = ANY($1::uuid[])
          ORDER BY created_at, aspect_ratio, id`, [ids])
    : { rows: [] };
  const byCreative = new Map(ids.map(id => [id, []]));
  for (const img of images) byCreative.get(img.creative_id)?.push(img);
  return { batch: batches[0], creatives, byCreative };
}

// Build the zip. Returns { buffer, filename, counts } so the route can put
// the counts in headers and the UI can say what it got without unzipping.
async function exportBatch(batchId) {
  const loaded = await loadBatch(batchId);
  if (!loaded) return null;
  const { batch, creatives, byCreative } = loaded;

  const JSZip = require('jszip');
  const zip = new JSZip();
  const csvRows = [];
  const missing = [];
  const used = new Set();
  let assetCount = 0;

  for (let i = 0; i < creatives.length; i++) {
    const c = creatives[i];
    const ref = String(i + 1).padStart(2, '0');
    const stem = `${ref}-${slug(c.headline, 'concept')}`;
    const assets = byCreative.get(c.id) || [];

    // A concept with nothing rendered still gets its row. Copy written and
    // never rendered is the normal state of half a batch, and leaving it out
    // of the sheet would quietly lose work.
    if (!assets.length) {
      csvRows.push([ref, c.framework, c.angle, c.headline, c.body, c.cta,
        c.visual_concept, c.notes, c.show_to_client === false ? 'no' : 'yes',
        '', '', '', '(nothing rendered)']);
      continue;
    }

    for (const a of assets) {
      const aspect = (a.aspect_ratio || 'custom').replace(/:/g, 'x');
      let name = `creative/${stem}-${aspect}${extFor(a.url, a.media_type)}`;
      let n = 2;
      while (used.has(name)) {
        name = `creative/${stem}-${aspect}-${n}${extFor(a.url, a.media_type)}`;
        n++;
      }
      used.add(name);

      let stored = '';
      try {
        zip.file(name, await readAsset(a.url));
        stored = name.replace('creative/', '');
        assetCount++;
      } catch (err) {
        missing.push(`${name.replace('creative/', '')} — ${err.message}`);
        stored = `(missing: ${err.message})`;
      }

      csvRows.push([ref, c.framework, c.angle, c.headline, c.body, c.cta,
        c.visual_concept, c.notes, c.show_to_client === false ? 'no' : 'yes',
        a.aspect_ratio, a.media_type || 'image', a.provider, stored]);
    }
  }

  zip.file('copy.csv', toCsv(CSV_HEADERS, csvRows));

  if (missing.length) {
    zip.file('MISSING.txt', [
      `${missing.length} asset${missing.length === 1 ? '' : 's'} could not be included.`,
      '',
      'Generated images are stored as links to the provider that made them',
      '(Ideogram, Replicate, Adobe) rather than copied onto the platform, and',
      'those links expire. Re-render anything listed here from the Render step.',
      '',
      ...missing,
    ].join('\n'));
  }

  const stamp = new Date(batch.created_at).toISOString().slice(0, 10);
  return {
    buffer: await zip.generateAsync({ type: 'nodebuffer' }),
    filename: `ads-${slug(batch.platform, 'batch')}-${stamp}.zip`,
    counts: { concepts: creatives.length, assets: assetCount, missing: missing.length },
  };
}

module.exports = { exportBatch, csvCell, toCsv, slug, extFor, diskPathFor, CSV_HEADERS };
