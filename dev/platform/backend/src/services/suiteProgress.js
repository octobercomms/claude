// Process Rails — derived-first per-suite step completion.
//
// Each suite maps a step_key to an async check against real data ("is this
// step actually done?"). Manual overrides in client_suite_progress win over the
// derived value, for the few steps that have no signal to derive from.
// See docs/omi/process-rails-plan.md.

const pool = require('../db');

async function boolQuery(sql, params) {
  const { rows } = await pool.query(sql, params);
  return rows.length > 0;
}

const localToolDone = (id, tool) => boolQuery(`SELECT 1 FROM local_seo_runs WHERE client_id = $1 AND tool = $2 LIMIT 1`, [id, tool]);

// suite → { step_key: async (clientId) => boolean }. Add a suite here to light
// up its rail; the frontend supplies the step titles/order.
const DERIVERS = {
  paid_advise: {
    briefing: (id) => boolQuery(`SELECT 1 FROM strategist_reports WHERE client_id = $1 AND status = 'completed' LIMIT 1`, [id]),
    audiences: (id) => boolQuery(`SELECT 1 FROM audience_segments WHERE client_id = $1 LIMIT 1`, [id]),
    async competitors(id) {
      const { rows } = await pool.query(
        `SELECT
           (SELECT COALESCE(array_length(competitor_domains, 1), 0) > 0 FROM clients WHERE id = $1) AS has_domains,
           EXISTS (SELECT 1 FROM competitor_ad_runs WHERE client_id = $1) AS has_runs`,
        [id]
      );
      return !!(rows[0] && (rows[0].has_domains || rows[0].has_runs));
    },
  },

  // Suite-level readiness — the major stages of each suite, for the Overview
  // "N of M set up" bar (not every tool; the headline journey).
  paid_setup: {
    connected: (id) => boolQuery(`SELECT 1 FROM connectors WHERE client_id = $1 AND connector_type IN ('google_ads','meta_ads') AND status = 'active' LIMIT 1`, [id]),
    briefed: (id) => boolQuery(`SELECT 1 FROM strategist_reports WHERE client_id = $1 AND status = 'completed' LIMIT 1`, [id]),
    audiences: (id) => boolQuery(`SELECT 1 FROM audience_segments WHERE client_id = $1 LIMIT 1`, [id]),
    creative: (id) => boolQuery(`SELECT 1 FROM ad_creative_batches WHERE client_id = $1 LIMIT 1`, [id]),
  },
  owned_setup: {
    keywords: (id) => boolQuery(`SELECT 1 FROM seo_keywords WHERE client_id = $1 AND active = true LIMIT 1`, [id]),
    audited: (id) => boolQuery(`SELECT 1 FROM site_audits WHERE client_id = $1 AND status = 'complete' LIMIT 1`, [id]),
    content: (id) => boolQuery(`SELECT 1 FROM content_drafts WHERE client_id = $1 LIMIT 1`, [id]),
    backlinks: (id) => boolQuery(`SELECT 1 FROM dfs_backlinks_summary WHERE client_id = $1 LIMIT 1`, [id]),
  },
  earned_setup: {
    contacts: (id) => boolQuery(`SELECT 1 FROM outreach_contacts WHERE client_id = $1 LIMIT 1`, [id]),
    pitched: (id) => boolQuery(`SELECT 1 FROM pr_editorial_log WHERE client_id = $1 AND status = 'pitched' LIMIT 1`, [id]),
    published: (id) => boolQuery(`SELECT 1 FROM pr_editorial_log WHERE client_id = $1 AND status = 'published' LIMIT 1`, [id]),
    thanked: (id) => boolQuery(`SELECT 1 FROM pr_sent_thanks s JOIN pr_editorial_log l ON l.id = s.editorial_log_id WHERE l.client_id = $1 LIMIT 1`, [id]),
  },
  shared_setup: {
    created: (id) => boolQuery(`SELECT 1 FROM social_posts WHERE client_id = $1 LIMIT 1`, [id]),
    planned: (id) => boolQuery(`SELECT 1 FROM social_post_plans WHERE client_id = $1 LIMIT 1`, [id]),
    published: (id) => boolQuery(`SELECT 1 FROM social_post_publications WHERE client_id = $1 LIMIT 1`, [id]),
  },

  // Per-group "work through these tabs" rails (Owned). Keys match the tab keys
  // in ClientSEOPage. Only tabs with a run/result record are derived; the rest
  // are left to the frontend (numbered step or info).
  owned_search: {
    keywords: (id) => boolQuery(`SELECT 1 FROM seo_keywords WHERE client_id = $1 AND active = true LIMIT 1`, [id]),
    ai_visibility: (id) => boolQuery(`SELECT 1 FROM ai_visibility_runs WHERE client_id = $1 LIMIT 1`, [id]),
    authority: (id) => boolQuery(`SELECT 1 FROM seo_manual_metrics WHERE client_id = $1 LIMIT 1`, [id]),
    backlinks: (id) => boolQuery(`SELECT 1 FROM dfs_backlinks_summary WHERE client_id = $1 LIMIT 1`, [id]),
    drift: (id) => boolQuery(`SELECT 1 FROM seo_drift_baselines WHERE client_id = $1 LIMIT 1`, [id]),
  },
  owned_optimise: {
    site_audit: (id) => boolQuery(`SELECT 1 FROM site_audits WHERE client_id = $1 AND status = 'complete' LIMIT 1`, [id]),
    content_audit: (id) => boolQuery(`SELECT 1 FROM content_audits WHERE client_id = $1 LIMIT 1`, [id]),
    keyword_footprint: (id) => boolQuery(`SELECT 1 FROM site_audit_page_keywords WHERE client_id = $1 LIMIT 1`, [id]),
    ai_seo: (id) => boolQuery(`SELECT 1 FROM ai_seo_keyword_targets WHERE client_id = $1 LIMIT 1`, [id]),
    agent_ready: (id) => boolQuery(`SELECT 1 FROM agent_readiness_runs WHERE client_id = $1 LIMIT 1`, [id]),
  },
  owned_localise: {
    local_gap: (id) => localToolDone(id, 'competition_gap'),
    local_schema: (id) => localToolDone(id, 'schema_audit'),
    local_keywords: (id) => localToolDone(id, 'buyer_intent'),
    local_xray: (id) => localToolDone(id, 'competitor_xray'),
    local_playbook: (id) => localToolDone(id, 'ranking_playbook'),
    local_outliers: (id) => localToolDone(id, 'ranking_outliers'),
    local_gbp: (id) => localToolDone(id, 'gbp_posts'),
  },
};

