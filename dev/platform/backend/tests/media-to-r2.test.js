// The disk-to-R2 copy, and in particular the one flag in OMI that deletes
// client video.
//
// `--prune-verified` frees the disk copy of every object it has put in R2.
// Before the switch is thrown, that disk copy is the only copy of every
// walkthrough Daniel has ever sent a client. The ordering that keeps it safe is
// four lines long and reads as obviously correct, which is exactly the kind of
// code that gets reordered during a refactor:
//
//   head R2 → compare the length to disk → only then remove the disk copy
//
// So it is driven here against a fake store, including a store that accepts a
// PUT and then lies about it. Every case below is a way the prune could delete
// something it should not have.
//
//   node tests/media-to-r2.test.js

const assert = require('assert');
const { migrate, collectKeys, KEY_SOURCES } = require('../scripts/media-to-r2');

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

// A pair of in-memory stores with the same interface the real drivers expose.
// `corrupt` makes putFile land a different number of bytes than it was given,
// which is what a truncated upload looks like from the outside.
function fakeStores({ diskFiles = {}, r2Files = {}, corrupt = false, putThrows = false } = {}) {
  const removed = [];
  const put = [];
  const disk = {
    files: { ...diskFiles },
    async head(k) { return k in this.files ? { size: this.files[k] } : null; },
    async localFile(k) {
      if (!(k in this.files)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return { path: `/fake/${k}`, release: async () => {} };
    },
    async remove(k) { removed.push(k); delete this.files[k]; },
  };
  const r2 = {
    files: { ...r2Files },
    async head(k) { return k in this.files ? { size: this.files[k] } : null; },
    async putFile(k) {
      if (putThrows) throw new Error('network reset');
      put.push(k);
      this.files[k] = corrupt ? disk.files[k] - 1 : disk.files[k];
    },
  };
  return { disk, r2, removed, put };
}

const quiet = () => {};

(async () => {
console.log('media-to-r2');

await check('a dry run writes nothing and deletes nothing', async () => {
  const { disk, r2, removed, put } = fakeStores({ diskFiles: { 'a.mp4': 100 } });
  const stat = await migrate({ disk, r2, keys: new Map([['a.mp4', ['recordings.storage_key']]]),
    commit: false, prune: true, log: quiet });
  assert.deepStrictEqual(put, [], 'a dry run uploaded something');
  assert.deepStrictEqual(removed, [], 'a dry run DELETED something');
  assert.strictEqual(stat.copied, 1, 'it should still report what it would copy');
});

await check('a dry run deletes nothing even for objects already in R2', async () => {
  // The case the first test cannot reach: with an empty R2 the object takes
  // the copy branch, where `commit` is checked again. An object already in R2
  // takes the *skip* branch, and that branch has its own commit check. Dropping
  // it meant `--prune-verified` without `--commit` deleted the disk copy of
  // every object already uploaded — a dry run that silently freed 200GB.
  const { disk, r2, removed } = fakeStores({ diskFiles: { 'a.mp4': 100 }, r2Files: { 'a.mp4': 100 } });
  const stat = await migrate({ disk, r2, keys: new Map([['a.mp4', []]]),
    commit: false, prune: true, log: quiet });
  assert.deepStrictEqual(removed, [], 'a dry run DELETED a disk copy');
  assert.strictEqual(stat.pruned, 0, 'a dry run reported pruning something');
  assert.strictEqual(disk.files['a.mp4'], 100, 'the disk copy must still be there');
});

await check('a copied object is verified before its disk copy is freed', async () => {
  const { disk, r2, removed, put } = fakeStores({ diskFiles: { 'a.mp4': 100 } });
  const stat = await migrate({ disk, r2, keys: new Map([['a.mp4', []]]),
    commit: true, prune: true, log: quiet });
  assert.deepStrictEqual(put, ['a.mp4']);
  assert.deepStrictEqual(removed, ['a.mp4']);
  assert.strictEqual(stat.copied, 1);
  assert.strictEqual(stat.pruned, 1);
  assert.strictEqual(r2.files['a.mp4'], 100, 'R2 should hold the same bytes');
});

await check('a truncated upload is never pruned', async () => {
  // The store accepts the PUT and reports a shorter object. If the length check
  // is dropped, this deletes the only good copy.
  const { disk, r2, removed } = fakeStores({ diskFiles: { 'a.mp4': 100 }, corrupt: true });
  const stat = await migrate({ disk, r2, keys: new Map([['a.mp4', []]]),
    commit: true, prune: true, log: quiet });
  assert.strictEqual(stat.failed, 1, 'a short object must count as a failure');
  assert.strictEqual(stat.copied, 0);
  assert.strictEqual(stat.pruned, 0);
  assert.deepStrictEqual(removed, [], 'the disk copy was deleted after a failed verify');
  assert.strictEqual(disk.files['a.mp4'], 100, 'the disk copy must still be there');
});

await check('a failed upload is never pruned', async () => {
  const { disk, r2, removed } = fakeStores({ diskFiles: { 'a.mp4': 100 }, putThrows: true });
  const stat = await migrate({ disk, r2, keys: new Map([['a.mp4', []]]),
    commit: true, prune: true, log: quiet });
  assert.strictEqual(stat.failed, 1);
  assert.deepStrictEqual(removed, [], 'the disk copy was deleted after a failed upload');
  assert.strictEqual(disk.files['a.mp4'], 100);
});

await check('an object already in R2 at the same length is skipped, not re-uploaded', async () => {
  const { disk, r2, put } = fakeStores({ diskFiles: { 'a.mp4': 100 }, r2Files: { 'a.mp4': 100 } });
  const stat = await migrate({ disk, r2, keys: new Map([['a.mp4', []]]),
    commit: true, prune: false, log: quiet });
  assert.deepStrictEqual(put, [], 're-uploaded an object that was already there');
  assert.strictEqual(stat.skipped, 1);
  assert.strictEqual(stat.copied, 0);
});

await check('an object in R2 at a different length is re-uploaded', async () => {
  // A half-finished earlier run leaves exactly this. Skipping it would leave a
  // truncated video in R2 and then free the good one on the next prune.
  const { disk, r2, put } = fakeStores({ diskFiles: { 'a.mp4': 100 }, r2Files: { 'a.mp4': 40 } });
  const stat = await migrate({ disk, r2, keys: new Map([['a.mp4', []]]),
    commit: true, prune: false, log: quiet });
  assert.deepStrictEqual(put, ['a.mp4'], 'a short object in R2 must be replaced');
  assert.strictEqual(stat.copied, 1);
});

await check('an object missing from both stores is reported, not pruned', async () => {
  const { disk, r2, removed } = fakeStores({ diskFiles: {} });
  const stat = await migrate({ disk, r2, keys: new Map([['gone.mp4', ['recordings.storage_key']]]),
    commit: true, prune: true, log: quiet });
  assert.strictEqual(stat.missing, 1);
  assert.strictEqual(stat.failed, 0, 'a missing object is a report, not a failure to retry');
  assert.deepStrictEqual(removed, []);
});

await check('a second pruned run over the same keys is a no-op', async () => {
  // After pruning, disk is empty and R2 holds everything. Re-running must not
  // treat that as "missing from both stores" and must not fail.
  const { disk, r2, removed } = fakeStores({ diskFiles: {}, r2Files: { 'a.mp4': 100 } });
  const stat = await migrate({ disk, r2, keys: new Map([['a.mp4', []]]),
    commit: true, prune: true, log: quiet });
  assert.strictEqual(stat.skipped, 1);
  assert.strictEqual(stat.missing, 0, 'an object already moved to R2 read as missing');
  assert.strictEqual(stat.failed, 0);
  assert.deepStrictEqual(removed, []);
});

await check('prune off means nothing is deleted at all', async () => {
  const { disk, r2, removed } = fakeStores({ diskFiles: { 'a.mp4': 100 } });
  await migrate({ disk, r2, keys: new Map([['a.mp4', []]]), commit: true, prune: false, log: quiet });
  assert.deepStrictEqual(removed, [], 'deleted a disk copy without --prune-verified');
  assert.strictEqual(disk.files['a.mp4'], 100);
});

await check('every column that holds a media key is in the key list', async () => {
  // The copy is driven off this list. A new key column added to the schema and
  // not added here means those objects are silently left behind on the old box
  // and 404 the moment the switch is thrown.
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'migrations');
  const declared = new Set(KEY_SOURCES.flatMap(([t, cols]) => cols.map(c => `${t}.${c}`)));
  // Columns the schema declares, found by name: anything ending _key, plus
  // storage_key, inside a recordings/transcripts/client_assets statement.
  const wanted = new Set();
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql'))) {
    // Strip `--` comments before looking for statement ends. Without this the
    // scan stopped at the semicolon inside "A url is fetchable as-is; a
    // storage_key needs…" in 212_client_assets.sql and missed the column three
    // lines below it, which is the exact failure this test exists to catch.
    const sql = fs.readFileSync(path.join(dir, f), 'utf8').replace(/--[^\n]*/g, '');
    for (const m of sql.matchAll(/(?:CREATE TABLE(?: IF NOT EXISTS)?|ALTER TABLE)\s+(recordings|transcripts|client_assets)\b([\s\S]*?);/gi)) {
      const [, table, body] = m;
      for (const c of body.matchAll(/\b((?:storage|play|mp4|gif|thumb|poster|audio|video)_key)\b\s+TEXT/gi)) {
        wanted.add(`${table}.${c[1].toLowerCase()}`);
      }
    }
  }
  assert.ok(wanted.size >= 6, `found only ${wanted.size} key columns in the migrations — did the regex stop matching?`);
  const unlisted = [...wanted].filter(c => !declared.has(c));
  assert.deepStrictEqual(unlisted, [],
    `these key columns exist in the schema but media-to-r2 would not copy them: ${unlisted.join(', ')}`);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
})();
