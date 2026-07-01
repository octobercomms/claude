// Phase E1 — Backlinks raw data pull, persisted per client.
//
// pullBacklinks(clientId) hits the three DFS Backlinks endpoints once and
// writes a snapshot row-set stamped with a single shared captured_at, so a
// cycle is atomic-ish for downstream diffing (E3) and trending (E2). The
// 3-day sweep in services/scheduler.js calls this for every active client
// with a domain.
//
// GATING: the DFS Backlinks API went pay-as-you-go for everyone on
// 1 July 2026. Before then isUnlocked('backlinks') is false and this
// throws a friendly 503 instead of a billing error. Post-cutover it's a
// no-op guard. See docs/omi/dataforseo-july-2026.md.

const pool = require('../db');
const dataForSEO = require('../connectors/dataforseo');
const { isUnlocked } = require('./dfsAvailability');

// Pull + persist one backlinks snapshot for a single client. Returns a
// small summary of what was written so the scheduler can log it and the
// (later) manual "refresh now" button can report progress.
async function pullBacklinks(clientId) {
  if (!isUnlocked('backlinks')) {
    const err = new Error('DataForSEO Backlinks is gated until 1 July 2026.');
    err.status = 503;
    throw err;
  }

  const { rows } = await pool.query('SELECT domain FROM clients WHERE id = $1', [clientId]);
  if (!rows.length) throw new Error('Client not found');
  const domain = (rows[0].domain || '').trim();
  if (!domain) throw new Error('Client has no domain set');

  // One timestamp for the whole cycle so summary / RDs / anchors line up.
  const capturedAt = new Date();

  // Fetch all three in parallel — independent DFS calls. If one fails we
  // still want the others, so settle rather than all-or-nothing.
  const [summaryR, rdsR, anchorsR] = await Promise.allSettled([
    dataForSEO.fetchBacklinkData(domain),
    dataForSEO.fetchReferringDomains(domain, { limit: 1000 }),
    dataForSEO.fetchAnchorTextDistribution(domain, { limit: 100 }),
  ]);

  const result = { client_id: clientId, captured_at: capturedAt, summary: false, referring_domains: 0, anchors: 0, errors: [] };

  // Summary — one row.
  if (summaryR.status === 'fulfilled' && summaryR.value) {
    const s = summaryR.value;
    const backlinks = num(s.backlinks);
    const nofollow = num(s.backlinks_nofollow);
    const dofollowRatio = backlinks ? Number(((backlinks - (nofollow || 0)) / backlinks).toFixed(4)) : null;
    await pool.query(
      `INSERT INTO dfs_backlinks_summary
         (client_id, captured_at, backlinks_total, referring_domains_total, dofollow_ratio, spam_score, rank, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [clientId, capturedAt, backlinks, num(s.referring_domains), dofollowRatio,
       num(s.backlinks_spam_score), num(s.rank), s]
    );
    result.summary = true;
  } else if (summaryR.status === 'rejected') {
    result.errors.push(`summary: ${summaryR.reason?.message || summaryR.reason}`);
  }

  // Referring domains — top ~1000, one row each. Batched insert.
  if (rdsR.status === 'fulfilled' && rdsR.value?.length) {
    const rds = rdsR.value;
    // Chunk to keep the parameter count under Postgres' 65535 cap
    // (9 params/row -> ~7000 rows/statement; 500 is comfortable).
    for (let i = 0; i < rds.length; i += 500) {
      const chunk = rds.slice(i, i + 500);
      const values = [];
      const params = [];
      chunk.forEach((d, j) => {
        const b = j * 9;
        values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9})`);
        params.push(clientId, capturedAt, d.domain, d.rank, d.first_seen, d.last_seen, d.backlinks_count, d.dofollow, d.raw);
      });
      await pool.query(
        `INSERT INTO dfs_referring_domains
           (client_id, captured_at, domain, rank, first_seen, last_seen, backlinks_count, dofollow, raw)
         VALUES ${values.join(', ')}`,
        params
      );
    }
    result.referring_domains = rds.length;
  } else if (rdsR.status === 'rejected') {
    result.errors.push(`referring_domains: ${rdsR.reason?.message || rdsR.reason}`);
  }

  // Anchors — top ~100.
  if (anchorsR.status === 'fulfilled' && anchorsR.value?.length) {
    const anchors = anchorsR.value;
    const values = [];
    const params = [];
    anchors.forEach((a, j) => {
      const b = j * 5;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`);
      params.push(clientId, capturedAt, a.anchor, a.backlinks, a.referring_domains);
    });
    await pool.query(
      `INSERT INTO dfs_anchors
         (client_id, captured_at, anchor, backlinks_count, referring_domains_count)
       VALUES ${values.join(', ')}`,
      params
    );
    result.anchors = anchors.length;
  } else if (anchorsR.status === 'rejected') {
    result.errors.push(`anchors: ${anchorsR.reason?.message || anchorsR.reason}`);
  }

  return result;
}

// Sweep every active client with a domain. Called from the 3-day cron.
// Runs clients sequentially so we don't hammer DFS with a burst of
// concurrent live calls (each does 3 requests).
async function pullBacklinksAllClients() {
  if (!isUnlocked('backlinks')) return { skipped: true, clients: 0 };
  const { rows } = await pool.query(
    "SELECT id, domain FROM clients WHERE active = TRUE AND domain IS NOT NULL AND domain != ''"
  );
  let ok = 0;
  for (const c of rows) {
    try {
      const r = await pullBacklinks(c.id);
      ok++;
      console.log(`[Backlinks] ${c.domain}: summary=${r.summary} rds=${r.referring_domains} anchors=${r.anchors}${r.errors.length ? ' errors=' + r.errors.join('; ') : ''}`);
    } catch (err) {
      console.warn(`[Backlinks] ${c.domain}: ${err.message}`);
    }
  }
  return { skipped: false, clients: rows.length, ok };
}

function num(v) {
  return (typeof v === 'number' && Number.isFinite(v)) ? v : null;
}

module.exports = { pullBacklinks, pullBacklinksAllClients };
