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

  return {
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

export default { analyse, checkableItems, namedQuotes, sentenceSpans, stripHtml, stripBoilerplate, MOVES, THRESHOLDS };
