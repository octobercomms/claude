/**
 * PR module service — CSV import, outlet/contact resolution, relationship
 * analytics and outlet deduplication, native to the platform (Postgres).
 */
const db = require('../db');
const crypto = require('crypto');
let claude;
try { claude = require('./claude'); } catch (e) { claude = null; }

// Statuses shown on a client's public coverage portal — Published + the
// positive pipeline only. Internal notes/declines are never exposed.
const CLIENT_VISIBLE_STATUS = {
  published: 'Published', download: 'Published', confirmed: 'Confirmed',
  interview_prep: 'In progress', pitched: 'Pitched',
};

const STATUS_LABELS = {
  pitched: 'Pitched', pending: 'Pending', no_response: 'No Response',
  confirmed: 'Confirmed', interview_prep: 'Interview Prep', download: 'Download',
  published: 'Published', declined: 'Declined', new: 'New', dismissed: 'Dismissed',
};
const STATUS_FROM_CSV = {
  pitched: 'pitched', pending: 'pending', noresponse: 'no_response', confirmed: 'confirmed',
  interviewprep: 'interview_prep', download: 'download', published: 'published', declined: 'declined',
};
const PUBLISHED = ['published', 'download'];

function statusLabel(s) { return STATUS_LABELS[s] || s; }

/** Relationship strength 0–100 from published volume + recency. */
function relationshipStrength(published, lastFeaturedTs, now = Date.now()) {
  published = Math.max(0, parseInt(published, 10) || 0);
  let score = Math.min(70, published * 10);
  if (published > 0 && lastFeaturedTs) {
    const months = (now - lastFeaturedTs) / (30 * 86400000);
    if (months <= 6) score += 30;
    else if (months <= 12) score += 18;
    else if (months <= 24) score += 8;
  }
  score = Math.min(100, Math.round(score));
  const label = score >= 80 ? 'Strong' : score >= 50 ? 'Good' : score >= 20 ? 'Warm' : score > 0 ? 'Cool' : 'New';
  return { score, label };
}

function hitRate(published, pitched, declined) {
  const denom = (+published || 0) + (+pitched || 0) + (+declined || 0);
  return denom > 0 ? (+published || 0) / denom : null;
}

function isGoneQuiet(published, lastFeaturedTs, now = Date.now()) {
  if (!published || !lastFeaturedTs) return false;
  return (now - lastFeaturedTs) > 12 * 30 * 86400000;
}

// ── CSV parsing (handles quoted fields, embedded commas/newlines, "" escapes) ──
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  text = text.replace(/^﻿/, ''); // strip BOM
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Notion exports relations as "Label (https://…)". Return the label or the URL. */
function stripNotionRef(value, wantUrl = false) {
  value = String(value || '').trim();
  if (!value) return '';
  const m = /^(.*?)\s*\((https?:\/\/[^)]+)\)\s*$/.exec(value);
  if (m) return wantUrl ? m[2].trim() : m[1].trim();
  if (wantUrl) return /^https?:\/\//.test(value) ? value : '';
  return value;
}

function parseDate(value) {
  value = String(value || '').trim();
  if (!value) return null;
  const t = new Date(value);
  return isNaN(t) ? null : t.toISOString().slice(0, 10);
}

async function resolveOutlet(name) {
  name = String(name || '').trim();
  if (!name) return null;
  const found = await db.query('SELECT id FROM pr_outlets WHERE lower(name) = lower($1) LIMIT 1', [name]);
  if (found.rows.length) return found.rows[0].id;
  const status = /do not use/i.test(name) ? 'do_not_use' : 'active';
  const ins = await db.query(
    'INSERT INTO pr_outlets (name, canonical_name, status) VALUES ($1, $1, $2) RETURNING id',
    [name, status]
  );
  return ins.rows[0].id;
}

