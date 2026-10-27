/**
 * The cut list: what comes out of a talking head, and what must not.
 *
 * The arithmetic is where this goes wrong. An off-by-one at a boundary clips
 * the first consonant off a word, which sounds like a fault in the camera
 * rather than in the edit, and a keep span that comes out negative or
 * zero-length hands ffmpeg nonsense.
 *
 *   node tests/silence-cut.test.js
 */
const path = require('path');
const { pathToFileURL } = require('url');

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log('  ok  ', label);
  else { console.log('  FAIL', label); failures += 1; }
};

/** Build timings from `word@start-end` tokens, so a fixture reads as a script. */
function tape(spec) {
  return spec.trim().split(/\s+/).map((t) => {
    const [word, span] = t.split('@');
    const [start, end] = span.split('-').map(Number);
    return { word, start, end };
  });
}

async function main() {
  const { planCuts, selectExpr, FILLERS } = await import(pathToFileURL(
    path.join(__dirname, '..', '..', 'shared', 'silenceCut.mjs')).href);

  console.log('A clean take loses nothing');
  const clean = planCuts(tape('This@0-0.4 is@0.4-0.6 a@0.6-0.7 clean@0.7-1.1 take@1.1-1.5'));
  ok(clean.cuts.length === 0, 'no cuts proposed');
  ok(clean.keep.length === 1 && clean.keep[0][1] === 1.5, 'and the whole thing is kept');
  ok(clean.saved_s === 0, 'nothing saved, which is the honest answer');

  console.log('\nA long pause is cut, but never to nothing');
  // Cutting a pause flat is what makes an edit sound machine-gunned, and it is
  // the first thing anyone notices.
  const paused = planCuts(tape('One@1.0-1.4 two@4.0-4.4'), { leave_s: 0.12 });
  ok(paused.cuts.length === 1 && paused.cuts[0].kind === 'silence', 'one silence cut');
  const [, firstEnd] = paused.keep[0];
  const [secondStart] = paused.keep[1];
  ok(firstEnd > 1.4 && secondStart < 4.0, 'with breathing room left on both sides');
  ok(Math.abs((firstEnd - 1.4) - 0.06) < 0.001 && Math.abs((4.0 - secondStart) - 0.06) < 0.001,
    'exactly half the leave on each side');

  console.log('\nA short pause is left alone');
  ok(planCuts(tape('One@2-2.4 two@2.7-3.1'), { gap_s: 0.45 }).cuts.length === 0,
    'a 0.3s gap is breath, not dead air');
  ok(planCuts(tape('One@2-2.4 two@3.2-3.6'), { gap_s: 0.45 }).cuts.length === 1,
    'a 0.8s gap is dead air');

  console.log('\nA long pause that starts inside the opening is trimmed, not spared');
  // Protecting all of a three-second pause because it begins half a second in
  // would leave the worst silence in the reel untouched.
  const straddle = planCuts(tape('One@0.2-0.5 two@4.0-4.4'), { keep_first_s: 1.0 });
  ok(straddle.cuts.length === 1, 'it is still cut');
  ok(straddle.cuts[0].from >= 1.0, 'but not before the guard');
  ok(straddle.keep[0][1] >= 1.0, 'so the opening survives intact');

  console.log('\nFiller words come out');
  const um = planCuts(tape('It@1.0-1.2 was@1.2-1.4 um@1.4-1.7 a@1.7-1.8 map@1.8-2.2'));
  ok(um.cuts.some((c) => c.kind === 'filler'), 'the um is cut');
  ok(um.filler_words.includes('um'), 'and named, so the operator can see what went');
  ok(um.keep.length === 2, 'leaving two spans either side of it');

  console.log('\nAnd so do filler phrases, as one cut rather than two');
  const yk = planCuts(tape('It@1.0-1.2 was@1.2-1.4 you@1.4-1.6 know@1.6-1.9 big@1.9-2.3'));
  const phrase = yk.cuts.filter((c) => c.kind === 'filler');
  ok(phrase.length === 1, 'one cut, not two');
  ok(/you know/.test(phrase[0].text), 'covering both words');

  console.log('\nA cut is padded, so it does not clip the word beside it');
  // Whisper's boundaries are close but not exact. Cutting flush to them takes
  // the first consonant off the next word.
  const padded = planCuts(tape('A@1.0-1.2 um@1.2-1.5 b@1.5-1.8'), { pad_s: 0.04, gap_s: 9 });
  const f = padded.cuts.find((c) => c.kind === 'filler');
  ok(f.from < 1.2 && f.to > 1.5, 'the cut reaches slightly past the filler on both sides');

  console.log('\nThe opening is protected, because the hook lives there');
  const early = planCuts(tape('um@0.2-0.5 For@0.8-1.1 two@1.1-1.4 hundred@1.4-1.9 years@1.9-2.4'),
    { keep_first_s: 1.0 });
  ok(early.cuts.length === 0, 'nothing inside the first second is touched');
  const late = planCuts(tape('For@0.1-0.4 two@0.4-0.7 um@2.0-2.3 hundred@2.3-2.8'),
    { keep_first_s: 1.0 });
  ok(late.cuts.length > 0, 'but a filler after it still goes');

  console.log('\nOverlapping removals become one, not two with nothing between');
  // A filler sitting inside a long pause produces two cuts that touch. Left
  // separate they leave a zero-length keep span, which is nonsense to ffmpeg.
  const overlap = planCuts(tape('A@1.0-1.2 um@2.0-2.3 b@3.4-3.8'), { gap_s: 0.45 });
  ok(overlap.keep.every(([a, b]) => b > a), 'every keep span has length');
  ok(overlap.keep.every(([a, b]) => b - a > 0.02), 'and none is a sliver');
  ok(overlap.cuts.every((c, i, arr) => i === 0 || c.from > arr[i - 1].to),
    'and the cuts do not overlap each other');

  console.log('\nNo kept span is too short to be worth keeping');
  // The bug this caught: a filler with a pause on each side produced cuts 20ms
  // apart, leaving two 20ms keep spans. At 30fps that is a single frame of
  // video and a 20ms click of audio, twice, which is exactly what makes an
  // automatic edit sound broken.
  const sandwich = planCuts(tape('A@1.0-1.2 um@2.0-2.3 b@3.4-3.8'), { keep_first_s: 0 });
  ok(sandwich.keep.every(([a, b]) => b - a >= 0.10),
    `every kept span is at least 100ms: ${JSON.stringify(sandwich.keep)}`);
  ok(sandwich.cuts.length === 2, 'and the cuts either side of the filler became one');
  // Across a set of awkward fixtures, not just the one that caught it.
  for (const spec of [
    'A@1.0-1.2 um@1.3-1.6 b@1.7-2.0',
    'A@1.0-1.2 uh@2.0-2.2 um@2.25-2.5 b@3.2-3.6',
    'A@0.5-0.7 you@0.75-0.9 know@0.9-1.1 b@1.15-1.4 um@2.2-2.5 c@2.55-2.9',
  ]) {
    const r = planCuts(tape(spec), { keep_first_s: 0 });
    const bad = r.keep.filter(([a, b]) => b - a < 0.10);
    if (bad.length) { ok(false, `slivers in "${spec}": ${JSON.stringify(bad)}`); break; }
  }
  ok(true, 'and none appear across the awkward cases either');

  console.log('\nThe spans are in order, inside the clip, and add up');
  const real = planCuts(tape(
    'So@0.2-0.5 um@0.5-0.9 the@1.4-1.6 thing@1.6-2.0 is@2.0-2.2 you@3.1-3.3 know@3.3-3.6 '
    + 'it@3.6-3.8 was@3.8-4.0 uh@4.0-4.4 nineteen@5.2-5.8 twelve@5.8-6.3'), { keep_first_s: 0 });
  ok(real.keep.every(([a, b]) => a >= 0 && b <= real.original_s + 0.001), 'inside the clip');
  ok(real.keep.every((s, i, arr) => i === 0 || s[0] >= arr[i - 1][1]), 'in order, not overlapping');
  const kept = real.keep.reduce((n, [a, b]) => n + (b - a), 0);
  ok(Math.abs(kept - real.new_s) < 0.01, 'the reported length is the spans added up');
  ok(Math.abs(real.original_s - real.new_s - real.saved_s) < 0.01, 'and saved is the difference');
  ok(real.saved_s > 1, `it saves ${real.saved_s}s out of ${real.original_s}s`);

  console.log('\nThe file is longer than the transcript, and the plan must know it');
  // The bug this caught: without the file's own length the plan ends at the
  // last word Whisper heard and everything after it is dropped silently. On a
  // partial transcript that is a lost sentence that looks like a clean edit.
  const short = planCuts(tape('One@0.3-0.6 two@0.6-1.0'), { media_s: 30, keep_first_s: 0 });
  ok(short.original_s === 30, 'the plan measures the file, not the transcript');
  const trailing = short.cuts.find((c) => /after the last word/.test(c.text));
  ok(!!trailing, 'and the silence after the last word is a listed cut');
  ok(Math.abs(trailing.to - 30) < 0.001, 'running to the end of the file');
  ok(short.keep.every(([, b]) => b <= 30.001), 'nothing is kept past the file');

  // Without media_s it still has to behave, because a caller that cannot
  // probe the file should get a plan covering what it does know about.
  const noMedia = planCuts(tape('One@0.3-0.6 two@0.6-1.0'), { keep_first_s: 0 });
  ok(noMedia.original_s === 1.0, 'with no file length it covers up to the last word');
  ok(!noMedia.cuts.some((c) => /after the last word/.test(c.text)),
    'and claims no trailing silence it cannot see');

  // A file SHORTER than the transcript means the timings are not this clip's.
  const wrong = planCuts(tape('One@0.3-0.6 two@9.0-9.4'), { media_s: 2, keep_first_s: 0 });
  ok(wrong.keep.every(([, b]) => b <= 9.4), 'a file shorter than the words does not invert the plan');

  console.log('\n"Like" is left alone, because a transcript cannot tell which it is');
  // Filler in "it was like, really big" and a preposition in "a map like this
  // one". Cutting it would make the sentence wrong.
  ok(!FILLERS.includes('like'), 'like is not in the list');
  ok(planCuts(tape('A@1-1.2 map@1.2-1.5 like@1.5-1.8 this@1.8-2.1')).cuts.length === 0,
    'and a sentence using it properly survives');

  console.log('\nThe switches actually switch things off');
  const both = tape('A@1.0-1.2 um@1.2-1.5 b@1.5-1.7 you@1.7-1.9 know@1.9-2.2 c@2.2-2.5');
  ok(planCuts(both, { fillers: false, filler_phrases: false }).cuts.length === 0,
    'no fillers, no cuts');
  ok(planCuts(both, { fillers: false }).cuts.length === 1, 'phrases alone still cut');
  ok(planCuts(both, { filler_phrases: false }).cuts.length === 1, 'and words alone');

  console.log('\nThe select expression is one filter, whatever the cut count');
  // A trim-and-concat chain for forty cuts builds a hundred and twenty nodes
  // and a command line long enough to hit ffmpeg's limit.
  const expr = selectExpr(real.keep);
  ok(expr.split('+').length === real.keep.length, 'one between() per kept span');
  ok(/^between\(t,[\d.]+,[\d.]+\)/.test(expr), 'in the shape ffmpeg takes');
  ok(selectExpr([]) === null && selectExpr(null) === null, 'and nothing to keep is null, not a crash');

  console.log('\nBad input does not produce a broken plan');
  for (const bad of [null, undefined, [], 'nope', [{}], [{ word: 'a', start: 2, end: 1 }],
    [{ word: 'a', start: NaN, end: 1 }]]) {
    const r = planCuts(bad);
    if (!r || !Array.isArray(r.keep) || r.keep.some(([a, b]) => !(b > a))) {
      ok(false, `broke on ${JSON.stringify(bad)}`); break;
    }
  }
  ok(planCuts([]).keep.length === 0, 'no words, nothing to keep');
  ok(planCuts([{ word: 'a', start: 2, end: 1 }]).keep.length === 0,
    'a word that ends before it starts is dropped rather than inverted');

  console.log('\nWords arriving out of order are sorted, not trusted');
  const shuffled = planCuts([
    { word: 'two', start: 4.0, end: 4.4 }, { word: 'one', start: 1.0, end: 1.4 }]);
  ok(shuffled.keep[0][0] < shuffled.keep[1][0], 'the plan is still in time order');
  ok(shuffled.cuts.length === 1, 'and the gap between them is found');

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.log('  FAIL ', e.stack || e.message); process.exit(1); });
