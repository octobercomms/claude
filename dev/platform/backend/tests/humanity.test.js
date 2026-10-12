/**
 * The reads-as-human heuristic.
 *
 * It is not a classifier and cannot read a watermark. What it does is what the
 * commercial detectors do without a key: look for the tells. The separation
 * below is the whole claim, so it is pinned here — if a future edit collapses
 * the gap between the AI and human samples, the thing has stopped working.
 *
 *   node tests/humanity.test.js        (no database, no network, no API key)
 */
const path = require('path');
const { pathToFileURL } = require('url');

let failures = 0;
const ok = (c, l) => { if (c) console.log('  ok   ' + l); else { console.log('  FAIL ' + l); failures++; } };

// The three samples from the editorial standard, verbatim where quoted there.
const HUMAN = `Describing it as an 'adrenaline building', Hollaway Studio's design for F51, features three skateparks, climbing wall (the tallest in the South East of England), and boxing ring. The landmark building appears as an imposing concrete beacon shrouded in mesh rising out of the Folkestone Creative Quarter and has transformed the landscape of Folkestone both architecturally and for the local community. F51's design has already received a number of awards and was selected in The Guardian's best architecture of 2022 where it was described as 'immaculately crafted.'`;
const AI = `Indiewalls approaches every project as a work of research, delving into each brief with meticulous care. It isn't just about art; it's about understanding how a space works. The consultancy serves hospitality, workplace, and healthcare clients, producing everything in-house through printing, framing, and sampling, giving it direct control over quality.`;
const REPORTED = `Indiewalls has paid 10 million dollars to independent artists since 2011. On 8 November the consultancy will hand-paint 100 pairs of sneakers at Altair Bar in Arlo Midtown, during BDNY weekend. Five artists are working the room, among them Brooklyn muralist Gavi Wolf. Last year 50 guests came.`;

(async () => {
  const m = await import(pathToFileURL(path.join(__dirname, '..', '..', 'shared', 'humanity.mjs')).href);
  const { analyse, aiTells } = m;

  console.log('\nThe samples separate');
  const ai = analyse(AI), human = analyse(HUMAN), reported = analyse(REPORTED);
  ok(ai.human_score < 25, `the Claude sample reads as generated (${ai.human_score}/100)`);
  ok(human.human_score > 70, `the human sample reads as human (${human.human_score}/100)`);
  ok(reported.human_score > 90, `plain reported facts score highest (${reported.human_score}/100)`);
  ok(human.human_score - ai.human_score > 50,
    `the gap is wide enough to act on (${human.human_score - ai.human_score} points)`);

  console.log('\nThe tells Anthropic names are caught');
  const tells = aiTells(AI).map((t) => t.label);
  ok(tells.some((t) => /isn’t just about|isn't just about/.test(t)), 'the "isn\'t just about" reframe');
  ok(tells.some((t) => /delving/i.test(t)), '"delving", from the verified excess-vocabulary list');
  ok(tells.some((t) => /meticulous/i.test(t)), '"meticulous", same list');
  ok(tells.filter((t) => /coordinate list/.test(t)).length >= 2, 'both three-item coordinate lists');
  ok(aiTells('It is not a tool, it is a way of working.').some((t) => /it’s not X/.test(t.label)),
    'the "it\'s not X, it\'s Y" construction Anthropic calls out by name');
  ok(aiTells("The team quietly rebuilt it.").some((t) => /quietly/.test(t.label)),
    '"quietly", the other one Anthropic names');

  console.log('\nOrdinary words are not treated as proof');
  const soft = aiTells('It transformed the landscape of Folkestone.');
  ok(soft.length === 1 && soft[0].weight === 2,
    'a soft-tier word scores 2, not 5 — "landscape" has ordinary uses');
  ok(analyse('It transformed the landscape of Folkestone in 2022 for 17 million pounds.').human_score > 85,
    'and one soft hit does not sink an otherwise factual sentence');

  console.log('\nBurstiness is not scored, on Pangram’s own evidence against it');
  const even = analyse('The wall is 28 metres tall. It opened in April 2022. Roger De Haan paid for it. Kent Council added funds.');
  ok(even.human_score > 85,
    `evenly built factual sentences are not punished for rhythm (${even.human_score}/100)`);
  ok(!even.human_parts.some((p) => /rhythm/i.test(p.label)), 'rhythm never appears as a cost');

  console.log('\nLength is not itself a penalty');
  const short = analyse(AI);
  const long = analyse(AI + ' ' + REPORTED.repeat(3));
  ok(long.human_score > short.human_score,
    `adding reported facts to the same tells raises the score (${short.human_score} → ${long.human_score})`);
  ok(analyse('A short human line about the 28-metre wall.').human_score > 70,
    'a short factual extract is not punished for being short');

  console.log('\nA name at the start of a sentence still counts as a fact');
  // Press releases open sentences with the client's name constantly. Counting
  // only mid-sentence capitals marked those sentences as carrying nothing.
  const opener = analyse('Indiewalls paints sneakers at Arlo Midtown. BDNY is the industry\u2019s main trade show. Indiewalls holds the event there.');
  ok(!opener.spans[1].bare, '\u201cBDNY is the industry\u2019s main trade show\u201d is not marked empty');
  // The rule only credits a name the text has already used mid-sentence, so a
  // client whose name only ever opens sentences needs the brand field.
  ok(opener.spans[2].bare, 'a name the body never uses mid-sentence is not guessed at');
  const withBrand = analyse(
    'Indiewalls paints sneakers at Arlo Midtown. Indiewalls holds the event there.',
    {}, { names: ['Indiewalls'] },
  );
  ok(withBrand.spans[1].facts > 0, 'and the brand field credits it');
  // The rule only credits names the document has already proved are names.
  const plain = analyse('Everyone agreed it looked good. Guests enjoyed the evening.');
  ok(plain.spans.every((sp) => sp.bare),
    'an ordinary capitalised first word is still not a fact');

  console.log('\nIt stays a heuristic');
  ok(typeof analyse('').human_score === 'number', 'empty text does not throw');
  ok(analyse(HUMAN).human_parts.every((p) => p.cost > 0),
    'the breakdown only lists what actually cost something');
})().catch((e) => { console.error('\nTEST ERROR:', e); failures++; })
  .finally(() => {
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    process.exit(failures ? 1 : 0);
  });
