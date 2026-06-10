/**
 * CRM Manager — weekly autopilot. Runs the high-confidence pile of contact
 * maintenance on a schedule so the AM doesn't have to:
 *
 *   - Same-email duplicate clusters → auto-merged (canonical picked by
 *     suggestCanonical: most coverage → most clients → oldest record).
 *   - Deterministic Tidy fixes — capitalisation, email-case, URL-scheme
 *     normalisation, missing-company-from-domain — auto-applied. Anything
 *     ambiguous (publication-in-name splits, fuzzy company guesses) stays
 *     queued for the AM to tick.
 *
 * Everything fuzzier than that (name+outlet / name+domain clusters, AI-only
 * suggestions Claude wouldn't classify as deterministic) stays in the
 * Cleanup Centre review queue. The autopilot only acts where we'd be happy
 * to act unattended.
 *
 * Every run writes a crm_manager_runs row with counts + ids of what was
 * touched, so the dashboard digest can show last week's activity and the
 * undo button can revert.
 */
const pool = require('../db');
const dedup = require('./contactDedup');
const contactTidy = require('./contactTidy');

// Fields safe for autopilot — same-value-shape regardless of who runs it.
// Anything outside this set (publication-in-name splits, freeform company
// fills) needs human review even if Claude is confident.
const SAFE_TIDY_FIELDS = new Set(['email', 'first_name', 'last_name', 'name', 'website', 'linkedin_url']);

function isSafeTidy(s) {
  if (!s || !SAFE_TIDY_FIELDS.has(s.field)) return false;
  const before = String(s.before || '').trim();
  const after = String(s.new_value || '').trim();
  if (!after) return false;
  if (s.field === 'email') {
    return before.toLowerCase() === after.toLowerCase() && before !== after;
  }
  if (s.field === 'website' || s.field === 'linkedin_url') {
    return after === `https://${before}` || after === `http://${before}` || after === before.replace(/^http:/, 'https:');
  }
  if (s.field === 'first_name' || s.field === 'last_name' || s.field === 'name') {
    return before.toLowerCase() === after.toLowerCase() && before !== after;
  }
  return false;
}

async function getSettings() {
  const { rows } = await pool.query(`SELECT enabled, auto_merge, auto_tidy FROM crm_manager_settings WHERE id = 'global'`);
  return rows[0] || { enabled: true, auto_merge: true, auto_tidy: true };
}

async function updateSettings(patch) {
  const cols = []; const vals = []; let n = 1;
  for (const k of ['enabled', 'auto_merge', 'auto_tidy']) {
    if (typeof patch[k] === 'boolean') { cols.push(`${k} = $${n++}`); vals.push(patch[k]); }
  }
  if (!cols.length) return getSettings();
  cols.push(`updated_at = NOW()`);
  await pool.query(`UPDATE crm_manager_settings SET ${cols.join(', ')} WHERE id = 'global'`, vals);
  return getSettings();
}

