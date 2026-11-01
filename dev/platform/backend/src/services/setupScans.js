// The nine setup scans: show what each one costs, run the ticked ones.
//
// Nine items in the 31 October review asked for a scan to run at setup. That
// is one decision, not nine, and it is a cost decision: today setup seeds
// four worked examples and costs a few pence, while each of these is a paid
// API call or a Claude run. Running all nine on every new client spends real
// money on the first click, most of it on scans nobody asked for. The call
// was the middle option — show the nine with their prices and run the ticked
// ones — which is how the Paid Brief step already works.
//
// Three rules, the same three worked examples learned:
//
// **Idempotent.** A second press returns what the first made. Nobody can tell
// by looking whether a scan has run, so pressing it twice must not cost
// twice. Every scan answers `find` before it answers `run`.
//
// **Never silent about failure.** One scan failing must not take the others
// with it, and must not be reported as success. Each returns its own outcome
// and the caller shows all nine.
//
// **It never runs on its own.** No scan here is triggered by creating a
// client, by opening a page, or by a cron. It waits for the tick and the
// button.
//
// On inputs. Three scans run from the client record alone. Two need the
// competitor list, which is why Competitors runs first: ticking it and a scan
// that consumes it in the same press works, because the list exists by the
// time the second one asks. Four need a service and a city, which the client
// record does not hold — there is no column for either — so the picker
// collects them and they are required only when a scan that needs them is
// ticked.

const pool = require('../db');
const clientCompetitors = require('./clientCompetitors');
const subredditResearch = require('./subredditResearch');
const aiSeo = require('./aiSeo');
const localSeo = require('./localSeo');
const { domainExists } = require('../utils/domainExists');

// What a scan can be waiting on. Each is checked against the client record,
// not assumed.
const NEEDS = {
  domain: 'a website on the client record',
  // A domain that is set but does not resolve is not the same problem as no
  // domain, and used to be reported as four separate scan failures in four
  // different vocabularies. On 1 November that was morrowcomms.com, a domain
  // picked for the client automatically, so nobody had typed it and nobody
  // had reason to doubt it. Naming the cause once is the whole fix.
  domain_dead: 'a website that resolves — the one on the record has no DNS record at all',
  competitors: 'at least one competitor (tick Competitors too and it runs first)',
  service_city: 'a service and a city',
};

// A local SEO scan is the same shape six times: look for a previous run of
// that tool, otherwise run it with the inputs it takes.
function localScan({ key, tool, label, what, feature, needs, body }) {
  return {
    key, label, what, feature, needs,
    async find(clientId) {
      const runs = await localSeo.listRuns(clientId, tool);
      return runs[0] || null;
    },
    async run(ctx) {
      return localSeo.run(tool, ctx.clientId, body(ctx));
    },
  };
}

// Order is load-bearing: Competitors is first because two scans below read
// the list it fills.
const SCANS = [
  {
    key: 'competitors',
    label: 'Competitors',
    what: 'who this client is up against, saved to the competitor list',
    feature: 'competitor_suggest',
    needs: [],
    async find(clientId) {
      const rows = await clientCompetitors.list(clientId);
      return rows.length ? rows[0] : null;
    },
    async run({ clientId }) {
      // Idempotent on its own account: with a list stored it returns the
      // stored one and spends nothing.
      return clientCompetitors.suggest(clientId);
    },
  },
  {
    key: 'subreddits',
    label: 'Subreddits',
    what: 'the subreddits where this client\'s buyers gather',
    feature: 'subreddit_suggest',
    needs: [],
    async find(clientId) {
      const rows = await subredditResearch.listSubreddits(clientId);
      return rows.length ? rows[0] : null;
    },
    async run({ clientId }) {
      return subredditResearch.suggestAndStore(clientId);
    },
  },
  {
    key: 'ai_seo',
    label: 'Starter keywords',
    what: 'keyword targets drawn from the brief and the website',
    feature: 'ai_seo_keywords',
    needs: ['domain'],
    async find(clientId) {
      const rows = await aiSeo.listKeywordTargets(clientId);
      return rows.length ? rows[0] : null;
    },
    async run({ clientId }) {
      return aiSeo.generateKeywordTargets(clientId, {});
    },
  },
  localScan({
    key: 'schema',
    tool: 'schema_audit',
    label: 'Schema audit',
    what: 'every schema type on the site\'s pages, graded, with the JSON-LD to fix the gaps',
    feature: 'local_seo_schema_audit',
    needs: ['domain'],
    body: ({ client }) => ({ url: client.domain }),
  }),
  localScan({
    key: 'local_gap',
    tool: 'competition_gap',
    label: 'Competition gap',
    what: 'the content and trust gaps against the competitor sites',
    feature: 'local_seo_competition_gap',
    needs: ['competitors'],
    body: ({ competitorUrls }) => ({ competitorUrls }),
  }),
  localScan({
    key: 'business_xray',
    tool: 'competitor_xray',
    label: 'Competitor X-ray',
    what: 'this site against the competitors, side by side, with the advantages named',
    feature: 'local_seo_competitor_xray',
    needs: ['domain', 'competitors'],
    body: ({ client, competitorUrls }) => ({ myUrl: client.domain, competitorUrls }),
  }),
  localScan({
    key: 'keyword_sniper',
    tool: 'buyer_intent',
    label: 'Buyer-intent keywords',
    what: '20 high-intent local keywords for the service and city',
    feature: 'local_seo_buyer_intent',
    needs: ['service_city'],
    body: ({ service, city }) => ({ service, city }),
  }),
  localScan({
    key: 'gbp_playbook',
    tool: 'ranking_playbook',
    label: 'GBP ranking playbook',
    what: 'the levers the local map pack rewards for this service and city',
    feature: 'local_seo_ranking_playbook',
    needs: ['service_city'],
    body: ({ service, city, competitorUrls }) => ({ service, city, competitorUrls }),
  }),
  localScan({
    key: 'ranking_outliers',
    tool: 'ranking_outliers',
    label: 'Ranking outliers',
    what: 'who ranks despite weak signals, and the one lever carrying them',
    feature: 'local_seo_ranking_outliers',
    needs: ['service_city'],
    body: ({ service, city, competitorUrls }) => ({ service, city, competitorUrls }),
  }),
];

