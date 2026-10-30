// Does the R2 preflight actually catch a broken bucket?
//
// A preflight that passes against a broken bucket is worse than no preflight:
// it is the thing standing between "the four keys are in .env" and switching
// every share link over to a store nobody has ever written to. So each check is
// driven against a store broken in exactly the way that check exists to find.
//
// The failures modelled here are the ones that read as success from the client
// side. A wrong bucket name throws loudly and needs no test; a store that
// accepts a PUT and returns 404 on the GET, or serves the whole file for a
// Range request, does not.
//
//   node tests/r2-preflight.test.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { CHECKS, runChecks, missingVars, fingerprint, REQUIRED } = require('../scripts/r2-preflight');

let failed = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

const quiet = () => {};
const BODY = crypto.randomBytes(64 * 1024);
const KEY = '__omi-preflight/probe.bin';

// A working in-memory stand-in for the r2 driver, with the same surface the
// preflight uses. `break_` names one behaviour to sabotage.
function fakeR2(break_ = null) {
  const store = new Map();
  const tmp = [];
  const r2 = {
    async putFile(key, srcPath) {
      if (break_ === 'write-denied') throw new Error('AccessDenied');
      const buf = fs.readFileSync(srcPath);
      // A write that silently lands fewer bytes than it was handed. For
      // 'lies-about-size' it lands short AND reports the full length, which is
      // the case that passes if the preflight trusts putFile's return value
      // instead of reading the object back.
      const short = break_ === 'truncated-write' || break_ === 'lies-about-size';
      store.set(key, short ? buf.subarray(0, buf.length - 1) : buf);
      return { size: break_ === 'lies-about-size' ? buf.length : store.get(key).length };
    },
    async head(key) {
      if (break_ === 'write-vanishes') return null;
      if (break_ === 'undeletable' && key === KEY) return { size: BODY.length };
      const b = store.get(key);
      return b ? { size: b.length } : null;
    },
    async getBuffer(key) {
      if (break_ === 'read-returns-junk') return Buffer.alloc(BODY.length, 7);
      const b = store.get(key);
      if (!b) throw new Error('NoSuchKey');
      return b;
    },
    async localFile(key) {
      if (break_ === 'stream-fails') throw new Error('connection reset mid-stream');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-r2-'));
      const p = path.join(dir, 'obj');
      const b = break_ === 'stream-truncates'
        ? store.get(key).subarray(0, 100)
        : store.get(key);
      fs.writeFileSync(p, b);
      tmp.push(dir);
      return { path: p, release: async () => { fs.rmSync(dir, { recursive: true, force: true }); } };
    },
    async signedGetUrl(key) {
      if (break_ === 'unsigned-url') return `http://insecure.example/${key}`;
      return `https://fake.r2.example/${key}?sig=abc`;
    },
    async remove(key) {
      if (break_ === 'undeletable') return;
      store.delete(key);
    },
  };
  return { r2, store, cleanup: () => tmp.forEach(d => fs.rmSync(d, { recursive: true, force: true })) };
}

// Stands in for fetch against the signed URL.
function fakeFetch({ store }, break_ = null) {
  return async (url, opts = {}) => {
    const key = decodeURIComponent(new URL(url).pathname.slice(1));
    const buf = store.get(key);
    if (break_ === 'signed-url-403') return { ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0) };
    // A refusal that still returns the right bytes. Contrived, but it is what
    // isolates the status check from the byte check, and the status is what
    // makes the failure message say "HTTP 403" rather than "0 bytes".
    if (break_ === 'ok-bytes-bad-status' && !(opts.headers && opts.headers.Range)) {
      return { ok: false, status: 403, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
    }
    if (!buf) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    const range = opts.headers && opts.headers.Range;
    if (range) {
      const [, ra, rb] = /bytes=(\d+)-(\d+)/.exec(range);
      // A store that honours the Range but answers 200 instead of 206. The
      // bytes are right, so only the status check can see it, and a player
      // treats a 200 as the whole file and will not seek.
      if (break_ === 'range-200') {
        const sl = buf.subarray(Number(ra), Number(rb) + 1);
        return { ok: true, status: 200, arrayBuffer: async () => sl.buffer.slice(sl.byteOffset, sl.byteOffset + sl.length) };
      }
      // A store that ignores Range and serves the whole object with a 200 is
      // the failure that breaks seeking while looking like it works.
      if (break_ === 'ignores-range') {
        return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
      }
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(range);
      const slice = break_ === 'wrong-range'
        ? buf.subarray(0, Number(b) - Number(a) + 1)
        : buf.subarray(Number(a), Number(b) + 1);
      return { ok: true, status: 206, arrayBuffer: async () => slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.length) };
    }
    return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) };
  };
}

