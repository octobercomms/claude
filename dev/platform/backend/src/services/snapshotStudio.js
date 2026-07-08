// Snapshot Studio — orchestration for the lead-gen "Growth Snapshot".
//   gather(url)  → fetch the prospect's site (SSRF-guarded), pull copy + images,
//                  and have Claude draft a personalised 6-part snapshot.
//   refine()     → chat-edit the draft with Claude.
// Rendering lives in snapshotReport.js; PDF in pdfService.

const axios = require('axios');
const cheerio = require('cheerio');
const dns = require('dns').promises;
const net = require('net');
const pool = require('../db');
const claude = require('./claude');

const UA = 'Mozilla/5.0 (compatible; OctoberGrowthSnapshot/1.0; +https://octobercomms.com)';

// ─── URL safety (SSRF guard) ────────────────────────────────────────────
// The URL comes from an untrusted submitter, and we fetch it server-side, so
// block anything that isn't a public http(s) host (no localhost, no private
// ranges, no cloud metadata IP).
function isPrivateIp(ip) {
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  const l = ip.toLowerCase();
  return l === '::1' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l === '::';
}

function normaliseUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) throw new Error('URL required');
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(u);
  if (!hasScheme) {
    // A bare scheme like "javascript:" or "ftp:" (no //) must be rejected, not
    // prefixed. Anything else is treated as a scheme-less domain.
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) throw new Error('Only http(s) URLs are allowed');
    u = 'https://' + u;
  }
  const parsed = new URL(u);
  if (!/^https?:$/.test(parsed.protocol)) throw new Error('Only http(s) URLs are allowed');
  return parsed;
}

async function assertPublicHost(parsed) {
  let addrs = [];
  try { addrs = await dns.lookup(parsed.hostname, { all: true }); }
  catch { throw new Error(`Could not resolve ${parsed.hostname}`); }
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) {
    throw new Error('That host is not publicly reachable');
  }
}

// ─── Fetch + parse ──────────────────────────────────────────────────────
async function fetchSite(parsed) {
  const res = await axios.get(parsed.toString(), {
    headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
    timeout: 15000,
    maxContentLength: 4 * 1024 * 1024,
    maxRedirects: 4,
    responseType: 'text',
    validateStatus: s => s >= 200 && s < 400,
  });
  return typeof res.data === 'string' ? res.data : String(res.data || '');
}

function parseSite(html, parsed) {
  const $ = cheerio.load(html);
  const meta = (sel) => $(sel).attr('content') || '';
  const rawTitle = ($('title').first().text() || '').trim();
  const company = (meta('meta[property="og:site_name"]') ||
    rawTitle.split(/[|–—\-]/)[0] || parsed.hostname.replace(/^www\./, '')).trim().slice(0, 120);

  $('script,style,noscript,svg').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 6000);

  const seen = new Set();
  const images = [];
  const add = (src) => {
    if (!src || src.startsWith('data:')) return;
    let abs;
    try { abs = new URL(src, parsed).toString(); } catch { return; }
    if (!/^https?:/.test(abs) || seen.has(abs)) return;
    if (/\.(svg|gif)(\?|$)/i.test(abs)) return;
    seen.add(abs); images.push(abs);
  };
  add(meta('meta[property="og:image"]'));
  $('img').each((_, el) => add($(el).attr('src') || $(el).attr('data-src')));

  return {
    company,
    description: meta('meta[name="description"]') || meta('meta[property="og:description"]') || '',
    text,
    images: images.slice(0, 16),
  };
}

// ─── Claude draft ───────────────────────────────────────────────────────
const SYSTEM = `You are a strategist at October, a full-service marketing & PR agency (strong in architecture, design and consumer brands). You produce a personalised "Growth Snapshot" for a PROSPECT from their website — a taste of every way October could help, designed to earn a call.

Rules:
- Be specific and concrete about THIS business — reference what they actually do. Generic advice is worthless here.
- Mix credibility (a plausible finding) with imagination (a genuinely creative idea we'd run). The ideas are the selling point.
- Cover the spread: search/AI visibility, paid, social, PR, brand. Group them into exactly 3 section panels.
- British English. Confident, warm, never salesy or hypey. No emojis.
- You only have their public site text, so frame findings as observations ("looks like", "we'd check"), never fabricated metrics you can't know.

Return ONLY a JSON object, no prose, no code fences, matching exactly:
{
  "company_name": string,
  "scores": { "search": string, "ai": string, "social": string, "pr": string },
  "score_notes": { "search": string, "ai": string, "social": string, "pr": string },
  "headline_opportunity": string,
  "summary": [ { "service": string, "text": string } ],   // exactly 5, one per discipline
  "sections": [ { "title": string, "service": string, "finding": string, "idea": string, "opportunity": string } ]  // exactly 3
}
Scores are short human labels (e.g. "62/100", "2/10", "Thin", "Low"), not invented precise numbers. Keep each text field to 1-2 sentences. You may use **bold** for emphasis.`;

