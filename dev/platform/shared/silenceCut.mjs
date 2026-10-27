/**
 * What to cut out of a talking head, worked out from the word timings.
 *
 * This is the biggest single saving on production time for a talking head,
 * bigger than captions, because it removes work rather than automating it. The
 * timings it needs are the ones the caption library already asks Whisper for,
 * so it costs nothing extra to run.
 *
 * Pure on purpose. It takes words and returns the spans to keep; it never
 * touches a file. That makes the arithmetic testable, and the arithmetic is
 * where this goes wrong: an off-by-one at a boundary clips the first consonant
 * off a word, which sounds like a fault in the camera rather than in the edit.
 *
 * Nothing here decides to cut anything on its own. It produces a proposal with
 * every removal listed, and the operator applies it. An automatic cut that
 * takes out a deliberate pause is worse than no cut at all, because it is
 * harder to notice than it is to fix.
 */

/**
 * Words that are filler when they stand alone.
 *
 * Deliberately short, and deliberately missing the ones that are usually doing
 * real work. "Like" is a filler in "it was like, really big" and a preposition
 * in "a map like this one", and nothing in a transcript tells the two apart.
 * Cutting it would make the sentence wrong, so it is left to the operator.
 */
export const FILLERS = ['um', 'uh', 'erm', 'er', 'ah', 'eh', 'hmm', 'mmm', 'mm'];

/** Phrases that are filler, matched across consecutive words. */
export const FILLER_PHRASES = [
  ['you', 'know'], ['i', 'mean'], ['sort', 'of'], ['kind', 'of'],
];

