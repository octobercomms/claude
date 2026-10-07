// Country on a journalist, derived from data OMI already holds.
//
// No AI. Three deterministic signals, ranked by how much they deserve to be
// trusted, because the operator is going to exclude countries from a send on the
// strength of this and needs to know which values are solid.
//
//   manual   — typed by a person. Never overwritten.
//   outlet   — from the publication record: its `region` where that names a
//              country, else its own domain's country TLD. Strongest derived
//              signal, because it describes the title rather than one person's
//              mailbox. Note pr_outlets has no `country` column — `region` is
//              free text and `domain` is the reliable part.
//   location — the contact's location text already names a country ("France").
//   city     — the location text names a city we recognise ("London").
//   tld      — the email's country TLD (.co.uk, .fr). Useful but weak: a London
//              journalist on a .com address resolves to nothing, and a .co
//              address is Colombia or a startup, so .co is deliberately absent.
//
// Unresolved is a real answer and stays NULL. Guessing would be worse than an
// honest gap, because a wrong country silently sends a release to someone the
// operator told it to hold back.

const pool = require('../db');

// Rank order: a later pass may fill a gap but never downgrade a better source.
const SOURCE_RANK = { manual: 5, outlet: 4, location: 3, city: 2, tld: 1 };
const SOURCES = Object.keys(SOURCE_RANK);

// Canonical names, with the spellings that actually turn up in pasted lists.
// Keys are lower-cased and stripped of punctuation before lookup.
const COUNTRY_ALIASES = {
  'uk': 'United Kingdom', 'u k': 'United Kingdom', 'gb': 'United Kingdom',
  'great britain': 'United Kingdom', 'britain': 'United Kingdom',
  'england': 'United Kingdom', 'scotland': 'United Kingdom',
  'wales': 'United Kingdom', 'northern ireland': 'United Kingdom',
  'united kingdom': 'United Kingdom',
  'us': 'United States', 'u s': 'United States', 'usa': 'United States',
  'u s a': 'United States', 'america': 'United States',
  'united states': 'United States', 'united states of america': 'United States',
  'uae': 'United Arab Emirates', 'united arab emirates': 'United Arab Emirates',
  'holland': 'Netherlands', 'the netherlands': 'Netherlands', 'netherlands': 'Netherlands',
  'eire': 'Ireland', 'republic of ireland': 'Ireland', 'ireland': 'Ireland',
  'deutschland': 'Germany', 'germany': 'Germany',
  'españa': 'Spain', 'espana': 'Spain', 'spain': 'Spain',
  'italia': 'Italy', 'italy': 'Italy',
  'france': 'France', 'belgium': 'Belgium', 'denmark': 'Denmark',
  'sweden': 'Sweden', 'norway': 'Norway', 'finland': 'Finland',
  'switzerland': 'Switzerland', 'austria': 'Austria', 'portugal': 'Portugal',
  'poland': 'Poland', 'czech republic': 'Czech Republic', 'greece': 'Greece',
  'canada': 'Canada', 'australia': 'Australia', 'new zealand': 'New Zealand',
  'japan': 'Japan', 'china': 'China', 'hong kong': 'Hong Kong',
  'singapore': 'Singapore', 'india': 'India', 'south africa': 'South Africa',
  'brazil': 'Brazil', 'mexico': 'Mexico', 'turkey': 'Turkey', 'israel': 'Israel',
  'south korea': 'South Korea', 'korea': 'South Korea', 'qatar': 'Qatar',
  'saudi arabia': 'Saudi Arabia',
};

