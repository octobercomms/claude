// Instagram DM autoresponder — phase 2: live auto-send via Meta.
//
// A single signature-verified webhook receives Instagram messaging + comment
// events for every connected client. We match the event to a client by the IG
// business account id, draft a reply with that client's persona (dmBot), and
// send it back through the Graph API using the client's Page token. Inbound and
// outbound messages are logged (audit + dedupe so we never double-reply).
//
// Config (per client) and the app secret live encrypted / in env; the webhook
// itself is unauthenticated but HMAC-verified, like the WP/Shopify ingests.

const axios = require('axios');
const crypto = require('crypto');
const pool = require('../db');
const { encrypt, decrypt } = require('../utils/encryption');
const { getSetting } = require('../utils/settings');
const dmBot = require('./dmBot');

const API_VERSION = 'v22.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

async function appSecret() { return (await getSetting('META_APP_SECRET')) || process.env.META_APP_SECRET || ''; }

// ── webhook verification (GET) ───────────────────────────────────────────────
function verifyToken() { return process.env.META_WEBHOOK_VERIFY_TOKEN || ''; }

// ── signature check (POST) ───────────────────────────────────────────────────
// Meta signs the raw body with the app secret as sha256=<hex>.
async function verifySignature(rawBody, header) {
  const secret = await appSecret();
  if (!secret || !header || !rawBody) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── per-client live config ───────────────────────────────────────────────────
async function getLiveConfig(clientId) {
  const { rows } = await pool.query(
    'SELECT enabled, ig_user_id, (page_token_encrypted IS NOT NULL) AS has_token FROM social_dm_bot WHERE client_id = $1',
    [clientId]
  );
  const r = rows[0] || {};
  return { enabled: !!r.enabled, ig_user_id: r.ig_user_id || null, has_token: !!r.has_token };
}

async function setLiveConfig(clientId, { enabled, ig_user_id, page_token } = {}) {
  // Upsert; only overwrite the token when a new one is supplied.
  const enc = page_token && String(page_token).trim() ? JSON.stringify(encrypt(String(page_token).trim())) : null;
  await pool.query(
    `INSERT INTO social_dm_bot (client_id, enabled, ig_user_id, page_token_encrypted)
       VALUES ($1, $2, $3, $4)
     ON CONFLICT (client_id) DO UPDATE SET
       enabled = $2,
       ig_user_id = COALESCE($3, social_dm_bot.ig_user_id),
       page_token_encrypted = COALESCE($4::jsonb, social_dm_bot.page_token_encrypted),
       updated_at = NOW()`,
    [clientId, enabled === undefined ? false : !!enabled, ig_user_id || null, enc]
  );
  return getLiveConfig(clientId);
}

async function findClientByIgId(igUserId) {
  if (!igUserId) return null;
  const { rows } = await pool.query(
    'SELECT client_id, enabled, page_token_encrypted FROM social_dm_bot WHERE ig_user_id = $1', [igUserId]
  );
  if (!rows.length) return null;
  return {
    clientId: rows[0].client_id,
    enabled: !!rows[0].enabled,
    pageToken: rows[0].page_token_encrypted ? decrypt(rows[0].page_token_encrypted) : null,
  };
}

// ── event log + dedupe ───────────────────────────────────────────────────────
async function alreadySeen(externalId) {
  if (!externalId) return false;
  const { rows } = await pool.query('SELECT 1 FROM social_dm_events WHERE external_id = $1 LIMIT 1', [externalId]);
  return rows.length > 0;
}

async function logEvent({ clientId, direction, channel, externalId, counterparty, text, status }) {
  await pool.query(
    `INSERT INTO social_dm_events (client_id, direction, channel, external_id, counterparty, text, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [clientId, direction, channel || 'dm', externalId || null, counterparty || null, (text || '').slice(0, 4000), status || null]
  );
}

async function listEvents(clientId, limit = 50) {
  const { rows } = await pool.query(
    'SELECT id, direction, channel, counterparty, text, status, created_at FROM social_dm_events WHERE client_id = $1 ORDER BY created_at DESC LIMIT $2',
    [clientId, Math.min(200, limit)]
  );
  return rows;
}

// ── Graph API sends ──────────────────────────────────────────────────────────
async function sendDM(igUserId, recipientId, text, token) {
  await axios.post(`${BASE_URL}/${igUserId}/messages`, {
    recipient: { id: recipientId },
    message: { text: String(text).slice(0, 950) },
  }, { params: { access_token: token }, timeout: 15000 });
}

async function sendPrivateReply(commentId, text, token) {
  await axios.post(`${BASE_URL}/${commentId}/private_replies`, {
    message: String(text).slice(0, 950),
  }, { params: { access_token: token }, timeout: 15000 });
}

// ── webhook dispatch ─────────────────────────────────────────────────────────
// Meta delivers an `object: 'instagram'` payload with entries. Each entry is
// keyed by the IG account id and carries `messaging` (DMs) and/or `changes`
// (comments). We never throw back to Meta — log and move on so it doesn't retry
// the whole batch over one bad event.
async function handleWebhook(body) {
  if (!body || !Array.isArray(body.entry)) return;
  for (const entry of body.entry) {
    const igId = entry.id;
    for (const m of entry.messaging || []) {
      try { await handleDm(igId, m); } catch (err) { console.error('[dm] message handler:', err.message); }
    }
    for (const ch of entry.changes || []) {
      if (ch.field === 'comments') {
        try { await handleComment(igId, ch.value); } catch (err) { console.error('[dm] comment handler:', err.message); }
      }
    }
  }
}

async function handleDm(igId, m) {
  // Ignore our own echoes, read receipts, reactions, and non-text.
  if (!m.message || m.message.is_echo) return;
  const text = m.message.text;
  const mid = m.message.mid;
  const sender = m.sender?.id;
  if (!text || !sender) return;
  if (await alreadySeen(mid)) return;

  const target = await findClientByIgId(igId);
  if (!target) return;                              // not a client we manage
  await logEvent({ clientId: target.clientId, direction: 'in', channel: 'dm', externalId: mid, counterparty: sender, text });
  if (!target.enabled || !target.pageToken) {
    return logEvent({ clientId: target.clientId, direction: 'out', channel: 'dm', counterparty: sender, status: 'skipped', text: target.enabled ? 'no page token' : 'bot disabled' });
  }

  try {
    const { reply } = await dmBot.draftReply(target.clientId, text);
    await sendDM(igId, sender, reply, target.pageToken);
    await logEvent({ clientId: target.clientId, direction: 'out', channel: 'dm', counterparty: sender, text: reply, status: 'replied' });
  } catch (err) {
    await logEvent({ clientId: target.clientId, direction: 'out', channel: 'dm', counterparty: sender, status: 'error', text: err.message });
  }
}

async function handleComment(igId, value) {
  const commentId = value?.id;
  const text = value?.text;
  const from = value?.from?.id || value?.from?.username;
  if (!commentId || !text) return;
  if (await alreadySeen(commentId)) return;

  const target = await findClientByIgId(igId);
  if (!target) return;
  await logEvent({ clientId: target.clientId, direction: 'in', channel: 'comment', externalId: commentId, counterparty: from, text });
  if (!target.enabled || !target.pageToken) return;
  // Don't reply to the account's own comments.
  if (value?.from?.id && value.from.id === igId) return;

  try {
    // Comment-to-DM: a private reply lands in the commenter's inbox — the
    // highest-converting trigger from the ManyChat playbook.
    const { reply } = await dmBot.draftReply(target.clientId, `They commented on our post: "${text}". Reply to start a DM conversation.`);
    await sendPrivateReply(commentId, reply, target.pageToken);
    await logEvent({ clientId: target.clientId, direction: 'out', channel: 'comment', counterparty: from, text: reply, status: 'replied' });
  } catch (err) {
    await logEvent({ clientId: target.clientId, direction: 'out', channel: 'comment', counterparty: from, status: 'error', text: err.message });
  }
}

module.exports = {
  verifyToken, verifySignature, handleWebhook,
  getLiveConfig, setLiveConfig, listEvents,
};