async function resolveContact(name, outletId) {
  name = String(name || '').trim();
  if (!name) return null;
  const sp = name.split(/\s+/);
  const first = sp[0] || '';
  const last = sp.slice(1).join(' ');
  const found = await db.query(
    `SELECT id FROM outreach_contacts
     WHERE lower(first_name) = lower($1) AND lower(last_name) = lower($2)
       AND kind IN ('media','industry') LIMIT 1`,
    [first, last]
  );
  if (found.rows.length) return found.rows[0].id;
  const ins = await db.query(
    `INSERT INTO outreach_contacts (first_name, last_name, name, outlet_id, kind)
     VALUES ($1, $2, $3, $4, 'media') RETURNING id`,
    [first, last, name, outletId || null]
  );
  return ins.rows[0].id;
}

/**
 * Import an editorial-log CSV for a client. Columns (Notion export):
 * Story Title, Client, Country, Interview Date, Issue Date, Link to story,
 * Notes / Outcome, Pitch / Request, Press Contact, Publication name,
 * Request Date, Status.
 */
async function importEditorialCsv(clientId, csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) return { imported: 0 };
  const headers = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const col = (key) => { const i = headers.indexOf(key); return i === -1 ? null : i; };
  const idx = {
    title: col('storytitle'), country: col('country'), interview: col('interviewdate'),
    issue: col('issuedate'), link: col('linktostory'), notes: col('notesoutcome'),
    pitch: col('pitchrequest'), contact: col('presscontact'), publication: col('publicationname'),
    request: col('requestdate'), status: col('status'),
  };
  const get = (r, k) => (idx[k] === null || idx[k] == null ? '' : String(r[idx[k]] || '').trim());

  let imported = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const title = stripNotionRef(get(r, 'title'));
    const publication = stripNotionRef(get(r, 'publication'));
    const contact = stripNotionRef(get(r, 'contact'));
    if (!title && !publication && !contact) continue;

    const outletId = publication ? await resolveOutlet(publication) : null;
    const contactId = contact ? await resolveContact(contact, outletId) : null;
    const statusKey = get(r, 'status').toLowerCase().replace(/[^a-z]/g, '');
    const status = STATUS_FROM_CSV[statusKey] || 'pitched';

    await db.query(
      `INSERT INTO pr_editorial_log
         (client_id, story_title, contact_id, outlet_id, country, status, pitch_request,
          request_date, interview_date, issue_date, story_url, notes_outcome, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'csv-import')`,
      [
        clientId, title, contactId, outletId, get(r, 'country'), status, get(r, 'pitch'),
        parseDate(get(r, 'request')), parseDate(get(r, 'interview')), parseDate(get(r, 'issue')),
        stripNotionRef(get(r, 'link'), true) || get(r, 'link'), get(r, 'notes'),
      ]
    );
    imported++;
  }
  return { imported };
}

/**
 * Import a combined editorial-log CSV that spans many clients — routes each row
 * to the matching platform client by the CSV's "Client" column (case-insensitive
 * name match against the clients table). Rows whose client can't be matched are
 * skipped and reported (never auto-create clients). Returns
 * { imported, skipped, unmatched: [names] }.
 */