// Cities that appear in design, architecture and trade media lists. Deliberately
// not exhaustive: a city we do not know resolves to nothing rather than to a
// guess. Ambiguous names are omitted on purpose, so "Birmingham" (UK and
// Alabama) and "Cambridge" (UK and Massachusetts) are absent.
const CITY_COUNTRY = {
  london: 'United Kingdom', manchester: 'United Kingdom', glasgow: 'United Kingdom',
  edinburgh: 'United Kingdom', leeds: 'United Kingdom', bristol: 'United Kingdom',
  liverpool: 'United Kingdom', cardiff: 'United Kingdom', belfast: 'United Kingdom',
  brighton: 'United Kingdom', oxford: 'United Kingdom', sheffield: 'United Kingdom',
  'new york': 'United States', brooklyn: 'United States', 'los angeles': 'United States',
  chicago: 'United States', 'san francisco': 'United States', boston: 'United States',
  seattle: 'United States', miami: 'United States', austin: 'United States',
  'washington dc': 'United States', denver: 'United States', atlanta: 'United States',
  'new york city': 'United States', nyc: 'United States', la: 'United States',
  paris: 'France', lyon: 'France', marseille: 'France',
  berlin: 'Germany', munich: 'Germany', münchen: 'Germany', hamburg: 'Germany',
  cologne: 'Germany', frankfurt: 'Germany', stuttgart: 'Germany',
  madrid: 'Spain', barcelona: 'Spain', valencia: 'Spain',
  milan: 'Italy', milano: 'Italy', rome: 'Italy', roma: 'Italy', turin: 'Italy',
  amsterdam: 'Netherlands', rotterdam: 'Netherlands', eindhoven: 'Netherlands',
  utrecht: 'Netherlands', 'the hague': 'Netherlands',
  brussels: 'Belgium', antwerp: 'Belgium', ghent: 'Belgium',
  copenhagen: 'Denmark', stockholm: 'Sweden', oslo: 'Norway', helsinki: 'Finland',
  zurich: 'Switzerland', zürich: 'Switzerland', geneva: 'Switzerland',
  basel: 'Switzerland', lausanne: 'Switzerland',
  vienna: 'Austria', wien: 'Austria', lisbon: 'Portugal', porto: 'Portugal',
  warsaw: 'Poland', prague: 'Czech Republic', athens: 'Greece',
  dublin: 'Ireland', cork: 'Ireland',
  toronto: 'Canada', vancouver: 'Canada', montreal: 'Canada', ottawa: 'Canada',
  calgary: 'Canada',
  sydney: 'Australia', melbourne: 'Australia', brisbane: 'Australia',
  perth: 'Australia', adelaide: 'Australia',
  auckland: 'New Zealand', wellington: 'New Zealand',
  tokyo: 'Japan', osaka: 'Japan', kyoto: 'Japan',
  beijing: 'China', shanghai: 'China', shenzhen: 'China', guangzhou: 'China',
  'hong kong': 'Hong Kong', singapore: 'Singapore',
  mumbai: 'India', delhi: 'India', 'new delhi': 'India', bangalore: 'India',
  bengaluru: 'India',
  dubai: 'United Arab Emirates', 'abu dhabi': 'United Arab Emirates',
  doha: 'Qatar', riyadh: 'Saudi Arabia',
  'tel aviv': 'Israel', 'cape town': 'South Africa', johannesburg: 'South Africa',
  'são paulo': 'Brazil', 'sao paulo': 'Brazil', 'rio de janeiro': 'Brazil',
  'mexico city': 'Mexico', istanbul: 'Turkey', seoul: 'South Korea',
};

// Country-code TLDs worth trusting. .co is absent (Colombia vs a startup
// vanity domain), as are .io, .me, .tv, .ai and .cc, which are sold globally
// and say nothing about where anyone is.
const TLD_COUNTRY = {
  uk: 'United Kingdom', fr: 'France', de: 'Germany', es: 'Spain', it: 'Italy',
  nl: 'Netherlands', be: 'Belgium', dk: 'Denmark', se: 'Sweden', no: 'Norway',
  fi: 'Finland', ch: 'Switzerland', at: 'Austria', pt: 'Portugal', pl: 'Poland',
  cz: 'Czech Republic', gr: 'Greece', ie: 'Ireland', ca: 'Canada', au: 'Australia',
  nz: 'New Zealand', jp: 'Japan', cn: 'China', hk: 'Hong Kong', sg: 'Singapore',
  in: 'India', za: 'South Africa', br: 'Brazil', mx: 'Mexico', tr: 'Turkey',
  il: 'Israel', kr: 'South Korea', ae: 'United Arab Emirates', qa: 'Qatar',
  sa: 'Saudi Arabia', us: 'United States',
};

const clean = (s) => String(s == null ? '' : s)
  .toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()'"]/g, ' ').replace(/\s+/g, ' ').trim();

/** "UK" / "u.k." / "England" -> "United Kingdom". Returns null if not a country. */
function normaliseCountry(text) {
  const k = clean(text);
  if (!k) return null;
  return COUNTRY_ALIASES[k] || null;
}

