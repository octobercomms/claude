#!/usr/bin/env node
// Prove the R2 credentials and bucket work before anything depends on them.
//
//   node scripts/r2-preflight.js
//
// Run this on the box as soon as the four R2_* vars are in place, with
// MEDIA_STORE still set to disk. It answers the question that otherwise only
// gets answered by a client clicking a share link and seeing nothing: are the
// keys right, does the bucket exist, and does every operation playback depends
// on actually work against it.
//
// It exercises the real r2 driver from services/mediaStore.js rather than a
// parallel implementation, so a pass here means the code that will serve video
// has itself done the round trip. It writes exactly one small object under
// `__omi-preflight/…` and deletes it again; it touches nothing else and reads
// nothing from the database.
//
// Secrets are never printed. The access key is shown as a length and its first
// four characters so a truncated paste is visible, and the secret not at all.
//
// The checks are a list rather than a run of statements so that
// tests/r2-preflight.test.js can drive them against a driver broken in one
// specific way each time. A preflight that passes against a broken bucket is
// worse than no preflight, so each check is shown to catch the thing it is
// there for.

// Load the backend's own .env before anything reads process.env.
//
// Only src/index.js did this, so a script run straight from the shell saw none
// of it: the preflight reported "Not configured yet" with all four R2 values
// correctly in place, and the scripts that touch Postgres tried to connect to
// localhost:5432 with no credentials. The path is resolved from __dirname
// rather than the working directory so it works from anywhere on the box.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const REQUIRED = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];

// Each check gets the driver, the key it is probing, the bytes that were meant
// to be written, and a fetch implementation. It returns a short note on success
// and throws on failure. `why` is what a failure costs, printed under it.
const CHECKS = [
  {
    name: 'write an object',
    why: 'the token cannot write to this bucket, or the bucket name or account id is wrong',
    async run({ r2, key, body, localPath }) {
      const { size } = await r2.putFile(key, localPath);
      if (size !== body.length) throw new Error(`wrote ${size} bytes, expected ${body.length}`);
      return `${size} bytes`;
    },
  },
  {
    name: 'read its size back',
    why: 'the write reported success but the object is not there, which is the case the migration guards against',
    async run({ r2, key, body }) {
      const h = await r2.head(key);
      if (!h) throw new Error('head returned null — the object is not in the bucket');
      if (h.size !== body.length) throw new Error(`bucket holds ${h.size} bytes, wrote ${body.length}`);
      return `${h.size} bytes`;
    },
  },
  {
    name: 'read the bytes back whole',
    why: 'reads are failing or returning something other than what was written',
    async run({ r2, key, body }) {
      const got = await r2.getBuffer(key);
      if (!Buffer.from(got).equals(body)) throw new Error(`got ${got.length} bytes and they do not match what was written`);
      return 'byte-identical';
    },
  },
  {
    name: 'stream it down to a local file',
    why: 'the export and transcribe paths, which stream rather than buffer, would fail on every recording',
    async run({ r2, key, body }) {
      const src = await r2.localFile(key);
      try {
        const got = fs.readFileSync(src.path);
        if (!got.equals(body)) throw new Error(`streamed ${got.length} bytes and they do not match`);
        return path.basename(src.path);
      } finally {
        await src.release();
      }
    },
  },
  {
    name: 'sign a playback URL and fetch it',
    why: 'this is exactly how a share link serves video — the watch route redirects a viewer to a signed URL. If this fails, playback is broken for everyone even though uploads work',
    async run({ r2, key, body, fetchImpl }) {
      const url = await r2.signedGetUrl(key, 600);
      if (!/^https:\/\//.test(String(url))) throw new Error(`signed URL is not https: ${String(url).slice(0, 60)}`);
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`fetching the signed URL returned HTTP ${res.status}`);
      const got = Buffer.from(await res.arrayBuffer());
      if (!got.equals(body)) throw new Error(`the signed URL served ${got.length} bytes and they do not match`);
      return 'served byte-identical over HTTPS';
    },
  },
  {
    name: 'serve a byte range from the signed URL',
    why: 'seeking in a long recording would not work: the player asks for ranges, not the whole file',
    async run({ r2, key, body, fetchImpl }) {
      const url = await r2.signedGetUrl(key, 600);
      const res = await fetchImpl(url, { headers: { Range: 'bytes=1024-2047' } });
      if (res.status !== 206) throw new Error(`a Range request returned HTTP ${res.status}, expected 206`);
      const got = Buffer.from(await res.arrayBuffer());
      if (!got.equals(body.subarray(1024, 2048))) throw new Error(`the range served ${got.length} bytes and they are not the right ones`);
      return '206 with the right 1024 bytes';
    },
  },
  {
    name: 'delete it again',
    why: 'the preflight object is harmless but deletes failing means removing a recording would leave its bytes behind',
    async run({ r2, key }) {
      await r2.remove(key);
      const h = await r2.head(key);
      if (h) throw new Error('the object is still in the bucket after remove');
      return 'gone';
    },
  },
];

