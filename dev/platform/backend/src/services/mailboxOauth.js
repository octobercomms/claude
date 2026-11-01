// Google OAuth for a mailbox OMI reads.
//
// Why this exists: app passwords are gone from the Google accounts October
// uses, and an app password is what outreach_inboxes was built to hold. The
// mailbox that takes press-release replies failed with AUTHENTICATIONFAILED on
// 25 October and could not be fixed by typing a new password, because the
// screen that issues one now says "the setting that you are looking for is not
// available for your account".
//
// The replacement authenticates the same IMAP socket with a bearer token
// instead of a password (XOAUTH2), so every line that reads, decodes, matches
// and suppresses stays exactly as it was. Only the credential changes.
//
// Scope: https://mail.google.com/ is the only scope Google accepts for IMAP,
// and it carries full mailbox access. Nothing narrower will open the socket;
// gmail.readonly works against the Gmail REST API and is refused by IMAP. The
// trade is deliberate, and worth stating plainly: reaching least privilege
// here would mean rewriting three fetch paths against the REST API, and the
// fetch paths are not where the risk lives. Google classifies this scope as
// restricted, so the OAuth client must either be Internal to the Workspace
// that owns the mailbox, or pass a security assessment.
//
// It reuses the platform's existing Google OAuth client and redirect URI; the
// callback in routes/oauth.js routes here when the signed state carries
// purpose=mailbox, the same way the Calendar grant does.

const axios = require('axios');
const pool = require('../db');
const { encrypt } = require('../utils/encryption');

const IMAP_SCOPE = 'https://mail.google.com/';
const SCOPES = [IMAP_SCOPE, 'https://www.googleapis.com/auth/userinfo.email'];

// A token is refreshed a minute before Google expires it. A poll can take
// longer than the gap between "valid" and "rejected", and an expiry checked
// to the second would hand IMAP a token that dies mid-fetch.
const EXPIRY_MARGIN_MS = 60 * 1000;

function authUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/**
 * Which of the scopes we asked for did the consent screen not grant?
 *
 * Google returns a partial grant as a success, so an ungranted IMAP scope
 * arrives looking identical to a working connection and then fails on every
 * poll. Checked at the callback, while the person who ticked the boxes is
 * still on screen and can tick the one they missed.
 */
function missingScopes(granted) {
  const have = String(granted || '').split(/\s+/).filter(Boolean);
  return SCOPES.filter((s) => !have.includes(s));
}

/** Is this stored access token still worth sending? */
function tokenUsable(tokens, now = Date.now()) {
  if (!tokens || !tokens.access_token) return false;
  const exp = Number(tokens.expires_at);
  if (!Number.isFinite(exp)) return false;
  return exp > now + EXPIRY_MARGIN_MS;
}

/** The address Google says this grant belongs to, or null. */
async function grantEmail(accessToken) {
  try {
    const { data } = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo',
      { headers: { Authorization: `Bearer ${accessToken}` } });
    return data.email || null;
  } catch {
    // The address is a label. Failing to read it must not fail the grant.
    return null;
  }
}

/**
 * Turn a consent code into a stored grant on one mailbox.
 *
 * Refuses three things outright, each of which would otherwise be stored as a
 * working connection and discovered fifteen minutes later in a log:
 * a grant with no refresh token, a grant missing the IMAP scope, and a grant
 * for an address other than the mailbox it is being attached to.
 */
async function attach(inboxId, code) {
  const { data } = await axios.post('https://oauth2.googleapis.com/token', {
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    grant_type: 'authorization_code',
  });

  if (!data.refresh_token) {
    throw new Error('Google did not return a refresh token, so OMI could not keep reading this mailbox after the first hour. Remove OMI from your Google account permissions (myaccount.google.com → Data & privacy → Third-party apps) and connect again.');
  }
  const missing = missingScopes(data.scope);
  if (missing.includes(IMAP_SCOPE)) {
    throw new Error('Mail access was not granted, so IMAP will refuse the connection. Run it again and tick the box that reads "Read, compose, send and permanently delete all your email from Gmail".');
  }

  const { rows } = await pool.query('SELECT username, label FROM outreach_inboxes WHERE id = $1', [inboxId]);
  if (!rows.length) { const e = new Error('Mailbox not found'); e.status = 404; throw e; }
  const row = rows[0];

  const email = await grantEmail(data.access_token);
  if (email && email.toLowerCase() !== String(row.username).toLowerCase()) {
    // A grant for the wrong account authenticates perfectly and reads the
    // wrong mailbox, which is the one failure here that looks like success.
    throw new Error(`You signed in as ${email}, but this mailbox is ${row.username}. Sign out of ${email} or use a private window, then connect again.`);
  }

  const tokens = {
    refresh_token: data.refresh_token,
    access_token: data.access_token,
    expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    scope: data.scope || '',
  };
  await pool.query(
    `UPDATE outreach_inboxes
        SET auth_type = 'google_oauth', oauth_enc = $2::jsonb, oauth_email = $3,
            oauth_connected_at = NOW(), last_error = NULL, updated_at = NOW()
      WHERE id = $1`,
    [inboxId, JSON.stringify(encrypt(tokens)), email || row.username]
  );
  return { label: row.label, email: email || row.username };
}

/** Drop the grant and put the mailbox back on passwords. */
async function detach(inboxId) {
  const { rows } = await pool.query('SELECT password_enc FROM outreach_inboxes WHERE id = $1', [inboxId]);
  if (!rows.length) { const e = new Error('Mailbox not found'); e.status = 404; throw e; }
  if (!rows[0].password_enc) {
    const e = new Error('This mailbox has no password to fall back on, so disconnecting Google would leave it unreadable. Enter a password first, or delete the mailbox.');
    e.status = 400;
    throw e;
  }
  await pool.query(
    `UPDATE outreach_inboxes
        SET auth_type = 'password', oauth_enc = NULL, oauth_email = NULL,
            oauth_connected_at = NULL, updated_at = NOW()
      WHERE id = $1`, [inboxId]);
  return { id: inboxId, disconnected: true };
}

/**
 * A bearer token for this mailbox's IMAP socket, refreshed if needed.
 *
 * `inbox` is a row read through outreachInboxes.withCredentials, so oauth_enc
 * is already decrypted onto `oauth`.
 */
async function accessTokenFor(inbox) {
  const tokens = inbox && inbox.oauth;
  if (!tokens || !tokens.refresh_token) {
    const e = new Error(`"${inbox?.label || 'That mailbox'}" is set to use Google sign-in but has no grant stored. Connect it in Settings → Keys → Mailboxes.`);
    e.status = 400;
    throw e;
  }
  if (tokenUsable(tokens)) return tokens.access_token;

  let data;
  try {
    ({ data } = await axios.post('https://oauth2.googleapis.com/token', {
      refresh_token: tokens.refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }));
  } catch (err) {
    const why = err.response?.data?.error_description || err.response?.data?.error || err.message;
    throw new Error(`Google refused to renew access to ${inbox.oauth_email || inbox.username} (${why}). Reconnect the mailbox in Settings → Keys → Mailboxes.`);
  }

  const next = {
    ...tokens,
    access_token: data.access_token,
    expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  try {
    await pool.query('UPDATE outreach_inboxes SET oauth_enc = $2::jsonb, updated_at = NOW() WHERE id = $1',
      [inbox.id, JSON.stringify(encrypt(next))]);
  } catch (err) {
    // Storing the renewed token is a saving, not a requirement: the poll can
    // run on the token in hand and mint another next time.
    console.warn('[Mailbox OAuth] could not store the renewed token:', err.message);
  }
  return data.access_token;
}

module.exports = {
  IMAP_SCOPE, SCOPES, EXPIRY_MARGIN_MS,
  authUrl, missingScopes, tokenUsable, attach, detach, accessTokenFor,
};
