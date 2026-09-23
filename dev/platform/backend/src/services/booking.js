// Book-a-call for October (docs/omi/booking.md).
//
//   slots()            → open start times from the availability rules minus
//                        Google Calendar busy blocks and existing bookings
//   book()             → re-checks the slot under a lock, creates the Google
//                        Meet event (Google sends the invite), writes the
//                        booking onto the pipeline lead and prepares the brief
//   reschedule/cancel  → from the manage link in the invite
//
// All availability maths runs in the business time zone (Europe/London by
// default); the widget shows times in the visitor's own zone.

const crypto = require('crypto');
const pool = require('../db');
const gcal = require('./googleCalendar');
const studio = require('./snapshotStudio');
const proposals = require('./proposals');
const email = require('./emailService');

const PLATFORM_URL = () => (process.env.PLATFORM_URL || 'https://platform.octobercomms.com').replace(/\/$/, '');

const WEEKDAY = [['09:30', '12:30'], ['13:30', '17:00']];
const DEFAULTS = {
  timezone: 'Europe/London',
  duration: 30,            // minutes
  buffer: 15,              // minutes kept clear either side of any busy block
  step: 30,                // slot start granularity
  min_notice_hours: 12,
  horizon_days: 21,
  max_per_day: 3,
  hours: { 0: [], 1: WEEKDAY, 2: WEEKDAY, 3: WEEKDAY, 4: WEEKDAY, 5: WEEKDAY, 6: [] },
  blackout_dates: [],      // 'YYYY-MM-DD' in the business zone
  calendar_ids: ['primary'],
  title: 'October x {company}: intro call',
  max_reschedules: 3,
};

const BUDGETS = ['Under £1,500 a month', '£1,500 to £3,000 a month', '£3,000+ a month', 'Not sure yet'];

