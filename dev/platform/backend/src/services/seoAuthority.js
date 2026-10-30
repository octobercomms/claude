// The Authority panel's numbers, fetched rather than typed.
//
// Until now all three were copied by hand once a month, and a cron emailed a
// reminder to go and do it, one email per client. Two of the three no longer
// need a person:
//
//   **referring domains** was never missing. DataForSEO has filled
//   `dfs_backlinks_summary` every three days since the Backlinks API came off
//   its subscription on 1 July 2026, and Drift and the Dashboard already read
//   it. The hand-typed monthly figure was a staler copy of a number in the
//   same database, displayed further up the same page.
//
//   **Moz DA** is one Moz API call per client per month. The free tier is 50
//   rows a month and October has twelve clients.
//
// **authority_score (Semrush) is not fetched and not asked for.** It measures
// what Moz DA measures, from another vendor, so collecting both is two
// numbers that move together. The column stays readable; nothing writes it.
//
// Everything here is idempotent on (client, month). Running it twice in a
// month overwrites with the same answer rather than stacking rows, and it
// never blanks a figure it could not fetch: a month that already has a value
// keeps it when a later run fails.

const pool = require('../db');
const moz = require('../connectors/moz');

// The free Moz tier allows roughly one request every ten seconds. Twelve
// clients therefore take about two minutes, which is fine for a job that runs
// once a month unattended, and far better than a 429 halfway through.
const MOZ_GAP_MS = 11000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function monthKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  return d.toISOString().slice(0, 10);
}

// The latest referring-domains figure DataForSEO has for this client.
// Deliberately "latest", not "latest within the month": the sweep runs every
// three days, so the newest snapshot is at most three days old and is a
// better answer for a month-stamped row than an older one that happens to
// fall inside it.
async function referringDomainsFor(clientId) {
  const { rows } = await pool.query(
    `SELECT referring_domains_total, captured_at
       FROM dfs_backlinks_summary
      WHERE client_id = $1 AND referring_domains_total IS NOT NULL
      ORDER BY captured_at DESC
      LIMIT 1`,
    [clientId]
  );
  if (!rows.length) return null;
  return { value: Number(rows[0].referring_domains_total), captured_at: rows[0].captured_at };
}

// One client. Returns what it filled and what it could not, per metric, so
// the caller can report rather than guess.
//   { client_id, month, moz_da, referring_domains, errors: {metric: reason} }
async function fillForClient(clientId, { month = monthKey(), domain = null, withMoz = true } = {}) {
  const out = { client_id: clientId, month, moz_da: null, referring_domains: null, errors: {} };

  // Referring domains, from the snapshot already on disk. No network call.
  try {
    const rd = await referringDomainsFor(clientId);
    if (rd) out.referring_domains = rd.value;
    else out.errors.referring_domains = 'No DataForSEO backlinks snapshot for this client yet.';
  } catch (err) {
    out.errors.referring_domains = err.message;
  }

  // Moz DA, one row of the monthly allowance.
  if (withMoz) {
    try {
      let target = domain;
      if (!target) {
        const { rows } = await pool.query('SELECT domain FROM clients WHERE id = $1', [clientId]);
        target = rows[0]?.domain || null;
      }
      if (!target) {
        out.errors.moz_da = 'No domain set for this client.';
      } else {
        const m = await moz.urlMetrics(target);
        if (m.domain_authority == null) out.errors.moz_da = 'Moz returned no domain authority.';
        else out.moz_da = m.domain_authority;
      }
    } catch (err) {
      out.errors.moz_da = err.code === 'MOZ_NOT_CONFIGURED'
        ? 'Moz API credentials not set.'
        : err.message;
    }
  }

  // Nothing fetched, nothing written. Writing a row of nulls would overwrite
  // a figure a person typed before this existed.
  if (out.moz_da == null && out.referring_domains == null) return out;

  // COALESCE on the update so a metric that failed this run keeps whatever
  // the month already had, rather than being blanked by a bad fetch.
  await pool.query(
    `INSERT INTO seo_manual_metrics
       (client_id, month, moz_da, referring_domains,
        moz_da_source, referring_domains_source, sources_filled_at)
     VALUES ($1, date_trunc('month', $2::date)::date, $3, $4,
             CASE WHEN $3::int IS NULL THEN NULL ELSE 'moz' END,
             CASE WHEN $4::int IS NULL THEN NULL ELSE 'dataforseo' END,
             NOW())
     ON CONFLICT (client_id, month) DO UPDATE SET
       moz_da = COALESCE(EXCLUDED.moz_da, seo_manual_metrics.moz_da),
       referring_domains = COALESCE(EXCLUDED.referring_domains, seo_manual_metrics.referring_domains),
       moz_da_source = COALESCE(EXCLUDED.moz_da_source, seo_manual_metrics.moz_da_source),
       referring_domains_source = COALESCE(EXCLUDED.referring_domains_source, seo_manual_metrics.referring_domains_source),
       sources_filled_at = NOW(),
       updated_at = NOW()`,
    [clientId, month, out.moz_da, out.referring_domains]
  );
  return out;
}

// Every active client with a domain. Paced for the free Moz tier.
async function fillAllClients({ month = monthKey() } = {}) {
  const withMoz = await moz.isConfigured();
  const { rows: clients } = await pool.query(
    `SELECT id, name, domain FROM clients
      WHERE active = true AND domain IS NOT NULL AND domain <> ''
      ORDER BY name ASC`
  );

  const results = [];
  for (let i = 0; i < clients.length; i += 1) {
    const c = clients[i];
    // Paced between Moz calls only. Without Moz there is no network call at
    // all and the sweep is a handful of queries.
    if (withMoz && i > 0) await sleep(MOZ_GAP_MS);
    const r = await fillForClient(c.id, { month, domain: c.domain, withMoz });
    results.push({ ...r, name: c.name });
  }

  return {
    month,
    clients: clients.length,
    moz_configured: withMoz,
    filled_da: results.filter(r => r.moz_da != null).length,
    filled_rd: results.filter(r => r.referring_domains != null).length,
    results,
  };
}

module.exports = { fillForClient, fillAllClients, referringDomainsFor, monthKey, MOZ_GAP_MS };