/** The country named by a free-text location, if it names one. */
function countryFromLocation(location) {
  const k = clean(location);
  if (!k) return null;
  const whole = COUNTRY_ALIASES[k];
  if (whole) return whole;
  // "London, UK" / "Brooklyn, New York, USA": test each comma-separated part,
  // last first, since the country conventionally comes last.
  const parts = String(location).split(/[,|/]/).map(clean).filter(Boolean).reverse();
  for (const p of parts) if (COUNTRY_ALIASES[p]) return COUNTRY_ALIASES[p];
  return null;
}

/** The country implied by a city in the location text. */
function countryFromCity(location) {
  const k = clean(location);
  if (!k) return null;
  if (CITY_COUNTRY[k]) return CITY_COUNTRY[k];
  const parts = String(location).split(/[,|/]/).map(clean).filter(Boolean);
  for (const p of parts) if (CITY_COUNTRY[p]) return CITY_COUNTRY[p];
  return null;
}

/** The country implied by an email's country-code TLD. */
function countryFromEmail(email) {
  const m = String(email || '').toLowerCase().match(/@([^@\s]+)$/);
  if (!m) return null;
  const labels = m[1].split('.').filter(Boolean);
  const tld = labels[labels.length - 1];
  if (!tld || tld.length !== 2) return null;        // .com / .org / .press etc
  return TLD_COUNTRY[tld] || null;
}

/**
 * Best country for one contact, with the source that produced it.
 * `outletCountry` is the publication's own country where we have it.
 * Returns null when nothing resolves, which is a real answer.
 */
function derive({ email, location, outletCountry }) {
  // Only a recognised country name counts. Passing through an unrecognised
  // string would turn "EMEA" or "North" into a country, and an exclusion list
  // would then never match it while the UI showed it as resolved.
  const fromOutlet = normaliseCountry(outletCountry)
    || (CITY_COUNTRY[clean(outletCountry)] || null);
  if (fromOutlet) return { country: fromOutlet, source: 'outlet' };
  const fromLocation = countryFromLocation(location);
  if (fromLocation) return { country: fromLocation, source: 'location' };
  const fromCity = countryFromCity(location);
  if (fromCity) return { country: fromCity, source: 'city' };
  const fromTld = countryFromEmail(email);
  if (fromTld) return { country: fromTld, source: 'tld' };
  return null;
}

/** True when `next` is at least as trustworthy as what is already stored. */
function supersedes(nextSource, currentSource) {
  if (!currentSource) return true;
  if (currentSource === 'manual') return false;     // a person typed it
  return (SOURCE_RANK[nextSource] || 0) >= (SOURCE_RANK[currentSource] || 0);
}

/**
 * Fill in country for media contacts that do not have one from a trusted source.
 * Free: one read, one write per batch, no model call. Returns what it did and
 * what is still unresolved, because the coverage figure is the thing that decides
 * whether a country exclusion is worth trusting.
 */
async function backfill({ limit = 50000, dryRun = false } = {}) {
  // Join each contact to its publication. Email domain first, because that is an
  // exact match; outlet name second, because a pasted company name is not
  // reliably the outlet's canonical name. Take the outlet's region (if it names a
  // country) or its domain's country TLD.
  const { rows } = await pool.query(
    `SELECT c.id, c.email, c.location, c.country, c.country_source,
            o.region AS outlet_region, o.domain AS outlet_domain
       FROM outreach_contacts c
       LEFT JOIN LATERAL (
         SELECT o.region, o.domain
           FROM pr_outlets o
          WHERE o.merged_into IS NULL
            AND (
              (o.domain IS NOT NULL AND o.domain <> ''
                 AND lower(split_part(c.email, '@', 2)) LIKE '%' || lower(o.domain))
              OR (c.company IS NOT NULL AND c.company <> ''
                 AND lower(COALESCE(o.canonical_name, o.name)) = lower(c.company))
            )
          -- Prefer the domain match: ordering by whether the domain matched puts
          -- it first, so a name collision cannot beat an exact domain.
          ORDER BY (o.domain IS NOT NULL AND o.domain <> ''
                    AND lower(split_part(c.email, '@', 2)) LIKE '%' || lower(o.domain)) DESC
          LIMIT 1
       ) o ON TRUE
      WHERE c.kind = 'media' AND c.merged_into IS NULL
      LIMIT $1`,
    [limit]
  );

  const updates = [];
  const bySource = {};
  let unchanged = 0;
  for (const r of rows) {
    // An outlet's region only counts when it actually names a country ("UK",
    // "Germany"); values like "EMEA" or "North" resolve to nothing. Its domain's
    // country TLD is the fallback.
    const outletCountry = normaliseCountry(r.outlet_region)
      || countryFromEmail(`x@${r.outlet_domain || ''}`);
    const got = derive({ email: r.email, location: r.location, outletCountry });
    if (!got) { unchanged++; continue; }
    if (r.country === got.country && r.country_source === got.source) { unchanged++; continue; }
    if (!supersedes(got.source, r.country_source)) { unchanged++; continue; }
    updates.push([r.id, got.country, got.source]);
    bySource[got.source] = (bySource[got.source] || 0) + 1;
  }

  if (updates.length && !dryRun) {
    // One statement for the whole batch: 20,000 contacts is one round trip.
    await pool.query(
      `UPDATE outreach_contacts AS c
          SET country = u.country, country_source = u.source, updated_at = NOW()
         FROM (SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[])
                 AS t(id, country, source)) AS u
        WHERE c.id = u.id`,
      [updates.map((u) => u[0]), updates.map((u) => u[1]), updates.map((u) => u[2])]
    );
  }

  return {
    examined: rows.length,
    updated: dryRun ? 0 : updates.length,
    would_update: updates.length,
    by_source: bySource,
    unchanged,
    dry_run: !!dryRun,
    ...(await coverage()),
  };
}

