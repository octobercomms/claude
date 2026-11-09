/**
 * The spoken shape of somebody else's reel: hook, problem, solution, CTA.
 *
 * The plan's row for this reads "transcribe, then Claude labels the
 * archetype", and the split is the same one the caption half uses. A model
 * labels spans of the transcript, because where a hook stops being a hook is
 * a judgement. Everything that can be measured is measured here, in a pure
 * module, and a labelling that contradicts a measurement is FLAGGED rather
 * than trusted.
 *
 * ── What is measured rather than asked ───────────────────────────────
 *
 * A call to action announces itself in words. "Link in bio", "book a call",
 * "save this for later" — there are perhaps twenty phrases that do almost all
 * of it, and finding them is a search rather than a judgement. So the
 * lexicon below runs over the transcript and the model's answer is checked
 * against it: a labelling with no CTA where "link in bio" appears at 24
 * seconds is a labelling that missed something, and the operator is told.
 *
 * The hook is positional in the same way. It is the first thing said, so a
 * labelling whose hook starts nine seconds in is describing something else.
 *
 * ── What this deliberately does not do ───────────────────────────────
 *
 * IT DOES NOT TOUCH THE DRAFT TEMPLATE. A template's slots are pictures and
 * words an operator supplies; the spoken structure of somebody else's reel is
 * information about how THEY wrote it. Sizing a text slot from a stranger's
 * hook would be a constraint nothing measured about our own batch — the same
 * reasoning that keeps the measured loudness out of the draft. It is reported
 * as a field, with its timings, which is what somebody writing a brief
 * actually wants.
 *
 * Pure. No I/O, no API, no side effects.
 */

/**
 * The sections, in the order they occur.
 *
 * Four, from the plan, and a section being absent is the ordinary case: most
 * reels are hook then solution then CTA, and plenty are hook then CTA. The
 * list is closed because a model asked an open question invents a word, and
 * an invented label cannot be checked against anything.
 */
export const SECTIONS = ['hook', 'problem', 'solution', 'cta'];

/** How long after the start a hook may begin before that is worth saying. */
export const HOOK_STARTS_BY = 1.5;

/** Where in the reel a call to action is expected. */
export const CTA_AFTER = 0.6;

/**
 * The phrases that are a call to action.
 *
 * Each is matched on word boundaries against the transcript, so "following"
 * does not fire "follow". A bare "comment" is deliberately absent: it occurs
 * in ordinary speech and the directive forms are what carry the intent.
 *
 * This list earns its place by being checkable. Every phrase here was chosen
 * because it is an instruction to the viewer and almost nothing else, and the
 * test asserts each one fires and that a sentence containing none of them
 * does not.
 */
export const CTA_PHRASES = [
  'link in bio',
  'link in my bio',
  'link in the bio',
  'link below',
  'link in the description',
  'tap the link',
  'click the link',
  'swipe up',
  'dm me',
  'dm us',
  'send me a dm',
  'drop me a dm',
  'comment below',
  'leave a comment',
  'comment the word',
  'follow for more',
  'follow me for',
  'follow us for',
  'save this',
  'save it for later',
  'book a call',
  'book a consultation',
  'get in touch',
  'drop us a line',
  'sign up',
  'subscribe',
  'share this',
  'request a quote',
  'get a quote',
];

// ── Reading the transcript ────────────────────────────────────────────

/**
 * The transcript as one searchable string, with a way back to the words.
 *
 * Punctuation is dropped and everything lowercased, so "Link in bio!" and
 * "link in bio" are the same phrase. The offsets array maps each character
 * of the joined string to the index of the word it came from, which is what
 * makes a match reportable as a TIME rather than as a string position.
 */
