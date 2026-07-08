// Snapshot Studio — orchestration for the lead-gen "Growth Snapshot".
//   gather(url)  → fetch the prospect's site (SSRF-guarded), pull copy + images,
//                  and have Claude draft a personalised 6-part snapshot.
//   refine()     → chat-edit the draft with Claude.
// Rendering lives in snapshotReport.js; PDF in pdfService.

const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
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
async function fetchSite(parsed, timeout = 15000) {
  const res = await axios.get(parsed.toString(), {
    headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
    timeout,
    maxContentLength: 4 * 1024 * 1024,
    maxRedirects: 4,
    responseType: 'text',
    validateStatus: s => s >= 200 && s < 400,
  });
  return typeof res.data === 'string' ? res.data : String(res.data || '');
}

// Same-host internal links worth reading, ranked so the pages that reveal the
// most (about / work / services / etc.) come first. Same-host only, which keeps
// the crawl inside the host we already SSRF-checked and off other domains.
function internalLinks(html, parsed) {
  const $ = cheerio.load(html);
  const host = parsed.hostname.replace(/^www\./, '');
  const priority = /about|work|portfolio|project|case|stud|service|solution|what-we|clients?|team|people|news|blog|press|shop|product|menu|contact/i;
  const seen = new Set();
  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!href || href.startsWith('#') || /^(mailto:|tel:|javascript:)/i.test(href)) return;
    let u;
    try { u = new URL(href, parsed); } catch { return; }
    if (!/^https?:$/.test(u.protocol)) return;
    if (u.hostname.replace(/^www\./, '') !== host) return;
    if (/\.(pdf|jpe?g|png|gif|svg|webp|zip|mp4|mov|dmg|docx?|xlsx?|csv)$/i.test(u.pathname)) return;
    u.hash = '';
    const key = u.pathname.replace(/\/$/, '') + u.search;
    if (!key || key === '/' || seen.has(key)) return;
    seen.add(key);
    links.push({ url: u.toString(), path: u.pathname, score: priority.test(u.pathname) ? 1 : 0 });
  });
  links.sort((a, b) => b.score - a.score);
  return links;
}

// Read the homepage plus a handful of the most informative internal pages, so
// the draft is based on the whole site rather than hallucinating from one page.
async function crawlSite(parsed, { maxPages = 5 } = {}) {
  const homeHtml = await fetchSite(parsed);
  const home = parseSite(homeHtml, parsed);
  const links = internalLinks(homeHtml, parsed).slice(0, maxPages);

  const pages = [{ url: parsed.toString(), text: home.text }];
  const images = [...home.images];

  const results = await Promise.allSettled(links.map(async (l) => {
    const lp = normaliseUrl(l.url);              // same host — already public-asserted
    const html = await fetchSite(lp, 10000);
    return { url: lp.toString(), ...parseSite(html, lp) };
  }));
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const p = r.value;
    if (p.text && p.text.length > 60) pages.push({ url: p.url, text: p.text });
    for (const img of p.images) if (!images.includes(img)) images.push(img);
  }

  // One labelled block per page, within a total budget so the prompt stays lean.
  const PER = 3000, TOTAL = 14000;
  let budget = TOTAL;
  const parts = [];
  for (const p of pages) {
    if (budget <= 0) break;
    const slice = p.text.slice(0, Math.min(PER, budget));
    parts.push(`# Page: ${p.url}\n${slice}`);
    budget -= slice.length;
  }
  return {
    company: home.company,
    description: home.description,
    text: parts.join('\n\n'),
    images: images.slice(0, 16),
    pageCount: pages.length,
  };
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
- Cover the spread: search/AI visibility, paid, social, PR, brand, and trust. Group them into exactly 3 section panels.
- British English. Confident, warm, never salesy or hypey. No emojis.
- You're given text sampled from several of their pages (each marked with its URL). Base every observation on what's actually in that text, framed as observations ("looks like", "we'd check") — never fabricated metrics you can't know. Crucially, do NOT claim the site is "one page", or that it "has no case studies / blog / portfolio / services page / etc." just because it isn't in this sample — you have not necessarily seen every page. If something seems missing, say at most "we couldn't see X on the pages we looked at", or better, lead with a positive opportunity instead of asserting an absence.

The trust/messenger lens is the sharpest edge, so give it real weight. Trust has gone local and personal (Edelman 2026 Trust Barometer): people now trust peers, employees, founders/CEOs and trusted niche creators far more than institutions, faceless brands, or ads. Assess who currently carries THIS brand's message, and whether they're leaning on their most-trusted voices — visible founder/leadership presence, employee advocacy, customer & community proof, partnerships with trusted creators — or hiding behind an anonymous brand. Make it a visible thread: it drives the "trust" score, should surface in at least one summary line, and ideally shapes one section idea.

