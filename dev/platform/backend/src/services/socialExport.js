// Shared → Schedule. Everything needed to post a batch by hand.
//
// The 31 Oct review asked: "the autopilot is something I've never used. How
// does it work? Do we just remove all of that, and allow me to download the
// assets and schedule? like we did for Paid?"
//
// This is the download. The autopilot's own fate is a separate decision, and
// this is deliberately built first: an export takes nothing away, so Shared
// gains a way to work by hand whether or not the automatic publisher stays.
//
// Shaped exactly like Paid's adExport, and reusing its CSV writer, slug,
// extension resolver and asset reader rather than growing a second set. The
// two exports answer the same question about different records, and the one
// place they must not disagree is "where did this asset go".
//
// One difference worth stating. A social post's media lives in image_urls,
// which for an older row can still be a provider link; readAsset prefers the
// copy on this box and falls back to the link, and anything it cannot get is
// listed in MISSING.txt rather than quietly left out. A short zip that says
// nothing is worse than a short zip, because the batch gets scheduled with a
// gap nobody noticed.

const pool = require('../db');
const { toCsv, slug, extFor, readAsset } = require('./adExport');

const CSV_HEADERS = [
  'Ref', 'Platform', 'Kind', 'Framework', 'Hook', 'Caption', 'Hashtags',
  'Visual concept', 'Notes', 'Status', 'Scheduled', 'Published URL', 'Files',
];

// The posts of one batch, in the order the Review grid showed them, which is
// the order they were approved in and therefore the order to post them in.
async function loadBatch(batchId) {
  const batch = (await pool.query(
    `SELECT b.*, c.name AS client_name
       FROM social_batches b JOIN clients c ON c.id = b.client_id
      WHERE b.id = $1`, [batchId])).rows[0];
  if (!batch) return null;
  const posts = (await pool.query(
    `SELECT * FROM social_posts WHERE batch_id = $1 ORDER BY position ASC, created_at ASC`,
    [batchId])).rows;
  return { batch, posts };
}

/**
 * Build the zip.
 *
 * `only` is an optional set of post ids: the review step lets the account
 * lead untick posts, and exporting the whole batch when they ticked four of
 * nine would ignore the one decision they made on that screen.
 *
 * Returns { buffer, filename, counts } so the route can report what came back
 * in headers and the page can say so without anyone unzipping anything.
 */
async function exportBatch(batchId, { only = null } = {}) {
  const loaded = await loadBatch(batchId);
  if (!loaded) return null;
  const { batch } = loaded;
  const posts = only ? loaded.posts.filter(p => only.has(p.id)) : loaded.posts;

  const JSZip = require('jszip');
  const zip = new JSZip();
  const rows = [];
  const missing = [];
  const used = new Set();
  let assetCount = 0;

  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const ref = String(i + 1).padStart(2, '0');
    const stem = `${ref}-${slug(p.hook || p.caption, p.platform || 'post')}`;
    const urls = Array.isArray(p.image_urls) ? p.image_urls.filter(Boolean) : [];
    const hashtags = Array.isArray(p.hashtags) ? p.hashtags.join(' ') : '';
    const scheduled = p.scheduled_at ? new Date(p.scheduled_at).toISOString() : '';

    const base = [ref, p.platform, p.kind, p.framework || '', p.hook || '',
      p.caption || '', hashtags, p.visual_concept || '', p.notes || '',
      p.status, scheduled, p.published_url || ''];

    // A post with a caption and no image still gets its row. Copy written and
    // never illustrated is the normal state of part of a batch, and leaving
    // it out of the sheet would lose the writing.
    if (!urls.length) {
      rows.push([...base, '(no media)']);
      continue;
    }

    const stored = [];
    for (let j = 0; j < urls.length; j++) {
      // A carousel is several files for one row, so the suffix is the slide
      // number rather than a uniqueness counter.
      const suffix = urls.length > 1 ? `-${String(j + 1).padStart(2, '0')}` : '';
      let name = `media/${stem}${suffix}${extFor(urls[j], p.kind === 'reel' ? 'video' : 'image')}`;
      let n = 2;
      while (used.has(name)) {
        name = `media/${stem}${suffix}-${n}${extFor(urls[j], p.kind === 'reel' ? 'video' : 'image')}`;
        n++;
      }
      used.add(name);
      try {
        zip.file(name, await readAsset(urls[j]));
        stored.push(name.replace('media/', ''));
        assetCount++;
      } catch (err) {
        missing.push(`${name.replace('media/', '')} — ${err.message}`);
        stored.push(`(missing: ${err.message})`);
      }
    }
    rows.push([...base, stored.join(' | ')]);
  }

  zip.file('posts.csv', toCsv(CSV_HEADERS, rows));

  if (missing.length) {
    zip.file('MISSING.txt', [
      `${missing.length} file${missing.length === 1 ? '' : 's'} could not be included.`,
      '',
      'A post made before generated media was kept on the platform points at',
      'the provider that made it, and those links expire. Re-render anything',
      'listed here from the Workbench step, or upload it again.',
      '',
      ...missing,
    ].join('\n'));
  }

  const stamp = new Date(batch.created_at).toISOString().slice(0, 10);
  return {
    buffer: await zip.generateAsync({ type: 'nodebuffer' }),
    filename: `social-${slug(batch.client_name, 'batch')}-${stamp}.zip`,
    counts: { posts: posts.length, assets: assetCount, missing: missing.length },
  };
}

module.exports = { exportBatch, loadBatch, CSV_HEADERS };
