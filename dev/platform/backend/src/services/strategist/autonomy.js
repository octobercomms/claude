// GTM Brain Phase 4 — graduated autonomy.
//
// Follows the prThanks.js pattern exactly, including its restraint:
// three stages, a threshold per stage, and the human moves the stage.
// Nothing auto-graduates.
//
// The "action" being automated is completion of queue items whose
// outcome reader confirms the number moved in the right direction.
// At assist (default), every item waits for the AM. At supervised,
// items whose metric_ref type has a high win rate in the track record
// are auto-completed when the outcome confirms improvement. At auto,
// the threshold is lower.
//
// This does not spend money or send anything outside OMI.

const pool = require('../../db');
const trackRecord = require('./trackRecord');

const STAGES = {
  assist: 'Assisted — I review every recommendation',
  supervised: 'Supervised — auto-complete only proven metric types',
  auto: 'Auto — handle proven metric types automatically',
};

const STAGE_KEYS = Object.keys(STAGES);

function threshold(stage) {
  if (stage === 'auto') return 0.60;
  if (stage === 'supervised') return 0.75;
  return 2.0; // assist: never auto-acts (no win rate exceeds 100%)
}

// Decision counts for one client, mirroring prThanks.trackRecord().
async function decisionRecord(clientId) {
  const { rows } = await pool.query(
    `SELECT review_decision, COUNT(*)::int AS n
       FROM strategist_briefing_recommendations
      WHERE client_id = $1
        AND review_decision IS NOT NULL
      GROUP BY review_decision`,
    [clientId]
  );
  const out = { accepted: 0, edited: 0, dismissed: 0, auto_completed: 0 };
  rows.forEach(r => { if (r.review_decision in out) out[r.review_decision] = r.n; });
  return out;
}

// Win rate per metric_ref from the Phase 3 track record, used as
// the confidence signal. Returns a Map of metric_ref -> win_rate (0-100).
async function winRates({ clientId } = {}) {
  const groups = await trackRecord.byMetric({ clientId });
  const rates = new Map();
  for (const g of groups) {
    if (g.win_rate != null) rates.set(g.key, g.win_rate);
  }
  return rates;
}

// The auto-tick. Runs on a schedule for supervised/auto clients.
// Finds completed items with confirmed positive outcomes and auto-marks
// them when the metric_ref's win rate exceeds the stage threshold.
async function runAuto({ log = () => {} } = {}) {
  const clients = (await pool.query(
    "SELECT id, strategist_action_stage FROM clients WHERE active = true AND strategist_active = true AND strategist_action_stage IN ('supervised', 'auto')"
  )).rows;

  if (!clients.length) {
    log('No clients with supervised/auto stage.');
    return { processed: 0, auto_completed: 0, clients: 0 };
  }

  let totalProcessed = 0;
  let totalAutoCompleted = 0;

  for (const client of clients) {
    const min = threshold(client.strategist_action_stage);
    const rates = await winRates({ clientId: client.id });

    // Items that are done, have a positive outcome, but no review decision yet.
    const { rows: candidates } = await pool.query(
      `SELECT r.id, r.metric_ref, r.baseline_value, r.outcome_value
         FROM strategist_briefing_recommendations r
         JOIN strategist_briefings b ON b.id = r.briefing_id
        WHERE r.client_id = $1
          AND r.done = true
          AND r.metric_ref IS NOT NULL
          AND r.qualitative = false
          AND r.baseline_value IS NOT NULL
          AND r.outcome_value IS NOT NULL
          AND r.review_decision IS NULL
          AND b.status = 'completed'
        ORDER BY r.done_at DESC NULLS LAST`,
      [client.id]
    );

    for (const item of candidates) {
      totalProcessed++;
      const winRate = rates.get(item.metric_ref);
      if (winRate == null || winRate < min) continue;

      // Verify this specific item improved (don't auto-complete declines).
      const classified = trackRecord.classifyRows([item]);
      if (!classified.length || classified[0].classification !== 'improved') continue;

      await pool.query(
        `UPDATE strategist_briefing_recommendations
            SET review_decision = 'auto_completed',
                review_decision_at = NOW(),
                review_decision_by = 'system'
          WHERE id = $1 AND review_decision IS NULL`,
        [item.id]
      );
      totalAutoCompleted++;
      log(`Auto-completed item ${item.id} (${item.metric_ref}, win rate ${winRate}%)`);
    }
  }

  log(`Autonomy tick: ${totalAutoCompleted} auto-completed of ${totalProcessed} candidates across ${clients.length} clients.`);
  return { processed: totalProcessed, auto_completed: totalAutoCompleted, clients: clients.length };
}

module.exports = { STAGES, STAGE_KEYS, threshold, decisionRecord, winRates, runAuto };