const bare = (w) => String(w || '').toLowerCase().replace(/[^a-z']/g, '');

/**
 * @param {{word:string,start:number,end:number}[]} words Whisper's word array.
 * @param {object} opts
 *   gap_s        a silence longer than this is a candidate (default 0.45)
 *   leave_s      how much of each cut gap to leave, so speech still breathes
 *   pad_s        kept either side of a filler, so a cut does not clip a word
 *   fillers      cut standalone filler words
 *   filler_phrases  cut "you know", "i mean" and the like
 *   keep_first_s take nothing out of the opening, where the hook lives
 */
export function planCuts(words, opts = {}) {
  const {
    gap_s: gapS = 0.45,
    leave_s: leaveS = 0.12,
    pad_s: padS = 0.04,
    fillers = true,
    filler_phrases: fillerPhrases = true,
    keep_first_s: keepFirstS = 1.0,
    media_s: mediaS = null,
    min_keep_s: minKeepS = 0.10,
  } = opts || {};

  const list = (Array.isArray(words) ? words : [])
    .filter((w) => w && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .sort((a, b) => a.start - b.start);

  if (!list.length) {
    return { keep: [], cuts: [], original_s: 0, new_s: 0, saved_s: 0,
      silence_s: 0, filler_s: 0, filler_words: [] };
  }

  const originalStart = 0;
  const lastWord = list[list.length - 1].end;
  // The transcript ends at the last word; the file usually runs on past it.
  // Without the file's own length the plan quietly truncates everything after
  // the last word Whisper heard, which on a partial transcript throws away a
  // whole sentence and looks like a successful edit.
  const originalEnd = Number.isFinite(mediaS) && mediaS > lastWord ? mediaS : lastWord;
  const cuts = [];

  // --- fillers ---------------------------------------------------------------
  // Marked before the gaps, because cutting a filler usually leaves a gap on
  // either side of it that is then worth cutting too.
  const isFiller = new Array(list.length).fill(false);
  if (fillers) {
    list.forEach((w, i) => { if (FILLERS.includes(bare(w.word))) isFiller[i] = true; });
  }
  if (fillerPhrases) {
    for (let i = 0; i < list.length; i += 1) {
      for (const phrase of FILLER_PHRASES) {
        if (phrase.every((p, k) => bare(list[i + k]?.word) === p)) {
          for (let k = 0; k < phrase.length; k += 1) isFiller[i + k] = true;
        }
      }
    }
  }

  // Consecutive flagged words become one cut, so "um, you know" is a single
  // removal rather than three abutting ones.
  let runStart = null;
  const fillerWords = [];
  for (let i = 0; i <= list.length; i += 1) {
    if (i < list.length && isFiller[i]) {
      if (runStart === null) runStart = i;
      fillerWords.push(list[i].word);
      continue;
    }
    if (runStart !== null) {
      const from = Math.max(0, list[runStart].start - padS);
      const to = list[i - 1].end + padS;
      // A filler sitting wholly inside the protected opening is left; one that
      // merely starts there is not worth trimming, because half an "um" is a
      // worse sound than a whole one.
      if (from >= keepFirstS) cuts.push({ kind: 'filler', from, to,
        text: list.slice(runStart, i).map((w) => w.word).join(' ') });
      runStart = null;
    }
  }

  // --- silence ---------------------------------------------------------------
  // A gap is measured between the words either side of it, so a filler already
  // marked for removal does not hide the silence around it.
  for (let i = 0; i < list.length - 1; i += 1) {
    const gap = list[i + 1].start - list[i].end;
    if (gap <= gapS) continue;
    // Leave a little at each end. Cutting a pause to nothing is what makes an
    // edit sound machine-gunned, and it is the first thing anyone notices.
    // Clamped to the guard rather than skipped by it. A three-second pause
    // starting half a second in is still three seconds of dead air; protecting
    // the whole of it because it begins inside the opening would leave the
    // worst silence in the reel untouched.
    const from = Math.max(list[i].end + leaveS / 2, keepFirstS);
    const to = list[i + 1].start - leaveS / 2;
    if (to - from <= 0.02) continue;
    cuts.push({ kind: 'silence', from, to,
      text: `${(to - from).toFixed(2)}s of a ${gap.toFixed(2)}s pause` });
  }

  // Trailing silence after the last word is a cut like any other, listed so
  // the operator sees it rather than losing it to an off-by-one.
  if (originalEnd - lastWord > gapS) {
    cuts.push({ kind: 'silence', from: lastWord + leaveS / 2, to: originalEnd,
      text: `${(originalEnd - lastWord).toFixed(2)}s after the last word` });
  }

  // A lead-in before the first word is silence too, unless the hook guard
  // covers it.
  if (list[0].start > gapS && keepFirstS <= 0) {
    cuts.push({ kind: 'silence', from: 0, to: list[0].start - leaveS / 2,
      text: `${list[0].start.toFixed(2)}s before the first word` });
  }

  // --- merge and invert ------------------------------------------------------
  cuts.sort((a, b) => a.from - b.from);
  const merged = [];
  for (const c of cuts) {
    const last = merged[merged.length - 1];
    // Two removals near each other become one, and `near` is the length of the
    // shortest keep span worth having rather than zero.
    //
    // This is not tidiness. A filler with a pause on each side produced cuts
    // 20ms apart, which left two 20ms keep spans: at 30fps that is one frame
    // of video and a 20ms click of audio, twice. A fragment of speech that
    // short is not speech, and leaving it in is what makes an automatic edit
    // sound broken.
    if (last && c.from <= last.to + minKeepS) {
      last.to = Math.max(last.to, c.to);
      last.kind = last.kind === c.kind ? last.kind : 'both';
      last.text = `${last.text} + ${c.text}`;
    } else merged.push({ ...c });
  }

  const keep = [];
  let at = originalStart;
  for (const c of merged) {
    if (c.from > at) keep.push([+at.toFixed(3), +c.from.toFixed(3)]);
    at = Math.max(at, c.to);
  }
  if (at < originalEnd) keep.push([+at.toFixed(3), +originalEnd.toFixed(3)]);

  const sum = (spans) => spans.reduce((n, [a, b]) => n + (b - a), 0);
  const silenceS = sum(merged.filter((c) => c.kind === 'silence').map((c) => [c.from, c.to]));
  const fillerS = sum(merged.filter((c) => c.kind === 'filler').map((c) => [c.from, c.to]));
  const bothS = sum(merged.filter((c) => c.kind === 'both').map((c) => [c.from, c.to]));

  return {
    keep,
    cuts: merged,
    original_s: +originalEnd.toFixed(2),
    new_s: +sum(keep).toFixed(2),
    saved_s: +(originalEnd - sum(keep)).toFixed(2),
    silence_s: +silenceS.toFixed(2),
    filler_s: +fillerS.toFixed(2),
    both_s: +bothS.toFixed(2),
    filler_words: fillerWords,
  };
}

/**
 * The ffmpeg select expression for a set of keep spans.
 *
 * One `select` filter rather than a trim-and-concat chain per span: a
 * forty-cut edit would otherwise build a filter graph with a hundred and
 * twenty nodes, and ffmpeg's command line has a length limit that a long
 * interview reaches.
 */
export function selectExpr(keep) {
  if (!keep?.length) return null;
  return keep.map(([a, b]) => `between(t,${a},${b})`).join('+');
}
