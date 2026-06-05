// LinkedIn auto-send hook for Phase 2 multichannel sequences.
//
// LinkedIn's messaging APIs (Messaging API, Conversations API,
// InMail) require approval through their Marketing Developer
// Platform partner programme — our regular OAuth app gets the
// w_member_social scope (organic UGC posts) but not the messaging
// scopes. That means the linkedin_message channel can't actually
// fire automatically through this connector yet.
//
// Rather than block Phase 2 on that approval, this module gives us
// the shape we need: tryAutoSend() returns false when we can't
// auto-deliver, which keeps the task in the manual queue. When the
// approval comes through (or when we swap in a third-party
// automation provider like Phantombuster / Salesflow), only this
// file needs to change.

const pool = require('../db');

// Detect whether the client has a LinkedIn connector with the
// messaging scope. Today that's never true — the connector only
// carries w_member_social. The check is here so the shape is right.
async function canAutoSend(clientId) {
  const { rows } = await pool.query(
    `SELECT credentials FROM connectors
      WHERE client_id = $1
        AND connector_type = 'linkedin_organic'
        AND status = 'active'
      LIMIT 1`,
    [clientId]
  );
  if (!rows.length) return false;
  // Scopes are stamped on the credentials at OAuth exchange time.
  // Until we re-auth with an approved messaging scope, this will be
  // false for every install.
  const scopes = rows[0].credentials?.scopes || [];
  return scopes.includes('r_messages') || scopes.includes('w_messages');
}

// Try to send a LinkedIn message automatically. Returns:
//   { sent: true, provider: 'linkedin_api' }    on success
//   { sent: false, reason: '…' }                if not possible
//
// The caller (outreachTasks.enqueue) uses this to decide whether to
// auto-complete the task or leave it in the manual queue.
async function tryAutoSend({ clientId, contact, prompt }) {
  if (!contact?.linkedin_url) {
    return { sent: false, reason: 'no linkedin_url on contact' };
  }
  const canSend = await canAutoSend(clientId);
  if (!canSend) {
    return {
      sent: false,
      reason: 'LinkedIn connector lacks messaging scope; manual task queued',
    };
  }

  // When we have the approved messaging scope, this is where the
  // actual DM dispatch lives. Sketch:
  //   const linkedin = require('../connectors/linkedin');
  //   const creds = await linkedin.getCredentials(clientId);
  //   await linkedin.sendMessage({ credentials: creds, recipientUrl: contact.linkedin_url, body: prompt });
  //   return { sent: true, provider: 'linkedin_api' };
  //
  // Until then, fall through to manual fallback.
  return { sent: false, reason: 'auto-send not yet wired' };
}

module.exports = { canAutoSend, tryAutoSend };
