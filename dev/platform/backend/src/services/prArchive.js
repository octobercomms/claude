/**
 * Stale-contact archive / refresh. People move on and retire, so the press list
 * goes stale. A weekly overnight sweep finds contacts with no recent coverage,
 * does a disambiguated web byline check (Serper News, name + outlet), and:
 *   - recent byline found  → still active; just stamp last_byline_check
 *   - no web trace at all   → auto-archive (reversible: availability_status)
 *   - results but none recent → suggest archiving (a human confirms)
 *
 * Cheap: only stale candidates are checked, staggered (re-check at most every
 * 90 days), one Serper call each (~$0.001) — no LLM. Archiving is reversible.
 */
const db = require('../db');
const serper = require('./serper');
const { getSetting } = require('../utils/settings');

// Serper news dates are relative ("2 days ago", "5 months ago", "1 year ago")
// or absolute ("Jan 5, 2024"). Recent = within ~12 months.
function isRecent(dateStr) {
  const s = String(dateStr || '').toLowerCase().trim();
  if (!s) return false;
  let m = s.match(/(\d+)\s+(hour|day|week|month|year)s?\s+ago/);
  if (m) {
    const n = parseInt(m[1], 10); const unit = m[2];
    if (unit === 'year') return false;
    if (unit === 'month') return n < 12;
    return true; // hours/days/weeks
  }
  const t = Date.parse(s);
  if (!isNaN(t)) return (Date.now() - t) < 365 * 86400000;
  return false;
}

/** Web byline check for one contact. Returns { active, suggest, total, recent }. */
async function checkByline(name, outlet) {
  const key = await getSetting('SERPER_API_KEY');
  if (!key || !name) return { skip: true };
  const q = `"${name}"${outlet ? ` ${outlet}` : ''}`;
  let res = [];
  try { res = await serper.searchNews(key, q, 15); } catch { return { skip: true }; }
  const total = res.length;
  const recent = res.filter((r) => isRecent(r.date)).length;
  if (recent >= 1) return { active: true, total, recent };
  if (total === 0) return { active: false, suggest: false, archive: true, total, recent }; // no trace → auto-archive
  return { active: false, suggest: true, total, recent }; // trace but stale → review
}

/** Stale, active press contacts due a check (latest coverage > 12mo ago / none). */
async function findStale(limit = 80) {
  const { rows } = await db.query(
    `SELECT c.id, TRIM(CONCAT(c.first_name,' ',c.last_name)) AS name, o.name AS outlet
       FROM outreach_contacts c
       LEFT JOIN pr_outlets o ON o.id = c.outlet_id
      WHERE c.kind IN ('media','industry') AND c.availability_status = 'active'
        AND (c.last_byline_check IS NULL OR c.last_byline_check < NOW() - INTERVAL '90 days')
        AND NOT EXISTS (
          SELECT 1 FROM pr_editorial_log l
           WHERE l.contact_id = c.id AND COALESCE(l.issue_date, l.request_date) > NOW() - INTERVAL '12 months'
        )
      ORDER BY c.last_byline_check ASC NULLS FIRST
      LIMIT $1`, [limit]
  );
  return rows;
}

async function runArchiveSweep({ limit = 80 } = {}) {
  const key = await getSetting('SERPER_API_KEY');
  if (!key) return { skipped: 'no-serper-key' };
  const stale = await findStale(limit);
  let archived = 0; let suggested = 0; let active = 0; let checked = 0;
  for (const c of stale) {
    const r = await checkByline(c.name, c.outlet);
    if (r.skip) continue;
    checked += 1;
    if (r.active) {
      await db.query('UPDATE outreach_contacts SET last_byline_check = NOW(), archive_suggested = FALSE WHERE id = $1', [c.id]);
      active += 1;
    } else if (r.archive) {
      await db.query("UPDATE outreach_contacts SET availability_status = 'archived', last_byline_check = NOW(), archive_suggested = FALSE WHERE id = $1", [c.id]);
      archived += 1;
    } else {
      await db.query('UPDATE outreach_contacts SET last_byline_check = NOW(), archive_suggested = TRUE WHERE id = $1', [c.id]);
      suggested += 1;
    }
  }
  return { checked, archived, suggested, active };
}

module.exports = { runArchiveSweep, checkByline, findStale, isRecent };
