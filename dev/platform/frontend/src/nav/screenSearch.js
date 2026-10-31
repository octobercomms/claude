// Ranking screens against what was typed.
//
// Its own module rather than part of the palette component, because the
// ranking is the part worth testing and a component drags in React, a router
// and a DOM to test one pure function.
//
// Four tiers, in the order a person expects:
//
//   0  the label is what you typed              "coverage" -> Coverage
//   1  the label starts with it                 "cov"      -> Coverage
//   2  the label contains it                    "age"      -> Coverage
//   3  the section or group contains it         "earned"   -> every Earned screen
//   4  every word you typed appears somewhere   "earned cov" -> Earned / Coverage
//
// Tier 4 exists because the way you name a screen out loud is usually its
// section plus its label, and neither substring on its own is the whole
// phrase. Without it, "earned coverage" matches nothing at all, which reads
// as the search being broken rather than as the query being two words.

// What is matched: "Earned · Track · Coverage". The label has to be in it or
// "earned coverage" has no single haystack holding both words.
export function screenPathLabel(s) {
  return [s.sectionTitle, s.heading, s.label].filter(Boolean).join(' · ');
}

// What is printed beside the title: "Earned · Track". The label is dropped,
// because the title is the label and a row reading "Coverage … Earned · Track ·
// Coverage" says it twice.
export function screenWhere(s) {
  return [s.sectionTitle, s.heading].filter(Boolean).join(' · ');
}

function scoreOf(term, words, s) {
  const label = s.label.toLowerCase();
  if (label === term) return 0;
  if (label.startsWith(term)) return 1;
  if (label.includes(term)) return 2;

  const hay = screenPathLabel(s).toLowerCase();
  if (hay.includes(term)) return 3;
  if (words.length > 1 && words.every(w => hay.includes(w))) return 4;
  return null;
}

// Matches, best first, capped. A term under two characters returns nothing:
// one letter matches most of the product and fills the palette with noise
// before you have said anything.
export function matchScreens(q, screens, limit = 8) {
  const term = String(q || '').trim().toLowerCase();
  if (term.length < 2) return [];
  const words = term.split(/\s+/).filter(Boolean);

  const hits = [];
  for (const s of screens) {
    const score = scoreOf(term, words, s);
    if (score !== null) hits.push({ ...s, score });
  }
  // Stable within a tier: the order screens are declared in is the order the
  // nav shows them, which is the order someone scanning the list expects.
  hits.sort((a, b) => a.score - b.score);
  return hits.slice(0, limit);
}

export default matchScreens;

// ── Credentials ───────────────────────────────────────────────────────────
//
// Search covered the record tables and the screens, and a credential is
// neither: typing "n8n" found nothing, although the field is right there on
// Settings → Connections → Other. Nor did "Moz", "DataForSEO" or any of the
// other sixty-odd keys.
//
// Scored the same way screens are, against the label, the environment
// variable name and the group, so a key is findable by what it is called on
// screen and by what somebody pasting it has in their clipboard.
export function matchSettings(q, entries, limit = 5) {
  const term = String(q || '').trim().toLowerCase();
  if (term.length < 2) return [];
  const words = term.split(/\s+/).filter(Boolean);
  const scored = [];
  for (const e of entries) {
    const label = String(e.label || '').toLowerCase();
    const key = String(e.key || '').toLowerCase();
    // Three tiers, not the four the screen matcher has. An exact tier was
    // written first and then removed: an exact match is also a prefix match,
    // so it only ever changed a tie, and ties are already settled
    // alphabetically in the right order. A mutation test proved the tier
    // could be deleted without any assertion noticing, which is the
    // definition of code doing nothing.
    let score = null;
    if (label.startsWith(term) || key.startsWith(term)) score = 1;
    else if (label.includes(term) || key.includes(term)) score = 2;
    else if (e.terms.includes(term)) score = 3;
    else if (words.length > 1 && words.every(w => e.terms.includes(w))) score = 4;
    if (score != null) scored.push({ e, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.e.label.localeCompare(b.e.label))
    .slice(0, limit)
    .map(x => x.e);
}
