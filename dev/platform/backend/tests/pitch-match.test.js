// One list for one story, from two engines that answer the same question.
//
// Earned → Match had two cards and two boxes to paste the same release into.
// They stay as two engines because they are good at different things, and the
// point of the merge is the thing neither produces alone: when Claude, having
// read the release, and a ranking over the whole contact database both pick
// the same journalist, that agreement is the strongest signal on the page.
//
// The failures this guards are all quiet ones. A journalist listed twice
// looks like a database problem. A journalist dropped because only one engine
// found them is invisible — you cannot miss a name that was never shown. A
// Claude outage emptying a list the free pass could have filled looks like
// "no matches" rather than like an outage. None of those throw.
//
//   node tests/pitch-match.test.js

const assert = require('assert');

// Both engines are stubbed, because what is under test is the merge: which
// rows survive, what they carry, and in what order.
const targetPath = require.resolve('../src/services/prTarget');
const matchPath = require.resolve('../src/services/journalistMatch');

let reasonedResult = { angle: '', targets: [] };
let rankedResult = { terms: [], mode: 'semantic', items: [] };
let reasonedThrows = null;
let rankedThrows = null;
const seenText = { reasoned: null, ranked: null };
let resolveCalls = 0;

require.cache[targetPath] = {
  id: targetPath, filename: targetPath, loaded: true,
  exports: {
    resolveText: async ({ url, brief }) => {
      resolveCalls += 1;
      if (brief) return brief;
      if (url) return `fetched body of ${url}`;
      throw Object.assign(new Error('Give a press-release URL or paste a brief.'), { status: 400 });
    },
    findTargets: async ({ brief }) => {
      seenText.reasoned = brief;
      if (reasonedThrows) throw new Error(reasonedThrows);
      return reasonedResult;
    },
  },
};
require.cache[matchPath] = {
  id: matchPath, filename: matchPath, loaded: true,
  exports: {
    matchForText: async (text) => {
      seenText.ranked = text;
      if (rankedThrows) throw new Error(rankedThrows);
      return rankedResult;
    },
  },
};

const pitchMatch = require('../src/services/pitchMatch');

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; console.log(`PASS  ${what}`); };

function reset() {
  reasonedResult = { angle: '', targets: [] };
  rankedResult = { terms: [], mode: 'semantic', items: [] };
  reasonedThrows = null;
  rankedThrows = null;
  seenText.reasoned = null;
  seenText.ranked = null;
  resolveCalls = 0;
}

const ranked = (id, name, fit, over = {}) => ({
  id, name, email: `${name.toLowerCase().replace(/\W+/g, '.')}@example.com`,
  verification_status: 'verified', outlet: 'Dezeen', tier: 1, fit,
  matched: ['architecture'], covered_client: false, ...over,
});
const reasoned = (id, name, over = {}) => ({
  id, name, outlet: 'Dezeen', tier: 1, reason: 'Covers UK practices.',
  strength_label: 'warm', published_for_client: 0, has_email: true, ...over,
});

