/**
 * PR module service — CSV import, outlet/contact resolution and the
 * relationship-strength analytics, native to the platform (Postgres).
 */
const db = require('../db');

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
    'SELECT id FROM pr_contacts WHERE lower(first_name) = lower($1) AND lower(last_name) = lower($2) LIMIT 1',
    [first, last]
  );
  if (found.rows.length) return found.rows[0].id;
  const ins = await db.query(
    `INSERT INTO pr_contacts (first_name, last_name, outlet_id, segment) VALUES ($1, $2, $3, 'media') RETURNING id`,
    [first, last, outletId || null]
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

module.exports = {
  STATUS_LABELS, PUBLISHED, statusLabel,
  relationshipStrength, hitRate, isGoneQuiet,
  parseCsv, stripNotionRef, parseDate,
  resolveOutlet, resolveContact, importEditorialCsv, importEditorialCsvAllClients,
};
