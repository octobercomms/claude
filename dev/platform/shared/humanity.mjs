/**
 * The Humanity Checker — a deterministic reporting checker.
 *
 * Canonical implementation, imported by BOTH the React editor (live, on every
 * keystroke) and the Node backend (on save, and for the pitch gate). One file
 * so the number on screen and the number in the database cannot drift apart.
 *
 * No network, no API, no dependencies. It costs nothing to run and it runs in
 * about a millisecond on a 600-word release.
 *
 * What it is NOT: an AI-text classifier. Pangram and its peers are trained on
 * enormous corpora and a hand-rolled one would be worse and would rot. See
 * docs/october-outreach/HUMANITY-CHECKER-BRIEF.md §2.
 *
 * The split that matters (and the one thing this departs from the brief on):
 *
 *   ACTIONABLE — missing facts. Highlighted, counted, and they move the
 *   headline number. You fix them by reporting: ring the client, get the
 *   measurement, get the quote.
 *
 *   DIAGNOSTIC — style markers. Reported without highlights and without a fix
 *   affordance, and they do NOT move the headline number. They tell you where
 *   the prose came from. The editorial standard is explicit that deliberately
 *   roughening prose to beat these is a known category that detectors are
 *   trained on (human-writing-standard.md §3), so an editor that invited you
 *   to go and break your own coordinate lists would be teaching the one move
 *   guaranteed to make things worse.
 */

// Capitalised words that are not evidence of reporting.
const STOP = new Set([
  'I', 'A', 'An', 'The', 'This', 'That', 'These', 'Those', 'It', 'Its', 'In', 'On', 'At', 'As',
  'And', 'But', 'Or', 'For', 'Of', 'To', 'With', 'From', 'By', 'We', 'Our', 'They', 'Their',
  'He', 'She', 'His', 'Her', 'There', 'Here', 'What', 'When', 'Where', 'Which', 'Who', 'Why',
  'How', 'All', 'Each', 'Every', 'No', 'Not', 'Now', 'Part', 'Both', 'After', 'Before',
  'Describing', 'Working', 'Following', 'Including', 'Using', 'Taking', 'Said', 'Says',
]);

