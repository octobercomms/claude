/**
 * Composition renders, and the disk they were never swept from.
 *
 * They land in `uploads/<client>/` beside the client's own files, and the
 * 03:15 sweep covers `video-clips` and `video-outputs` only, so a composition
 * render was kept forever. Thirty a fortnight makes that a real figure.
 *
 * Two things are asserted here and both are about NOT deleting the wrong
 * thing. The filename pattern, because everything else in that directory
 * belongs to the client and taking one of those files would be a far worse
 * fault than a disk that fills up. And the rule, because an item of a batch
 * nobody has reviewed is work nobody has looked at, and sweeping it leaves
 * the review sheet offering a row whose file is gone.
 *
 *   node tests/composition-retention.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const cleanup = require('../src/services/videoCleanup');
const assets = require('../src/services/assets');

const DAY = 86400 * 1000;
const WINDOW = 7 * DAY;

describe('which files the sweep will even look at', () => {
  it('matches what the runner writes', () => {
    // `render-<compositionId>-<renderId>.mp4`, and both ids are INTEGERS —
    // read off the real schema rather than assumed. The opposite assumption
    // is what broke the asset-path regex elsewhere in this codebase, where a
    // `(\d+)` for a client id had never once matched a real UUID, so the
    // types are checked here rather than guessed either way.
    assert.ok(cleanup.RENDER_FILE.test('render-12-7.mp4'));
    assert.ok(cleanup.RENDER_FILE.test('render-4096-118.mp4'));
    assert.ok(
      !cleanup.RENDER_FILE.test('render-7f3a1b2c-4d5e-6f70-8a9b-0c1d2e3f4a5b-41.mp4'),
      'a UUID-shaped name is not one of ours, and the query it would make throws'
    );
  });

  it('matches nothing else in a client\'s folder', () => {
    for (const name of [
      'my-holiday.mp4',               // the client's own upload
      'scene-1762560000000-a1b2c3.mp4', // the scene-template feature
      'render-only-one-part.mp4',
      'render-a-b.mov',
      'render-abc-41.mp4',          // not integer ids, so not one of ours
      'brand-guidelines.pdf',
      'render-a-b.mp4.bak',
      'logo.png',
    ]) {
      assert.ok(!cleanup.RENDER_FILE.test(name), `${name} must not be swept`);
    }
  });

  it('pulls the composition and the render out of the name', () => {
    // So the library row can be archived with the same source_id the runner
    // recorded, rather than a guess at it.
    const m = 'render-312-41.mp4'.match(cleanup.RENDER_FILE);
    assert.equal(m[1], '312');
    assert.equal(m[2], '41');
  });
});

describe('when a composition render may go', () => {
  const may = (over) => cleanup.mayDelete({ windowMs: WINDOW, ...over });

  it('holds anything inside the window', () => {
    assert.equal(may({ ageMs: 2 * DAY, batchItem: null }).ok, false);
    assert.equal(may({ ageMs: 2 * DAY, batchItem: { verdict: 'approved' } }).ok, false);
    assert.match(may({ ageMs: 0, batchItem: null }).why, /inside the retention window/);
  });

  it('deletes an old render that was never part of a batch', () => {
    // Somebody exported it from the editor. There is no verdict to wait for,
    // so it goes on age alone, the same rule a project master gets.
    assert.equal(may({ ageMs: 9 * DAY, batchItem: null }).ok, true);
  });

  it('HOLDS an old batch item nobody has reviewed', () => {
    // The rule worth having. Sweeping it would leave the review sheet
    // offering a row whose file is gone, which is the review sheet lying.
    const r = may({ ageMs: 90 * DAY, batchItem: { verdict: null } });
    assert.equal(r.ok, false);
    assert.match(r.why, /nobody has reviewed/);
  });

  it('deletes an old batch item once it has a verdict, either way', () => {
    assert.equal(may({ ageMs: 9 * DAY, batchItem: { verdict: 'approved' } }).ok, true);
    assert.equal(may({ ageMs: 9 * DAY, batchItem: { verdict: 'rejected' } }).ok, true);
  });

  it('holds at exactly the boundary minus a millisecond, and goes at it', () => {
    assert.equal(may({ ageMs: WINDOW - 1, batchItem: null }).ok, false);
    assert.equal(may({ ageMs: WINDOW, batchItem: null }).ok, true);
  });

  it('holds on an unreadable age rather than guessing', () => {
    assert.equal(may({ ageMs: NaN, batchItem: null }).ok, false);
    assert.equal(may({ ageMs: undefined, batchItem: null }).ok, false);
  });
});

describe('the asset source', () => {
  it('is its own, not the scene-template feature\'s', () => {
    // They shared `scene_render` until migration 251, so the Library called
    // every composition render a "Scene template" and `archiveBySource` could
    // not target either without hitting the other.
    assert.ok(assets.SOURCES.includes('composition'));
    assert.ok(assets.SOURCES.includes('scene_render'));
  });

  it('is what the runner records', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'services', 'compositionRenderRunner.js'), 'utf8'
    );
    assert.match(src, /source: 'composition',/);
    assert.ok(!/source: 'scene_render'/.test(src), 'and no longer the old one');
  });

  it('is what the sweep archives', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'services', 'videoCleanup.js'), 'utf8'
    );
    assert.match(src, /archiveBySource\('composition'/);
  });

  it('is allowed by the migration that adds it', () => {
    const fs = require('fs');
    const path = require('path');
    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', '251_composition_asset_source.sql'), 'utf8'
    );
    // Every source the service knows has to be in the constraint, or a
    // perfectly ordinary record() throws at the database.
    for (const source of assets.SOURCES) {
      assert.ok(sql.includes(`'${source}'`), `the constraint allows ${source}`);
    }
    assert.match(sql, /UPDATE client_assets/, 'and the rows already written are moved');
  });

  it('has a label in the Library, so it is not an unexplained row', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'AssetLibrary.jsx'), 'utf8'
    );
    assert.match(src, /composition: '[^']+'/);
  });
});
