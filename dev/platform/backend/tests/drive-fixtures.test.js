/**
 * The drives' composition fixture, run through the real model.
 *
 * The editor drew its empty state in every drive until this fixture existed,
 * so nothing about the editor could be checked in a browser. Now that a drive
 * asserts against it, the fixture is load-bearing, and a fixture nobody
 * validates is how a drive ends up proving a shape the product would reject.
 *
 * That is not hypothetical here. The first version of the stub's composition
 * LIST returned thin rows with no `data`, because that is what the endpoint
 * looks like it should return. The editor opens list[0] directly rather than
 * fetching it, so every assertion about the editor passed against an empty
 * composition. The fix was to match what `services/compositions.js` actually
 * selects, which is the whole row.
 *
 *   node tests/drive-fixtures.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const C = require('../../shared/composition.mjs');
const { MOTIONS } = require('../../shared/compositionTemplate.mjs');

const DIR = path.join(__dirname, '../../drives/fixtures');
const comp = JSON.parse(fs.readFileSync(path.join(DIR, 'composition.json'), 'utf8'));
const transcript = JSON.parse(fs.readFileSync(path.join(DIR, 'transcript.json'), 'utf8'));

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

ok('the fixture is a composition the product would accept', () => {
  const errs = C.validate(comp);
  assert.deepStrictEqual(errs, [], `the drives run against an invalid composition: ${errs.join('; ')}`);
});

ok('it has enough in it to be worth asserting against', () => {
  // Each of these is something a drive or a screenshot depends on. An empty
  // or one-track fixture would pass validate() and prove nothing.
  const kinds = Object.values(comp.sources).map(s => s.kind);
  assert.ok(kinds.includes('clip'), 'no clip source');
  assert.ok(kinds.includes('audio'), 'no audio source, so no waveform renders');
  assert.ok(Object.values(comp.sources).some(s => s.still === true),
    'no photograph, so the stills work has no fixture');
  assert.strictEqual(comp.tracks.length, 2, 'the fixture should have a video and an audio track');
  const items = comp.tracks.flatMap(t => t.items);
  assert.ok(items.length >= 4, `only ${items.length} items`);
  assert.ok(C.duration(comp) > 10, 'too short to show a timeline worth reading');
});

ok('the camera moves on it are the real vocabulary', () => {
  const moved = comp.tracks.flatMap(t => t.items).filter(i => i.beat);
  assert.ok(moved.length >= 2, 'no photograph in the fixture carries a camera move');
  for (const item of moved) {
    assert.ok(MOTIONS[item.beat], `"${item.beat}" is not a motion this product has`);
    // And the transform on the item must be the one that motion means, or the
    // fixture shows a move the product would never produce.
    const want = JSON.stringify(MOTIONS[item.beat]);
    const got = JSON.stringify({
      ...(item.scale !== undefined ? { scale: item.scale } : {}),
      ...(item.pos !== undefined ? { pos: item.pos } : {}),
    });
    assert.strictEqual(got, want,
      `the fixture's "${item.beat}" does not match MOTIONS["${item.beat}"]`);
  }
});

ok('the transcript belongs to a source that exists and lands inside its item', () => {
  for (const [sourceId, words] of Object.entries(transcript)) {
    assert.ok(comp.sources[sourceId], `the transcript names source "${sourceId}", which is not in the composition`);
    assert.ok(Array.isArray(words) && words.length > 5, 'too few words to judge a hook');
    let prev = -1;
    for (const w of words) {
      assert.ok(typeof w.word === 'string' && w.word.length, 'a word with no text');
      assert.ok(w.end > w.start, `"${w.word}" ends before it starts`);
      assert.ok(w.start >= prev, 'the words are out of order');
      prev = w.start;
    }
    // The reel checks read the first word's start as the hook. If the
    // transcript began after its item ended, every check would read as
    // unjudgeable and the drive's "4 of 8" would be meaningless.
    const item = comp.tracks.flatMap(t => t.items).find(i => i.source === sourceId);
    assert.ok(item, `no item uses source "${sourceId}"`);
    assert.ok(words[0].start < item.len,
      'the transcript starts after its own clip ends, so no word reaches the reel checks');
  }
});

ok('the stub serves the fixture as a whole row, the way the service does', () => {
  // The exact fault above: the list endpoint returns every column, and the
  // editor opens list[0] without a second fetch.
  const stub = fs.readFileSync(path.join(__dirname, '../../drives/stub-server.js'), 'utf8');
  const m = stub.match(/'\/api\/compose\/clients\/c1\/compositions':\s*\[([\s\S]*?)\n  \],/);
  assert.ok(m, 'the stub no longer serves a composition list');
  for (const col of ['data:', 'transcripts:', 'source_assets:']) {
    assert.ok(m[1].includes(col),
      `the stub's composition list has no ${col} — the editor would load an empty `
      + 'composition and every drive assertion about it would pass against its empty state');
  }
});

console.log(`${passed} guards`);
console.log('---');
console.log('THE DRIVES RUN AGAINST SOMETHING REAL');