const UNIT_RE = /(?:^|[\s(])(?:\d[\d,.]*)\s*(?:mm|cm|m|km|sq\s?ft|sqft|ft|m2|m²|kg|t|%)\b|[£$€]\s?\d/i;

// Words that describe nothing checkable. Seed list from the standard; extend
// from October's own rejected drafts as they accumulate.
const ABSTRACTION = [
  'approach', 'commitment', 'solutions', 'experience', 'journey', 'seamless', 'curated',
  'bespoke', 'innovative', 'passionate', 'dedicated', 'holistic', 'tailored', 'elevate',
  'crafted', 'weaves', 'vision', 'ethos', 'leverage', 'robust', 'cutting-edge', 'world-class',
  'state-of-the-art', 'synergy', 'empower', 'transformative', 'reimagine', 'redefine',
];

const ATTRIB_RE = /\b(said|says|according to|added|explains|explained|commented|notes|noted)\b/i;

export function stripHtml(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|li|div|blockquote)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&(?:quot|#34);/gi, '"').replace(/&(?:#39|apos|rsquo|lsquo);/gi, "'")
    .replace(/&(?:ldquo|rdquo);/gi, '"').replace(/&#?\w+;/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Drop the parts that are boilerplate rather than reporting, so a long "About"
 * paragraph cannot dilute the density of the release itself.
 */
export function stripBoilerplate(text) {
  const cuts = [
    /\n\s*(?:ENDS|-ENDS-|###|--30--)\s*\n/i,
    /\n\s*(?:Notes? to editors?|About [A-Z][\w &'-]{2,40}\s*(?:\n|:))/,
    /\n\s*(?:Press (?:contact|enquiries|office)|For (?:more|further) information|Media (?:contact|enquiries))/i,
  ];
  let out = text;
  for (const re of cuts) {
    const m = out.match(re);
    if (m && m.index > 40) out = out.slice(0, m.index);
  }
  return out.trim();
}

function words(text) { return text.split(/\s+/).filter(Boolean); }

function sentences(text) {
  return text.split(/(?<=[.!?])["')\]]?\s+(?=[A-Z"'(])/).map((s) => s.trim()).filter((s) => s.length > 1);
}

/** Normalise a checkable item so "Folkestone" and "Folkestone's" are one fact. */
function key(token) {
  return token.toLowerCase().replace(/['’]s$/, '').replace(/[^a-z0-9²£$€%.]/g, '');
}

/**
 * Every checkable item in the text, with its character offset.
 *
 * Counted DISTINCT rather than per occurrence. Counting occurrences means the
 * cheapest way to raise your score is to repeat the client's name, which is a
 * habit PR copy already has: on the standard's own exemplar that is 16
 * occurrences of 11 distinct facts. Both are returned so the calibration run
 * has the raw figure too.
 */
export function checkableItems(text) {
  const out = [];
  const re = /\S+/g;
  let m;
  let atSentenceStart = true;
  while ((m = re.exec(text))) {
    const raw = m[0];
    const offset = m.index;
    const bare = raw.replace(/^[^\w£$€]+/, '').replace(/[^\w%²]+$/, '');
    const starts = atSentenceStart;
    atSentenceStart = /[.!?]["'”’)]?$/.test(raw);
    if (!bare) continue;
    if (/\d/.test(bare)) { out.push({ text: bare, offset, length: raw.length, kind: 'number' }); continue; }
    if (UNIT_RE.test(raw)) { out.push({ text: bare, offset, length: raw.length, kind: 'measurement' }); continue; }
    if (/^[A-Z]/.test(bare) && !starts && !STOP.has(bare)) {
      out.push({ text: bare, offset, length: raw.length, kind: 'proper noun' });
    }
  }
  return out;
}

/** Quotations carrying an attribution within a sentence of them. */
export function namedQuotes(text) {
  const out = [];
  const re = /["“]([^"”]{12,400})["”]/g;
  let m;
  while ((m = re.exec(text))) {
    const window = text.slice(Math.max(0, m.index - 160), Math.min(text.length, m.index + m[0].length + 160));
    const hasAttrib = ATTRIB_RE.test(window);
    const hasName = /\b[A-Z][a-z]+\s+[A-Z][a-z’'-]+/.test(window);
    out.push({ text: m[1], offset: m.index, length: m[0].length, named: hasAttrib && hasName });
  }
  return out;
}

/** Style markers. Diagnostic only — see the header. */
function styleMarkers(body, sents) {
  const w = words(body).length || 1;
  const per100 = (n) => +(n / w * 100).toFixed(2);

  const coordinate = body.match(/\b[\w'’-]+,\s+[\w'’-]+(?:,)?\s+and\s+[\w'’-]+/g) || [];
  const gerundLists = (body.match(/\b\w+ing,\s+\w+ing,?\s+and\s+\w+ing\b/g) || []);
  const lens = sents.map((s) => words(s).length);
  const mean = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const sd = lens.length > 1
    ? Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / (lens.length - 1)) : 0;
  const cv = mean ? +(sd / mean).toFixed(2) : null;
  const abstraction = ABSTRACTION.filter((a) => new RegExp(`\\b${a}\\b`, 'i').test(body));
  const last = sents[sents.length - 1] || '';
  const flourish = /,\s+(?:giving|allowing|ensuring|providing|creating|offering|delivering|enabling)\b[^.]*\.?$/i.test(last)
    || (!!last && !/\d/.test(last) && !checkableItems(last).length);

  return {
    coordinate_lists: { per_100: per100(coordinate.length), count: coordinate.length, flagged: per100(coordinate.length) >= 2 },
    parallel_gerund_lists: { count: gerundLists.length, flagged: gerundLists.length >= 1 },
    sentence_length_cv: { value: cv, flagged: cv != null && cv < 0.35 },
    abstraction: { per_100: per100(abstraction.length), words: abstraction, flagged: per100(abstraction.length) >= 3 },
    closing_flourish: { flagged: flourish, sentence: last.slice(0, 200) },
  };
}

/**
 * The body split into sentences, each with its character offsets and the
 * checkable facts it carries.
 *
 * This is what the editor highlights. It highlights SENTENCES THAT CARRY NO
 * CHECKABLE FACT — not "AI sentences", which this cannot know, and not the
 * style markers, which must never be highlighted because the fix for those is
 * to rough up the prose and that is the one move the standard forbids.
 *
 * A factless sentence is the honest target. It is what a journalist skims past
 * and it is what a detector reads as generated, and the fix for it is the same
 * in both cases: go and get a fact. You cannot clear it by rewording.
 */
export function sentenceSpans(text) {
  const out = [];
  const re = /[^.!?]+[.!?]*["'”’)\]]?\s*/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[0];
    const trimmed = raw.trim();
    if (trimmed.length < 2) continue;
    const start = m.index + (raw.length - raw.trimStart().length);
    const items = checkableItems(trimmed);
    const distinct = new Set(items.map((i) => key(i.text)));
    out.push({
      text: trimmed,
      start,
      end: start + trimmed.length,
      words: trimmed.split(/\s+/).filter(Boolean).length,
      facts: distinct.size,
      bare: distinct.size === 0,
    });
  }
  return out;
}

// ─── Reads-as-human scoring ──────────────────────────────────────────────────
//
// A heuristic, and it says so on screen. It is not a classifier and it cannot
// read a watermark: Claude's SynthID-Text watermark needs Anthropic's key and
// their detection API is in private preview for regulators, media and
// fact-checkers, not agencies.
//
// What it does is what the commercial detectors do WITHOUT the key, in
// Anthropic's own description of them: look for the tells that show up in AI
// phrasing. Three sources feed the list:
//
//   1. Anthropic, naming two directly: a fondness for "this isn't X, it's Y",
//      and "quietly" used more than you would expect.
//   2. The excess-vocabulary literature. Kobak et al. (Science Advances, 2025)
//      found an abrupt post-ChatGPT rise in a specific set of style words
//      across 15M PubMed abstracts; a companion medRxiv study verified 74 such
//      terms, led by delve, underscore, meticulous, commendable, showcase.
//   3. October's own eight markers, from the three Pangram samples.
//
// The honest limit, stated plainly because it governs how much weight the
// number deserves. Pangram's own account of its method is the clearest
// statement of the gap: it maps text into a high-dimensional style space built
// from human/AI pairs, and "visible LLM-isms are only one signal among hundreds
// of thousands" it weighs. This checks the visible LLM-isms. That is one thin
// slice of what a trained classifier does.
//
// Two consequences worth holding on to:
//
//   - Those vocabulary studies measure population-level frequency and do not
//     establish markers for judging a single document. A high score here means
//     "none of the usual tells are present", which is weaker than "a human
//     wrote this".
//   - A word list is, in Pangram's words about its own predecessors, "trivially
//     bypassed by swapping words for less common synonyms". Swapping "delve"
//     for something rarer raises this score and improves nothing. The component
//     that cannot be gamed that way is specificity, which is why it carries the
//     most weight and why it is the one the gap list acts on.
//
// The weights below are judgement, not derived from a labelled corpus. They
// are in one table so they can be recalibrated against October's own archive.

// Verified excess vocabulary, in two tiers.
//
// STRONG are words that rarely turn up in plain reporting and whose post-2022
// rise is well documented. SOFT are on the same lists but have ordinary
// everyday uses, so a single hit is weak evidence and they are priced at less
// than half. "Landscape" sits in SOFT for exactly this reason: "transformed the
// landscape of Folkestone" is reporting, while "in the landscape of
// hospitality" is the tell, and only the second is caught, by pattern.
const TELL_STRONG = [
  'delve', 'delves', 'delving', 'underscore', 'underscores', 'underscoring',
  'meticulous', 'meticulously', 'commendable', 'showcase', 'showcases', 'showcasing',
  'tapestry', 'intricate', 'intricacies', 'unwavering', 'myriad', 'seamless',
  'seamlessly', 'holistic', 'synergy', 'game-changer', 'cutting-edge',
  'state-of-the-art', 'reimagine', 'reimagines', 'reimagining', 'redefine',
  'redefines', 'redefining', 'transformative', 'testament',
  // Anthropic names this one directly.
  'quietly',
];
const TELL_SOFT = [
  'realm', 'pivotal', 'robust', 'crucial', 'vital', 'navigate', 'navigating',
  'landscape', 'leverage', 'leveraging', 'curated', 'bespoke', 'elevate',
  'elevates', 'elevating', 'empower', 'empowers', 'innovative', 'noteworthy',
  'furthermore', 'moreover', 'notably', 'remarkable', 'remarkably',
];

// Constructions, which are stronger signal than any single word.
const TELL_PATTERNS = [
  { key: 'not_x_but_y', weight: 9,
    re: /\b(?:it|this|that)(?:'s| is| was)\s+not\s+(?:just\s+)?[^.,;]{2,60}[,;]?\s+(?:it|this|that)(?:'s| is| was)\s+/gi,
    label: '“it’s not X, it’s Y”', note: 'Anthropic names this construction as a favourite of AI models.' },
  { key: 'not_only', weight: 7,
    re: /\bnot (?:only|just)\b[^.]{2,80}?\bbut (?:also )?\b/gi,
    label: '“not only X but also Y”', note: 'The same reframe in its other dress.' },
  { key: 'closing_flourish', weight: 8,
    re: /,\s+(?:giving|allowing|ensuring|providing|creating|offering|delivering|enabling|cementing|solidifying)\b[^.]{0,120}\.(?:\s*$|\s*\n)/gi,
    label: 'participial benefit clause', note: 'A closing flourish that interprets rather than reports.' },
  { key: 'isnt_about', weight: 6,
    re: /\b(?:is|was)(?:n'?t| not)\s+(?:merely|simply|just)?\s*about\b/gi,
    label: '“isn’t just about…”', note: 'The elevation move.' },
  { key: 'stands_as', weight: 5,
    re: /\b(?:stands|serves|acts) as a\b/gi,
    label: '“stands as a…”', note: 'Usually followed by testament, reminder or symbol.' },
  { key: 'in_the_realm', weight: 5,
    re: /\b(?:in|across) the (?:realm|world|landscape|space) of\b/gi,
    label: '“in the realm of…”', note: 'Scene-setting that carries no fact.' },
  { key: 'rule_of_three', weight: 4,
    re: /\b[\w'’-]+,\s+[\w'’-]+,?\s+and\s+[\w'’-]+\b/g,
    label: 'three-item coordinate list', note: 'The loudest single marker in October’s own samples.' },
];

/** Every tell in the text, with offsets so the editor can mark them. */
export function aiTells(text) {
  const hits = [];
  for (const pat of TELL_PATTERNS) {
    const re = new RegExp(pat.re.source, pat.re.flags);
    let m;
    while ((m = re.exec(text))) {
      hits.push({ kind: pat.key, label: pat.label, note: pat.note, weight: pat.weight,
        text: m[0].trim(), offset: m.index, length: m[0].length });
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  for (const [list, weight, note] of [
    [TELL_STRONG, 5, 'On the verified excess-vocabulary list, and rare in plain reporting.'],
    [TELL_SOFT, 2, 'On the excess-vocabulary list, but it has ordinary uses — weak on its own.'],
  ]) {
    for (const w of list) {
      const re = new RegExp(`\\b${w.replace(/-/g, '\\-')}\\b`, 'gi');
      let m;
      while ((m = re.exec(text))) {
        hits.push({ kind: 'word', label: `“${m[0]}”`, note, weight, text: m[0],
          offset: m.index, length: m[0].length });
      }
    }
  }
  return hits.sort((a, b) => a.offset - b.offset);
}

/**
 * 0 to 100, higher meaning fewer of the usual tells and more of the things
 * human copy carries. Starts at 100 and spends it.
 */
export function humanScore({ text, words: wordCount, tells, density, cv, bare_pct }) {
  const parts = [];
  const spend = (label, amount, detail) => {
    if (amount > 0) parts.push({ label, cost: Math.round(amount), detail });
    return amount;
  };
  let score = 100;

  // Normalised per 1000 words so a long release is not penalised for length —
  // but against a floor of 150 words, because without one a single tell in a
  // 70-word extract reads as a document full of them.
  const effective = Math.max(wordCount, 150);
  const weighted = tells.reduce((n, t) => n + t.weight, 0);
  const tellCost = Math.min(50, (weighted / effective) * 1000 * 0.4);
  score -= spend('AI phrasing', tellCost,
    `${tells.length} tell${tells.length === 1 ? '' : 's'} in ${wordCount} words`);

  // Thin specificity. The strongest human signal in October's own samples, and
  // the only one you fix by reporting rather than by editing.
  const specCost = density >= THRESHOLDS.target ? 0
    : Math.min(34, (THRESHOLDS.target - density) * 3.6);
  score -= spend('Thin on checkable fact', specCost,
    `${density} checkable facts per 100 words, against a target of ${THRESHOLDS.target}`);

  // Even information density: a high share of sentences saying nothing.
  const bareCost = Math.min(15, Math.max(0, (bare_pct - 20)) * 0.3);
  score -= spend('Sentences carrying nothing', bareCost, `${bare_pct}% of the words`);

  // Burstiness is deliberately NOT scored.
  //
  // Sentence-length variance is the signal the first generation of detectors
  // leaned on, and Pangram's own account of why they abandoned it applies
  // exactly here: "highly formulaic or technical human writing often triggers
  // false flags under those criteria". A press release is formulaic structured
  // writing by design, so penalising even rhythm would mark good human copy as
  // machine-written, and the only way to answer the penalty is to vary sentence
  // length on purpose, which is the roughening the editorial standard forbids.
  //
  // It is still computed, and still shown in the diagnostic block, where it
  // describes the text without costing anything.

  return { score: Math.max(0, Math.min(100, Math.round(score))), parts, burstiness: cv };
}

export const MOVES = [
  { key: 'hook', label: 'Hook phrase', hint: 'a line someone actually said' },
  { key: 'scope', label: 'Scope', hint: 'number, size, first or largest' },
  { key: 'material', label: 'Material and siting', hint: 'what it is made of, where it sits' },
  { key: 'impact', label: 'Impact', hint: 'what changed, for whom' },
  { key: 'context', label: 'Wider context', hint: 'programme, portfolio, trend' },
  { key: 'proof', label: 'Third-party proof', hint: 'award, publication, collaborator' },
];

/**
 * Provisional, and on the DISTINCT basis.
 *
 * The standard's 10-per-100 target was derived from a raw occurrence count:
 * the Hollaway exemplar is 12.7 that way, and 9.6 counting distinct facts.
 * Keeping 10 against distinct counting would mark the standard's own exemplar
 * "marginal", which cannot be right. Scaled like for like, 10 × (9.6 / 12.7)
 * lands at about 7.6, so the target is 8 and the lower bound moves with it.
 *
 * These are two numbers derived from three samples. They are advisory until
 * the analyser has been run across twenty of October's own covered releases
 * and the thresholds set where the populations actually separate — see the
 * brief, §6. Nothing blocks on them in the meantime.
 */
export const THRESHOLDS = { target: 8, marginal: 5, basis: 'distinct', provisional: true };

/**
 * @param {string} html   the release body
 * @param {object} brief  the fact sheet, so filled slots can be credited
 */
export function analyse(html, brief = {}) {
  const full = stripHtml(html);
  const body = stripBoilerplate(full);
  const w = words(body);
  const wordCount = w.length;
  const sents = sentences(body);

  const items = checkableItems(body);
  const distinctMap = new Map();
  for (const it of items) if (!distinctMap.has(key(it.text))) distinctMap.set(key(it.text), it);
  const distinct = [...distinctMap.values()];

  const density = wordCount ? +(distinct.length / wordCount * 100).toFixed(1) : 0;
  const densityRaw = wordCount ? +(items.length / wordCount * 100).toFixed(1) : 0;

  const quotes = namedQuotes(body);
  const named = quotes.filter((q) => q.named);
  const measurements = distinct.filter((i) => i.kind === 'measurement' || i.kind === 'number');

  // A move counts as filled when its slot carries text in the fact sheet.
  const moves = MOVES.map((mv) => ({
    ...mv,
    filled: !!String(brief?.moves?.[mv.key] || '').trim(),
  }));

  // The actionable list, worst first. Each one is fixed by reporting.
  const gaps = [];
  if (density < THRESHOLDS.marginal) {
    gaps.push({ key: 'density', severity: 'high', label: 'The reporting has not been done',
      detail: `${distinct.length} checkable facts in ${wordCount} words. Target is ${THRESHOLDS.target} per 100.` });
  } else if (density < THRESHOLDS.target) {
    gaps.push({ key: 'density', severity: 'medium', label: 'Go back for more facts',
      detail: `${density} per 100 words. Target is ${THRESHOLDS.target}.` });
  }
  if (!named.length) {
    gaps.push({ key: 'named_quote', severity: 'high', label: 'No named, attributed quote',
      detail: quotes.length
        ? `${quotes.length} quotation${quotes.length === 1 ? '' : 's'}, none with a name and an attribution next to it.`
        : 'Nobody is quoted. Two named quotes is the bar.' });
  } else if (named.length < 2) {
    gaps.push({ key: 'named_quote', severity: 'medium', label: 'Only one named quote', detail: 'The bar is two.' });
  }
  if (!measurements.length) {
    gaps.push({ key: 'measurement', severity: 'high', label: 'No number or measurement',
      detail: 'A size, a count, a span, a date or a cost. One hard number is the bar.' });
  }
  if (!String(brief?.moves?.proof || '').trim()) {
    gaps.push({ key: 'proof', severity: 'high', label: 'No third-party proof',
      detail: 'An award, a publication, or a named collaborator.' });
  }
  for (const mv of moves.filter((x) => !x.filled && x.key !== 'proof')) {
    gaps.push({ key: `move_${mv.key}`, severity: 'medium', label: `Move unfilled: ${mv.label}`, detail: mv.hint });
  }
  if (!String(brief?.assets?.press_contact || '').trim()) {
    gaps.push({ key: 'contact', severity: 'medium', label: 'No named press contact',
      detail: 'A human who answers the phone, with a direct line.' });
  }

  const verdict = density >= THRESHOLDS.target ? 'ready'
    : density >= THRESHOLDS.marginal ? 'marginal' : 'not_ready';

  // Sentence-level view, for the meter and the inline highlighting.
  const spans = sentenceSpans(body);
  const bareWords = spans.filter((sp) => sp.bare).reduce((n, sp) => n + sp.words, 0);
  // Measured by WORDS rather than by sentence count, so one long factless
  // paragraph is not scored the same as one short factless aside.
  const barePct = wordCount ? Math.round((bareWords / wordCount) * 100) : 0;

  const tells = aiTells(body);
  const human = humanScore({
    text: body, words: wordCount, tells, density,
    cv: styleMarkers(body, sents).sentence_length_cv.value, bare_pct: barePct,
  });

  return {
    tells,
    human_score: human.score,
    human_parts: human.parts,
    spans,
    bare_pct: barePct,
    bare_sentences: spans.filter((sp) => sp.bare).length,
    sentence_count: spans.length,
    word_count: wordCount,
    density,
    density_raw: densityRaw,
    checkable: distinct.length,
    checkable_occurrences: items.length,
    items: distinct,
    quotes,
    named_quotes: named.length,
    moves,
    moves_filled: moves.filter((m) => m.filled).length,
    gaps,
    verdict,
    style: styleMarkers(body, sents),
    thresholds: THRESHOLDS,
  };
}

export default { analyse, checkableItems, namedQuotes, sentenceSpans, aiTells, humanScore, stripHtml, stripBoilerplate, MOVES, THRESHOLDS };