async function importEditorialCsvAllClients(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return { imported: 0, skipped: 0, unmatched: [] };
  const headers = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const col = (key) => { const i = headers.indexOf(key); return i === -1 ? null : i; };
  const idx = {
    title: col('storytitle'), client: col('client'), country: col('country'),
    interview: col('interviewdate'), issue: col('issuedate'), link: col('linktostory'),
    notes: col('notesoutcome'), pitch: col('pitchrequest'), contact: col('presscontact'),
    publication: col('publicationname'), request: col('requestdate'), status: col('status'),
  };
  const get = (r, k) => (idx[k] === null || idx[k] == null ? '' : String(r[idx[k]] || '').trim());

  // client name (lowercased) -> id
  const { rows: clients } = await db.query('SELECT id, name FROM clients');
  const clientMap = new Map(clients.map((c) => [String(c.name || '').trim().toLowerCase(), c.id]));

  let imported = 0, skipped = 0;
  const unmatched = new Set();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const clientName = stripNotionRef(get(r, 'client'));
    const title = stripNotionRef(get(r, 'title'));
    const publication = stripNotionRef(get(r, 'publication'));
    const contact = stripNotionRef(get(r, 'contact'));
    if (!clientName && !title && !publication && !contact) continue;

    const clientId = clientName ? clientMap.get(clientName.toLowerCase()) : null;
    if (!clientId) { if (clientName) unmatched.add(clientName); skipped++; continue; }

    const outletId = publication ? await resolveOutlet(publication) : null;
    const contactId = contact ? await resolveContact(contact, outletId) : null;
    const statusKey = get(r, 'status').toLowerCase().replace(/[^a-z]/g, '');
    const status = STATUS_FROM_CSV[statusKey] || 'pitched';

    await db.query(
      `INSERT INTO pr_editorial_log
         (client_id, story_title, contact_id, outlet_id, country, status, pitch_request,
          request_date, interview_date, issue_date, story_url, notes_outcome, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'csv-import')`,
      [
        clientId, title, contactId, outletId, get(r, 'country'), status, get(r, 'pitch'),
        parseDate(get(r, 'request')), parseDate(get(r, 'interview')), parseDate(get(r, 'issue')),
        stripNotionRef(get(r, 'link'), true) || get(r, 'link'), get(r, 'notes'),
      ]
    );
    imported++;
  }
  return { imported, skipped, unmatched: [...unmatched] };
}

// ── Outlet deduplication ────────────────────────────────────────────────────
const TLDS = new Set(['com', 'co', 'uk', 'net', 'org', 'io', 'mx', 'de', 'fr', 'es', 'it', 'cn', 'ru', 'eu', 'us', 'au', 'nl', 'se', 'ch', 'at', 'be', 'ie', 'info', 'online', 'news', 'mag']);

function foldDiacritics(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }

/** Reduce a publication name to a canonical match key (lowercase alnum). */
function normaliseOutlet(name) {
  let s = String(name || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/\bdo not use\b/g, '').trim();
  s = foldDiacritics(s).replace(/&/g, ' and ');
  const looksUrl = /^(https?:\/\/|www\.)/.test(s) || /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/|$)/.test(s);
  if (looksUrl) {
    s = s.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[/?].*$/, '');
    return s.split(/[^a-z0-9]+/).filter(Boolean).filter((p) => !TLDS.has(p)).join('');
  }
  const parts = s.split(/[^a-z0-9]+/).filter(Boolean);
  if (parts[0] === 'the') parts.shift();
  return parts.join('');
}

function isDoNotUse(name) { return /do not use/i.test(String(name || '')); }

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function similar(a, b) {
  if (a === b) return 1;
  const len = Math.max(a.length, b.length);
  if (!len) return 0;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / len;
  if (len > 40) return 0;
  return 1 - levenshtein(a, b) / len;
}

/** Cluster duplicate outlets from [{id,name}]. Returns clusters (>=2 members). */
function buildOutletClusters(records, threshold = 0.86) {
  const byKey = new Map();
  for (const r of records) {
    const key = normaliseOutlet(r.name);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push({ ...r, _key: key });
  }
  const keys = [...byKey.keys()];
  const parent = new Map(keys.map((k) => [k, k]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { parent.set(find(a), find(b)); };

  const blocks = new Map();
  for (const k of keys) { const b = k[0] || ''; if (!blocks.has(b)) blocks.set(b, []); blocks.get(b).push(k); }
  for (const bucket of blocks.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        if (similar(bucket[i], bucket[j]) >= threshold) union(bucket[i], bucket[j]);
      }
    }
  }
  const groups = new Map();
  for (const k of keys) { const root = find(k); if (!groups.has(root)) groups.set(root, []); for (const rec of byKey.get(k)) groups.get(root).push(rec); }

  const clusters = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const distinct = new Set(members.map((m) => m._key)).size;
    clusters.push({
      method: distinct === 1 ? 'exact' : 'fuzzy',
      confidence: distinct === 1 ? 0.99 : 0.8,
      members: members.map((m) => ({ id: m.id, name: m.name })),
    });
  }
  return clusters;
}

