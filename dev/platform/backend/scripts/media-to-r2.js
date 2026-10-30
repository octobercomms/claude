#!/usr/bin/env node
// Copy every stored media object from the local disk store into Cloudflare R2,
// so MEDIA_STORE can be switched over without a single share link breaking.
//
// Why a script and not a migration: this moves bytes, not schema. It takes as
// long as the uplink takes, it has to be resumable, and it has to run
// repeatedly while the platform stays up on the disk store. Nothing about the
// switch is automatic — docs/omi/loom-replacement-plan.md has the order.
//
//   node scripts/media-to-r2.js                     # dry run: what would be copied
//   node scripts/media-to-r2.js --commit            # copy, verifying every object
//   node scripts/media-to-r2.js --commit --prune-verified
//                                                   # and free the disk copy of
//                                                   # anything verified in R2
//
// Safe to re-run: an object already in R2 at the same byte length is skipped.
//
// --prune-verified deletes files. It only ever deletes an object whose length
// in R2 has been read back and matches the length on disk, it never deletes on
// a dry run, and it never deletes an object that is not in R2 at all. That
// ordering is the whole safety of the script, so it is tested rather than
// trusted: tests/media-to-r2.test.js drives migrate() with a fake store,
// including a store that lies about what it wrote.
//
// Keys come from the database, not from listing the store directory, because an
// object nothing references is not worth paying to keep and a directory listing
// would quietly carry over every orphan ever made.

const fmt = (b) => (b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(1) + ' MB');

// Every column in the schema that holds a media-store key. One key can appear
// in several of them — client_assets.storage_key points at the same object as
// the recording it was made from — so they are de-duplicated here.
const KEY_SOURCES = [
  ['recordings', ['storage_key', 'play_key', 'mp4_key', 'gif_key']],
  ['transcripts', ['storage_key']],
  ['client_assets', ['storage_key']],
];

async function collectKeys(pool, log = console.warn) {
  const keys = new Map();   // key -> which columns reference it
  for (const [table, cols] of KEY_SOURCES) {
    let rows;
    try {
      ({ rows } = await pool.query(`SELECT ${cols.join(', ')} FROM ${table}`));
    } catch (err) {
      // A table this box has not migrated to yet is not worth stopping for.
      log(`  (skipping ${table}: ${err.message})`);
      continue;
    }
    for (const row of rows) {
      for (const col of cols) {
        const k = row[col];
        if (!k) continue;
        if (!keys.has(k)) keys.set(k, []);
        keys.get(k).push(`${table}.${col}`);
      }
    }
  }
  return keys;
}

// The copy itself. Takes its two stores and its key list as arguments so the
// dangerous part can be driven by a test without an R2 bucket.
async function migrate({ disk, r2, keys, commit = false, prune = false, log = console.log }) {
  const stat = { copied: 0, skipped: 0, missing: 0, failed: 0, pruned: 0, freed: 0, bytes: 0 };

  for (const [key, refs] of keys) {
    const onDisk = await disk.head(key);
    const inR2 = await r2.head(key);

    // Already there at the same length as the local copy, or the local copy is
    // gone — which is what a previous pruned run leaves behind.
    if (inR2 && (!onDisk || inR2.size === onDisk.size)) {
      stat.skipped++;
      if (prune && commit && onDisk) {
        await disk.remove(key);
        stat.pruned++; stat.freed += onDisk.size;
        log(`  pruned     ${key}  ${fmt(onDisk.size)} freed`);
      }
      continue;
    }

    if (!onDisk) {
      // Referenced by a row but in neither store. Worth naming rather than
      // counting: it is a recording whose playback is already broken.
      stat.missing++;
      log(`  MISSING    ${key}  (referenced by ${refs.join(', ')})`);
      continue;
    }

    if (!commit) {
      stat.copied++; stat.bytes += onDisk.size;
      log(`  would copy ${key}  ${fmt(onDisk.size)}`);
      continue;
    }

    let src = null;
    try {
      // localFile on the disk driver hands back the stored file itself, and
      // putFile (unlike saveFile) leaves its source alone, so this streams the
      // live object up without touching it.
      src = await disk.localFile(key);
      await r2.putFile(key, src.path);

      // Read back what R2 says it holds. Never trust the PUT.
      const check = await r2.head(key);
      if (!check || check.size !== onDisk.size) {
        throw new Error(`verify failed — disk ${onDisk.size} bytes, R2 ${check ? check.size : 'absent'}`);
      }
      stat.copied++; stat.bytes += onDisk.size;
      log(`  copied     ${key}  ${fmt(onDisk.size)}`);

      // Only ever after that size check has passed.
      if (prune) {
        await disk.remove(key);
        stat.pruned++; stat.freed += onDisk.size;
      }
    } catch (err) {
      stat.failed++;
      log(`  FAILED     ${key}  ${err.message}`);
    } finally {
      if (src) await src.release();
    }
  }
  return stat;
}

async function main() {
  const pool = require('../src/db');
  const mediaStore = require('../src/services/mediaStore');
  const args = process.argv.slice(2);
  const commit = args.includes('--commit');
  const prune = args.includes('--prune-verified');

  if (!mediaStore.r2Configured()) {
    console.error('R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,');
    console.error('R2_SECRET_ACCESS_KEY and R2_BUCKET, then run this again.');
    process.exit(1);
  }

  console.log(`media-to-r2 — ${commit ? 'COMMIT' : 'dry run'}${prune ? ', pruning verified disk copies' : ''}`);
  console.log(`bucket: ${process.env.R2_BUCKET}\n`);

  const keys = await collectKeys(pool);
  console.log(`${keys.size} distinct object keys referenced by the database\n`);

  const { disk, r2 } = mediaStore.drivers;
  const stat = await migrate({ disk, r2, keys, commit, prune });

  console.log('\n--- summary ---');
  console.log(`${commit ? 'copied' : 'would copy'}:   ${stat.copied} objects, ${fmt(stat.bytes)}`);
  console.log(`already in R2: ${stat.skipped}`);
  if (stat.pruned) console.log(`disk copies removed: ${stat.pruned}, ${fmt(stat.freed)} freed`);
  if (stat.missing) console.log(`MISSING from both stores: ${stat.missing}  <- these cannot play`);
  if (stat.failed) console.log(`FAILED: ${stat.failed}`);
  if (!commit) console.log('\nNothing was written. Re-run with --commit to copy.');

  await pool.end();
  process.exit(stat.failed ? 1 : 0);
}

module.exports = { collectKeys, migrate, KEY_SOURCES };

if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });
