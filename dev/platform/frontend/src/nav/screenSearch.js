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
