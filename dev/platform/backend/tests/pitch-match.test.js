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
const seenScope = { reasoned: undefined, ranked: undefined };
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
    findTargets: async ({ brief, visibleClientIds }) => {
      seenText.reasoned = brief;
      seenScope.reasoned = visibleClientIds;
      if (reasonedThrows) throw new Error(reasonedThrows);
      return reasonedResult;
    },
  },
};
require.cache[matchPath] = {
  id: matchPath, filename: matchPath, loaded: true,
  exports: {
    matchForText: async (text, opts = {}) => {
      seenText.ranked = text;
      seenScope.ranked = opts.visibleClientIds;
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
  seenScope.reasoned = undefined;
  seenScope.ranked = undefined;
  resolveCalls = 0;
}

const ranked = (id, name, fit, over = {}) => ({
  id, name, email: `${name.toLowerCase().replace(/\W+/g, '.')}@example.com`,
  verification_status: 'verified', outlet: 'Dezeen', tier: 1, fit,
  matched: ['architecture'], covered_client: false, ...over,
});
const reasoned = (id, name, over = {}) => ({
  id, name, outlet: 'Dezeen', tier: 1, reason: 'Covers UK practices.',
  strength_label: 'warm', published_for_client: 0, has_email: true,
  email: `${name.toLowerCase().replace(/\W+/g, '.')}@example.com`,
  verification_status: 'verified', ...over,
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

  ok('the score leads, and agreement does not override it', () => {
    // Ben scores 91 against Anna's 70, and Ben leads even though both engines
    // picked Anna.
    //
    // The first version ranked agreement above the score, on the reasoning
    // that two engines agreeing independently is the strongest signal. They
    // are not independent: journalistEmbed embeds beats, topics, auto_topics,
    // enrichment_note and recent titles, and prTarget's pool is a LIKE over
    // enrichment_note, beats, topics and outlet name. Both read the same
    // columns, so agreement means the beats data agrees with itself — and
    // where a contact's beats are stale both engines are wrong together and
    // the error went to the top of the page. It also put a 41% above a 92%.
    assert.strictEqual(agreed.items[0].id, 'b',
      `${agreed.items[0].name} led with a lower score — agreement is being ranked above fit again`);
    assert.strictEqual(agreed.items[1].id, 'a');
  });

  ok('agreement breaks a tie between equal scores', () => {
    // Where it is genuinely useful, and the only place it touches the order.
    const tied = [...agreed.items];
    assert.ok(tied.every(i => typeof i.agreed === 'boolean'),
      'rows do not carry `agreed`, so the screen cannot preselect a shortlist from it');
    const { compareRows } = pitchMatch._internals;
    const both = { fit: 70, agreed: true, name: 'Zoe' };
    const one = { fit: 70, agreed: false, name: 'Anna' };
    assert.ok(compareRows(both, one) < 0,
      'at the same score the row both engines picked should come first, even against an earlier name');
  });

  ok('the angle and the match mode both come through', () => {
    assert.strictEqual(agreed.angle, 'A new studio opens.');
    assert.strictEqual(agreed.mode, 'semantic');
    assert.deepStrictEqual(agreed.terms, ['architecture']);
  });

  // ── contacts the free pass cannot return ──────────────────────────────────

  reset();
  rankedResult = { terms: [], mode: 'keyword', items: [ranked('a', 'Anna', 60)] };
  // Zoe has no address; Wendy has one. Only the second case can show whether
  // the address survives the merge, and the first version of this test had
  // only Zoe, so its loop ran over nothing and asserted nothing.
  reasonedResult = { angle: '', targets: [
    reasoned('z', 'Zoe', { has_email: false, email: '', tier: 1 }),
    reasoned('w', 'Wendy', { email: 'wendy@ft.com' }),
  ] };
  const noEmail = await pitchMatch.combined({ clientId: 'c1', brief: 'story' });

  ok('a contact only Claude found keeps the address that is on file', () => {
    // prTarget reads c.email out of the database and used to return only a
    // has_email boolean, so a journalist it picked showed blank in the list
    // and in the export even though the address was held. Spotted from the
    // export: "i also know i have emails for some of them".
    const wendy = noEmail.items.find(i => i.id === 'w');
    assert.ok(wendy, 'the Claude-only contact with an address is missing from the list entirely');
    assert.strictEqual(wendy.email, 'wendy@ft.com',
      'the address was dropped on the way through, so the row reads blank and the export is blank '
      + 'for someone whose address is in the database');
    assert.strictEqual(wendy.has_email, true);
    assert.strictEqual(wendy.verification_status, 'verified',
      'the verification state did not travel, so a guessed address cannot be flagged as a guess');
  });

  ok('a contact with no email on file is kept, not dropped', () => {
    const zoe = noEmail.items.find(i => i.id === 'z');
    // journalistMatch requires a working address, so it can never return
    // these. Dropping them in the merge would hide them completely, and at a
    // title that matters the right answer is to go and find an address.
    assert.ok(zoe, 'the no-email contact vanished from the merged list');
    assert.strictEqual(zoe.has_email, false);
    assert.strictEqual(zoe.email, '');
  });

  ok('but sits below the scored rows', () => {
    // Anna is the only scored row, so she leads. Wendy and Zoe are both
    // unscored and tie on everything but name.
    assert.strictEqual(noEmail.items[0].id, 'a');
    const unscored = noEmail.items.slice(1).map(i => i.id);
    assert.deepStrictEqual(unscored, ['w', 'z'],
      `unscored rows came back as ${unscored.join(', ')}; they should follow the scored ones, `
      + 'ordered by name when nothing else separates them');
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
  rankedResult = { terms: [], mode: 'keyword', items: Array.from({ length: 60 }, (_, i) => ranked(`r${i}`, `R${i}`, 50 + (i % 7))) };
  reasonedResult = { angle: '', targets: [reasoned('only-claude', 'Imogen Clarke', { has_email: false })] };
  const full = await pitchMatch.combined({ clientId: 'c1', brief: 'story', limit: 40 });

  ok('a full page of scored rows does not evict the Claude-only picks', () => {
    // The regression this whole merge exists to prevent, and the first
    // version made it certain rather than occasional. The free pass is asked
    // for `limit` rows and returns that many on any populated database, the
    // unscored rows sorted last, and the slice landed exactly on them — the
    // contacts with no address, which the free pass structurally cannot
    // return at all. Nothing threw. The names were simply never shown.
    const imogen = full.items.find(i => i.id === 'only-claude');
    assert.ok(imogen,
      'the Claude-only pick was cut by the cap, so the one thing the merge adds is gone on any '
      + 'database with 40 matching contacts');
    assert.strictEqual(imogen.has_email, false);
  });

  ok('the cap still holds the scored rows to what was asked for', () => {
    // 60 scored rows offered against a cap of 40, so a missing slice shows.
    const scored = full.items.filter(i => i.fit != null);
    assert.strictEqual(scored.length, 40, `asked for 40 scored rows, got ${scored.length}`);
    assert.strictEqual(full.items.length, 41, 'exactly the extra Claude pick beyond the cap');
  });

  reset();
  rankedResult = { terms: [], mode: 'keyword', items: [ranked('a', 'Anna', 60)] };
  reasonedResult = { angle: '', targets: [] };
  await pitchMatch.combined({ clientId: 'c1', brief: 'story', visibleClientIds: ['c1'] });

  ok('the caller\'s client scope reaches the reasoning pass too', () => {
    // prTarget had no visibility scoping while journalistMatch did, so on a
    // viewer limited to one client the merged list drew journalists out of
    // every other client's book — and it would have surfaced as the two
    // engines disagreeing about who exists rather than as a leak.
    assert.deepStrictEqual(seenScope.reasoned, ['c1'],
      'the Claude pass ran unscoped, so a scoped viewer sees contacts they are not entitled to');
    assert.deepStrictEqual(seenScope.ranked, ['c1']);
  });

  console.log(`\n${passed} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
