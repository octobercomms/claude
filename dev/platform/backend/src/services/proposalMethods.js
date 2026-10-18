// The offer, as data (docs/omi/sales-pipeline.md).
//
// A method is what October sells: a name, a price in each market, and the
// objectives, KPIs, strategy and tactics that it delivers. Those four content
// blocks used to be written fresh by Claude for every prospect, which made the
// proposal read as bespoke consulting and, worse, meant the KPIs in a document
// that becomes a contract on acceptance were invented on the spot. They are now
// decided once, here, and edited in Settings → Proposals.
//
// Prices are fixed per currency, never converted: £2,500 and $2,500 are
// different prices for different markets, deliberately. The currency is picked
// by hand on the draft screen.

const pool = require('../db');

const CURRENCIES = {
  GBP: { code: 'GBP', symbol: '£', label: 'Pounds' },
  USD: { code: 'USD', symbol: '$', label: 'US dollars' },
  EUR: { code: 'EUR', symbol: '€', label: 'Euros' },
};
const CURRENCY_CODES = Object.keys(CURRENCIES);

const symbolFor = (code) => CURRENCIES[String(code || '').toUpperCase()]?.symbol || '£';

const text = (v, max = 400) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : '';
};
const lines = (v, max = 12) => (Array.isArray(v) ? v : String(v || '').split('\n'))
  .map(x => text(x, 300)).filter(Boolean).slice(0, max);