// Run every check, carrying on past a failure so one run reports everything
// that is wrong rather than only the first thing.
async function runChecks(ctx, log = console.log) {
  const results = [];
  for (const check of CHECKS) {
    try {
      const note = await check.run(ctx);
      results.push({ name: check.name, ok: true, note });
      log(`  ok    ${check.name}${note ? '  — ' + note : ''}`);
    } catch (err) {
      results.push({ name: check.name, ok: false, error: err.message });
      log(`  FAIL  ${check.name}`);
      log(`        ${err.message}`);
      log(`        what this means: ${check.why}`);
    }
  }
  return results;
}

// Enough of a value to spot a truncated or mis-pasted one, not enough to use.
function fingerprint(v) {
  if (!v) return '(empty)';
  return `${v.length} chars, starts ${v.slice(0, 4)}…`;
}

function missingVars(env = process.env) {
  return REQUIRED.filter(k => !env[k]);
}

async function main() {
  const mediaStore = require('../src/services/mediaStore');
  console.log('R2 preflight\n');

  const missing = missingVars();
  if (missing.length) {
    console.log('Not configured yet. These are unset or empty:\n');
    for (const k of missing) console.log(`  ${k}`);
    console.log('\nThey belong in dev/platform/backend/.env on the box, next to the');
    console.log('MEDIA_STORE line. Leave MEDIA_STORE=disk until this script passes.');
    process.exit(1);
  }

  console.log(`  R2_ACCOUNT_ID        ${process.env.R2_ACCOUNT_ID}`);
  console.log(`  R2_BUCKET            ${process.env.R2_BUCKET}`);
  console.log(`  R2_ACCESS_KEY_ID     ${fingerprint(process.env.R2_ACCESS_KEY_ID)}`);
  console.log(`  R2_SECRET_ACCESS_KEY ${fingerprint(process.env.R2_SECRET_ACCESS_KEY)}`);
  console.log(`  MEDIA_STORE          ${process.env.MEDIA_STORE || '(unset — disk)'}`);
  console.log(`  active driver        ${mediaStore.driverName}\n`);

  const key = `__omi-preflight/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.bin`;
  // Big enough that a truncating proxy or a bad content-length shows up, and
  // that a 1KB range request has something either side of it. Small enough to
  // cost nothing.
  const body = crypto.randomBytes(64 * 1024);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2-preflight-'));
  const localPath = path.join(dir, 'probe.bin');
  fs.writeFileSync(localPath, body);

  console.log(`probing with ${key} (${body.length} bytes)\n`);

  const results = await runChecks({
    r2: mediaStore.drivers.r2, key, body, localPath, fetchImpl: fetch,
  });

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }

  const failed = results.filter(r => !r.ok).length;
  console.log();
  console.log(closingAdvice(mediaStore.driverName, failed).join('\n'));
  if (failed) {
    console.log(`\nThe probe object was ${results.find(r => r.name === 'delete it again')?.ok ? 'cleaned up' : `left at ${key} — delete it by hand if it is there`}.`);
    process.exit(1);
  }
}

// What to print after the checks. It depends on where the platform is actually
// reading from: printing the pre-migration sequence to someone already live on
// R2 reads as "you have not started yet", and sent one person back round the
// whole loop. Pure and exported so the branches are tested, not eyeballed.
function closingAdvice(driverName, failed) {
  const live = driverName === 'r2';
  if (failed) {
    if (live) {
      // Live on R2 and a check failed: playback is affected right now, so the
      // reassuring "nothing is broken" line would be a lie.
      return [
        `${failed} check(s) failed and the active driver is r2, so playback is`,
        'affected now. Set MEDIA_STORE=disk and `pm2 reload october-platform` to',
        'fall back to the disk copies while you fix the bucket or token.',
      ];
    }
    return [
      `${failed} check(s) failed. Leave MEDIA_STORE=disk — nothing is broken,`,
      'and the platform keeps serving from disk until this passes.',
    ];
  }
  const head = 'All checks passed. The bucket and token do everything playback needs.';
  if (live) {
    return [
      head,
      '',
      'The active driver is already r2, so the switch is done. Nothing to run',
      'here. To check the objects themselves:',
      '  node scripts/media-store-status.js      # every recording has a playback copy',
      'If that reports everything present and you no longer want the duplicate',
      'disk copies:',
      '  node scripts/media-to-r2.js --commit --prune-verified',
    ];
  }
  return [
    head,
    '',
    'Next, still on MEDIA_STORE=disk:',
    '  node scripts/media-to-r2.js             # dry run, writes nothing',
    '  node scripts/media-to-r2.js --commit    # copy, verifying each object',
    '  node scripts/media-store-status.js      # confirm nothing is missing',
    'Only then set MEDIA_STORE=r2 and reload. Keep the disk copies for a few',
    'days; --prune-verified frees them when you are ready.',
  ];
}

module.exports = { CHECKS, runChecks, missingVars, fingerprint, REQUIRED, closingAdvice };


if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });
