// Daniel's own Google Calendar, for October's book-a-call widget.
//
// This is a platform-level connection (one Google account, the one whose
// calendar takes bookings), separate from the per-client Google connectors.
// It reuses the platform's Google OAuth client and redirect URI; the callback
// in routes/oauth.js routes here when the signed state says purpose=calendar.
// Tokens live encrypted in platform_settings under GOOGLE_CALENDAR_TOKENS.

const axios = require('axios');
const pool = require('../db');
const { encrypt, decrypt } = require('../utils/encryption');

const KEY = 'GOOGLE_CALENDAR_TOKENS';
const API = 'https://www.googleapis.com/calendar/v3';
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',     // create / move / cancel the Meet events
  'https://www.googleapis.com/auth/calendar.freebusy',   // read busy blocks only, never event details
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

function getAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function readTokens() {
  const { rows } = await pool.query('SELECT value FROM platform_settings WHERE key = $1', [KEY]);
  if (!rows.length) return null;
  try { return decrypt(JSON.parse(rows[0].value)); } catch { return null; }
}

async function writeTokens(tokens) {
  await pool.query(
    `INSERT INTO platform_settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [KEY, JSON.stringify(encrypt(tokens))]);
}

async function disconnect() {
  await pool.query('DELETE FROM platform_settings WHERE key = $1', [KEY]);
}

async function handleCallback(code) {
  const { data } = await axios.post('https://oauth2.googleapis.com/token', {
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    grant_type: 'authorization_code',
  });
  if (!data.refresh_token) throw new Error('Google did not return a refresh token. Remove OMI from your Google account permissions and connect again.');
  const granted = String(data.scope || '').split(/\s+/);
  const missing = SCOPES.split(' ').filter(s => !granted.includes(s));
  if (missing.length) throw new Error('Calendar access was not fully granted. Tick both calendar boxes on the Google consent screen.');
  let email = null;
  try {
    const { data: me } = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${data.access_token}` } });
    email = me.email || null;
  } catch { /* email is a label only */ }
  await writeTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    email,
    connected_at: new Date().toISOString(),
  });
  return email;
}

async function accessToken() {
  const t = await readTokens();
  if (!t?.refresh_token) {
    const e = new Error('Google Calendar is not connected. Connect it in Settings → Biz dev → Booking.');
    e.code = 'NOT_CONNECTED';
    throw e;
  }
  if (t.access_token && t.expires_at > Date.now() + 60000) return t.access_token;
  try {
    const { data } = await axios.post('https://oauth2.googleapis.com/token', {
      refresh_token: t.refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    });
    await writeTokens({ ...t, access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 });
    return data.access_token;
  } catch (err) {
    const e = new Error(`Google Calendar token refresh failed (${err.response?.data?.error || err.message}). Reconnect the calendar.`);
    e.code = 'NOT_CONNECTED';
    throw e;
  }
}

async function status() {
  const t = await readTokens();
  return { connected: !!t?.refresh_token, email: t?.email || null, connected_at: t?.connected_at || null };
}

async function call(method, path, { params, data } = {}) {
  const token = await accessToken();
  const res = await axios({ method, url: `${API}${path}`, params, data, headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });
  return res.data;
}

// Busy blocks across the calendars that should block a booking (primary plus
// any extra ids, e.g. a personal calendar shared into the work account).
async function busy(timeMin, timeMax, calendarIds = ['primary']) {
  const data = await call('post', '/freeBusy', {
    data: { timeMin: new Date(timeMin).toISOString(), timeMax: new Date(timeMax).toISOString(), items: calendarIds.map(id => ({ id })) },
  });
  const out = [];
  for (const cal of Object.values(data.calendars || {})) {
    if (cal.errors?.length) throw new Error(`Calendar read failed: ${cal.errors[0].reason}`);
    for (const b of cal.busy || []) out.push({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() });
  }
  return out;
}

// Creates the event with a Google Meet link. sendUpdates=all makes Google
// send the invite (with the Meet link and its own reminders) to the prospect.
async function createMeetEvent({ calendarId = 'primary', summary, description, start, end, attendees, requestId }) {
  const ev = await call('post', `/calendars/${encodeURIComponent(calendarId)}/events`, {
    params: { conferenceDataVersion: 1, sendUpdates: 'all' },
    data: {
      summary, description,
      start: { dateTime: new Date(start).toISOString() },
      end: { dateTime: new Date(end).toISOString() },
      attendees,
      conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
      reminders: { useDefault: true },
      guestsCanModify: false,
    },
  });
  const meet = ev.hangoutLink || (ev.conferenceData?.entryPoints || []).find(p => p.entryPointType === 'video')?.uri || null;
  return { id: ev.id, meet_url: meet, html_link: ev.htmlLink };
}

async function moveEvent({ calendarId = 'primary', eventId, start, end }) {
  return call('patch', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    params: { sendUpdates: 'all' },
    data: { start: { dateTime: new Date(start).toISOString() }, end: { dateTime: new Date(end).toISOString() } },
  });
}

async function cancelEvent({ calendarId = 'primary', eventId }) {
  try {
    await call('delete', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { params: { sendUpdates: 'all' } });
  } catch (err) {
    if (err.response?.status === 410 || err.response?.status === 404) return;   // already gone
    throw err;
  }
}

module.exports = { SCOPES, getAuthUrl, handleCallback, status, disconnect, busy, createMeetEvent, moveEvent, cancelEvent };