// ─── Config ─────────────────────────────────────────────────────────────────
async function getConfig() {
  const { rows } = await pool.query('SELECT config FROM booking_settings WHERE id = 1');
  const saved = rows[0]?.config || {};
  return { ...DEFAULTS, ...saved, hours: { ...DEFAULTS.hours, ...(saved.hours || {}) } };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
async function saveConfig(input = {}) {
  const cur = await getConfig();
  const next = { ...cur };
  const num = (k, lo, hi) => {
    if (input[k] === undefined) return;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${k} must be between ${lo} and ${hi}`);
    next[k] = n;
  };
  num('duration', 10, 120); num('buffer', 0, 120); num('step', 5, 120);
  num('min_notice_hours', 0, 336); num('horizon_days', 1, 90); num('max_per_day', 1, 20); num('max_reschedules', 0, 10);
  if (input.timezone !== undefined) {
    try { new Intl.DateTimeFormat('en-GB', { timeZone: input.timezone }); } catch { throw new Error('Unknown time zone'); }
    next.timezone = input.timezone;
  }
  if (input.hours !== undefined) {
    const h = {};
    for (let d = 0; d < 7; d++) {
      const ranges = Array.isArray(input.hours[d]) ? input.hours[d] : [];
      h[d] = ranges.map(r => {
        if (!Array.isArray(r) || !HHMM.test(r[0]) || !HHMM.test(r[1]) || r[0] >= r[1]) throw new Error('Hours must be HH:MM ranges with start before end');
        return [r[0], r[1]];
      });
    }
    next.hours = h;
  }
  if (input.blackout_dates !== undefined) {
    next.blackout_dates = (input.blackout_dates || []).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
  }
  if (input.calendar_ids !== undefined) {
    const ids = (input.calendar_ids || []).map(s => String(s).trim()).filter(Boolean).slice(0, 10);
    next.calendar_ids = ids.length ? ids : ['primary'];
  }
  if (input.title !== undefined) next.title = String(input.title).slice(0, 200) || DEFAULTS.title;
  await pool.query('UPDATE booking_settings SET config = $1, updated_at = NOW() WHERE id = 1', [JSON.stringify(next)]);
  return next;
}

// ─── Time zone maths (no library: Intl gives us the offset) ─────────────────
function offsetMs(instant, tz) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant));
  const v = Object.fromEntries(parts.map(p => [p.type, Number(p.value)]));
  const asUtc = Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

// Wall-clock time in `tz` → UTC ms. Two passes settle DST boundaries.
function zonedToUtc(y, m, d, hh, mm, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetMs(guess, tz);
  const off2 = offsetMs(t, tz);
  if (guess - off2 !== t) t = guess - off2;
  return t;
}

function localDate(instant, tz) {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d, key: s };
}

// ─── Availability ───────────────────────────────────────────────────────────
let busyCache = { at: 0, key: '', blocks: [] };

async function busyBlocks(cfg, from, to, { fresh = false } = {}) {
  const key = `${cfg.calendar_ids.join(',')}|${from}|${to}`;
  if (!fresh && busyCache.key === key && Date.now() - busyCache.at < 60000) return busyCache.blocks;
  const blocks = await gcal.busy(from, to, cfg.calendar_ids);
  // Confirmed bookings count as busy even if Google hasn't reflected them yet.
  const { rows } = await pool.query(
    `SELECT start_at, end_at FROM bookings WHERE status = 'confirmed' AND end_at > $1 AND start_at < $2`,
    [new Date(from), new Date(to)]);
  for (const r of rows) blocks.push({ start: new Date(r.start_at).getTime(), end: new Date(r.end_at).getTime() });
  busyCache = { at: Date.now(), key, blocks };
  return blocks;
}

async function perDayCounts(cfg, from, to) {
  const { rows } = await pool.query(
    `SELECT start_at FROM bookings WHERE status = 'confirmed' AND start_at >= $1 AND start_at < $2`,
    [new Date(from), new Date(to)]);
  const counts = {};
  for (const r of rows) { const k = localDate(new Date(r.start_at).getTime(), cfg.timezone).key; counts[k] = (counts[k] || 0) + 1; }
  return counts;
}

// Pure: candidate starts from the rules, minus busy (with buffer), minus
// full days. Exported for tests.
function computeSlots(cfg, { now, busy = [], counts = {} }) {
  const tz = cfg.timezone;
  const dur = cfg.duration * 60000;
  const buf = cfg.buffer * 60000;
  const earliest = now + cfg.min_notice_hours * 3600000;
  const today = localDate(now, tz);
  const out = [];
  for (let i = 0; i <= cfg.horizon_days; i++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + i));
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (cfg.blackout_dates.includes(key)) continue;
    if ((counts[key] || 0) >= cfg.max_per_day) continue;   // day is full
    for (const [a, b] of cfg.hours[day.getUTCDay()] || []) {
      const [ah, am] = a.split(':').map(Number);
      const [bh, bm] = b.split(':').map(Number);
      const winEnd = zonedToUtc(y, m, d, bh, bm, tz);
      for (let s = zonedToUtc(y, m, d, ah, am, tz); s + dur <= winEnd; s += cfg.step * 60000) {
        if (s < earliest) continue;
        const clash = busy.some(bk => s < bk.end + buf && s + dur > bk.start - buf);
        if (!clash) out.push(s);
      }
    }
  }
  return out;
}

async function slots() {
  const cfg = await getConfig();
  const now = Date.now();
  const to = now + (cfg.horizon_days + 1) * 86400000;
  const [busy, counts] = await Promise.all([busyBlocks(cfg, now, to), perDayCounts(cfg, now, to)]);
  return {
    timezone: cfg.timezone,
    duration: cfg.duration,
    slots: computeSlots(cfg, { now, busy, counts }).map(t => new Date(t).toISOString()),
    budgets: BUDGETS,
  };
}

// ─── Booking ────────────────────────────────────────────────────────────────
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

// Checks the slot is still open using fresh calendar data. Caller holds the lock.
async function assertOpen(cfg, startMs, { ignoreBookingId = null } = {}) {
  const now = Date.now();
  const to = now + (cfg.horizon_days + 1) * 86400000;
  let busy = await busyBlocks(cfg, now, to, { fresh: true });
  if (ignoreBookingId) {
    // When moving a booking, its own current slot (in Google and in the DB) mustn't block the move.
    const { rows } = await pool.query('SELECT start_at, end_at FROM bookings WHERE id = $1', [ignoreBookingId]);
    if (rows[0]) {
      const s = new Date(rows[0].start_at).getTime(), e = new Date(rows[0].end_at).getTime();
      busy = busy.filter(b => !(b.start === s && b.end === e));
    }
  }
  const counts = await perDayCounts(cfg, now, to);
  if (ignoreBookingId) {
    const { rows } = await pool.query('SELECT start_at FROM bookings WHERE id = $1', [ignoreBookingId]);
    if (rows[0]) { const k = localDate(new Date(rows[0].start_at).getTime(), cfg.timezone).key; counts[k] = Math.max(0, (counts[k] || 0) - 1); }
  }
  const open = computeSlots(cfg, { now, busy, counts });
  if (!open.includes(startMs)) {
    const e = new Error('That time has just gone. Please pick another.');
    e.code = 'TAKEN';
    throw e;
  }
}

async function withLock(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['october_booking']);
    const out = await fn();
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}

// Find or create the pipeline lead this booking belongs to: the Snapshot the
// visitor ran (token passed through from the report page), else the latest
// lead with this email, else a new one from their website.
async function resolveLead({ snapshotToken, emailAddr, name, company, website, referral }) {
  let lead = snapshotToken ? await studio.getByPublicToken(snapshotToken) : null;
  if (!lead) {
    const { rows } = await pool.query('SELECT id FROM snapshot_leads WHERE lower(email) = lower($1) ORDER BY created_at DESC LIMIT 1', [emailAddr]);
    if (rows[0]) lead = await studio.getLead(rows[0].id);
  }
  if (!lead) {
    let url;
    try { url = studio.normaliseUrl(website).toString(); } catch { url = null; }
    if (!url) throw new Error('Add your website address.');
    const { rows } = await pool.query(
      `INSERT INTO snapshot_leads (url, email, company_name, contact_name, referral_source, source, status)
         VALUES ($1, $2, $3, $4, $5, 'booking', 'new') RETURNING id`,
      [url, emailAddr, company || null, name || null, referral || null]);
    return studio.getLead(rows[0].id);
  }
  await pool.query(
    `UPDATE snapshot_leads SET email = COALESCE(email, $2), contact_name = COALESCE(contact_name, $3),
       company_name = COALESCE(company_name, NULLIF($4, '')), referral_source = COALESCE(referral_source, NULLIF($5, ''))
     WHERE id = $1`, [lead.id, emailAddr, name, company, referral]);
  return studio.getLead(lead.id);
}

function fmtWhen(ms, tz) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(ms));
}

async function book(input = {}) {
  const startMs = new Date(input.start).getTime();
  if (!Number.isFinite(startMs)) throw new Error('Pick a time.');
  const name = clip(input.name, 120);
  const emailAddr = clip(input.email, 200).toLowerCase();
  const company = clip(input.company, 160);
  const website = clip(input.website, 300);
  const goal = clip(input.goal, 1000);
  const budget = BUDGETS.includes(input.budget) ? input.budget : null;
  const referral = clip(input.referral, 160);
  const tz = clip(input.timezone, 64) || null;
  if (!name) throw new Error('Add your name.');
  if (!isEmail(emailAddr)) throw new Error('Add a valid email address.');
  if (!company) throw new Error('Add your company.');
  if (!website) throw new Error('Add your website address.');
  if (!budget) throw new Error('Choose a budget range.');

  const cfg = await getConfig();
  const lead = await resolveLead({ snapshotToken: clip(input.snapshot, 80) || null, emailAddr, name, company, website, referral });
  const token = crypto.randomBytes(18).toString('base64url');
  const manageUrl = `${PLATFORM_URL()}/b/${token}`;

  const booking = await withLock(async () => {
    await assertOpen(cfg, startMs);
    const endMs = startMs + cfg.duration * 60000;
    const ev = await gcal.createMeetEvent({
      calendarId: cfg.calendar_ids[0] || 'primary',
      summary: cfg.title.replace('{company}', company).replace('{name}', name),
      description: [
        `${name}, ${company} (${website})`,
        goal ? `What they want more of: ${goal}` : null,
        `Budget: ${budget}`,
        referral ? `Heard about us: ${referral}` : null,
        '',
        `Need to move or cancel? ${manageUrl}`,
      ].filter(v => v !== null).join('\n'),
      start: startMs, end: endMs,
      attendees: [{ email: emailAddr, displayName: name }],
      requestId: token,
    });
    const { rows } = await pool.query(
      `INSERT INTO bookings (lead_id, manage_token, start_at, end_at, timezone, name, email, company, website, answers, calendar_event_id, meet_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [lead.id, token, new Date(startMs), new Date(endMs), tz, name, emailAddr, company, website,
        JSON.stringify({ goal, budget, referral }), ev.id, ev.meet_url]);
    busyCache.at = 0;
    return rows[0];
  });

  // Pipeline: call booked, answers into the notes, brief prepared in the background.
  const notes = [`Booking form: wants more of: ${goal || '(not said)'}`, `Budget: ${budget}`].join('\n');
  await pool.query(
    `UPDATE snapshot_leads SET call_notes = CASE WHEN call_notes IS NULL OR call_notes = '' THEN $2 ELSE call_notes END WHERE id = $1`,
    [lead.id, notes]);
  await proposals.markCallBooked(lead.id, new Date(startMs).toISOString());
  proposals.callBrief(lead.id).catch(e => console.warn(`[booking] brief for ${lead.id} failed: ${e.message}`));

  const lowBudget = budget === BUDGETS[0];
  email.sendPipelineAlert({
    subject: `Call booked: ${company}, ${fmtWhen(startMs, cfg.timezone)}`,
    headline: `${name} (${company}) booked a call for ${fmtWhen(startMs, cfg.timezone)}.`,
    lines: [
      `Website: ${website}`,
      `Wants more of: ${goal || 'not said'}`,
      `Budget: ${budget}${lowBudget ? ' (below Basic)' : ''}`,
      referral ? `Heard about us: ${referral}` : 'Referral source not given',
      lead.draft ? 'They ran a Snapshot before booking.' : 'No Snapshot yet; OMI is reading their site now.',
      booking.meet_url ? `Meet: ${booking.meet_url}` : 'Meet link missing, check the calendar event.',
    ],
    suggestion: lowBudget
      ? 'Budget sits below the Basic tier. Decide before the call whether to keep it, move it to a 15-minute fit check, or point them to a lighter option.'
      : 'The call brief will be on the lead page within a couple of minutes.',
    link: `${PLATFORM_URL()}/leads/${lead.id}`,
  }).catch(() => {});

  return publicView(booking, cfg);
}