Return ONLY a JSON object, no prose, no code fences, matching exactly:
{
  "company_name": string,
  "scores": { "search": string, "ai": string, "social": string, "pr": string, "trust": string },
  "score_notes": { "search": string, "ai": string, "social": string, "pr": string, "trust": string },
  "headline_opportunity": string,
  "summary": [ { "service": string, "text": string } ],   // exactly 5, one per discipline (include the trust/messenger angle)
  "sections": [ { "title": string, "service": string, "finding": string, "idea": string, "opportunity": string } ]  // exactly 3
}
Scores are short human labels — a number or 1-2 words, max ~12 characters (e.g. "62/100", "Thin", "Low", "Active", "Founder-led"), not invented precise numbers. The "trust" score reads on how well they use trusted human voices. score_notes are TERSE captions of at most 6 words (e.g. "thin indexable content", "not named in AI answers", "founder voice under-used") — NOT sentences; the real detail belongs in summary and sections. Keep summary and section text fields to 1-2 sentences. You may use **bold** for emphasis.`;

function parseJson(str) {
  let s = String(str || '').trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

async function draftReport({ company, url, description, text, pageCount = 1 }) {
  const user = `Prospect: ${company}\nWebsite: ${url}\nMeta description: ${description || '(none)'}\nPages read: ${pageCount}\n\nContent gathered from ${pageCount} page(s) of the site, each marked with its URL (text truncated per page):\n"""\n${text}\n"""\n\nWrite the Growth Snapshot JSON for ${company}. Remember: don't assert that pages or content are missing just because they're not in this sample.`;
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
  const site = await crawlSite(parsed);

  const draft = await draftReport({
    company: site.company, url: parsed.toString(),
    description: site.description, text: site.text, pageCount: site.pageCount,
  });

  // Refresh the site-sourced images (leave uploads/screenshots untouched).
  await pool.query(`DELETE FROM snapshot_lead_images WHERE lead_id = $1 AND kind = 'site'`, [id]);
  for (const imgUrl of site.images) {
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

// ─── Public front door (embed on octobercomms.com) ──────────────────────────
// Unauthenticated visitors submit their URL (+ optional Instagram handle) and
// get a value-first "taste"; entering an email unlocks the full sections. All
// abuse control lives here + in the route: dedup (same URL reuses the draft,
// no repeat Claude spend), a daily cap, and the existing SSRF guard.
const PUBLIC_DEDUP_DAYS = 7;
const PUBLIC_DAILY_CAP = parseInt(process.env.SNAPSHOT_PUBLIC_DAILY_CAP || '200', 10);

async function publicCountToday() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM snapshot_leads WHERE source = 'public' AND created_at > NOW() - INTERVAL '1 day'`
  );
  return rows[0]?.n || 0;
}

// A recent public lead for the same URL that already has a draft — so a repeat
// submit (or a bot hammering one URL) reuses the draft instead of re-spending.
async function findRecentPublicDraft(url) {
  const { rows } = await pool.query(
    `SELECT id FROM snapshot_leads
       WHERE source = 'public' AND url = $1 AND draft IS NOT NULL
         AND created_at > NOW() - INTERVAL '${PUBLIC_DEDUP_DAYS} days'
       ORDER BY created_at DESC LIMIT 1`,
    [url]
  );
  return rows[0] || null;
}

// Create a public lead + draft its snapshot. Returns { lead, reused }.
async function createPublicSnapshot({ url, igHandle = null, ip = null }) {
  const parsed = normaliseUrl(url);
  const canonical = parsed.toString();

  const existing = await findRecentPublicDraft(canonical);
  if (existing) {
    if (igHandle) await pool.query('UPDATE snapshot_leads SET ig_handle = COALESCE(ig_handle, $1) WHERE id = $2', [igHandle, existing.id]);
    return { lead: await getLead(existing.id), reused: true };
  }

  if (await publicCountToday() >= PUBLIC_DAILY_CAP) {
    const e = new Error('The Growth Snapshot is at capacity for today — please try again tomorrow, or drop us your email and we\'ll run it for you.');
    e.code = 'CAP';
    throw e;
  }

  await assertPublicHost(parsed);
  const token = crypto.randomUUID();
  const { rows } = await pool.query(
    `INSERT INTO snapshot_leads (url, ig_handle, source, status, public_token, public_ip)
       VALUES ($1, $2, 'public', 'new', $3, $4) RETURNING id`,
    [canonical, igHandle || null, token, ip || null]
  );
  const lead = await gather(rows[0].id);   // fetch + draft + store site images
  return { lead, reused: false };
}

async function getByPublicToken(token) {
  if (!token) return null;
  const { rows } = await pool.query('SELECT id FROM snapshot_leads WHERE public_token = $1', [token]);
  if (!rows.length) return null;
  return getLead(rows[0].id);
}

async function attachPublicEmail(token, email) {
  const lead = await getByPublicToken(token);
  if (!lead) throw new Error('Snapshot not found');
  await pool.query(
    `UPDATE snapshot_leads
       SET email = COALESCE(email, $1), email_requested_at = COALESCE(email_requested_at, NOW())
       WHERE id = $2`,
    [email, lead.id]
  );
  return getByPublicToken(token);
}

module.exports = {
  createLead, listLeads, getLead, gather, refine, updateLead, deleteLead,
  addImage, setImageFeatured, deleteImage,
  createPublicSnapshot, getByPublicToken, attachPublicEmail,
  normaliseUrl, parseSite, // exported for tests
};
