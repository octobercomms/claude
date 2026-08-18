// Tender Agent — normalisation helpers shared by every source adapter.
// Adapters turn a portal's raw item into the common shape below; ingest.js
// upserts it. Keeping parsing here (not in each adapter) means one place fixes
// a wonky date or value across all sources.
//
// Common notice shape an adapter returns:
//   {
//     external_ref, url, title, buyer_name, buyer_country, buyer_city,
//     cpv_codes: string[], published_at: Date|null, closing_at: Date|null,
//     value_min: number|null, value_max: number|null, currency,
//     description, raw_payload, needs_manual_check: bool
//   }

const crypto = require('crypto');

// content_hash over the fields that matter for "did this materially change?".
// A changed hash => re-score/re-brief; an identical hash => skip.
function contentHash({ title, description, closing_at }) {
  const closing = closing_at instanceof Date ? closing_at.toISOString().slice(0, 10) : (closing_at || '');
  return crypto.createHash('sha256')
    .update(`${(title || '').trim()}\n${(description || '').trim()}\n${closing}`)
    .digest('hex');
}

// Parse a deadline into a real Date, or null. Portals express deadlines
// inconsistently; a wrong deadline is worse than no deadline, so anything we
// can't confidently parse returns null (and the caller flags needs_manual_check).
function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value) ? null : value;
  const s = String(value).trim();
  if (!s) return null;
  // ISO 8601 (incl. OCDS "2026-08-27T12:00:00Z") — the reliable common case.
  const iso = new Date(s);
  if (!isNaN(iso) && /^\d{4}-\d{2}-\d{2}/.test(s)) return iso;
  // RFC-822 (RSS pubDate, e.g. "Wed, 27 Aug 2026 12:00:00 GMT").
  if (!isNaN(iso) && /\d{1,2}\s+\w{3}\s+\d{4}/.test(s)) return iso;
  return null;
}

// A parsed date is only usable as a closing date if it's a real future/past
// timestamp we trust. Returns { closing_at, needs_manual_check }.
function resolveClosing(value) {
  const d = parseDate(value);
  if (d) return { closing_at: d, needs_manual_check: false };
  return { closing_at: null, needs_manual_check: true };
}

// Pull a numeric value out of assorted shapes (number, "£20,000", "20000.00").
function parseAmount(value) {
  if (value == null) return null;
  if (typeof value === 'number') return isFinite(value) ? value : null;
  const n = parseFloat(String(value).replace(/[^0-9.]/g, ''));
  return isFinite(n) ? n : null;
}

// Is the notice closed (deadline in the past)? Notices with no closing date are
// NOT treated as expired here — they're flagged for manual check instead.
function isExpired(closing_at, now = new Date()) {
  return closing_at instanceof Date && closing_at.getTime() < now.getTime();
}

// Coerce a CPV list to an array of clean code strings.
function cpvList(codes) {
  if (!codes) return [];
  const arr = Array.isArray(codes) ? codes : String(codes).split(/[,\s]+/);
  return arr.map(c => String(c).trim()).filter(Boolean);
}

module.exports = { contentHash, parseDate, resolveClosing, parseAmount, isExpired, cpvList };