function publicView(b, cfg) {
  return {
    status: b.status,
    start: new Date(b.start_at).toISOString(),
    end: new Date(b.end_at).toISOString(),
    duration: cfg?.duration,
    name: b.name,
    company: b.company,
    meet_url: b.status === 'confirmed' ? b.meet_url : null,
    email: b.email,
    can_reschedule: b.status === 'confirmed' && (b.reschedule_count || 0) < (cfg?.max_reschedules ?? 3) && new Date(b.start_at).getTime() > Date.now(),
    can_cancel: b.status === 'confirmed' && new Date(b.start_at).getTime() > Date.now(),
  };
}

async function byToken(token) {
  if (!token || token.length < 10) return null;
  const { rows } = await pool.query('SELECT * FROM bookings WHERE manage_token = $1', [token]);
  return rows[0] || null;
}

async function manageView(token) {
  const b = await byToken(token);
  if (!b) return null;
  return publicView(b, await getConfig());
}

async function reschedule(token, start) {
  const cfg = await getConfig();
  const b = await byToken(token);
  if (!b) return null;
  const v = publicView(b, cfg);
  if (!v.can_reschedule) throw new Error('This booking can no longer be moved online. Reply to the invite and we will sort it.');
  const startMs = new Date(start).getTime();
  if (!Number.isFinite(startMs)) throw new Error('Pick a time.');
  const updated = await withLock(async () => {
    await assertOpen(cfg, startMs, { ignoreBookingId: b.id });
    const endMs = startMs + cfg.duration * 60000;
    await gcal.moveEvent({ calendarId: cfg.calendar_ids[0] || 'primary', eventId: b.calendar_event_id, start: startMs, end: endMs });
    const { rows } = await pool.query(
      `UPDATE bookings SET start_at = $2, end_at = $3, reschedule_count = reschedule_count + 1 WHERE id = $1 RETURNING *`,
      [b.id, new Date(startMs), new Date(endMs)]);
    busyCache.at = 0;
    return rows[0];
  });
  if (b.lead_id) await pool.query('UPDATE snapshot_leads SET call_at = $2 WHERE id = $1', [b.lead_id, new Date(startMs)]);
  email.sendPipelineAlert({
    subject: `Moved: ${b.company} now ${fmtWhen(startMs, cfg.timezone)}`,
    headline: `${b.name} moved the call from ${fmtWhen(new Date(b.start_at).getTime(), cfg.timezone)} to ${fmtWhen(startMs, cfg.timezone)}.`,
    lines: [], link: b.lead_id ? `${PLATFORM_URL()}/leads/${b.lead_id}` : null,
  }).catch(() => {});
  return publicView(updated, cfg);
}

