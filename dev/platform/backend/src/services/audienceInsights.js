// Audience Insights — the Outra-substitute for the Paid suite. Three
// layers stacked:
//   1. First-party postcode distribution from Shopify orders (live this
//      commit) — answers "where are our customers concentrated"
//   2. Saved audience_segments — AM-defined criteria saved per client
//   3. UK postcode-level demographic overlay (next commit) — ONS data
//      joined to the distribution so segments can filter by income /
//      household type / age band
//
// The cache table keeps the live aggregation snappy: first request
// triggers a walk of every order in the last 365 days, subsequent
// requests in the same day serve the cached snapshot.

const crypto = require('crypto');
const pool = require('../db');
const { decrypt } = require('../utils/encryption');
const shopify = require('../connectors/shopify');

const CACHE_TTL_HOURS = 24;

async function getShopifyCreds(clientId) {
  const { rows } = await pool.query(
    `SELECT credentials FROM connectors
      WHERE client_id = $1 AND connector_type = 'shopify' AND status = 'active'
      LIMIT 1`,
    [clientId]
  );
  if (!rows.length) return null;
  return decrypt(rows[0].credentials);
}

// Aggregate first-party postcodes for a client. Uses the cache when
// available; pass force=true to recompute.
async function getPostcodeDistribution(clientId, { force = false } = {}) {
  if (!force) {
    const { rows: cached } = await pool.query(
      `SELECT * FROM audience_postcode_cache WHERE client_id = $1`,
      [clientId]
    );
    const c = cached[0];
    if (c && Date.now() - new Date(c.computed_at).getTime() < CACHE_TTL_HOURS * 60 * 60 * 1000) {
      return {
        postcodes: c.postcodes || [],
        total_orders: c.total_orders,
        total_revenue: Number(c.total_revenue),
        computed_at: c.computed_at,
        from_cache: true,
      };
    }
  }
  const creds = await getShopifyCreds(clientId);
  if (!creds) {
    return { postcodes: [], total_orders: 0, total_revenue: 0, computed_at: null, note: 'No active Shopify connector — first-party audience needs a Shopify connection.' };
  }
  const customers = await shopify.fetchCustomerPostcodes(creds, { days: 365 });
  const byDistrict = new Map();
  for (const c of customers) {
    const d = c.postcode_district;
    if (!d) continue;
    const e = byDistrict.get(d) || { postcode_district: d, customer_count: 0, order_count: 0, revenue: 0 };
    e.customer_count += 1;
    e.order_count += c.order_count;
    e.revenue += c.revenue;
    byDistrict.set(d, e);
  }
  const postcodes = [...byDistrict.values()]
    .map(p => ({ ...p, revenue: Math.round(p.revenue * 100) / 100 }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 200);    // cap at 200 districts to keep the payload small
  const totalOrders = customers.reduce((n, c) => n + c.order_count, 0);
  const totalRevenue = customers.reduce((n, c) => n + c.revenue, 0);

  await pool.query(
    `INSERT INTO audience_postcode_cache (client_id, postcodes, total_orders, total_revenue, computed_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (client_id) DO UPDATE
       SET postcodes = EXCLUDED.postcodes,
           total_orders = EXCLUDED.total_orders,
           total_revenue = EXCLUDED.total_revenue,
           computed_at = NOW()`,
    [clientId, JSON.stringify(postcodes), totalOrders, totalRevenue]
  );
  return {
    postcodes,
    total_orders: totalOrders,
    total_revenue: Math.round(totalRevenue * 100) / 100,
    computed_at: new Date().toISOString(),
    from_cache: false,
  };
}

// Apply a segment's filters against the cached distribution. Returns
// the matching postcodes + a reach estimate. Filters supported in this
// commit: postcode_districts[] (explicit list), min_revenue (sum of
// revenue from postcode), min_customers. Demographic filters (income,
// age band) plug in once the ONS overlay is loaded.
function applySegmentFilters(distribution, filters = {}) {
  if (!distribution?.postcodes?.length) return { postcodes: [], reach: 0 };
  const allowed = Array.isArray(filters.postcode_districts) && filters.postcode_districts.length
    ? new Set(filters.postcode_districts.map(s => String(s).toUpperCase()))
    : null;
  const minRev = Number(filters.min_revenue || 0);
  const minCust = Number(filters.min_customers || 0);
  const matched = distribution.postcodes.filter(p => {
    if (allowed && !allowed.has(p.postcode_district)) return false;
    if (minRev > 0 && p.revenue < minRev) return false;
    if (minCust > 0 && p.customer_count < minCust) return false;
    return true;
  });
  const reach = matched.reduce((n, p) => n + p.customer_count, 0);
  return { postcodes: matched, reach };
}

async function listSegments(clientId) {
  const { rows } = await pool.query(
    `SELECT id, name, description, filters, estimated_reach, source, updated_at
       FROM audience_segments WHERE client_id = $1
       ORDER BY updated_at DESC`,
    [clientId]
  );
  return rows;
}

async function saveSegment(clientId, { id, name, description, filters, source = 'manual' }) {
  // Compute estimated_reach off the cached distribution if available.
  let estimatedReach = null;
  try {
    const dist = await getPostcodeDistribution(clientId);
    estimatedReach = applySegmentFilters(dist, filters).reach;
  } catch { /* leave null — UI handles absent estimate */ }
  if (id) {
    const { rows } = await pool.query(
      `UPDATE audience_segments
          SET name = $1, description = $2, filters = $3,
              estimated_reach = $4, source = $5, updated_at = NOW()
        WHERE id = $6 AND client_id = $7
        RETURNING id, name, description, filters, estimated_reach, source, updated_at`,
      [name, description || null, JSON.stringify(filters || {}), estimatedReach, source, id, clientId]
    );
    return rows[0];
  }
  const { rows } = await pool.query(
    `INSERT INTO audience_segments (client_id, name, description, filters, estimated_reach, source)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, description, filters, estimated_reach, source, updated_at`,
    [clientId, name, description || null, JSON.stringify(filters || {}), estimatedReach, source]
  );
  return rows[0];
}

async function deleteSegment(clientId, segmentId) {
  await pool.query(`DELETE FROM audience_segments WHERE id = $1 AND client_id = $2`, [segmentId, clientId]);
}

// Format a segment for Meta Custom Audience upload. Two shapes depending
// on the segment source:
//   - customer_list → hashed email,phone rows (Meta accepts pre-hashed
//     multi-key uploads). We never stored the raw PII, only the hashes.
//   - everything else → first-party postcode segment, emitted as
//     zip,country per Meta's "lookalike seed" format, deduped by district.
async function exportSegmentForMeta(clientId, segmentId, countryCode = 'GB') {
  const { rows } = await pool.query(
    `SELECT filters, source FROM audience_segments WHERE id = $1 AND client_id = $2`,
    [segmentId, clientId]
  );
  if (!rows.length) throw new Error('Segment not found');

  if (rows[0].source === 'customer_list') {
    const { rows: contacts } = await pool.query(
      `SELECT email_hash, phone_hash FROM audience_customer_contacts WHERE segment_id = $1`,
      [segmentId]
    );
    const lines = ['email,phone'];
    for (const c of contacts) lines.push(`${c.email_hash || ''},${c.phone_hash || ''}`);
    return lines.join('\n');
  }

  const dist = await getPostcodeDistribution(clientId);
  const { postcodes } = applySegmentFilters(dist, rows[0].filters);
  // CSV header per Meta spec. We dedupe by postcode so a busy district
  // doesn't get one row per customer.
  const lines = ['zip,country'];
  for (const p of postcodes) lines.push(`${p.postcode_district},${countryCode}`);
  return lines.join('\n');
}

// ─── Customer-list uploads ─────────────────────────────────────────────
// Hash helpers follow Meta's normalisation rules. We hash on ingest so
// raw emails/phones never touch the database.
function hashEmail(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s || !s.includes('@') || s.length < 5) return null;
  return crypto.createHash('sha256').update(s).digest('hex');
}
function hashPhone(raw) {
  const digits = String(raw || '').replace(/[^0-9]/g, '');
  if (digits.length < 7) return null;          // too short to be a real number
  return crypto.createHash('sha256').update(digits).digest('hex');
}