/** Scan all live outlets for duplicate clusters. */
async function scanOutletDuplicates() {
  const { rows } = await db.query("SELECT id, name FROM pr_outlets WHERE status <> 'merged'");
  return buildOutletClusters(rows);
}

/** Ask Claude to confirm/split fuzzy clusters. Returns [{canonical, members[], confidence}] or null. */
async function adjudicateOutletClusters(clusters) {
  if (!claude || !claude.callClaude || !clusters.length) return null;
  const blocks = clusters.map((c, i) => `Group ${i + 1}: ${c.map((m) => m.name).join(' | ')}`).join('\n');
  const system = 'You clean a publications database. Decide which names are the SAME outlet. TREAT AS SAME: case/punctuation, URL vs name (Dezeen / Dezeen.com), trailing "DO NOT USE", typos. KEEP SEPARATE: regional editions (Elle Decor Spain vs Italia vs India) and distinct titles (Interior Design vs Interior Designer). Respond with a JSON array only.';
  const user = `Candidate groups:\n${blocks}\n\nReturn a JSON array of confirmed duplicate sets: [{"canonical":"Clean Name","members":["a","b"],"confidence":0.0-1.0}]. Only sets with 2+ genuinely-same members.`;
  try {
    const text = await claude.callClaude({ max_tokens: 2000, system, user });
    const m = text.match(/\[[\s\S]*\]/);
    return m ? JSON.parse(m[0]) : null;
  } catch (e) { return null; }
}

/** Merge member outlets into canonical: repoint FKs, fold aliases, tombstone members. */
async function mergeOutlets(canonicalId, memberIds) {
  memberIds = (memberIds || []).filter((mid) => mid && mid !== canonicalId);
  if (!canonicalId || !memberIds.length) return 0;
  const canon = await db.query('SELECT name, aliases FROM pr_outlets WHERE id = $1', [canonicalId]);
  if (!canon.rows.length) return 0;
  let aliases = canon.rows[0].aliases || [];
  if (!Array.isArray(aliases)) aliases = [];

  for (const mid of memberIds) {
    const m = await db.query('SELECT name, aliases FROM pr_outlets WHERE id = $1', [mid]);
    if (!m.rows.length) continue;
    await db.query('UPDATE pr_editorial_log SET outlet_id = $1 WHERE outlet_id = $2', [canonicalId, mid]);
    await db.query('UPDATE outreach_contacts SET outlet_id = $1 WHERE outlet_id = $2', [canonicalId, mid]);
    aliases.push(m.rows[0].name);
    if (Array.isArray(m.rows[0].aliases)) aliases = aliases.concat(m.rows[0].aliases);
    await db.query("UPDATE pr_outlets SET status = 'merged', merged_into = $1 WHERE id = $2", [canonicalId, mid]);
  }
  const clean = [...new Set(aliases.map((a) => String(a).trim()).filter((a) => a && a !== canon.rows[0].name))];
  await db.query('UPDATE pr_outlets SET aliases = $1 WHERE id = $2', [JSON.stringify(clean), canonicalId]);
  return memberIds.length;
}

