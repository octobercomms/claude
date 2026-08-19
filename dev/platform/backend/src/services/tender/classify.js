// Tender Agent — Stage-1 deterministic prefilter (brief §6).
//
// The feeds carry the whole of CPV division 79 (and cultural div 92), so the
// raw list is mostly noise — fit-out contractors, CCTV, resurfacing, catering,
// fireworks. This cheap keyword/heuristic pass keeps only notices that look
// like MARKETING / PR / COMMUNICATIONS SERVICES for a CREATIVE-SECTOR buyer,
// and kills the obvious non-starters, before any expensive LLM scoring.
//
// Relevant = has a comms/PR/marketing SERVICE term
//            AND a creative-sector signal (arts/culture/design/heritage/tourism…)
//            AND is not an excluded kind of work (build/maintenance/research…).
//
// Tunable: these lists move to a config table in a later phase so Daniel can
// adjust them without a deploy.

// Word-boundary regexes. Multi-word service phrases avoid false positives on
// stray tokens (e.g. a reference like "PR 41 2025" must NOT count as PR work).
const SERVICE = [
  /\bpublic relations\b/,
  /\bpr (agency|agencies|services|consultanc?y|consultant|support|and communications|& communications|and marketing)\b/,
  /\bmedia relations\b/,
  /\bpress office\b/,
  /\bpress and (pr|publicity|media)\b/,
  /\bstrategic communications\b/,
  /\bcorporate communications\b/,
  /\bcommunications (agency|services|consultanc?y|consultant|strategy|support|partner|framework|and media|and marketing)\b/,
  /\b(media|marketing) and communications\b/,
  /\bmarketing communications\b/,
  /\bmarcomms\b/,
  /\bmarketing (agency|services|strategy|and communications|and pr|campaign|and design|support)\b/,
  /\bearned media\b/,
  /\bmedia campaign\b/,
  /\bpress campaign\b/,
  /\bpublicity\b/,
  /\badvertising (agency|services|campaign)\b/,
  /\bbrand (strategy|campaign|awareness|communications|and marketing)\b/,
  /\bsocial media (management|marketing|agency|strategy)\b/,
  /\bcontent marketing\b/,
  /\bmedia buying\b/,
  /\bmedia planning\b/,
  /\bcampaign management\b/,
  /\bbrand positioning\b/,
  /\bbrand development\b/,
  /\bbrand strategy\b/,
  /\bbrand(ing)? and marketing\b/,
  /\baudience development\b/,
  /\bmarketing strategy\b/,
  /\bdigital marketing\b/,
  /\bcreative (agency|services|campaign|and marketing)\b/,
  /\bdestination marketing\b/,
  /\bplace (marketing|branding)\b/,
  /\bmarketing\b/,      // broad — only promotes to a "match" when a sector term is also present
  /\badvertising\b/,
];

const SECTOR = [
  /\barts?\b/, /\bgalleries\b/, /\bgallery\b/, /\bmuseum/, /\bcultural?\b/,
  /\bheritage\b/, /\bdesign\b/, /\barchitectur/, /\btourism\b/, /\bdestination\b/,
  /\bexhibition/, /\bfestival/, /\bbiennale\b/, /\btheatre\b/, /\btheater\b/,
  /\bopera\b/, /\bcreative\b/, /\bfilm\b/, /\bvisual arts\b/, /\bperforming arts\b/,
  /\blibrar/, /\barchive/, /\bsculpture\b/, /\bcarnival\b/,
  // Known cultural / destination buyers — help once the buyer field is enriched
  // (or when the buyer appears in the title).
  /\bvisitscotland\b/, /\bvisit ?(britain|wales|england|scotland)\b/, /\bbritish council\b/,
  /\barts council\b/, /\bnational galler/, /\bnational trust\b/, /\bhistoric \w+\b/,
  /\btate\b/, /\bbiennial\b/, /\bpavilion\b/,
];

const EXCLUDE = [
  /\bmanufactur/, /\binstallation\b/, /\binstall\b/, /\bfit[- ]?out\b/, /\bconstruction\b/,
  /\brefurbish/, /\bresurfac/, /\bmaintenance\b/, /\bcctv\b/, /\bplayground\b/, /\bcatering\b/,
  /\bcleaning\b/, /\bfirework/, /\bpantomime\b/, /\banimatronic\b/, /\bdinosaur/,
  /\bconsultation\b/, /\bcommunity engagement\b/, /\baudience research\b/, /\bmarket research\b/,
  /\bgroundwork/, /\broofing\b/, /\belectrical\b/, /\bhvac\b/, /\bfurniture\b/, /\bstorage\b/,
  /\bdisplay cas/, /\buniform/, /\bwaste\b/, /\bsignage\b/, /\bcontractor\b/, /\bsupplier\b/,
  /\bequipment\b/, /\btraining\b/, /\bfirst aid\b/, /\bleisure facilit/, /\bgames area\b/,
  /\btennis court/, /\bschool meals\b/, /\bskills programme\b/, /\bactivity plan\b/,
  /\bbase build\b/, /\bcar park\b/, /\bboiler\b/, /\bflooring\b/, /\blandscaping\b/,
  /\bsecurity services\b/, /\bfood fusion\b/, /\bmental health\b/, /\bwarden\b/,
];

function firstMatch(text, patterns) {
  for (const re of patterns) { const m = text.match(re); if (m) return m[0].trim(); }
  return null;
}

// notice: { title, description, buyer_name }. Returns:
//   { relevant, reason, service, sector, excluded }
function prefilter(notice = {}) {
  const text = [notice.title, notice.description, notice.buyer_name]
    .filter(Boolean).join(' \n ').toLowerCase();

  const excluded = firstMatch(text, EXCLUDE);
  const service = firstMatch(text, SERVICE);
  const sector = firstMatch(text, SECTOR);

  // Three tiers so a real PR notice whose sector only lives in the (not-yet-
  // enriched) buyer name isn't lost:
  //   match — a comms/PR/marketing service AND a creative-sector signal (default view)
  //   maybe — a comms/PR/marketing service, sector not yet visible
  //   noise — everything else (all the fit-out / CCTV / events / research feed clutter)
  const relevant = !!service && !!sector && !excluded;
  const tier = relevant ? 'match' : (service && !excluded ? 'maybe' : 'noise');

  let reason;
  if (tier === 'match') reason = `${service} · ${sector}`;
  else if (tier === 'maybe') reason = `${service} — sector unclear`;
  else if (excluded) reason = `not comms work (${excluded})`;
  else if (!service) reason = 'no PR/marketing service';
  else reason = 'no creative-sector signal';

  return { relevant, tier, reason, service, sector, excluded };
}

module.exports = { prefilter, SERVICE, SECTOR, EXCLUDE };
