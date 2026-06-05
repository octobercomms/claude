// LinkedIn + manual task queue. Non-email sequence steps (channel
// other than 'email') don't get sent through the SMTP sender; they
// become a row in this queue for the AM to action. Once the row is
// marked completed, the per-prospect state advances to the next step
// exactly as if an email had been delivered.

const pool = require('../db');
const prospectState = require('./outreachProspectState');

// Create a task for a (campaign, contact, sequence-step) combination.
// Idempotent against the same step — re-running enroll doesn't
// double-up.
//
// For linkedin_message tasks we ask the auto-sender if it can deliver
// before we commit the task to the queue. If yes, we still write the
// row (for audit) but mark it completed and advance the prospect
// state immediately. If no, we leave it pending for the AM to do
// manually.
async function enqueue({ campaignId, contactId, sequenceId, channel, taskType, prompt, dueAt, assignedTo }) {
  const { rows: existing } = await pool.query(
    `SELECT id FROM outreach_tasks
      WHERE campaign_id = $1 AND contact_id = $2 AND sequence_id = $3
      LIMIT 1`,
    [campaignId, contactId, sequenceId]
  );
  if (existing.length) return existing[0];
  const { rows } = await pool.query(
    `INSERT INTO outreach_tasks
       (campaign_id, contact_id, sequence_id, channel, task_type, prompt,
        due_at, assigned_to)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [campaignId, contactId, sequenceId, channel, taskType,
     prompt || null, dueAt || null, assignedTo || null]
  );
  const task = rows[0];

  // Try auto-send for linkedin_message. No-ops today (the connector
  // doesn't carry the messaging scope yet); pre-wired so the moment
  // we get partner approval, the existing tasks auto-fire.
  if (channel === 'linkedin_message') {
    try {
      const linkedinAuto = require('./linkedinAutoSender');
      const { rows: cRows } = await pool.query(
        `SELECT c.linkedin_url, c.email, cmp.client_id
           FROM outreach_contacts c
           JOIN outreach_campaigns cmp ON cmp.id = $1
          WHERE c.id = $2`,
        [campaignId, contactId]
      );
      const ctx = cRows[0];
      const result = await linkedinAuto.tryAutoSend({
        clientId: ctx.client_id, contact: ctx, prompt,
      });
      if (result.sent) {
        await pool.query(
          `UPDATE outreach_tasks
              SET status = 'completed', completed_at = NOW()
            WHERE id = $1`,
          [task.id]
        );
        await prospectState.advance(campaignId, contactId);
        await prospectState.markEvent(campaignId, contactId, 'task_completed');
        return { ...task, status: 'completed', auto_sent: true };
      }
    } catch (err) {
      // Auto-send failed — leave the task pending for manual action.
    }
  }
  return task;
}

// AM marks a task done — bumps the per-prospect state to the next
// step so the cadence continues.
async function complete(taskId, userId) {
  const { rows } = await pool.query(
    `UPDATE outreach_tasks
        SET status = 'completed', completed_at = NOW(), completed_by = $2
      WHERE id = $1 AND status = 'pending'
      RETURNING campaign_id, contact_id`,
    [taskId, userId]
  );
  if (!rows.length) return null;
  await prospectState.advance(rows[0].campaign_id, rows[0].contact_id);
  await prospectState.markEvent(
    rows[0].campaign_id, rows[0].contact_id, 'task_completed'
  );
  return rows[0];
}

// Skip — same shape as complete but doesn't advance the state.
// Useful when the AM realises the task is no longer relevant.
async function skip(taskId, userId, reason) {
  await pool.query(
    `UPDATE outreach_tasks
        SET status = 'skipped', completed_at = NOW(),
            completed_by = $2, prompt = COALESCE(prompt, '') || '\n[skipped: ' || $3 || ']'
      WHERE id = $1`,
    [taskId, userId, reason || 'no reason']
  );
}

// AM's daily queue across every client they can see.
async function listForUser(userId, visibleClientIds = null) {
  const params = [userId];
  let scope = '';
  if (visibleClientIds && visibleClientIds.length) {
    params.push(visibleClientIds);
    scope = `AND cmp.client_id = ANY($${params.length}::uuid[])`;
  } else if (Array.isArray(visibleClientIds) && !visibleClientIds.length) {
    return [];
  }
  const { rows } = await pool.query(
    `SELECT t.*, c.name AS contact_name, c.email, c.linkedin_url,
            cmp.name AS campaign_name, cmp.client_id, cl.name AS client_name
       FROM outreach_tasks t
       JOIN outreach_contacts  c   ON c.id = t.contact_id
       JOIN outreach_campaigns cmp ON cmp.id = t.campaign_id
       JOIN clients            cl  ON cl.id = cmp.client_id
      WHERE t.status = 'pending'
        AND (t.assigned_to IS NULL OR t.assigned_to = $1)
        ${scope}
      ORDER BY t.due_at NULLS LAST, t.created_at ASC
      LIMIT 200`,
    params
  );
  return rows;
}

module.exports = { enqueue, complete, skip, listForUser };