// Minimal RFC-4180-ish CSV parser — handles quoted fields, escaped
// quotes ("") and CRLF. Good enough for the customer exports AMs paste
// in (Shopify, Klaviyo, Mailchimp, a hand-rolled spreadsheet).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Pull hashed contacts out of an uploaded CSV. Detects email/phone
// columns by header; if no recognisable header exists, assumes a single
// column of emails. Dedupes on the (email,phone) hash pair.
function extractContacts(text) {
  const rows = parseCsv(text).filter(r => r.some(c => c && c.trim()));
  if (!rows.length) return { contacts: [], withEmail: 0, withPhone: 0 };

  const header = rows[0].map(h => h.trim().toLowerCase());
  let emailIdx = header.findIndex(h => /e-?mail/.test(h));
  let phoneIdx = header.findIndex(h => /phone|mobile|tel\b/.test(h));
  let dataRows;
  if (emailIdx === -1 && phoneIdx === -1) {
    // No headers we recognise — treat column 0 as emails. Keep the first
    // row only if it isn't itself an email value.
    emailIdx = 0;
    dataRows = hashEmail(rows[0][0]) ? rows : rows.slice(1);
  } else {
    dataRows = rows.slice(1);
  }

  const seen = new Set();
  const contacts = [];
  let withEmail = 0, withPhone = 0;
  for (const r of dataRows) {
    const eh = emailIdx >= 0 ? hashEmail(r[emailIdx]) : null;
    const ph = phoneIdx >= 0 ? hashPhone(r[phoneIdx]) : null;
    if (!eh && !ph) continue;
    const key = `${eh || ''}|${ph || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (eh) withEmail++;
    if (ph) withPhone++;
    contacts.push({ email_hash: eh, phone_hash: ph });
  }
  return { contacts, withEmail, withPhone };
}

const MAX_CONTACTS = 500_000;

// Create a customer_list segment from an uploaded CSV. Inserts the
// segment row, then bulk-inserts the hashed contacts in chunks.
async function createCustomerListSegment(clientId, { name, filename, csvText }) {
  const { contacts, withEmail, withPhone } = extractContacts(csvText);
  if (!contacts.length) {
    throw new Error('No valid email or phone contacts found in that file. Expecting a CSV with an "email" and/or "phone" column.');
  }
  if (contacts.length > MAX_CONTACTS) {
    throw new Error(`That list has ${contacts.length.toLocaleString()} contacts — the limit is ${MAX_CONTACTS.toLocaleString()}. Split it and upload in parts.`);
  }

  const filters = { kind: 'customer_list', filename: filename || null, has_email: withEmail > 0, has_phone: withPhone > 0 };
  const { rows } = await pool.query(
    `INSERT INTO audience_segments (client_id, name, description, filters, estimated_reach, source)
     VALUES ($1, $2, $3, $4, $5, 'customer_list')
     RETURNING id, name, description, filters, estimated_reach, source, updated_at`,
    [clientId, name, `Uploaded customer list — ${contacts.length} contacts`, JSON.stringify(filters), contacts.length]
  );
  const segmentId = rows[0].id;

  const CHUNK = 1000;
  for (let i = 0; i < contacts.length; i += CHUNK) {
    const slice = contacts.slice(i, i + CHUNK);
    const params = [];
    const values = [];
    slice.forEach((c, j) => {
      params.push(`($${j * 3 + 1}, $${j * 3 + 2}, $${j * 3 + 3})`);
      values.push(segmentId, c.email_hash, c.phone_hash);
    });
    await pool.query(
      `INSERT INTO audience_customer_contacts (segment_id, email_hash, phone_hash) VALUES ${params.join(',')}`,
      values
    );
  }
  return rows[0];
}

module.exports = {
  getPostcodeDistribution, applySegmentFilters,
  listSegments, saveSegment, deleteSegment, exportSegmentForMeta,
  createCustomerListSegment,
};
