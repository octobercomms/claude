// Tender Agent — keyword & CPV configuration and the source→adapter registry.
//
// The keyword/CPV sets live here for now (Phase 1). The brief wants these
// tunable by Daniel without a deploy; Phase 2 will move them into a config
// table and read them from there. Keep this module the single source of truth
// so that move is a one-line swap.

// Service terms — the kind of work we do.
const SERVICE_TERMS = [
  'public relations', 'pr agency', 'media relations', 'press office',
  'communications agency', 'marketing communications', 'strategic communications',
  'earned media',
];

// Sector terms — the kind of buyer we want (arts/culture/design/heritage/destination).
const SECTOR_TERMS = [
  'museum', 'gallery', 'arts', 'cultural', 'heritage', 'design', 'architecture',
  'tourism', 'destination', 'exhibition', 'festival', 'biennale',
];

// CPV codes for PR / communications / cultural services. Used to query TED and
// as a signal in the deterministic prefilter (Phase 2).
const CPV_CODES = [
  '79416000', // Public relations services
  '79416100', // Public relations management services
  '79416200', // Public relations consultancy services
  '79340000', // Advertising and marketing services
  '92500000', // Library, archives, museums and other cultural services
  '92520000', // Museum and preservation-of-historical-sites services
];

// The adapter module for each source kind/name. ingest.js resolves a source row
// to one of these. Keyed by a lowercase token matched against the source name
// (first match wins), falling back to `kind`.
const ADAPTERS = {
  ukPortals:  () => require('./sources/ukPortals'), // Find a Tender + Contracts Finder (official OCDS APIs)
  d3:         () => require('./sources/d3'),         // legacy mirror (retired)
  ted:        () => require('./sources/ted'),
  canadabuys: () => require('./sources/canadabuys'),
  sam:        () => require('./sources/sam'),
};

function resolveAdapter(source) {
  const name = (source.name || '').toLowerCase();
  if (name.includes('find a tender') || name.includes('contracts finder')) return ADAPTERS.ukPortals();
  if (name.includes('d3')) return ADAPTERS.d3();
  if (name.includes('ted')) return ADAPTERS.ted();
  if (name.includes('canadabuys') || name.includes('canada')) return ADAPTERS.canadabuys();
  if (name.includes('sam')) return ADAPTERS.sam();
  return null;
}

module.exports = { SERVICE_TERMS, SECTOR_TERMS, CPV_CODES, ADAPTERS, resolveAdapter };
