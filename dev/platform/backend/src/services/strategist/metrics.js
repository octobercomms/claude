// Pillar-scoped metric enum for the GTM Brain.
//
// Every metric reference is `pillar:name` — the pillar prefix makes it
// unambiguous and lets the model, the prompt and the code all agree on which
// number an item is about. The window is how many days after an item is
// completed before its outcome is read; paid moves fast, earned does not.
//
// Build the enum with an earned case in it from the start even though Falcon
// will not exercise it much — a tier-1 placement is the case that breaks a
// naive design, and discovering that in Phase 4 would be expensive.

// `direction` says whether higher is better ('up'), lower is better ('down'),
// or it depends on the item ('neutral' — spend can go either way). The track
// record uses this to classify an outcome as improved, flat or declined.
const METRICS = {
  paid: {
    roas:        { label: 'ROAS',                 window: 30, direction: 'up' },
    cpa:         { label: 'Cost per acquisition',  window: 30, direction: 'down' },
    spend:       { label: 'Ad spend',              window: 30, direction: 'neutral' },
    revenue:     { label: 'Ad revenue',            window: 30, direction: 'up' },
    conversions: { label: 'Conversions',           window: 30, direction: 'up' },
    clicks:      { label: 'Clicks',                window: 30, direction: 'up' },
  },
  earned: {
    published:        { label: 'Published pieces',          window: 60, direction: 'up' },
    tier1_placements: { label: 'Tier 1 placements',         window: 60, direction: 'up' },
    pitch_conversion: { label: 'Pitch-to-published rate',   window: 60, direction: 'up' },
    journalist_count: { label: 'Active journalist count',   window: 60, direction: 'up' },
  },
  shared: {
    engagement_rate: { label: 'Engagement rate', window: 30, direction: 'up' },
    reach:           { label: 'Total reach',     window: 30, direction: 'up' },
    posts:           { label: 'Posts published',  window: 30, direction: 'up' },
  },
  owned: {
    top10:             { label: 'Top 10 keywords',          window: 30, direction: 'up' },
    top3:              { label: 'Top 3 keywords',           window: 30, direction: 'up' },
    audit_score:       { label: 'Site audit score',         window: 30, direction: 'up' },
    domain_authority:  { label: 'Domain authority',         window: 60, direction: 'up' },
    aio_citation_rate: { label: 'AI Overview citation rate', window: 30, direction: 'up' },
  },
  cross: {
    revenue: { label: 'Revenue', window: 30, direction: 'up' },
    orders:  { label: 'Orders',  window: 30, direction: 'up' },
  },
};

function isValid(ref) {
  if (!ref || typeof ref !== 'string') return false;
  const i = ref.indexOf(':');
  if (i < 1) return false;
  const pillar = ref.slice(0, i);
  const metric = ref.slice(i + 1);
  return !!(METRICS[pillar] && METRICS[pillar][metric]);
}

function windowFor(ref) {
  if (!ref) return 30;
  const i = ref.indexOf(':');
  if (i < 1) return 30;
  return METRICS[ref.slice(0, i)]?.[ref.slice(i + 1)]?.window || 30;
}

function labelFor(ref) {
  if (!ref) return null;
  const i = ref.indexOf(':');
  if (i < 1) return ref;
  return METRICS[ref.slice(0, i)]?.[ref.slice(i + 1)]?.label || ref;
}

function allRefs() {
  const out = [];
  for (const [pillar, metrics] of Object.entries(METRICS)) {
    for (const name of Object.keys(metrics)) {
      out.push(`${pillar}:${name}`);
    }
  }
  return out;
}

function refsByPillar(pillar) {
  const m = METRICS[pillar];
  if (!m) return [];
  return Object.keys(m).map(name => `${pillar}:${name}`);
}

function directionFor(ref) {
  if (!ref) return null;
  const i = ref.indexOf(':');
  if (i < 1) return null;
  return METRICS[ref.slice(0, i)]?.[ref.slice(i + 1)]?.direction || null;
}

module.exports = { METRICS, isValid, windowFor, labelFor, allRefs, refsByPillar, directionFor };