async function recentRuns(limit = 10) {
  const { rows } = await pool.query(
    `SELECT id, started_at, finished_at, status, trigger, merged_count, tidied_count,
            queued_dupes, queued_tidies, error
       FROM crm_manager_runs
      ORDER BY started_at DESC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

async function lastRun() {
  const { rows } = await pool.query(
    `SELECT id, started_at, finished_at, status, trigger, merged_count, tidied_count,
            queued_dupes, queued_tidies, error
       FROM crm_manager_runs
      ORDER BY started_at DESC LIMIT 1`
  );
  return rows[0] || null;
}

/**
 * Run a sweep. Returns the run row (counts + ids) once finished.
 *
 * trigger='manual' is used by the "Run now" button in Settings; 'cron' by
 * the weekly scheduler. The flow is identical; only the recorded trigger
 * differs.
 */
async function runSweep({ trigger = 'cron' } = {}) {
  const settings = await getSettings();
  if (!settings.enabled) return { skipped: 'disabled' };

  const { rows: runRows } = await pool.query(
    `INSERT INTO crm_manager_runs (trigger) VALUES ($1) RETURNING id`,
    [trigger]
  );
  const runId = runRows[0].id;
  const mergedIds = [];
  const tidiedAuditIds = [];
  let mergedCount = 0, tidiedCount = 0, queuedDupes = 0, queuedTidies = 0;

  try {
    // Pass 1: auto-merge same-email clusters. visibleClientIds=null because
    // the autopilot is a workspace-wide tool (not scoped to a user session).
    if (settings.auto_merge) {
      const clusters = await dedup.scanContactDuplicates(null);
      for (const c of clusters) {
        if (c.method !== 'exact_email') { queuedDupes++; continue; }
        const canon = dedup.suggestCanonical(c);
        const memberIds = c.members.map((m) => m.id).filter((id) => id !== canon);
        if (!canon || !memberIds.length) continue;
        const merged = await dedup.mergeContacts(canon, memberIds);
        mergedCount += merged;
        for (const mid of memberIds) mergedIds.push({ loser: mid, canonical: canon });
      }
      // Anything left that we DIDN'T auto-merge (name+outlet, name+domain) still
      // gets counted as "queued for review" so the digest is honest about
      // what's waiting.
      const remaining = await dedup.scanContactDuplicates(null);
      queuedDupes = remaining.filter((c) => c.method !== 'exact_email').length;
    }

    // Pass 2: deterministic tidy fixes. Spin up a tidy run, then auto-apply
    // the subset that matches the safe-fields shape; the rest stays in the
    // run's suggestions so the AM can review from the Tidy fixes tab.
    if (settings.auto_tidy) {
      const { runId: tidyRunId } = await contactTidy.startTidyRun({
        visibleClientIds: null, filterBody: {}, userId: null, limit: contactTidy.MAX_CONTACTS,
      });
      // Poll the tidy run to completion (it's already async; we wait for it
      // here to keep the sweep's accounting honest).
      let tidyRun;
      for (let i = 0; i < 600; i++) {
        tidyRun = await contactTidy.getTidyRun(tidyRunId, null);
        if (!tidyRun || tidyRun.status !== 'running') break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      const suggestions = (tidyRun && tidyRun.suggestions) || [];
      const safe = suggestions.filter(isSafeTidy);
      const unsafe = suggestions.length - safe.length;
      queuedTidies = unsafe;
      if (safe.length) {
        const before = (await pool.query(`SELECT id FROM outreach_contact_audit ORDER BY id DESC LIMIT 1`)).rows[0]?.id || 0;
        const r = await contactTidy.applyTidy({ user: null, visibleClientIds: null, suggestions: safe });
        tidiedCount = r.applied || 0;
        // Capture the audit ids written by this apply so the undo can revert
        // them and only them.
        const after = await pool.query(`SELECT id FROM outreach_contact_audit WHERE id > $1`, [before]);
        for (const row of after.rows) tidiedAuditIds.push(row.id);
      }
    }

    await pool.query(
      `UPDATE crm_manager_runs
          SET status='done', finished_at=NOW(),
              merged_count=$1, tidied_count=$2, queued_dupes=$3, queued_tidies=$4,
              merged_ids=$5::jsonb, tidied_audit_ids=$6::jsonb
        WHERE id=$7`,
      [mergedCount, tidiedCount, queuedDupes, queuedTidies,
       JSON.stringify(mergedIds), JSON.stringify(tidiedAuditIds), runId]
    );
    return { runId, mergedCount, tidiedCount, queuedDupes, queuedTidies };
  } catch (err) {
    await pool.query(
      `UPDATE crm_manager_runs SET status='failed', error=$2, finished_at=NOW() WHERE id=$1`,
      [runId, err.message]
    ).catch(() => {});
    throw err;
  }
}

/**
 * Undo a previous run. Un-merges every merged loser (clears merged_into) and
 * rolls back every audit-recorded tidy by writing the before_value back.
 * Idempotent: re-running undo on the same run is a no-op once the targets
 * have already been restored.
 */
async function undoRun(runId) {
  const { rows } = await pool.query(
    `SELECT merged_ids, tidied_audit_ids FROM crm_manager_runs WHERE id = $1`,
    [runId]
  );
  if (!rows.length) return { error: 'Run not found' };
  const r = rows[0];
  let unmerged = 0, untidied = 0;

  // Un-merge: clear merged_into on every loser. We don't try to un-do the FK
  // repointing — the canonical now legitimately holds that history; what the
  // AM gets back is a live loser row sitting alongside, and a re-run of the
  // duplicate scan will surface them as a cluster again so they can re-decide.
  for (const entry of (r.merged_ids || [])) {
    const { rowCount } = await pool.query(
      `UPDATE outreach_contacts SET merged_into = NULL WHERE id = $1 AND merged_into IS NOT NULL`,
      [entry.loser]
    );
    if (rowCount) unmerged++;
  }

  // Un-tidy: walk the audit rows in reverse and restore before_value to the
  // contact field. Mark the audit row as reverted by source to keep history
  // honest.
  for (const auditId of (r.tidied_audit_ids || [])) {
    const { rows: ar } = await pool.query(
      `SELECT contact_id, field, before_value FROM outreach_contact_audit WHERE id = $1`, [auditId]
    );
    if (!ar.length) continue;
    const a = ar[0];
    try {
      await pool.query(`UPDATE outreach_contacts SET ${a.field} = $1, updated_at = NOW() WHERE id = $2`, [a.before_value, a.contact_id]);
      await pool.query(
        `INSERT INTO outreach_contact_audit (contact_id, field, before_value, after_value, source, rationale)
         VALUES ($1, $2, $3, $4, 'crm_manager_undo', 'Reverted by CRM Manager undo')`,
        [a.contact_id, a.field, null, a.before_value]
      );
      untidied++;
    } catch (e) { /* skip individual failures */ }
  }
  return { unmerged, untidied };
}

module.exports = { runSweep, undoRun, getSettings, updateSettings, recentRuns, lastRun };