const BY_KEY = new Map(SCANS.map(s => [s.key, s]));

function isScan(key) { return BY_KEY.has(key); }

async function loadClient(clientId) {
  const { rows } = await pool.query(
    'SELECT id, name, domain, briefing_field FROM clients WHERE id = $1', [clientId]);
  if (!rows.length) { const e = new Error('Client not found'); e.status = 404; throw e; }
  return rows[0];
}

// The competitor URLs two of the scans consume, capped at three because that
// is what the tools take.
async function competitorUrls(clientId) {
  const rows = await clientCompetitors.list(clientId);
  return rows.map(c => c.domain).filter(Boolean).slice(0, 3);
}

// What a scan is missing, given what is on hand. `service` and `city` come
// from the form rather than the record, so they are passed in.
function missingFor(scan, { client, competitors, service, city, domainDead }) {
  const out = [];
  for (const need of scan.needs) {
    if (need === 'domain' && !String(client.domain || '').trim()) out.push(need);
    // Only when the domain is set: "not set" and "set but dead" are different
    // sentences and the picker should not print both.
    else if (need === 'domain' && domainDead) out.push('domain_dead');
    if (need === 'competitors' && !competitors) out.push(need);
    if (need === 'service_city' && (!String(service || '').trim() || !String(city || '').trim())) out.push(need);
  }
  return out;
}

// The picker's data: every scan, what it produces, what it costs the caller
// to find out (the frontend reads the median from the usage API), whether one
// has already run, and what it is waiting on.
async function catalogue(clientId) {
  const client = await loadClient(clientId);
  const urls = await competitorUrls(clientId);
  // Asked once, before the picker is drawn, rather than discovered four times
  // over by four scans that each fetch the same unreachable site. `known` is
  // false when the resolver itself could not be trusted, and an unknown
  // answer must never block a client whose site is fine.
  const dns = String(client.domain || '').trim()
    ? await domainExists(client.domain).catch(() => ({ exists: true, known: false, reason: 'check failed' }))
    : { exists: false, known: true, reason: 'no domain set' };
  const domainDead = dns.known && !dns.exists;
  const scans = [];
  for (const scan of SCANS) {
    const existing = await scan.find(clientId).catch(() => null);
    // service and city are unknown here — the form has them — so a scan that
    // needs them reports that need rather than a missing value.
    const missing = missingFor(scan, { client, competitors: urls.length > 0, domainDead });
    scans.push({
      key: scan.key,
      label: scan.label,
      what: scan.what,
      feature: scan.feature,
      needs: scan.needs,
      present: !!existing,
      missing,
      missing_labels: missing.map(m => NEEDS[m]),
      wants_service_city: scan.needs.includes('service_city'),
    });
  }
  return {
    scans,
    client: { id: client.id, name: client.name, domain: client.domain || null },
    // The picker shows this above the list, so the four blocked scans have one
    // explanation between them instead of four failures after the fact.
    domain_check: { ok: !domainDead, checked: dns.known, reason: dns.reason },
  };
}

// Run the ticked ones, in catalogue order, one at a time.
//
// Sequential rather than parallel for one reason that matters: Competitors
// fills the list that Competition gap and the X-ray read, so ticking all
// three in one press has to run the first before the other two ask. The
// competitor list is therefore re-read for each scan rather than captured
// once.
async function run(clientId, { scans: asked, service = '', city = '' } = {}) {
  const keys = (Array.isArray(asked) ? asked : []).filter(isScan);
  if (!keys.length) { const e = new Error('Tick at least one scan.'); e.status = 400; throw e; }
  const client = await loadClient(clientId);
  const ordered = SCANS.filter(s => keys.includes(s.key));

  const results = [];
  for (const scan of ordered) {
    const urls = await competitorUrls(clientId);
    const missing = missingFor(scan, { client, competitors: urls.length > 0, service, city });
    if (missing.length) {
      results.push({
        key: scan.key, label: scan.label, status: 'skipped',
        reason: `needs ${missing.map(m => NEEDS[m]).join(' and ')}`,
      });
      continue;
    }
    const existing = await scan.find(clientId).catch(() => null);
    if (existing) {
      results.push({ key: scan.key, label: scan.label, status: 'existed' });
      continue;
    }
    try {
      await scan.run({ clientId, client, competitorUrls: urls, service: String(service).trim(), city: String(city).trim() });
      results.push({ key: scan.key, label: scan.label, status: 'created' });
    } catch (err) {
      console.error(`[setup-scans] ${scan.key} failed:`, err.message);
      results.push({ key: scan.key, label: scan.label, status: 'failed', error: err.message });
    }
  }

  return {
    results,
    created: results.filter(r => r.status === 'created').length,
    existed: results.filter(r => r.status === 'existed').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    failed: results.filter(r => r.status === 'failed').length,
  };
}

module.exports = { SCANS, NEEDS, catalogue, run, isScan, _missingFor: missingFor };
