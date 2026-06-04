// In-house error tracker — the lightweight Sentry alternative.
// Captures:
//   - Backend uncaughtException + unhandledRejection (wired in index.js)
//   - Cron failures (recordError called from scheduler.js catch blocks)
//   - Frontend ErrorBoundary + window.onerror (via /api/_internal/log-frontend-error)
//
// Writes each error to error_log with a sha256 fingerprint so the daily
// digest can roll up duplicates ("ReferenceError x 4,217 in last 24h")
// rather than spamming one line per occurrence.

const crypto = require('crypto');
const pool = require('../db');

// Build a stable fingerprint per error. First non-empty stack frame is
// usually enough to identify the call site; falling back to the message
// keeps fingerprints unique even when stack is missing (frontend errors
// often arrive without one when source maps fail).
function fingerprint({ message, stack }) {
  const firstFrame = String(stack || '')
    .split('\n')
    .map(s => s.trim())
    .find(s => s.startsWith('at ') && !s.includes('<anonymous>')) || '';
  const seed = `${message || 'unknown'}::${firstFrame}`;
  return crypto.createHash('sha256').update(seed).digest('hex');
}

async function recordError({ source = 'backend', message, stack = null, context = {}, userAgent = null }) {
  if (!message) message = 'unknown error';
  try {
    await pool.query(
      `INSERT INTO error_log (source, fingerprint, message, stack, context, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        source.slice(0, 40),
        fingerprint({ message, stack }),
        String(message).slice(0, 4000),
        stack ? String(stack).slice(0, 16000) : null,
        JSON.stringify(context || {}),
        userAgent ? String(userAgent).slice(0, 500) : null,
      ]
    );
  } catch (err) {
    // Last resort — if we can't even write to the error log (DB down),
    // at least put it in the process log. Never throw from recordError;
    // callers are usually already in a fatal path.
    console.error('[errorTracker] failed to record error:', err.message, '| original:', message);
  }
}

// Sweep the last `hours` of error_log and aggregate by fingerprint for
// the daily digest email. Returns groups ordered by occurrence count
// desc, capped at 50 to keep the email scannable.
async function recentSummary({ hours = 24, groupLimit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT fingerprint,
            MIN(source) AS source,
            MAX(occurred_at) AS last_seen,
            MIN(occurred_at) AS first_seen,
            COUNT(*)::int AS count,
            (ARRAY_AGG(message ORDER BY occurred_at DESC))[1] AS message,
            (ARRAY_AGG(stack ORDER BY occurred_at DESC) FILTER (WHERE stack IS NOT NULL))[1] AS stack,
            (ARRAY_AGG(context ORDER BY occurred_at DESC))[1] AS last_context
       FROM error_log
      WHERE occurred_at >= NOW() - ($1::int || ' hours')::interval
      GROUP BY fingerprint
      ORDER BY count DESC, last_seen DESC
      LIMIT $2`,
    [hours, groupLimit]
  );
  const { rows: totalRows } = await pool.query(
    `SELECT COUNT(*)::int AS total FROM error_log WHERE occurred_at >= NOW() - ($1::int || ' hours')::interval`,
    [hours]
  );
  return { total: totalRows[0]?.total || 0, groups: rows };
}

// Prune rows older than 30 days. Called from the daily cron.
async function prune({ olderThanDays = 30 } = {}) {
  const { rowCount } = await pool.query(
    `DELETE FROM error_log WHERE occurred_at < NOW() - ($1::int || ' days')::interval`,
    [olderThanDays]
  );
  return rowCount;
}

module.exports = { recordError, recentSummary, prune, fingerprint };
