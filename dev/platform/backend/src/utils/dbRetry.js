// Retry a transient database operation a few times with short backoff.
//
// The webhook ingests (WordPress plugin, Shopify app) treat the stored raw
// event as their durable record — there's no separate async processing to
// queue, the connectors aggregate on read. So "durable delivery" reduces to
// "the INSERT must not be lost to a momentary DB blip the sender won't
// re-deliver for". This wraps such writes in a couple of backed-off retries on
// transient errors (connection failures, serialization/deadlock, too-many-
// connections), while failing fast on permanent ones (constraint violations,
// bad SQL).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// PostgreSQL SQLSTATEs + Node socket codes that are worth retrying.
const TRANSIENT_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN',
  '08000', '08001', '08003', '08004', '08006', // connection exceptions
  '40001', '40P01',                              // serialization_failure, deadlock_detected
  '53300', '57P03',                              // too_many_connections, cannot_connect_now
]);

function isTransientDbError(err) {
  if (err && TRANSIENT_CODES.has(err.code)) return true;
  const msg = ((err && err.message) || '').toLowerCase();
  return /timeout|timed out|connection terminated|connection reset|econn|too many clients|cannot connect/.test(msg);
}

async function withDbRetry(fn, { attempts = 3, baseDelayMs = 200 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || !isTransientDbError(err)) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1); // 200ms, 400ms, …
      console.warn(`[dbRetry] attempt ${attempt}/${attempts} failed (${err.message}); retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

module.exports = { withDbRetry, isTransientDbError };