export function flatten(words = []) {
  const parts = [];
  const offsets = [];
  let text = '';
  for (let i = 0; i < words.length; i += 1) {
    const raw = String(words[i]?.word ?? '').toLowerCase().replace(/[^a-z0-9']+/g, '');
    if (!raw) continue;
    if (text.length) {
      text += ' ';
      offsets.push(i);
    }
    text += raw;
    for (let c = 0; c < raw.length; c += 1) offsets.push(i);
    parts.push(raw);
  }
  return { text, offsets };
}

/**
 * Every call-to-action phrase in the transcript, with when it was said.
 *
 * Returns `[{ phrase, at, words }]`, earliest first. `at` is the start of the
 * first word of the match, which is what a disagreement is reported against.
 */
export function ctaCues(words = []) {
  const { text, offsets } = flatten(words);
  if (!text) return [];
  const found = [];
  for (const phrase of CTA_PHRASES) {
    let from = 0;
    for (;;) {
      const i = text.indexOf(phrase, from);
      if (i < 0) break;
      from = i + 1;
      // Word boundaries, so "follow for more" is not found inside
      // "unfollow for more" and "subscribe" is not found inside
      // "subscriber".
      const before = i === 0 ? ' ' : text[i - 1];
      const afterIndex = i + phrase.length;
      const after = afterIndex >= text.length ? ' ' : text[afterIndex];
      if (before !== ' ' || after !== ' ') continue;
      const wordIndex = offsets[i];
      const w = words[wordIndex];
      if (!w) continue;
      found.push({ phrase, at: Number(w.start), words: wordIndex });
    }
  }
  found.sort((a, b) => a.at - b.at || a.phrase.localeCompare(b.phrase));
  return found;
}

/** When the last word ends. */
export function transcriptEnd(words = []) {
  let end = 0;
  for (const w of words) {
    const e = Number(w?.end);
    if (Number.isFinite(e) && e > end) end = e;
  }
  return end;
}

/** The words inside a span, by their own times. */
export function wordsIn(words = [], start, end) {
  return words.filter((w) => {
    const s = Number(w?.start);
    const e = Number(w?.end);
    return Number.isFinite(s) && Number.isFinite(e) && e > start && s < end;
  });
}

// ── The labelling contract ────────────────────────────────────────────

/**
 * Check a labelling against the transcript it claims to describe.
 *
 * Returns a list of problems, empty when it is usable. A model's answer goes
 * through here before anything is derived from it: a label outside the
 * vocabulary, a span that overlaps the one before it, a span containing no
 * words at all, or sections out of order are all faults in the answer rather
 * than reasons to repair it quietly.
 */
export function validateLabelling(sections, words = []) {
  const errors = [];
  if (!Array.isArray(sections)) return ['not a list of sections'];
  if (!sections.length) return ['no sections'];

  const end = transcriptEnd(words);
  const seen = [];
  let previousEnd = -Infinity;

  sections.forEach((s, i) => {
    const at = `section ${i + 1}`;
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      errors.push(`${at}: not an object`);
      return;
    }
    const unknown = Object.keys(s).filter((k) => !['label', 'start', 'end', 'says'].includes(k));
    if (unknown.length) errors.push(`${at}: reports ${unknown.join(', ')}, which nothing reads`);
    if (!SECTIONS.includes(s.label)) {
      errors.push(`${at}: unknown label "${s.label}" (${SECTIONS.join(', ')})`);
      return;
    }
    if (seen.includes(s.label)) {
      errors.push(`${at}: a second "${s.label}"`);
    }
    // In the order the sections occur. A solution before the problem it
    // solves is a labelling that has lost track of the transcript.
    const rank = SECTIONS.indexOf(s.label);
    const worst = seen.reduce((a, l) => Math.max(a, SECTIONS.indexOf(l)), -1);
    if (rank < worst) {
      errors.push(`${at}: "${s.label}" comes after "${seen[seen.length - 1]}"`);
    }
    seen.push(s.label);

    const start = Number(s.start);
    const stop = Number(s.end);
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) {
      errors.push(`${at}: start and end must be seconds, with end after start`);
      return;
    }
    if (start < -0.05) errors.push(`${at}: starts before the recording`);
    if (end > 0 && start > end + 0.05) {
      errors.push(`${at}: starts at ${round(start)}s, after the last word at ${round(end)}s`);
    }
    if (start < previousEnd - 0.05) {
      errors.push(`${at}: overlaps the section before it`);
    }
    previousEnd = stop;

    if (words.length && !wordsIn(words, start, stop).length) {
      errors.push(`${at}: covers no words`);
    }
  });

  return errors;
}

// ── The reading ───────────────────────────────────────────────────────

/**
 * What the labelling says, with what the transcript says held against it.
 *
 * Returns:
 *   archetype      the sequence of sections, e.g. "hook-solution-cta"
 *   sections       the labelling, with the words each span covers
 *   disagreements  where the labelling and the measured transcript differ
 *   confidence     0..1
 *   says           one paragraph an operator reads
 */
