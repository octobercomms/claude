// Hard bounce + complaint suppression. Called from two places:
//   1. outreachSender — when SES throws a synchronous MessageRejected
//      whose error code names a dead/blocked address (sandbox sends, hard
//      bounces on resend, blacklist hits).
//   2. routes/sesWebhook — when SES's SNS Notification stream tells us a
//      previously-accepted message bounced at delivery time.
//
// A hard bounce or complaint marks the contact globally:
//   - outreach_contacts.bounced_at + bounce_reason set
//   - status flipped to 'bounced'
//   - every pending outreach_sends row for this contact is cancelled,
//     across every client.
// A soft bounce is logged but not suppressed (the scheduler will retry).

const pool = require('../db');

// SES bounce categorisation. Permanent.* and undetermined-with-known-DSN-codes
// count as hard; everything else is soft.
const HARD_BOUNCE_TYPES = new Set(['Permanent']);
const HARD_BOUNCE_SUBTYPES = new Set([
  'General', 'NoEmail', 'Suppressed', 'OnAccountSuppressionList', 'OnSuppressionList',
]);

function isHardBounce(notification) {
  if (notification.bounceType === 'Permanent') return true;
  if (notification.bounceType === 'Transient') return false;
  // Undetermined: be conservative — only suppress on subtype that's clearly dead
  return HARD_BOUNCE_TYPES.has(notification.bounceType)
      || HARD_BOUNCE_SUBTYPES.has(notification.bounceSubType);
}

// Patterns in SESv2 SendEmail error responses that name a hard-bounce
// failure mode. Used by the synchronous catcher in outreachSender.
const SYNC_HARD_BOUNCE_PATTERNS = [
  /address.*blacklist/i,
  /email address is not verified/i,
  /address.*suppress/i,
  /invalid.*recipient/i,
  /mailbox.*not.*found/i,
  /recipient.*rejected/i,
];

function looksLikeSyncHardBounce(errorMessage) {
  return SYNC_HARD_BOUNCE_PATTERNS.some(rx => rx.test(String(errorMessage || '')));
}

async function markBounced(contactId, reason) {
  if (!contactId) return;
  await pool.query(
    `UPDATE outreach_contacts
        SET bounced_at = COALESCE(bounced_at, NOW()),
            bounce_reason = COALESCE(bounce_reason, $2),
            status = CASE WHEN status = 'unsubscribed' THEN status ELSE 'bounced' END,
            updated_at = NOW()
      WHERE id = $1`,
    [contactId, (reason || '').slice(0, 500)]
  );
  await pool.query(
    `UPDATE outreach_sends SET status = 'cancelled'
      WHERE contact_id = $1 AND status = 'pending'`,
    [contactId]
  );
}

// Look up the outreach_sends row by SES message id and return the linked
// contact id. Falls back to email lookup when the message id isn't on
// the row (older sends that pre-date the provider_message_id column).
async function contactForSesMessage(sesMessageId, fallbackEmail) {
  if (sesMessageId) {
    const { rows } = await pool.query(
      'SELECT contact_id FROM outreach_sends WHERE provider_message_id = $1 LIMIT 1',
      [sesMessageId]
    );
    if (rows.length) return rows[0].contact_id;
  }
  if (fallbackEmail) {
    const { rows } = await pool.query(
      'SELECT id AS contact_id FROM outreach_contacts WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [fallbackEmail]
    );
    if (rows.length) return rows[0].contact_id;
  }
  return null;
}

// Entry point used by the SES SNS webhook. message is the parsed JSON of
// the Bounce/Complaint notification (the body of the SNS Message field).
async function handleSesEvent(message) {
  if (!message || typeof message !== 'object') return { handled: false };
  const sesMessageId = message.mail?.messageId || null;

  if (message.notificationType === 'Bounce' && message.bounce) {
    const hard = isHardBounce(message.bounce);
    if (!hard) return { handled: true, kind: 'soft-bounce' };
    const reason = [message.bounce.bounceType, message.bounce.bounceSubType, message.bounce.bouncedRecipients?.[0]?.diagnosticCode]
      .filter(Boolean).join(' / ');
    for (const r of (message.bounce.bouncedRecipients || [])) {
      const contactId = await contactForSesMessage(sesMessageId, r.emailAddress);
      if (contactId) await markBounced(contactId, reason);
    }
    return { handled: true, kind: 'hard-bounce' };
  }

  if (message.notificationType === 'Complaint' && message.complaint) {
    // Complaints are "this person flagged us as spam" — treat as a global
    // suppression even harsher than a bounce. Reuse the bounce path with
    // a clear reason string so reporting still distinguishes them.
    for (const r of (message.complaint.complainedRecipients || [])) {
      const contactId = await contactForSesMessage(sesMessageId, r.emailAddress);
      if (contactId) await markBounced(contactId, `Complaint · ${message.complaint.complaintFeedbackType || 'unspecified'}`);
    }
    return { handled: true, kind: 'complaint' };
  }

  return { handled: false };
}

module.exports = {
  markBounced, contactForSesMessage, handleSesEvent,
  looksLikeSyncHardBounce, isHardBounce,
};