(async () => {
  // ── agreement ─────────────────────────────────────────────────────────────

  reset();
  rankedResult = { terms: ['architecture'], mode: 'semantic', items: [ranked('a', 'Anna', 70), ranked('b', 'Ben', 91)] };
  reasonedResult = { angle: 'A new studio opens.', targets: [reasoned('a', 'Anna')] };
  const agreed = await pitchMatch.combined({ clientId: 'c1', brief: 'A studio opened in Margate.' });

  ok('a journalist both engines picked appears once', () => {
    const anna = agreed.items.filter(i => i.id === 'a');
    assert.strictEqual(anna.length, 1,
      `Anna appears ${anna.length} times — a merge that does not deduplicate reads as a database fault`);
  });

  ok('and carries the address from one engine and the reason from the other', () => {
    const anna = agreed.items.find(i => i.id === 'a');
    assert.strictEqual(anna.email, 'anna@example.com', 'the address was lost, which is the one thing the list is for');
    assert.strictEqual(anna.reason, 'Covers UK practices.', 'the written reason was lost');
    assert.strictEqual(anna.fit, 70, 'the fit score was lost');
    assert.deepStrictEqual(anna.sources.sort(), ['ranked', 'reasoned']);
    assert.strictEqual(anna.agreed, true);
  });

  ok('agreement outranks a higher score from one engine alone', () => {
    // Ben scores 91 against Anna's 70, and Anna still leads: two independent
    // engines picking the same person is the signal neither produces alone.
    assert.strictEqual(agreed.items[0].id, 'a',
      `${agreed.items[0].name} led the list — agreement is not being ranked above a lone score`);
    assert.strictEqual(agreed.items[1].id, 'b');
  });

  ok('the angle and the match mode both come through', () => {
    assert.strictEqual(agreed.angle, 'A new studio opens.');
    assert.strictEqual(agreed.mode, 'semantic');
    assert.deepStrictEqual(agreed.terms, ['architecture']);
  });

  // ── contacts the free pass cannot return ──────────────────────────────────

  reset();
  rankedResult = { terms: [], mode: 'keyword', items: [ranked('a', 'Anna', 60)] };
  reasonedResult = { angle: '', targets: [reasoned('z', 'Zoe', { has_email: false, tier: 1 })] };
  const noEmail = await pitchMatch.combined({ clientId: 'c1', brief: 'story' });

  ok('a contact with no email on file is kept, not dropped', () => {
    const zoe = noEmail.items.find(i => i.id === 'z');
    // journalistMatch requires a working address, so it can never return
    // these. Dropping them in the merge would hide them completely, and at a
    // title that matters the right answer is to go and find an address.
    assert.ok(zoe, 'the no-email contact vanished from the merged list');
    assert.strictEqual(zoe.has_email, false);
    assert.strictEqual(zoe.email, '');
  });

  ok('but sits below the ones you can actually email', () => {
    assert.strictEqual(noEmail.items[0].id, 'a');
    assert.strictEqual(noEmail.items[1].id, 'z');
  });

  ok('a row with no score does not read as a zero fit', () => {
    const zoe = noEmail.items.find(i => i.id === 'z');
    assert.strictEqual(zoe.fit, null,
      'a missing score became a number, so the screen will print it as a percentage and claim a bad fit');
  });

  // ── one engine down ───────────────────────────────────────────────────────

  reset();
  rankedResult = { terms: [], mode: 'keyword', items: [ranked('a', 'Anna', 60)] };
  reasonedThrows = 'Anthropic 529';
  const claudeDown = await pitchMatch.combined({ clientId: 'c1', brief: 'story' });

  ok('Claude being down costs the reasons, not the contacts', () => {
    assert.strictEqual(claudeDown.items.length, 1,
      'the list emptied because one engine failed, which reads as "no matches" rather than as an outage');
    assert.strictEqual(claudeDown.items[0].id, 'a');
  });

  ok('and the outage is reported rather than swallowed', () => {
    assert.strictEqual(claudeDown.degraded.length, 1);
    assert.strictEqual(claudeDown.degraded[0].engine, 'reasoned');
    assert.ok(/529/.test(claudeDown.degraded[0].message),
      'the reason the engine failed did not travel, so the screen can only say something went wrong');
  });

  reset();
  reasonedResult = { angle: 'An angle.', targets: [reasoned('a', 'Anna')] };
  rankedThrows = 'embeddings unavailable';
  const rankerDown = await pitchMatch.combined({ clientId: 'c1', brief: 'story' });

  ok('the same the other way round', () => {
    assert.strictEqual(rankerDown.items.length, 1);
    assert.strictEqual(rankerDown.items[0].id, 'a');
    assert.strictEqual(rankerDown.degraded[0].engine, 'ranked');
  });

  reset();
  reasonedThrows = 'down';
  rankedThrows = 'also down';
  const bothDown = await pitchMatch.combined({ clientId: 'c1', brief: 'story' });

  ok('both down is an empty list and two reasons, not a crash', () => {
    assert.deepStrictEqual(bothDown.items, []);
    assert.strictEqual(bothDown.degraded.length, 2,
      'one failure masked the other, so half the problem is invisible');
  });

  // An error the targeting engine RETURNS rather than throws.
  reset();
  rankedResult = { terms: [], mode: 'keyword', items: [ranked('a', 'Anna', 60)] };
  reasonedResult = { error: 'Claude not configured.' };
  const notConfigured = await pitchMatch.combined({ clientId: 'c1', brief: 'story' });

  ok('a returned error counts as degraded too', () => {
    // prTarget reports a missing key by returning {error}, not by throwing.
    // Treating that as success would show a short list with no explanation.
    assert.strictEqual(notConfigured.items.length, 1);
    assert.strictEqual(notConfigured.degraded.length, 1, 'a returned error was read as a successful empty result');
    assert.ok(/not configured/i.test(notConfigured.degraded[0].message));
  });

  // ── the story is resolved once ────────────────────────────────────────────

  reset();
  rankedResult = { terms: [], mode: 'keyword', items: [] };
  reasonedResult = { angle: '', targets: [] };
  await pitchMatch.combined({ clientId: 'c1', url: 'https://example.com/release' });

  ok('a URL is fetched once and both engines read the same text', () => {
    assert.strictEqual(resolveCalls, 1,
      'the URL was resolved more than once — two requests to the client\'s newsroom for one click');
    assert.strictEqual(seenText.reasoned, 'fetched body of https://example.com/release');
    assert.strictEqual(seenText.ranked, seenText.reasoned,
      'the two engines ranked against different text, so their agreement would mean nothing');
  });

  reset();
  let threw = null;
  try { await pitchMatch.combined({ clientId: 'c1' }); } catch (e) { threw = e; }

  ok('neither a URL nor a brief is a 400 with something to act on', () => {
    assert.ok(threw, 'an empty request produced a list rather than an error');
    assert.strictEqual(threw.status, 400);
    assert.ok(/URL or paste a brief/i.test(threw.message));
  });

  // ── the placeholder address ───────────────────────────────────────────────

  ok('an @import.local address does not count as an email', () => {
    const { usableEmail } = pitchMatch._internals;
    // It looks like an address and bounces every time, so a row carrying one
    // must not read as contactable.
    assert.strictEqual(usableEmail('a@import.local'), false);
    assert.strictEqual(usableEmail('A@IMPORT.LOCAL'), false);
    assert.strictEqual(usableEmail('anna@dezeen.com'), true);
    assert.strictEqual(usableEmail(''), false);
    assert.strictEqual(usableEmail(null), false);
  });

  // ── the cap ───────────────────────────────────────────────────────────────

  reset();
  rankedResult = { terms: [], mode: 'keyword', items: Array.from({ length: 60 }, (_, i) => ranked(`r${i}`, `R${i}`, 50)) };
  reasonedResult = { angle: '', targets: Array.from({ length: 60 }, (_, i) => reasoned(`t${i}`, `T${i}`)) };
  const capped = await pitchMatch.combined({ clientId: 'c1', brief: 'story', limit: 10 });

  ok('the limit applies to the merged list, not to each engine', () => {
    assert.strictEqual(capped.items.length, 10,
      `asked for 10 and got ${capped.items.length}: capping per engine returns up to twice what was asked for`);
  });

  console.log(`\n${passed} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