// A price is only usable if it has a monthly figure. Setup and the GoCardless
// link are optional: Daniel may not have created the nine pages yet, and a
// missing link is handled at acceptance (he is told to follow up by hand)
// rather than blocking the proposal from going out.
function cleanPrices(raw) {
  const out = {};
  for (const code of CURRENCY_CODES) {
    const p = raw?.[code] || raw?.[code.toLowerCase()];
    if (!p) continue;
    const monthly = Number(p.monthly);
    if (!Number.isFinite(monthly) || monthly < 0) continue;
    const setup = Number(p.setup);
    const url = text(p.gocardless_url, 600);
    if (url && !/^https:\/\//i.test(url)) throw new Error(`The ${code} GoCardless link must start with https://`);
    out[code] = {
      monthly: Math.round(monthly),
      setup: Number.isFinite(setup) && setup > 0 ? Math.round(setup) : 0,
      ...(url ? { gocardless_url: url } : {}),
    };
  }
  return out;
}

function cleanObjectives(raw) {
  const o = {};
  for (const k of ['short', 'mid', 'long']) {
    const v = text(raw?.[k], 400);
    if (v) o[k] = v;
  }
  return o;
}

// Two tiers, and the split is the product rather than a presentation choice.
// "committed" is October's own output, so it is a promise that can be kept.
// "reported" is the outcome, which is influenced and not controlled: promising
// press coverage to someone who has bought PR before reads as naive or
// dishonest, and neither converts.
function cleanKpis(raw) {
  const k = {
    committed: lines(raw?.committed, 8),
    reported: lines(raw?.reported, 10),
  };
  const close = text(raw?.close, 400);
  if (close) k.close = close;
  return k;
}

const cleanStrategy = (raw) => (Array.isArray(raw) ? raw : [])
  .map(s => ({ title: text(s?.title, 120), text: text(s?.text, 800) }))
  .filter(s => s.title || s.text).slice(0, 6);

const cleanTactics = (raw) => (Array.isArray(raw) ? raw : [])
  .map(t => ({ heading: text(t?.heading, 120), items: lines(t?.items, 8) }))
  .filter(t => t.heading && t.items.length).slice(0, 8);

const cleanStages = (raw) => (Array.isArray(raw) ? raw : [])
  .map((s, i) => ({
    stage: text(s?.stage, 8) || String(i + 1).padStart(2, '0'),
    when: text(s?.when, 60),
    title: text(s?.title, 120),
    text: text(s?.text, 800),
  }))
  .filter(s => s.title || s.text).slice(0, 8);

const slugify = (v) => text(v, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// 'full'              case studies and outcome claims are fair game.
// 'no_outcome_claims' a new service nobody has run yet. The proposal may cite
//                     October's record and the testimonials, and may not imply
//                     a result this method produced, because it has not
//                     produced one.
//
// This is a column rather than a note to remember because matchProof's job is
// to find the most persuasive proof available, and a case study from a
// different service scores well on sector tags. Left to judgement, the engine
// would eventually put an outcome claim in front of a prospect for a method
// that has never run.
const EVIDENCE_POLICIES = ['full', 'no_outcome_claims'];
const evidencePolicy = (v) => (EVIDENCE_POLICIES.includes(v) ? v : 'full');

// Content fields only. A price change or a rename does not invalidate a sent
// proposal's reading of the method, so it does not bump the version.
const CONTENT_FIELDS = ['objectives', 'kpis', 'strategy', 'tactics', 'stages'];
const contentChanged = (before, after) =>
  CONTENT_FIELDS.some(f => JSON.stringify(before?.[f] ?? null) !== JSON.stringify(after[f]));

async function listMethods({ includeInactive = false } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM proposal_methods ${includeInactive ? '' : 'WHERE active'}
      ORDER BY sort_order, name`);
  return rows;
}

async function getMethod(id) {
  const { rows } = await pool.query('SELECT * FROM proposal_methods WHERE id = $1', [id]);
  return rows[0] || null;
}

async function getMethodBySlug(slug) {
  const { rows } = await pool.query('SELECT * FROM proposal_methods WHERE slug = $1', [slug]);
  return rows[0] || null;
}

async function saveMethod(id, f = {}) {
  const name = text(f.name, 160);
  if (!name) throw new Error('The method needs a name.');
  const slug = slugify(f.slug || name);
  if (!slug) throw new Error('The method needs a name with letters or numbers in it.');

  const next = {
    slug,
    name,
    family: text(f.family, 160) || null,
    blurb: text(f.blurb, 600) || null,
    evidence_policy: evidencePolicy(f.evidence_policy),
    scarcity: text(f.scarcity, 800) || null,
    sort_order: Number.isFinite(Number(f.sort_order)) ? Math.round(Number(f.sort_order)) : 0,
    active: f.active !== false,
    prices: cleanPrices(f.prices),
    includes: lines(f.includes, 12),
    objectives: cleanObjectives(f.objectives),
    kpis: cleanKpis(f.kpis),
    strategy: cleanStrategy(f.strategy),
    tactics: cleanTactics(f.tactics),
    stages: cleanStages(f.stages),
  };

  const cols = ['slug', 'name', 'family', 'blurb', 'evidence_policy', 'scarcity',
    'sort_order', 'active', 'prices', 'includes', 'objectives', 'kpis', 'strategy',
    'tactics', 'stages'];
  const vals = cols.map(c => (next[c] !== null && typeof next[c] === 'object' ? JSON.stringify(next[c]) : next[c]));

  if (id) {
    const before = await getMethod(id);
    if (!before) throw new Error('Method not found');
    const bump = contentChanged(before, next) ? ', version = version + 1' : '';
    const sets = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
    const { rows } = await pool.query(
      `UPDATE proposal_methods SET ${sets}${bump}, updated_at = NOW() WHERE id = $${cols.length + 1} RETURNING *`,
      [...vals, id]);
    return rows[0];
  }
  const { rows } = await pool.query(
    `INSERT INTO proposal_methods (${cols.join(', ')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, vals);
  return rows[0];
}

// Deactivate rather than delete where a proposal used it, so the pipeline's
// history stays readable. A method nothing has used is removed outright.
async function deleteMethod(id) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM proposals WHERE method_id = $1', [id]);
  if (rows[0].n > 0) {
    await pool.query('UPDATE proposal_methods SET active = false, updated_at = NOW() WHERE id = $1', [id]);
    return { archived: true, used_by: rows[0].n };
  }
  await pool.query('DELETE FROM proposal_methods WHERE id = $1', [id]);
  return { archived: false, used_by: 0 };
}

// What goes onto the proposal at draft time. The proposal keeps this rather
// than a reference, so improving the method later never rewrites a proposal
// that has already been sent or signed.
function snapshot(method, currencyCode) {
  const code = CURRENCIES[String(currencyCode || '').toUpperCase()] ? String(currencyCode).toUpperCase() : 'GBP';
  const price = method.prices?.[code] || null;
  return {
    method_id: method.id,
    slug: method.slug,
    name: method.name,
    family: method.family || null,
    blurb: method.blurb || null,
    // Carried onto the proposal so the rule travels with the document. A method
    // later relaxed to 'full' must not retrospectively license a claim the
    // proposal that was already sent did not make.
    evidence_policy: method.evidence_policy || 'full',
    scarcity: method.scarcity || null,
    version: method.version,
    currency: code,
    symbol: symbolFor(code),
    monthly: price ? price.monthly : null,
    setup: price ? price.setup : 0,
    price_missing: !price,
    // Captured now so acceptance sends them to the mandate page that was
    // priced in the document they signed.
    ...(price?.gocardless_url ? { gocardless_url: price.gocardless_url } : {}),
    includes: method.includes || [],
    objectives: method.objectives || {},
    kpis: method.kpis || {},
    strategy: method.strategy || [],
    tactics: method.tactics || [],
    stages: method.stages || [],
    snapshot_at: new Date().toISOString(),
  };
}

// Read from the snapshot first: an accepted proposal must send the prospect to
// the mandate page that was priced in the document they signed, not to whatever
// the method says today.
function gocardlessUrl(snap, method) {
  const code = snap?.currency || 'GBP';
  return snap?.gocardless_url
    || method?.prices?.[code]?.gocardless_url
    || process.env[`GOCARDLESS_URL_${(snap?.slug || '').toUpperCase()}_${code}`]
    || process.env[`GOCARDLESS_URL_${code}`]
    || process.env.GOCARDLESS_URL
    || null;
}

module.exports = {
  CURRENCIES, CURRENCY_CODES, symbolFor, EVIDENCE_POLICIES, evidencePolicy,
  listMethods, getMethod, getMethodBySlug, saveMethod, deleteMethod,
  snapshot, gocardlessUrl,
  // exported for tests
  cleanPrices, cleanKpis, cleanTactics, cleanStrategy, cleanStages, contentChanged, slugify,
};
