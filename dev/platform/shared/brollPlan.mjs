/**
 * Where a talking head needs something else on screen, worked out from the
 * words alone.
 *
 * The expensive half of "Claude edits my videos" is not the render, it is
 * knowing where a cut belongs. This does that half from the transcript, which
 * costs nothing and is deterministic, and leaves the other half, what to show,
 * to the operator. That split is deliberate: nothing in OMI knows what is
 * inside a b-roll clip, and a planner that guessed would place the wrong shot
 * confidently and be noticed only on playback.
 *
 * So this proposes moments, never footage. Each one says why it is a moment,
 * because a reason can be argued with and a suggestion cannot.
 *
 * Pure. It takes words and returns spans; it never touches a file.
 */

/** A pause this long or longer ends a sentence, when punctuation does not. */
const SENTENCE_GAP_S = 0.45;

/**
 * Things a sentence can name that are worth showing: a number, a measurement,
 * a year, a place-ish capitalised run. Deliberately narrow. A planner that
 * called every sentence showable would propose a cut every four seconds, which
 * is a different kind of bad video.
 */
const SHOWABLE = new RegExp(
  '\\b\\d[\\d,.]*\\s*(%|per cent|million|billion|thousand|metres?|m|km|ft|feet|'
  + 'years?|hours?|days?|weeks?|months?)\\b'
  + '|\\b(1[0-9]{3}|20[0-9]{2})\\b'
  + '|\\b(first|second|third|fourth|fifth|next|finally|then)\\b'
  + '|\\b(looks? like|you can see|here|this is|shaped|colour|color|texture|'
  + 'drawing|photograph|model|sketch|site|building|room|garden|fabric)\\b', 'i');

const round2 = (n) => Math.round(n * 100) / 100;

/** Group words into sentences, on punctuation or on a pause. */
function sentences(list) {
  const out = [];
  let current = [];
  for (let i = 0; i < list.length; i += 1) {
    current.push(list[i]);
    const text = String(list[i].word || '');
    const gapAfter = i + 1 < list.length ? list[i + 1].start - list[i].end : Infinity;
    if (/[.!?]$/.test(text.trim()) || gapAfter >= SENTENCE_GAP_S || i === list.length - 1) {
      out.push({
        words: current,
        start: current[0].start,
        end: current[current.length - 1].end,
        text: current.map((w) => w.word).join(' ').trim(),
      });
      current = [];
    }
  }
  return out;
}

/**
 * @param {{word:string,start:number,end:number}[]} words Whisper's word array.
 * @param {object} opts
 *   hold_first_s  leave the opening on the speaker's face (the hook)
 *   hold_last_s   and the ending, where the payoff lands
 *   min_hold_s    propose a cut once the viewer has had this long on one shot
 *   max_span_s    no single b-roll shot runs longer than this
 *   min_gap_s     at least this much face between two b-roll shots
 *   media_s       the clip's real length, when the transcript ends early
 *   limit         most spans to propose
 */
export function planBroll(words, opts = {}) {
  const {
    hold_first_s: holdFirst = 3,
    hold_last_s: holdLast = 2,
    min_hold_s: minHold = 6,
    max_span_s: maxSpan = 5,
    min_gap_s: minGap = 4,
    media_s: mediaS = null,
    limit = 8,
  } = opts || {};

  const list = (Array.isArray(words) ? words : [])
    .filter((w) => w && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .sort((a, b) => a.start - b.start);

  if (!list.length) return { spans: [], sentences: 0, duration_s: 0, held_s: 0 };

  const lastWord = list[list.length - 1].end;
  const duration = Number.isFinite(mediaS) && mediaS > lastWord ? mediaS : lastWord;
  const latestStart = duration - holdLast;

  const sents = sentences(list);

  // Candidate moments: every sentence start, plus points inside any sentence
  // that runs longer than the shot is allowed to hold.
  //
  // Sentence starts alone are not enough, and the case they miss is the one
  // this feature exists for: somebody talking in a single unbroken stretch for
  // half a minute has exactly one sentence start, at zero, inside the hook
  // guard, so the planner proposed nothing at all for the most monotonous reel
  // it could be handed.
  const candidates = [];
  for (const s of sents) {
    candidates.push({ start: s.start, end: s.end, text: s.text });
    if (s.end - s.start <= minHold) continue;
    for (const w of s.words) {
      const last = candidates[candidates.length - 1];
      // Spacing the candidates, which keeps the list short on a long take.
      // It is not what stops two cutaways landing together: minGap does that,
      // below, and a mutation proving this line is behavioural would be
      // proving something untrue.
      if (w.start - last.start < minHold) continue;
      candidates.push({ start: w.start, end: s.end, text: s.text, mid: true });
    }
  }
  candidates.sort((a, b) => a.start - b.start);

  const spans = [];
  // How long the viewer has been looking at the same shot. Starts at the hook,
  // because that is a shot too, and the longer it has run the more a change is
  // worth proposing.
  let shotSince = 0;

  for (const s of candidates) {
    if (s.start < holdFirst) continue;          // the hook stays on the face
    // An early exit, not the guard: the payoff is protected by clamping `to`
    // to latestStart below, which is what a test can actually catch. This line
    // stops the loop walking candidates that can only be discarded.
    if (s.start >= latestStart) break;

    const held = s.start - shotSince;
    // A point chosen in the middle of a sentence is chosen because the shot
    // has run long, not because of anything the sentence names: the showable
    // term may be thirty words away from the cut.
    const showable = s.mid ? null : SHOWABLE.exec(s.text);
    // A sentence earns a cut either by naming something showable, or by the
    // shot having run long enough that any change helps.
    if (!showable && held < minHold) continue;
    if (spans.length && s.start - spans[spans.length - 1].to < minGap) continue;

    const to = Math.min(s.end, s.start + maxSpan, latestStart);
    if (to - s.start < 0.8) continue;           // too short to read as a shot

    spans.push({
      from: round2(s.start),
      to: round2(to),
      text: s.text.slice(0, 120),
      // Why, in the words an operator would use. The held figure is the one
      // that makes the case: "you have been on the same shot for eleven
      // seconds" is an argument; "consider b-roll" is not.
      reason: showable
        ? `This sentence names something you could show: "${showable[0]}"`
        : `${Math.round(held)}s on the same shot by this point`,
      held_s: round2(held),
      showable: !!showable,
    });
    shotSince = to;
    if (spans.length >= limit) break;
  }

  return {
    spans,
    sentences: sents.length,
    duration_s: round2(duration),
    // The longest the viewer ever goes without a change, after this plan. The
    // number an operator is really asking about.
    held_s: round2(spans.reduce((worst, s, i) => {
      const prev = i ? spans[i - 1].to : 0;
      return Math.max(worst, s.from - prev);
    }, spans.length ? duration - spans[spans.length - 1].to : duration)),
  };
}
