// Auto-publish content drafts to WordPress / Shopify, or fall back to
// clipboard / DOCX export for platforms we can't post to directly
// (Squarespace, custom CMSes). Pipeline → Publish step 4.
//
// SAFETY:
// - WordPress + Shopify pushes go through the same encrypted-credential
//   flow as data fetches — no new auth surface.
// - Every publish carries a `human approval gate`: this service only
//   runs when an AM explicitly clicks Publish (or schedules a publish
//   that the cron later runs). No silent auto-posting from a content
//   generator → that's the "scaled content abuse" Google penalises.
// - Drafts default to status='draft' on the destination unless the AM
//   ticks "Publish live". On WordPress that means it lands in the WP
//   admin → Drafts queue for the client to review themselves.

const axios = require('axios');
const pool = require('../db');
const { decrypt } = require('../utils/encryption');

// ── WordPress publish ────────────────────────────────────────────────────
// Reuses the WooCommerce connector's stored credentials (store_url +
// consumer_key/secret). WP REST API authenticates the same way for the
// /wp/v2 namespace as for /wc/v3.
async function publishToWordPress({ draft, connector, scheduledAt, statusOverride }) {
  const creds = decrypt(connector.credentials);
  if (!creds.store_url) throw new Error('WordPress credentials missing store_url');
  if (!creds.consumer_key || !creds.consumer_secret) {
    throw new Error('WordPress credentials missing consumer_key / consumer_secret');
  }
  const base = creds.store_url.replace(/\/$/, '') + '/wp-json/wp/v2';
  const body = {
    title: draft.title,
    content: draft.body_html,
    excerpt: draft.meta_description || undefined,
    status: scheduledAt ? 'future' : (statusOverride || 'draft'),
    ...(scheduledAt ? { date_gmt: new Date(scheduledAt).toISOString() } : {}),
  };
  const res = await axios.post(`${base}/posts`, body, {
    auth: { username: creds.consumer_key, password: creds.consumer_secret },
    timeout: 30000,
    validateStatus: () => true,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OctoberMarketingIntelligence/1.0)' },
  });
  if (res.status >= 400) {
    const msg = res.data?.message || `WordPress returned ${res.status}`;
    throw new Error(msg);
  }
  return {
    platform_post_id: String(res.data.id),
    external_url: res.data.link || null,
  };
}

// ── WordPress publish via the OMI plugin ───────────────────────────────────
// When the client runs the October MI WordPress plugin, publish through its
// dedicated draft route instead of the wp/v2 REST API. Server-initiated calls
// to the plugin route aren't WAF-challenged the way wp/v2 is, and the plugin
// authenticates with the pairing refresh_secret (not app passwords / WC keys).
// The plugin route deliberately only creates DRAFTS for the client to review —
// live/scheduled publishing must use a WooCommerce REST connector.
async function publishToWordPressViaPlugin({ draft, connector, scheduledAt, statusOverride }) {
  const creds = decrypt(connector.credentials);
  if (!creds.site_url || !creds.refresh_secret) {
    throw new Error('WordPress plugin connector not paired (missing site_url / refresh_secret).');
  }
  if (scheduledAt || (statusOverride && statusOverride !== 'draft')) {
    throw new Error('The WordPress plugin channel only creates drafts for the client to review. To publish live or schedule, use a WooCommerce REST connector.');
  }
  const url = creds.site_url.replace(/\/$/, '') + '/wp-json/october-mi/v1/draft';
  const res = await axios.post(
    url,
    {
      title: draft.title,
      content: draft.body_html,
      excerpt: draft.meta_description || undefined,
      type: 'post',
    },
    {
      headers: {
        Authorization: `Bearer ${creds.refresh_secret}`,
        'Content-Type': 'application/json',
        'User-Agent': 'OctoberMI-Platform/1.0',
      },
      timeout: 30000,
      validateStatus: () => true,
    }
  );
  if (res.status >= 400) {
    throw new Error(res.data?.message || `WordPress plugin returned ${res.status}`);
  }
  return {
    platform_post_id: res.data.post_id != null ? String(res.data.post_id) : null,
    external_url: res.data.edit_link || null,
  };
}

// ── Shopify publish ──────────────────────────────────────────────────────
// Shopify needs the blog ID — many stores have just one ("news"), so we
// auto-pick the first blog if config.blog_id isn't set. AM can override
// per-connector if there are multiple.
async function publishToShopify({ draft, connector, scheduledAt, statusOverride }) {
  const creds = decrypt(connector.credentials);
  if (!creds.shop_domain || !creds.access_token) {
    throw new Error('Shopify credentials missing shop_domain / access_token');
  }
  const headers = { 'X-Shopify-Access-Token': creds.access_token };
  let blogId = connector.config?.blog_id;
  if (!blogId) {
    const blogsRes = await axios.get(
      `https://${creds.shop_domain}/admin/api/2024-01/blogs.json`,
      { headers, timeout: 15000 }
    );
    blogId = blogsRes.data.blogs?.[0]?.id;
    if (!blogId) throw new Error('No Shopify blog found on store — create one in Shopify admin first');
  }
  // published=false → draft article (visible in Shopify admin only).
  // Shopify doesn't natively support "scheduled future publish" via API —
  // we keep the article as draft and our cron flips published=true at
  // the scheduled time.
  const body = {
    article: {
      title: draft.title,
      body_html: draft.body_html,
      summary_html: draft.meta_description || undefined,
      published: scheduledAt ? false : (statusOverride === 'publish'),
    },
  };
  const res = await axios.post(
    `https://${creds.shop_domain}/admin/api/2024-01/blogs/${blogId}/articles.json`,
    body, { headers, timeout: 30000, validateStatus: () => true }
  );
  if (res.status >= 400) {
    throw new Error(res.data?.errors ? JSON.stringify(res.data.errors) : `Shopify returned ${res.status}`);
  }
  const article = res.data.article;
  const external = creds.shop_domain.replace(/\.myshopify\.com$/, '');
  return {
    platform_post_id: String(article.id),
    external_url: article.handle ? `https://${creds.shop_domain}/blogs/news/${article.handle}` : null,
  };
}

