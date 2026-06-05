// Per-prospect state machine. Every (campaign, contact) pair has one
// row in outreach_prospect_state. The sender + task queue read from
// it before scheduling the next step; the reply classifier + send
// outcome handlers write to it so cross-channel events can pause or
// terminate the cadence.
//
// The contract is small on purpose: ensure(), advance(), markEvent(),
// pause(), resume(). Anything more nuanced sits in the consumers.

const pool = require('../db');

// Idempotent — creates the state row if missing, returns whatever is
// stored. Called when a contact is enrolled into a campaign.
async function ensure(campaignId, contactId) {
  const { rows } = await pool.query(
    `INSERT INTO outreach_prospect_state (campaign_id, contact_id)
     VALUES ($1, $2)
     ON CONFLICT (campaign_id, contact_id) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [campaignId, contactId]
  );
  return rows[0];
}

// Bump current_step. If the new step number doesn't exist on the
// sequence, mark the state completed instead. Returns the updated
// row.
async function advance(campaignId, contactId) {
  const { rows: stateRows } = await pool.query(
    'SELECT * FROM outreach_prospect_state WHERE campaign_id = $1 AND contact_id = $2',
    [campaignId, contactId]
  );
  if (!stateRows.length) return ensure(campaignId, contactId);
  const cur = stateRows[0];
  if (cur.state !== 'enrolled') return cur;

  const { rows: maxStep } = await pool.query(
    'SELECT MAX(step_number) AS max FROM outreach_sequences WHERE campaign_id = $1',
    [campaignId]
  );
  const next = (cur.current_step || 1) + 1;
  if (!maxStep[0].max || next > maxStep[0].max) {
    const { rows } = await pool.query(
      `UPDATE outreach_prospect_state
          SET state = 'completed', updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [cur.id]
    );
    return rows[0];
  }
  const { rows } = await pool.query(
    `UPDATE outreach_prospect_state
        SET current_step = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *`,
    [next, cur.id]
  );
  return rows[0];
}

// Record a cross-channel event. Some events end the sequence
// (replied / bounced / unsubscribed); others are informational and
// just update last_channel_event so the sequence can branch later.
//
// kind values: replied | bounced | unsubscribed | linkedin_replied |
//              linkedin_connected | opened | clicked | task_completed
async function markEvent(campaignId, contactId, kind, { note } = {}) {
  const TERMINAL = {
    replied: 'replied',
    linkedin_replied: 'replied',
    bounced: 'bounced',
    unsubscribed: 'unsubscribed',
  };
  const newState = TERMINAL[kind];
  const fields = ['last_channel_event = $3', 'last_event_at = NOW()', 'updated_at = NOW()'];
  const params = [campaignId, contactId, kind];
  if (newState) { params.push(newState); fields.push(`state = $${params.length}`); }
  if (note)     { params.push(note);    fields.push(`notes = $${params.length}`); }

  await pool.query(
    `INSERT INTO outreach_prospect_state (campaign_id, contact_id, last_channel_event, last_event_at, state, notes)
     VALUES ($1, $2, $3, NOW(), ${newState ? `'${newState}'` : `'enrolled'`}, ${note ? `'${note.replace(/'/g, "''")}'` : 'NULL'})
     ON CONFLICT (campaign_id, contact_id) DO UPDATE SET ${fields.join(', ')}`,
    params
  );
}

async function pause(campaignId, contactId, note) {
  await ensure(campaignId, contactId);
  await pool.query(
    `UPDATE outreach_prospect_state
        SET state = 'paused', notes = COALESCE($3, notes), updated_at = NOW()
      WHERE campaign_id = $1 AND contact_id = $2`,
    [campaignId, contactId, note || null]
  );
}

async function resume(campaignId, contactId) {
  await pool.query(
    `UPDATE outreach_prospect_state
        SET state = 'enrolled', updated_at = NOW()
      WHERE campaign_id = $1 AND contact_id = $2
        AND state IN ('paused', 'replied')`,
    [campaignId, contactId]
  );
}

// Should we schedule the next outbound action for this prospect?
// The sender calls this before queuing the next email; the task
// dispatcher calls it before adding a LinkedIn / manual task row.
async function isActive(campaignId, contactId) {
  const { rows } = await pool.query(
    'SELECT state FROM outreach_prospect_state WHERE campaign_id = $1 AND contact_id = $2',
    [campaignId, contactId]
  );
  if (!rows.length) return true; // never enrolled = treat as active default
  return rows[0].state === 'enrolled';
}

module.exports = { ensure, advance, markEvent, pause, resume, isActive };