function parseJson(str) {
  let s = String(str || '').trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

async function draftReport({ company, url, description, text }) {
  const user = `Prospect: ${company}\nWebsite: ${url}\nMeta description: ${description || '(none)'}\n\nHomepage/site text (truncated):\n"""\n${text}\n"""\n\nWrite the Growth Snapshot JSON for ${company}.`;
  const raw = await claude.callClaude({ max_tokens: 2200, system: SYSTEM, user, feature: 'snapshot_draft' });
  const draft = parseJson(raw);
  draft.company_name = draft.company_name || company;
  return draft;
}

async function refineDraft(current, message) {
  const user = `Here is the current Growth Snapshot draft as JSON:\n${JSON.stringify(current)}\n\nThe account manager says: "${message}"\n\nReturn the FULL updated JSON in the same schema — apply their change, keep everything else intact.`;
  const raw = await claude.callClaude({ max_tokens: 2200, system: SYSTEM, user, feature: 'snapshot_refine' });
  return parseJson(raw);
}

// ─── DB ─────────────────────────────────────────────────────────────────
async function createLead({ url, source = 'manual', email = null }) {
  const parsed = normaliseUrl(url);
  const { rows } = await pool.query(
    `INSERT INTO snapshot_leads (url, email, source, status) VALUES ($1, $2, $3, 'new') RETURNING *`,
    [parsed.toString(), email, source]
  );
  return rows[0];
}

async function listLeads() {
  const { rows } = await pool.query(
    `SELECT l.*, (SELECT COUNT(*)::int FROM snapshot_lead_images i WHERE i.lead_id = l.id) AS image_count
       FROM snapshot_leads l ORDER BY l.created_at DESC LIMIT 200`
  );
  return rows;
}

async function getLead(id) {
  const { rows } = await pool.query('SELECT * FROM snapshot_leads WHERE id = $1', [id]);
  if (!rows.length) return null;
  const { rows: images } = await pool.query('SELECT * FROM snapshot_lead_images WHERE lead_id = $1 ORDER BY created_at ASC', [id]);
  return { ...rows[0], images };
}

// Fetch the site, store its images, draft the report, mark drafted.
async function gather(id) {
  const lead = await getLead(id);
  if (!lead) throw new Error('Lead not found');
  const parsed = normaliseUrl(lead.url);
  await assertPublicHost(parsed);
  const html = await fetchSite(parsed);
  const parsedSite = parseSite(html, parsed);

  const draft = await draftReport({
    company: parsedSite.company, url: parsed.toString(),
    description: parsedSite.description, text: parsedSite.text,
  });

  // Refresh the site-sourced images (leave uploads/screenshots untouched).
  await pool.query(`DELETE FROM snapshot_lead_images WHERE lead_id = $1 AND kind = 'site'`, [id]);
  for (const imgUrl of parsedSite.images) {
    await pool.query(`INSERT INTO snapshot_lead_images (lead_id, url, kind) VALUES ($1, $2, 'site')`, [id, imgUrl]);
  }
  const { rows } = await pool.query(
    `UPDATE snapshot_leads SET company_name = $1, scores = $2, draft = $3, status = 'drafted'
       WHERE id = $4 RETURNING *`,
    [draft.company_name, JSON.stringify(draft.scores || {}), JSON.stringify(draft), id]
  );
  return getLead(rows[0].id);
}

async function refine(id, message) {
  const lead = await getLead(id);
  if (!lead) throw new Error('Lead not found');
  if (!lead.draft) throw new Error('Nothing to refine yet — gather the site first.');
  const updated = await refineDraft(lead.draft, message);
  await pool.query(
    `UPDATE snapshot_leads SET draft = $1, scores = $2 WHERE id = $3`,
    [JSON.stringify(updated), JSON.stringify(updated.scores || lead.scores || {}), id]
  );
  return getLead(id);
}

async function updateLead(id, fields) {
  const allowed = ['company_name', 'email', 'ig_handle', 'notes', 'status'];
  const sets = [], vals = [];
  for (const k of allowed) {
    if (k in fields) { vals.push(fields[k]); sets.push(`${k} = $${vals.length}`); }
  }
  if ('email' in fields && fields.email) { vals.push(new Date()); sets.push(`email_requested_at = COALESCE(email_requested_at, $${vals.length})`); }
  if (fields.status === 'sent') { vals.push(new Date()); sets.push(`sent_at = COALESCE(sent_at, $${vals.length})`); }
  if (!sets.length) return getLead(id);
  vals.push(id);
  await pool.query(`UPDATE snapshot_leads SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
  return getLead(id);
}

async function deleteLead(id) {
  await pool.query('DELETE FROM snapshot_leads WHERE id = $1', [id]);
}

async function addImage(id, { url, kind = 'upload', filename = null }) {
  const { rows } = await pool.query(
    `INSERT INTO snapshot_lead_images (lead_id, url, kind, filename) VALUES ($1, $2, $3, $4) RETURNING *`,
    [id, url, kind, filename]
  );
  return rows[0];
}

async function setImageFeatured(imageId, featured) {
  const { rows } = await pool.query(
    `UPDATE snapshot_lead_images SET featured = $1 WHERE id = $2 RETURNING *`, [!!featured, imageId]
  );
  return rows[0];
}

async function deleteImage(imageId) {
  const { rows } = await pool.query('DELETE FROM snapshot_lead_images WHERE id = $1 RETURNING lead_id, filename', [imageId]);
  return rows[0] || null;
}

module.exports = {
  createLead, listLeads, getLead, gather, refine, updateLead, deleteLead,
  addImage, setImageFeatured, deleteImage,
  normaliseUrl, parseSite, // exported for tests
};