// ── Squarespace / clipboard fallback ─────────────────────────────────────
// Squarespace's Content API is enterprise-gated. For everyone else (and
// for AMs who want to paste into Notion / Google Docs / Webflow) we just
// surface the markdown for copy. No external call — purely a record that
// the draft was exported.
function publishToClipboard({ draft }) {
  return {
    platform_post_id: null,
    external_url: null,
  };
}

// ── DOCX export ──────────────────────────────────────────────────────────
// Minimal DOCX writer — just enough to produce a valid Word document
// from a markdown body. We don't pull in a heavyweight library; we
// build the zip ourselves. (Caller writes the bytes to a download
// response.) Used by the route handler, not stored in the DB.
//
// Implementation kept here even though it returns bytes (not a publication
// record) so all publish destinations live in one file.
async function exportDraftAsDocx(draft) {
  const JSZip = (() => { try { return require('jszip'); } catch { return null; } })();
  if (!JSZip) {
    // Fall back to plain text masquerading as .doc — Word will open it.
    const text = `${draft.title}\n\n${draft.body_markdown}`;
    return { mime: 'text/plain', bytes: Buffer.from(text, 'utf8') };
  }
  // Real DOCX requires document.xml inside a specific zip layout. Build it.
  const escape = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paragraphs = (draft.body_markdown || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const body = paragraphs.map(p => {
    const isHeading = /^#{1,3}\s/.test(p);
    const text = escape(p.replace(/^#{1,3}\s/, ''));
    const style = isHeading ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : '';
    return `<w:p>${style}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  }).join('');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${escape(draft.title || '')}</w:t></w:r></w:p>
    ${body}
  </w:body>
</w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.folder('_rels').file('.rels', rels);
  zip.folder('word').file('document.xml', doc);
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  return {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    bytes,
  };
}

// ── Orchestrator ─────────────────────────────────────────────────────────
async function publish({ draftId, platform, connectorId, scheduledAt, statusOverride }) {
  const { rows: drafts } = await pool.query('SELECT * FROM content_drafts WHERE id = $1', [draftId]);
  if (!drafts.length) throw new Error('Draft not found');
  const draft = drafts[0];

  // Create the publication row immediately so a slow/failed publish
  // still has a record to read its status from.
  const initialStatus = scheduledAt ? 'scheduled' : 'publishing';
  const { rows: pubRows } = await pool.query(
    `INSERT INTO content_publications (draft_id, platform, status, scheduled_at)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [draftId, platform, initialStatus, scheduledAt || null]
  );
  const pub = pubRows[0];
  if (scheduledAt) return pub;     // cron will run this later

  // Look up the chosen connector for WP/Shopify, or no-op for clipboard.
  let result;
  try {
    if (platform === 'wordpress' || platform === 'shopify') {
      if (!connectorId) throw new Error('connectorId required for ' + platform);
      const { rows: cs } = await pool.query(
        `SELECT * FROM connectors WHERE id = $1 AND client_id = $2 AND status = 'active'`,
        [connectorId, draft.client_id]
      );
      if (!cs.length) throw new Error('Selected connector not found or inactive');
      const connector = cs[0];
      if (platform === 'wordpress') {
        result = connector.connector_type === 'wordpress_plugin'
          ? await publishToWordPressViaPlugin({ draft, connector, statusOverride })
          : await publishToWordPress({ draft, connector, statusOverride });
      } else {
        result = await publishToShopify({ draft, connector, statusOverride });
      }
    } else if (platform === 'clipboard') {
      result = publishToClipboard({ draft });
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }
    await pool.query(
      `UPDATE content_publications
       SET status = 'published', published_at = NOW(), platform_post_id = $1, external_url = $2, updated_at = NOW()
       WHERE id = $3`,
      [result.platform_post_id, result.external_url, pub.id]
    );
    await pool.query(`UPDATE content_drafts SET status = 'published', updated_at = NOW() WHERE id = $1`, [draftId]);
    return { ...pub, status: 'published', published_at: new Date(), ...result };
  } catch (err) {
    await pool.query(
      `UPDATE content_publications SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`,
      [err.message, pub.id]
    );
    throw err;
  }
}

module.exports = { publish, exportDraftAsDocx };
