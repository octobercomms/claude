// Per-page keyword extractor — pulls the recurring noun-phrase-ish
// n-grams from raw page text. No external NLP dep on purpose: a small
// stoplist + n-gram + frequency-cap algorithm is good enough for the
// "what is this page about?" surface, and keeps the install surface
// minimal. Deterministic, fast, no Python/native bindings.

// Common English stop words — kept short. The goal isn't perfect NLP,
// it's surfacing the AM's eye-of-Google sense of the page topic, so
// over-aggressive filtering matters less than reliability.
const STOP_WORDS = new Set([
  'a','an','the','and','or','but','if','then','else','of','at','by','for','with','about',
  'against','between','into','through','during','before','after','above','below','to','from',
  'up','down','in','out','on','off','over','under','again','further','then','once','here',
  'there','when','where','why','how','all','any','both','each','few','more','most','other',
  'some','such','no','nor','not','only','own','same','so','than','too','very','can','will',
  'just','don','should','now','is','are','was','were','be','been','being','have','has','had',
  'having','do','does','did','doing','am','this','that','these','those','i','you','he','she',
  'it','we','they','what','which','who','whom','whose','its','our','their','my','your','his',
  'her','us','them','me','him','one','two','three','four','five','six','seven','eight','nine',
  'ten','first','second','third','also','really','well','still','even','many','much','few',
  'every','any','some','make','made','using','use','used','make','using','using','get','got',
  'getting','take','taking','help','helping','find','found','finding','need','needs','needed',
  'know','knows','known','want','wants','wanted','like','likes','liked','see','sees','saw',
  'seen','say','says','said','go','goes','went','gone','as','said','href','www','com','co',
  'uk','net','org','io','html','htm','php','aspx','rel','alt','src','class','id',
]);

// Strip non-alphanumeric (keep hyphenated words), lowercase, split on
// whitespace. Drop tokens that are pure numbers or 1-2 chars.
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(t => t.length >= 3 && !/^\d+$/.test(t));
}

function isStop(token) {
  return STOP_WORDS.has(token);
}

// Build 1-grams + 2-grams + 3-grams, count frequencies, return ranked.
// 2-grams and 3-grams need at least one non-stop token to count — pure
// stopword phrases ("of the", "in the", "with the") are noise.
// Single tokens that are stopwords are dropped entirely.
function extractPhrases(text, { maxPhrases = 15 } = {}) {
  const tokens = tokenize(text);
  if (tokens.length < 5) return [];
  const counts = new Map();

  function bump(phrase, weight = 1) {
    counts.set(phrase, (counts.get(phrase) || 0) + weight);
  }

  for (let i = 0; i < tokens.length; i++) {
    const t1 = tokens[i];
    if (!isStop(t1)) bump(t1, 1);
    if (i + 1 < tokens.length) {
      const t2 = tokens[i + 1];
      const both = !isStop(t1) && !isStop(t2);
      // 2-grams where both are content-y get weight 2 (more meaningful
      // than singles). Mixed get weight 1. Pure stop dropped.
      if (both) bump(`${t1} ${t2}`, 2);
      else if (!isStop(t1) || !isStop(t2)) bump(`${t1} ${t2}`, 1);
    }
    if (i + 2 < tokens.length) {
      const t2 = tokens[i + 1];
      const t3 = tokens[i + 2];
      const contentCount = (!isStop(t1)) + (!isStop(t2)) + (!isStop(t3));
      if (contentCount >= 2) bump(`${t1} ${t2} ${t3}`, contentCount);
    }
  }

  // Sort by frequency descending; tie-break by length descending (longer
  // phrases are usually more meaningful when frequencies tie).
  const sorted = Array.from(counts.entries())
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);

  // De-duplicate: if a longer phrase contains a shorter phrase and the
  // shorter phrase's frequency is mostly explained by the longer one,
  // drop the shorter one. Heuristic — when shorter ≤ longer + 1, drop.
  const kept = [];
  for (const [phrase, freq] of sorted) {
    const supersedes = kept.some(([k, f]) =>
      k !== phrase && k.includes(phrase) && f + 1 >= freq
    );
    if (!supersedes) kept.push([phrase, freq]);
    if (kept.length >= maxPhrases) break;
  }

  return kept.map(([phrase, frequency], i) => ({ phrase, frequency, rank: i + 1 }));
}

// "No clear focus" signal — when even the top phrase appears < 3 times
// in a body that's > 200 words, the page isn't anchored on any specific
// topic.
function hasUnclearFocus(text, phrases) {
  const tokenCount = tokenize(text).length;
  if (tokenCount < 200) return false;     // too short to call
  if (!phrases.length) return true;
  return phrases[0].frequency < 3;
}

module.exports = { extractPhrases, hasUnclearFocus };
