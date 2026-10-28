/**
 * The reel craft checks.
 *
 * Seven rules from October's own growth plan, every one deterministic. The
 * tests matter more than usual here because each check is a claim about what
 * makes a reel work, and a check that fires on the wrong thing trains an
 * account manager to ignore the panel, which is worse than having no panel.
 *
 *   node tests/reel-checks.test.js
 */
const path = require('path');
const { pathToFileURL } = require('url');

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log('  ok  ', label);
  else { console.log('  FAIL', label); failures += 1; }
};

/** Build word timings from a sentence at a given pace. */
function say(text, { start = 0.4, wps = 2.8 } = {}) {
  const parts = String(text).split(/\s+/).filter(Boolean);
  const step = 1 / wps;
  return parts.map((w, i) => ({
    word: w, start: +(start + i * step).toFixed(2), end: +(start + (i + 1) * step).toFixed(2),
  }));
}

const by = (r, key) => r.checks.find((c) => c.key === key);

async function main() {
  const { checkReel } = await import(pathToFileURL(
    path.join(__dirname, '..', '..', 'shared', 'reelChecks.mjs')).href);

  // The plan's own example hook, which should pass everything it can.
  const GOOD = 'For two hundred years every map of the world showed a continent '
    + 'at the bottom. Nobody had been there. It was drawn because the world seemed '
    + 'to need balancing, and it stayed on charts until someone finally sailed south '
    + 'and found nothing but open water where a continent was meant to be.';

  console.log('A reel built the way the plan describes passes every check');
  const good = checkReel({
    timings: say(GOOD, { start: 0.3, wps: 2.6 }),
    edit: { caption_template: 'institution', brand: 'Oculi Mundi',
      // A term this client is trying to be found for, said out loud. Without
      // one the keyword check is unjudgeable and this fixture would quietly
      // stop testing a full pass.
      keywords: ['map of the world', 'antique maps'] },
  });
  const failed = good.checks.filter((c) => !c.pass).map((c) => `${c.key}: ${c.detail}`);
  ok(good.passed === good.total,
    `all ${good.total}${failed.length ? `\n      ${failed.join('\n      ')}` : ''}`);
  ok(good.verdict === 'all', 'and the verdict says so');

  console.log('\nA reel has to say something people search for');
  {
    const k = ['garden design', 'planting plan'];
    const said = checkReel({ timings: say('We spent two hundred hours on this garden design'),
      edit: { duration_s: 30, keywords: k } });
    ok(by(said, 'says_a_term_we_rank_for').pass === true, 'a tracked term said out loud counts');
    ok(/garden design/.test(by(said, 'says_a_term_we_rank_for').detail),
      'and the panel names which one, because that is the question being asked');

    const onScreen = checkReel({ timings: say('We spent two hundred hours on it'),
      edit: { duration_s: 30, keywords: k, on_screen_text: 'Planting plan, Surrey' } });
    ok(by(onScreen, 'says_a_term_we_rank_for').pass === true,
      'a term on screen counts too, because the platform reads it');

    const missed = checkReel({ timings: say('We spent two hundred hours on this project'),
      edit: { duration_s: 30, keywords: k } });
    ok(by(missed, 'says_a_term_we_rank_for').pass === false,
      'a reel that carries none of them does not pass');

    const untracked = checkReel({ timings: say('We spent two hundred hours on this project'),
      edit: { duration_s: 30 } });
    ok(by(untracked, 'says_a_term_we_rank_for').pass === null,
      'and a client tracking no terms is unjudged rather than failed');

    // Whole phrase, on word boundaries. Stemming would match every near miss
    // it invented, and a near miss is a term the reel does not say.
    const partial = checkReel({ timings: say('We love gardens designed around light'),
      edit: { duration_s: 30, keywords: k } });
    ok(by(partial, 'says_a_term_we_rank_for').pass === false,
      '"gardens designed" is not "garden design"');

    // The case that actually tests the boundaries, and the common one: short
    // single-word terms are everywhere in a tracked keyword list, and a
    // substring match would find "design" inside "designer" and report a reel
    // as carrying a term it never said.
    const inside = checkReel({ timings: say('We are a designer of quiet interiors'),
      edit: { duration_s: 30, keywords: ['design'] } });
    ok(by(inside, 'says_a_term_we_rank_for').pass === false,
      '"designer" does not contain the term "design"');

    const punctuated = checkReel({ timings: say('This, our garden design, took a year'),
      edit: { duration_s: 30, keywords: k } });
    ok(by(punctuated, 'says_a_term_we_rank_for').pass === true,
      'but punctuation between the words does not hide the phrase');

    const empty = checkReel({ timings: say('Anything at all'),
      edit: { duration_s: 30, keywords: ['', '   ', null] } });
    ok(by(empty, 'says_a_term_we_rank_for').pass === false,
      'and a list of blanks matches nothing rather than everything');
  }

  console.log('\nEvery check carries the rule it came from');
  ok(good.checks.every((c) => c.rule && c.rule.length > 20),
    'so a rule can be argued with rather than obeyed');
  ok(good.checks.every((c) => c.detail), 'and says what it actually saw');

  console.log('\nThe hook has to land inside a second');
  ok(by(checkReel({ timings: say(GOOD, { start: 2.4 }), edit: {} }), 'hook_timing').pass === false,
    'a reel that starts at 2.4s fails');
  ok(by(checkReel({ timings: say(GOOD, { start: 0.9 }), edit: {} }), 'hook_timing').pass === true,
    'and one that starts at 0.9s passes');
  // Null rather than false, and the distinction matters on screen: an edit
  // whose words have not been timed yet is unjudged, not badly made. This read
  // false until the editor's panel turned out to be running on an empty
  // transcript, which showed an amber dot against reels that open perfectly.
  ok(by(checkReel({ timings: [], edit: {} }), 'hook_timing').pass === null,
    'no audio at all is not judged either way');

  console.log('\nThe hook has to state something checkable');
  ok(by(checkReel({ timings: say('For two hundred years every map showed a continent'), edit: {} }),
    'hook_is_a_fact').pass === true, 'a number counts');
  ok(by(checkReel({ timings: say('This map is from 1513 and it is wrong') }), 'hook_is_a_fact').pass === true,
    'so does a year');
  ok(by(checkReel({ timings: say('We think this one is really something special') }),
    'hook_is_a_fact').pass === false, 'an opinion does not');

  console.log('\nA fact written in words is still a fact');
  // The plan's own exemplar carries no digit at all. A check that failed the
  // hook the plan holds up as correct would teach the wrong lesson on its
  // first use, which is how a panel loses an operator.
  ok(by(checkReel({ timings: say('For two hundred years every map showed a continent') }),
    'hook_is_a_fact').pass === true, 'two hundred years counts');
  ok(by(checkReel({ timings: say('Fifteen editions carried the same error') }),
    'hook_is_a_fact').pass === true, 'so does fifteen editions');
  ok(by(checkReel({ timings: say('Many people thought it was somewhere out there') }),
    'hook_is_a_fact').pass === false, 'but a vague quantity does not');

  console.log('\nA check that cannot be judged yet is not a green tick');
  // Two of these pass by absence. On an empty reel there is nothing to be
  // absent from, and a tick there is how an operator learns to stop looking.
  const blank = checkReel({});
  ok(blank.checks.filter((c) => c.pass === true).length === 0, 'an empty reel earns no ticks');
  ok(blank.unknown >= 3, `${blank.unknown} checks report as not yet judgeable`);
  ok(by(blank, 'stated_flatly').pass === null, 'no hook means no verdict on hype');
  ok(by(blank, 'not_about_us').pass === null, 'and none on self-promotion');
  ok(by(blank, 'captions').pass === false,
    'but a missing caption template is a real failure, not an unknown');

  console.log('\nHype in the hook is the thing that reads as a low-register account');
  const hyped = checkReel({ timings: say('You won\'t believe this insane 1513 map') });
  ok(by(hyped, 'stated_flatly').pass === false, 'it fails');
  ok(/insane/.test(by(hyped, 'stated_flatly').detail), 'and names the word, so it can be cut');
  // The check reads the HOOK, not the whole transcript: a word used later in a
  // quote is not the account hyping its own opening.
  const lateHype = checkReel({
    timings: [...say('In 1513 Waldseemuller drew a coastline nobody had seen', { start: 0.3 }),
      ...say('The curator called it an amazing survival', { start: 12 })],
  });
  ok(by(lateHype, 'stated_flatly').pass === true,
    'but the same word at twelve seconds is not the hook being hyped');

  console.log('\nThe account talking about itself is its own worst content');
  ok(by(checkReel({ timings: say('Join us on Thursday for tickets to our latest event') }),
    'not_about_us').pass === false, 'an event reminder fails');
  ok(by(checkReel({ timings: say('We are delighted to announce this week\'s guest') }),
    'not_about_us').pass === false, 'so does a guest announcement');
  // Naming the brand once is attribution, not promotion. Three times is an advert.
  const once = checkReel({
    timings: say('Oculi Mundi holds a 1513 map that shows a coastline nobody had seen'),
    edit: { brand: 'Oculi Mundi' } });
  ok(by(once, 'not_about_us').pass === true, 'naming the brand once is attribution');
  const thrice = checkReel({
    timings: say('Oculi Mundi has a map. Oculi Mundi bought it in 1990. Oculi Mundi is proud.'),
    edit: { brand: 'Oculi Mundi' } });
  ok(by(thrice, 'not_about_us').pass === false, 'three times is an advert');

  console.log('\nCaptions have to be burned in, because most viewing is silent');
  ok(by(checkReel({ timings: say(GOOD), edit: {} }), 'captions').pass === false, 'no template fails');
  ok(by(checkReel({ timings: say(GOOD), edit: { caption_template: 'gallery' } }), 'captions').pass === true,
    'and a chosen one passes');

  console.log('\nA reel that races is a list rather than one idea');
  ok(by(checkReel({ timings: say(GOOD, { wps: 5.0 }) }), 'one_idea').pass === false,
    'five words a second fails');
  ok(by(checkReel({ timings: say(GOOD, { wps: 2.6 }) }), 'one_idea').pass === true,
    'a measured pace passes');

  console.log('\nAnd the length is the format\'s own');
  ok(by(checkReel({ timings: say('Short one', { wps: 1 }) }), 'length').pass === false,
    'a three-second reel fails');
  ok(by(checkReel({ timings: say(GOOD, { wps: 2.6 }), edit: { duration_s: 38 } }), 'length').pass === true,
    '38 seconds passes');
  ok(by(checkReel({ timings: say(GOOD), edit: { duration_s: 95 } }), 'length').pass === false,
    'and 95 seconds fails');

  console.log('\nThe duration is taken from the edit when there is one');
  // The transcript ends when the talking stops, which is not when the reel does.
  const trailing = checkReel({ timings: say('Nine words at a steady measured pace here now'),
    edit: { duration_s: 32 } });
  ok(trailing.duration_s === 32, 'the edit wins over the last word');
  ok(checkReel({ timings: say(GOOD, { wps: 2.6 }) }).duration_s > 0,
    'and the last word is used when there is no edit yet');

  console.log('\nNothing throws on an empty or broken reel');
  for (const input of [undefined, {}, { timings: null }, { timings: 'nope' },
    { timings: [], edit: null }]) {
    const r = checkReel(input);
    // Read off the result rather than retyped: a count in a test is a count
    // that disagrees with the code the first time a check is added, which is
    // what happened here.
    if (!r || r.total !== checkReel({}).total) {
      ok(false, `broke on ${JSON.stringify(input)}`); break;
    }
  }
  ok(checkReel({}).total === 8, 'an empty reel still reports every check');
  ok(checkReel({}).passed === 0, 'none of which pass');
  ok(checkReel({}).verdict === 'early', 'and the verdict says it is early, not failing');

  console.log('\nThe panel never claims more certainty than it has');
  const src = require('fs').readFileSync(
    path.join(__dirname, '..', '..', 'shared', 'reelChecks.mjs'), 'utf8');
  ok(/planning assumptions, not/.test(src),
    'the source records that the plan\'s figures are assumptions, not measurements');
  ok(!/score|out of 100/i.test(JSON.stringify(checkReel({}))),
    'and the result is a list of checks, not a score out of a hundred');

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.log('  FAIL ', e.stack || e.message); process.exit(1); });