async function cancel(token, reason) {
  const cfg = await getConfig();
  const b = await byToken(token);
  if (!b) return null;
  if (!publicView(b, cfg).can_cancel) throw new Error('This booking is already cancelled or in the past.');
  await gcal.cancelEvent({ calendarId: cfg.calendar_ids[0] || 'primary', eventId: b.calendar_event_id });
  const { rows } = await pool.query(
    `UPDATE bookings SET status = 'cancelled', cancelled_at = NOW(), answers = answers || jsonb_build_object('cancel_reason', $2::text) WHERE id = $1 RETURNING *`,
    [b.id, clip(reason, 500) || null]);
  busyCache.at = 0;
  if (b.lead_id) {
    await pool.query(
      `UPDATE snapshot_leads SET call_at = NULL, status = CASE WHEN status = 'booked' THEN 'drafted' ELSE status END WHERE id = $1`, [b.lead_id]);
  }
  email.sendPipelineAlert({
    subject: `Cancelled: ${b.company}`,
    headline: `${b.name} (${b.company}) cancelled the call on ${fmtWhen(new Date(b.start_at).getTime(), cfg.timezone)}.`,
    lines: reason ? [`Reason: ${clip(reason, 500)}`] : ['No reason given.'],
    suggestion: 'One personal line from you within a day tends to rebook. Offer two specific times.',
    link: b.lead_id ? `${PLATFORM_URL()}/leads/${b.lead_id}` : null,
  }).catch(() => {});
  return publicView(rows[0], cfg);
}

async function upcoming() {
  const { rows } = await pool.query(
    `SELECT b.id, b.lead_id, b.status, b.start_at, b.name, b.company, b.email, b.answers, b.meet_url, b.reschedule_count
       FROM bookings b WHERE b.start_at > NOW() - INTERVAL '14 days' ORDER BY b.start_at ASC LIMIT 100`);
  return rows;
}

module.exports = {
  DEFAULTS, BUDGETS, getConfig, saveConfig, slots, book, manageView, reschedule, cancel, upcoming,
  computeSlots, zonedToUtc, offsetMs,
};
