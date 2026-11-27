// Searching the web for ONE story is a different search from sweeping a client.
//
// The scheduled sweep asks for "MORE journalists on these and adjacent beats",
// seeded with the beats of the journalists already on the list. That is right
// for a standing client sweep and circular for a project: a client with no
// Gulf architecture press will never be sent to look for Gulf architecture
// press, because there is none on the list to be adjacent to. Daniel put it
// plainly — "find does something different... only a client" — while trying
// to build a Shenzhen press trip with no Middle East press in the book.
//
// The failure this guards is silent. If the story brief is ever collapsed
// back into the client brief, the search still runs, still returns real
// journalists with real bylines, and still looks like it worked. It would
// just be answering a different question, and nobody would see that in the
// results.
//
//   node tests/scout-story.test.js

const assert = require('assert');

const dbPath = require.resolve('../src/db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: {
    query: async (sql) => {
      if (/FROM clients/.test(sql)) {
        return { rows: [{ id: 'c1', name: 'Caro Communications', briefing_field: 'Architecture and design PR', monthly_focus: '' }] };
      }
      if (/jsonb_array_elements_text/.test(sql)) {
        return { rows: [{ beat: 'uk architecture' }, { beat: 'interiors' }] };
      }
      if (/pr_editorial_log/.test(sql)) {
        return { rows: [{ story_title: 'A London practice wins a competition', outlet: 'Dezeen' }] };
      }
      return { rows: [] };
    },
  },
};

// The web search is paid and calls the Anthropic SDK directly, so the global
// cap in callClaude never sees it. This path has its own gate and nothing
// covered it.
const budgetPath = require.resolve('../src/services/budget');
const budgetStub = { taskCapReached: async () => false };
require.cache[budgetPath] = { id: budgetPath, filename: budgetPath, loaded: true, exports: budgetStub };

const scout = require('../src/services/journalistScout');

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; console.log(`PASS  ${what}`); };

const STORY = 'MAD Architects, the Beijing practice founded by Ma Yansong, is opening new cultural '
  + 'buildings in Shenzhen. Sculptural, landscape-led architecture.';

(async () => {
  const sweepCtx = await scout.buildContext('c1');
  const storyCtx = await scout.buildContext('c1', { story: STORY });
  const sweepPrompt = scout.buildPrompt(sweepCtx, 20);
  const storyPrompt = scout.buildPrompt(storyCtx, 20);

  ok('a story reaches the context', () => {
    assert.strictEqual(storyCtx.story, STORY);
    assert.strictEqual(sweepCtx.story, '', 'the sweep should carry no story');
  });

  ok('the client sweep is unchanged', () => {
    // The scheduled job still has to do what it always did.
    assert.ok(/find MORE journalists on these and adjacent beats/i.test(sweepPrompt),
      'the client sweep no longer asks for more of the beats already covered, which is its whole job');
    assert.ok(!/THE STORY:/.test(sweepPrompt), 'the sweep prompt is carrying a story section');
  });

  ok('the story search asks about the story', () => {
    assert.ok(storyPrompt.includes(STORY),
      'the story text is not in the prompt, so the search is not about it');
    assert.ok(/ONE specific story/i.test(storyPrompt));
  });

  ok('and does NOT ask for more of the same beats', () => {
    // The single most important difference. Collapsing the two prompts back
    // together is the regression that would never show up in the results.
    assert.ok(!/find MORE journalists on these and adjacent beats/i.test(storyPrompt),
      'the story search is asking for more of the beats already covered, which is the client sweep '
      + 'wearing a story as a hat — it will never reach a market the list is missing');
    assert.ok(/do NOT limit yourself to them/i.test(storyPrompt),
      'nothing tells it to go beyond the existing beats');
    assert.ok(/Go where the list is thin/i.test(storyPrompt),
      'nothing tells it to search a market the beats do not cover, which is the reason to run it');
  });

  ok('the existing list is an exclusion, not a template', () => {
    assert.ok(/do NOT return these people or duplicate them/i.test(storyPrompt),
      'the outlets already covered are not being excluded, so it will hand back people you have');
  });

  ok('the rules that keep this honest survive in both', () => {
    for (const [name, p] of [['sweep', sweepPrompt], ['story', storyPrompt]]) {
      assert.ok(/Never invent a person, outlet, or email/i.test(p), `${name}: invention is not forbidden`);
      assert.ok(/never guess one/i.test(p), `${name}: it may invent an address`);
      assert.ok(/Provenance is required/i.test(p), `${name}: a candidate could arrive unverifiable`);
      assert.ok(/source_url/.test(p), `${name}: no source is asked for`);
    }
  });

  // Awaited out here, not inside ok().
  //
  // `ok` calls its callback synchronously and ignores what it returns, so an
  // async callback's assertions run after PASS has printed. Returning a
  // promise from one looks like it works and guarantees nothing. Do the work,
  // then assert on the result.
  let shortStory = null;
  try { await scout.scoutForStory('c1', { story: 'too short' }); }
  catch (e) { shortStory = e; }

  ok('a story too short to search on is refused', () => {
    // Guarded here rather than at the route, because this one costs money
    // per call and "architecture" is not a brief.
    assert.ok(shortStory, 'a two-word story was accepted and would have run a paid web search');
    assert.ok(/a sentence is enough/i.test(shortStory.message), `refused with "${shortStory.message}"`);
    assert.strictEqual(shortStory.status, 400);
  });

  // Mutated in place, not replaced: journalistScout binds the module at
  // require time.
  budgetStub.taskCapReached = async () => true;
  const capped = await scout.scoutForStory('c1', { story: STORY });
  budgetStub.taskCapReached = async () => false;

  ok('a spent budget stops the search before it costs anything', () => {
    assert.strictEqual(capped.budget_stopped, true,
      'the cap was reached and the search ran anyway — this path calls the SDK directly, so the '
      + 'global cap in callClaude never sees it and this gate is the only one');
    assert.deepStrictEqual(capped.candidates, []);
    assert.strictEqual(capped.found, 0);
  });

  console.log(`\n${passed} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