async function run(break_ = null, fetchBreak = null) {
  const f = fakeR2(break_);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-src-'));
  const localPath = path.join(dir, 'probe.bin');
  fs.writeFileSync(localPath, BODY);
  try {
    const results = await runChecks(
      { r2: f.r2, key: KEY, body: BODY, localPath, fetchImpl: fakeFetch(f, fetchBreak) },
      quiet);
    return results;
  } finally {
    f.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const failedNames = (results) => results.filter(r => !r.ok).map(r => r.name);

(async () => {
console.log('the R2 preflight');

await check('a working bucket passes every check', async () => {
  const results = await run();
  assert.deepStrictEqual(failedNames(results), [],
    'the preflight fails against a store that does everything right');
  assert.strictEqual(results.length, CHECKS.length);
});

await check('a bucket the token cannot write to fails', async () => {
  const results = await run('write-denied');
  assert.ok(failedNames(results).includes('write an object'));
});

await check('a write that vanishes is caught, not reported as success', async () => {
  // The PUT returns 200 and the object is not there. This is the exact case the
  // migration's verify step exists for, and the preflight has to see it too.
  const results = await run('write-vanishes');
  assert.ok(failedNames(results).includes('read its size back'),
    'a vanished object passed the size check');
});

await check('a truncated write is caught', async () => {
  const results = await run('truncated-write');
  assert.ok(failedNames(results).includes('read its size back'),
    'an object a byte short passed the size check');
});

await check('a driver that lies about how much it wrote is caught', async () => {
  // putFile returns the length it was handed rather than the length that
  // landed. Trusting the return value instead of reading it back would miss it.
  const results = await run('lies-about-size');
  assert.ok(failedNames(results).includes('read its size back'),
    'the preflight trusted putFile\'s own return value');
});

await check('reads that return the wrong bytes are caught', async () => {
  // Same length, different content. A length-only check would pass.
  const results = await run('read-returns-junk');
  assert.ok(failedNames(results).includes('read the bytes back whole'),
    'the preflight compared lengths but not contents');
});

await check('a failing stream-down is caught', async () => {
  const results = await run('stream-fails');
  assert.ok(failedNames(results).includes('stream it down to a local file'));
});

await check('a stream that truncates is caught', async () => {
  const results = await run('stream-truncates');
  assert.ok(failedNames(results).includes('stream it down to a local file'),
    'a short stream passed, so export and transcribe would silently work on partial video');
});

await check('a signed URL that is not https is caught', async () => {
  const results = await run('unsigned-url');
  assert.ok(failedNames(results).includes('sign a playback URL and fetch it'));
});

await check('a signed URL that will not serve is caught', async () => {
  // Uploads work, playback 403s. Without this check the first sign of it is a
  // client seeing a dead player.
  const results = await run(null, 'signed-url-403');
  const names = failedNames(results);
  assert.ok(names.includes('sign a playback URL and fetch it'),
    'a 403 on the playback URL passed the preflight');
});

await check('a store that ignores Range is caught', async () => {
  // Serves the whole object with a 200. Playback starts, seeking does not work,
  // and nothing errors — the hardest kind of failure to notice.
  const results = await run(null, 'ignores-range');
  assert.ok(failedNames(results).includes('serve a byte range from the signed URL'),
    'a store that ignores Range passed, so seeking would quietly not work');
});

await check('a range that serves the wrong bytes is caught', async () => {
  // Right status, right length, wrong offset. Seeking would jump to the wrong
  // place in the video.
  const results = await run(null, 'wrong-range');
  assert.ok(failedNames(results).includes('serve a byte range from the signed URL'),
    'the range check compared only the length, not the offset');
});

await check('a Range answered 200 instead of 206 is caught', async () => {
  // The bytes are correct, so the comparison passes; only the status tells you
  // the store is not doing partial content, and a player will not seek without
  // a 206.
  const results = await run(null, 'range-200');
  assert.ok(failedNames(results).includes('serve a byte range from the signed URL'),
    'a 200 for a Range request passed, so seeking would not work');
});

await check('a refused playback URL is reported by its status', async () => {
  // The message has to name the HTTP status: "403" tells you the token or the
  // bucket policy is wrong, where "0 bytes" sends you looking at the video.
  const results = await run(null, 'ok-bytes-bad-status');
  const r = results.find(x => x.name === 'sign a playback URL and fetch it');
  assert.ok(r && !r.ok, 'a 403 that returned the right bytes passed the preflight');
  assert.ok(/403/.test(r.error), `the failure should name the status, got: ${r.error}`);
});

await check('a delete that does not delete is caught', async () => {
  const results = await run('undeletable');
  assert.ok(failedNames(results).includes('delete it again'),
    'remove silently doing nothing passed, so deleting a recording would leave its bytes');
});

await check('one failure does not stop the rest of the checks', async () => {
  // A run has to report everything that is wrong, not just the first thing, or
  // fixing the bucket takes one round trip per problem.
  const results = await run('write-denied');
  assert.strictEqual(results.length, CHECKS.length,
    `only ${results.length} of ${CHECKS.length} checks ran after the first failure`);
});

await check('every required variable is named when it is missing', async () => {
  assert.deepStrictEqual(missingVars({}), REQUIRED, 'an empty env should name all four');
  assert.deepStrictEqual(
    missingVars({ R2_ACCOUNT_ID: 'a', R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'c', R2_SECRET_ACCESS_KEY: 'd' }),
    [], 'a complete env should report nothing missing');
  assert.deepStrictEqual(
    missingVars({ R2_ACCOUNT_ID: 'a', R2_BUCKET: '', R2_ACCESS_KEY_ID: 'c', R2_SECRET_ACCESS_KEY: 'd' }),
    ['R2_BUCKET'], 'an empty string is as missing as unset');
});

await check('the secret is never printed', async () => {
  // This script exists to be run while someone reads its output, possibly over
  // a shoulder or into a terminal that is being recorded.
  const secret = 'SUPERSECRETVALUE0123456789abcdef';
  const out = fingerprint(secret);
  assert.ok(!out.includes(secret), 'the whole secret was printed');
  assert.ok(!out.includes('SECRET'), `too much of the secret was printed: ${out}`);
  assert.ok(out.includes(String(secret.length)), 'the length is what makes a truncated paste visible');
  assert.strictEqual(fingerprint(''), '(empty)');
  assert.strictEqual(fingerprint(undefined), '(empty)');
  // Four characters is enough to tell two keys apart and not enough to use.
  assert.ok(out.includes('SUPE') && !out.includes('SUPER'), `expected a 4-character prefix, got ${out}`);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');
})();