// Returns { suite, steps: { <key>: 'done' | 'todo' } } for the derivable steps.
// Informational steps (no completion) are owned by the frontend and not
// returned here.
async function getProgress(clientId, suite) {
  const derivers = DERIVERS[suite];
  if (!derivers) throw new Error(`Unknown suite: ${suite}`);
  const keys = Object.keys(derivers);

  const derived = {};
  await Promise.all(keys.map(async (k) => {
    try { derived[k] = await derivers[k](clientId); } catch { derived[k] = false; }
  }));

  const { rows } = await pool.query(
    'SELECT step_key, done FROM client_suite_progress WHERE client_id = $1 AND suite = $2',
    [clientId, suite]
  );
  const manual = {};
  rows.forEach((r) => { manual[r.step_key] = r.done; });

  const steps = {};
  for (const k of keys) {
    const done = (k in manual) ? manual[k] : derived[k];
    steps[k] = done ? 'done' : 'todo';
  }
  return { suite, steps };
}

async function setManual(clientId, suite, stepKey, done) {
  await pool.query(
    `INSERT INTO client_suite_progress (client_id, suite, step_key, done, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (client_id, suite, step_key) DO UPDATE SET done = EXCLUDED.done, updated_at = NOW()`,
    [clientId, suite, stepKey, !!done]
  );
}

module.exports = { getProgress, setManual, DERIVERS };