// ── Profile AI helpers ───────────────────────────────────────────────────────
/** Suggest beat tags for a journalist from the stories they've covered. */
async function suggestBeats(name, titles) {
  if (!claude || !claude.callClaude) return [];
  const list = (titles || []).filter(Boolean).slice(0, 40).join('\n');
  if (!list) return [];
  const system = 'You categorise journalists by beat from the stories they cover. Respond with a JSON array of 3–8 short lowercase topic tags (e.g. "architecture","interiors","sustainability"). JSON array only.';
  try {
    const text = await claude.callClaude({ max_tokens: 300, system, user: `Journalist: ${name}\nStories:\n${list}\n\nReturn the beat tags as a JSON array.` });
    const m = text.match(/\[[\s\S]*\]/);
    const arr = m ? JSON.parse(m[0]) : [];
    return Array.isArray(arr) ? arr.map((t) => String(t).trim().toLowerCase()).filter(Boolean) : [];
  } catch (e) { return []; }
}

/** Write a 1–2 sentence "who they are" summary for a publication. */
async function writeOutletSummary(name, titles) {
  if (!claude || !claude.callClaude) return '';
  const list = (titles || []).filter(Boolean).slice(0, 40).join('\n');
  const system = 'You write a concise, factual 1–2 sentence description of a publication for an internal media database. British English, no marketing fluff, plain text only.';
  try {
    return (await claude.callClaude({ max_tokens: 300, system, user: `Publication: ${name}\n${list ? `Recent stories:\n${list}\n` : ''}\nWrite the 1–2 sentence description.` })).trim();
  } catch (e) { return ''; }
}

// ── Client portal ────────────────────────────────────────────────────────────
/** Get (or create) a client's public portal token. */
async function ensureClientToken(clientId) {
  const found = await db.query('SELECT portal_token FROM pr_client_settings WHERE client_id = $1', [clientId]);
  if (found.rows.length) return found.rows[0].portal_token;
  const token = crypto.randomBytes(16).toString('hex');
  await db.query('INSERT INTO pr_client_settings (client_id, portal_token) VALUES ($1, $2)', [clientId, token]);
  return token;
}

/** Public coverage for a portal token: client name + visible (no-notes) items. */
async function getCoverageByToken(token) {
  const cs = await db.query(
    `SELECT cs.client_id, cl.name FROM pr_client_settings cs
     JOIN clients cl ON cl.id = cs.client_id WHERE cs.portal_token = $1`, [token]
  );
  if (!cs.rows.length) return null;
  const keys = Object.keys(CLIENT_VISIBLE_STATUS);
  const ph = keys.map((_, i) => `$${i + 2}`).join(',');
  const rows = (await db.query(
    `SELECT l.story_title, l.status, l.country, l.issue_date, l.story_url,
            o.name AS outlet, TRIM(CONCAT(c.first_name,' ',c.last_name)) AS journalist
     FROM pr_editorial_log l
     LEFT JOIN pr_outlets o ON o.id = l.outlet_id
     LEFT JOIN outreach_contacts c ON c.id = l.contact_id
     WHERE l.client_id = $1 AND l.status IN (${ph})
     ORDER BY (l.status IN ('published','download')) DESC, COALESCE(l.issue_date, l.request_date) DESC NULLS LAST`,
    [cs.rows[0].client_id, ...keys]
  )).rows;
  return {
    client_name: cs.rows[0].name,
    items: rows.map((r) => ({
      outlet: r.outlet, journalist: (r.journalist || '').trim(), country: r.country,
      status: r.status, status_label: CLIENT_VISIBLE_STATUS[r.status] || r.status,
      issue_date: r.issue_date, story_url: r.story_url,
      published: r.status === 'published' || r.status === 'download',
    })),
  };
}

module.exports = {
  STATUS_LABELS, PUBLISHED, statusLabel, CLIENT_VISIBLE_STATUS,
  relationshipStrength, hitRate, isGoneQuiet,
  parseCsv, stripNotionRef, parseDate,
  resolveOutlet, resolveContact, importEditorialCsv, importEditorialCsvAllClients,
  normaliseOutlet, isDoNotUse, buildOutletClusters, scanOutletDuplicates,
  adjudicateOutletClusters, mergeOutlets,
  suggestBeats, writeOutletSummary,
  ensureClientToken, getCoverageByToken,
};