export function readStructure(sections, words = []) {
  const problems = validateLabelling(sections, words);
  if (problems.length) {
    return {
      archetype: null,
      sections: [],
      disagreements: [],
      confidence: 0,
      says: `The labelling is not usable: ${problems.join('; ')}.`,
    };
  }

  const end = transcriptEnd(words);
  const cues = ctaCues(words);
  const labels = sections.map((s) => s.label);
  const disagreements = [];

  const hook = sections.find((s) => s.label === 'hook');
  if (hook && Number(hook.start) > HOOK_STARTS_BY) {
    // Positional, not semantic: the hook is the first thing said. A span
    // starting nine seconds in is describing something else, whatever it was
    // called.
    disagreements.push(
      `the hook was placed at ${round(hook.start)}s, and a hook is the first thing said`
    );
  }
  if (!hook) {
    disagreements.push('nothing was labelled a hook, and every reel opens with something');
  }

  const cta = sections.find((s) => s.label === 'cta');
  const lateCues = end > 0 ? cues.filter((c) => c.at >= end * CTA_AFTER) : cues;
  if (!cta && lateCues.length) {
    disagreements.push(
      `no call to action was labelled, but "${lateCues[0].phrase}" is said`
      + ` at ${round(lateCues[0].at)}s`
    );
  }
  if (cta && !cues.length) {
    // Allowed, and worth saying. A CTA can be entirely on screen — a card, a
    // handle, an arrow — with nothing in the audio.
    disagreements.push(
      'a call to action was labelled but nothing in the words asks for one,'
      + ' so it is on screen rather than spoken'
    );
  }
  if (cta && cues.length) {
    const inside = cues.filter((c) => c.at >= Number(cta.start) - 0.5 && c.at <= Number(cta.end) + 0.5);
    if (!inside.length) {
      disagreements.push(
        `the call to action was placed at ${round(cta.start)}s but "${cues[0].phrase}"`
        + ` is said at ${round(cues[0].at)}s`
      );
    }
  }

  // Coverage: how much of what was said got a label at all. A labelling that
  // covers a third of the transcript has not read it.
  const covered = sections.reduce((a, s) => a + (Number(s.end) - Number(s.start)), 0);
  const coverage = end > 0 ? Math.min(1, covered / end) : 0;
  if (coverage < 0.6) {
    disagreements.push(
      `only ${Math.round(coverage * 100)}% of what was said carries a label`
    );
  }

  // The 0.85 IS the ceiling: coverage is already clamped to 1 and nothing
  // adds to the figure, so the highest this can read is 0.85 and a reading
  // can never claim certainty. There was a `Math.min(0.85, ...)` here as
  // well, and a mutation sweep walked straight through its removal, which is
  // what redundant means. Nothing here is measured off the file.
  const confidence = round(
    Math.max(0.1, 0.85 * coverage - 0.15 * disagreements.length),
    2
  );

  const withWords = sections.map((s) => ({
    label: s.label,
    start: round(s.start),
    end: round(s.end),
    seconds: round(Number(s.end) - Number(s.start)),
    words: wordsIn(words, Number(s.start), Number(s.end)).length,
    ...(s.says ? { says: s.says } : {}),
  }));

  return {
    archetype: labels.join('-'),
    sections: withWords,
    disagreements,
    confidence: Math.max(0.1, confidence),
    says: summarise(labels.join('-'), withWords, disagreements, cues),
  };
}

/** One paragraph, which is what somebody writing a brief actually reads. */
export function summarise(archetype, sections = [], disagreements = [], cues = []) {
  if (!archetype) return 'Nothing readable.';
  const shape = sections
    .map((s) => `${s.label} ${s.seconds}s`)
    .join(', ');
  const bits = [`${archetype.split('-').length} sections: ${shape}.`];
  if (cues.length) {
    bits.push(`It asks for the click in words: "${cues[0].phrase}" at ${round(cues[0].at)}s.`);
  } else {
    bits.push('Nothing in the words asks for a click.');
  }
  if (disagreements.length) {
    bits.push(`Worth checking: ${disagreements.join('; ')}.`);
  }
  return bits.join(' ');
}

function round(n, places = 2) {
  const f = 10 ** places;
  return Math.round(Number(n) * f) / f;
}
