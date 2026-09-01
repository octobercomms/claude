// Press interest watcher — the "24/7 account exec keeping an eye on it". Reacts
// to every open/click on a press send: keeps a running interest score per
// (journalist × client), and when a journalist crosses the warm threshold it
// (a) flags them warm, (b) alerts the AM once, and (c) pushes them onto the
// client's dashboard coverage/PR area so the client sees live interest.
//
// Runs on the tracking hot path, so it's cheap and fire-and-forget: a failure
// here must never break the tracking pixel/redirect.

const pool = require('../db');

// Default "what counts as warm" blend. Deliberately not a single static "10
// opens" — interest is a blend. The AM can override per client via
// clients.press_warm_config. (Two-opens-within-an-hour burst detection wants an
// opens-event table; noted as a later refinement — for now: opens>=min OR click.)
const DEFAULT_CONFIG = { min_opens: 3, any_click: true };

async function config(clientId) {
  try {
    const { rows } = await pool.query('SELECT press_warm_config FROM clients WHERE id = $1', [clientId]);
    return { ...DEFAULT_CONFIG, ...(rows[0]?.press_warm_config || {}) };
  } catch { return { ...DEFAULT_CONFIG }; }
}

// Aggregate engagement for this journalist across every step of this campaign.
async function metrics(campaignId, contactId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(s.open_count), 0)::int AS opens,
            (SELECT COUNT(*) FROM outreach_clicks cl
               JOIN outreach_sends s2 ON s2.id = cl.send_id
              WHERE s2.campaign_id = $1 AND s2.contact_id = $2)::int AS clicks
       FROM outreach_sends s
      WHERE s.campaign_id = $1 AND s.contact_id = $2`,
    [campaignId, contactId]
  );
  return rows[0] || { opens: 0, clicks: 0 };
}

// A click is worth roughly three opens. Warm when the blend trips.
function scoreAndReason(m, cfg) {
  const opens = m.opens || 0;
  const clicks = m.clicks || 0;
  const score = opens + clicks * 3;
  const warm = (cfg.any_click && clicks > 0) || opens >= (cfg.min_opens || 3);
  let reason = null;
  if (warm) {
    reason = clicks > 0
      ? `clicked a link${opens ? ` and opened ${opens}×` : ''}`
      : `opened ${opens}×`;
  }
  return { score, warm, reason };
}

// Entry point from the tracking endpoints. `sendId` → resolve to a PRESS send,
// re-score, and warm-flag if the threshold is crossed.
async function onEngagement(sendId, { clicked = false } = {}) {
  const { rows } = await pool.query(
    `SELECT s.campaign_id, s.contact_id, c.client_id, c.kind
       FROM outreach_sends s JOIN outreach_campaigns c ON c.id = s.campaign_id
      WHERE s.id = $1`,
    [sendId]
  );
  const row = rows[0];
  if (!row || row.kind !== 'press_release' || !row.contact_id || !row.client_id) return;
  await evaluate({ campaignId: row.campaign_id, contactId: row.contact_id, clientId: row.client_id });
}

async function evaluate({ campaignId, contactId, clientId }) {
  const cfg = await config(clientId);
  const m = await metrics(campaignId, contactId);
  const { score, warm, reason } = scoreAndReason(m, cfg);

  // Keep the running score fresh even when not yet warm.
  await pool.query(
    `UPDATE outreach_contact_clients SET interest_score = $1 WHERE contact_id = $2 AND client_id = $3`,
    [score, contactId, clientId]
  );
  if (!warm) return;

  // Alert exactly once per (campaign, journalist): the INSERT is the guard.
  const ins = await pool.query(
    `INSERT INTO press_interest_alerts (client_id, campaign_id, contact_id, score, reason)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (campaign_id, contact_id) DO NOTHING RETURNING id`,
    [clientId, campaignId, contactId, score, reason]
  );
  if (!ins.rowCount) return; // already flagged/alerted for this campaign

  await pool.query(
    `UPDATE outreach_contact_clients
        SET warm_at = COALESCE(warm_at, NOW()), warm_reason = $4,
            warm_campaign_id = COALESCE(warm_campaign_id, $5), interest_score = $1
      WHERE contact_id = $2 AND client_id = $3`,
    [score, contactId, clientId, reason, campaignId]
  );

  const ctx = await loadNames(clientId, contactId);
  try { await alertAM({ ...ctx, score, reason }); } catch (e) { console.warn('[pressInterest] alert failed:', e.message); }
  try { await pushToClientCoverage({ clientId, contactId, campaignId, reason, ...ctx }); }
  catch (e) { console.warn('[pressInterest] coverage push failed:', e.message); }
}

async function loadNames(clientId, contactId) {
  const [{ rows: cl }, { rows: co }] = await Promise.all([
    pool.query('SELECT name FROM clients WHERE id = $1', [clientId]),
    pool.query('SELECT name, email, company FROM outreach_contacts WHERE id = $1', [contactId]),
  ]);
  return {
    clientId, contactId,
    clientName: cl[0]?.name || 'Client',
    contactName: co[0]?.name || co[0]?.email || 'A journalist',
    outlet: co[0]?.company || null,
  };
}

async function alertAM({ clientName, contactName, outlet, score, reason }) {
  const emailService = require('./emailService');
  if (typeof emailService.sendPressInterestAlert !== 'function') return;
  await emailService.sendPressInterestAlert({ clientName, contactName, outlet, score, reason });
}

// Surface the warm journalist on the CLIENT's dashboard coverage/PR area, so the
// client immediately sees "these contacts are interested". Wired to the real
// coverage mechanism (see mapping in docs/platform/press-outreach) — the warm
// flag on outreach_contact_clients (warm_at/warm_reason) is already set above, so
// the client-facing view reads from there; this hook is where an explicit
// coverage-list row is created if the coverage model needs one.
async function pushToClientCoverage(_args) {
  // Intentionally a no-op beyond the warm flag until the coverage-list write is
  // wired — the client dashboard reads warm_at directly. See Phase 4 follow-up.
  return;
}

module.exports = { onEngagement, evaluate, scoreAndReason, config, metrics, DEFAULT_CONFIG };
