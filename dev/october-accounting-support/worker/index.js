require('dotenv').config();
const cron = require('node-cron');

// Background poller. On each tick it will:
//   1. Refresh the Xero token if near expiry (refresh token rotates, re-store it).
//   2. Pull unreconciled bank lines from Xero.
//   3. Classify each: rule hit -> deterministic suggestion; miss/ambiguous ->
//      Anthropic proposes with reasoning.
//   4. Upsert into reconcile_queue for the review surface.
// Write-back to Xero only happens on human confirmation, and only when
// WRITE_BACK_ENABLED is true. Phase 1 runs read-only.

const SCHEDULE = process.env.POLL_CRON || '*/15 * * * *'; // every 15 minutes

async function poll() {
  // TODO Phase 1: implement steps 1-4 above.
  console.log(`[${new Date().toISOString()}] poll tick (stub) — write-back=${process.env.WRITE_BACK_ENABLED === 'true'}`);
}

cron.schedule(SCHEDULE, poll);
console.log(`october-accounting-support worker started, schedule "${SCHEDULE}"`);
poll();