/** How much of the media library has a country, by country and by source. */
async function coverage() {
  const { rows: tot } = await pool.query(
    `SELECT COUNT(*)::int AS contacts,
            COUNT(country)::int AS with_country
       FROM outreach_contacts WHERE kind = 'media' AND merged_into IS NULL`
  );
  const { rows: byCountry } = await pool.query(
    `SELECT country, COUNT(*)::int AS n
       FROM outreach_contacts
      WHERE kind = 'media' AND merged_into IS NULL AND country IS NOT NULL
      GROUP BY country ORDER BY n DESC, country`
  );
  const { rows: bySource } = await pool.query(
    `SELECT country_source AS source, COUNT(*)::int AS n
       FROM outreach_contacts
      WHERE kind = 'media' AND merged_into IS NULL AND country IS NOT NULL
      GROUP BY country_source ORDER BY n DESC`
  );
  const contacts = tot[0].contacts;
  const withCountry = tot[0].with_country;
  return {
    contacts,
    with_country: withCountry,
    unknown: contacts - withCountry,
    // Rounded to a whole number: this is read as "can I trust a country filter",
    // not as a statistic.
    coverage_pct: contacts ? Math.round((withCountry / contacts) * 100) : 0,
    by_country: byCountry,
    by_source: bySource,
  };
}

/** Set a country by hand. 'manual' outranks every derivation, so it sticks. */
async function setManual(contactId, country) {
  const value = String(country || '').trim();
  if (!value) {
    await pool.query(
      'UPDATE outreach_contacts SET country = NULL, country_source = NULL, updated_at = NOW() WHERE id = $1',
      [contactId]
    );
    return { country: null, country_source: null };
  }
  const canonical = normaliseCountry(value) || value;
  await pool.query(
    "UPDATE outreach_contacts SET country = $2, country_source = 'manual', updated_at = NOW() WHERE id = $1",
    [contactId, canonical]
  );
  return { country: canonical, country_source: 'manual' };
}

/**
 * The SQL fragment that holds a contact back for a release's country rules.
 * Shared by the audience pickers, the send-plan counts and the dispatch gate, so
 * all three agree. `$cAlias` is the contacts alias in the calling query.
 *
 * It is written as "is this contact excluded" rather than "which contacts to
 * select", because the dispatch gate asks the question that way and the gate is
 * the authoritative stop.
 */
function excludedByCountrySql(cAlias, countriesParam, policyParam) {
  return `(
    CASE
      WHEN COALESCE(array_length(${countriesParam}, 1), 0) = 0 THEN FALSE
      WHEN ${cAlias}.country IS NULL THEN ${policyParam} = 'hold'
      ELSE ${cAlias}.country = ANY(${countriesParam})
    END
  )`;
}

module.exports = {
  derive, normaliseCountry, countryFromLocation, countryFromCity, countryFromEmail,
  supersedes, backfill, coverage, setManual, excludedByCountrySql,
  SOURCES, SOURCE_RANK, COUNTRY_ALIASES, CITY_COUNTRY, TLD_COUNTRY,
};
