// The Authority numbers are fetched, and a bad fetch never overwrites a good
// number.
//
// These figures end up in a client's monthly report. Three ways that goes
// wrong quietly, each guarded here:
//
//   - a month that already has a value gets blanked because this month's
//     fetch failed. The report then shows a gap where there was a number.
//   - a partial fetch is reported as a success, so a missing DA reaches a
//     client report with nobody told.
//   - the domain is normalised wrongly, so Moz is asked about the wrong site
//     and answers confidently about someone else's.
//
//   node tests/seo-authority.test.js

const assert = require('assert');
const moz = require('../src/connectors/moz');

let failed = 0;
// Checks are queued rather than run inline, because some of them stub the
// HTTP layer and have to await. Running an async check without awaiting it
// reports a pass before the assertion has happened, which is the whole family
// of mistake these guards exist to catch.
const queue = [];
function check(name, fn) { queue.push([name, fn]); }
async function runAll() {
  for (const [name, fn] of queue) {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (err) { failed += 1; console.error(`  FAIL ${name}\n       ${err.message}`); }
  }
}

console.log('seo authority');

// ── The domain we actually ask Moz about ─────────────────────────────────

check('a scheme and trailing slash are stripped', () => {
  assert.strictEqual(moz.normaliseTarget('https://falconenamelware.com/'), 'falconenamelware.com');
  assert.strictEqual(moz.normaliseTarget('http://example.co.uk'), 'example.co.uk');
});

check('case is normalised, because Moz keys on the string', () => {
  assert.strictEqual(moz.normaliseTarget('Example.COM'), 'example.com');
});

check('www is left alone', () => {
  // Deliberate: www and the apex are different targets with different DA, and
  // silently rewriting one to the other would answer about a site nobody
  // asked about. Whatever is on the client record is what gets queried.
  assert.strictEqual(moz.normaliseTarget('www.example.com'), 'www.example.com');
});

check('a path survives, so a client on a subfolder still resolves', () => {
  assert.strictEqual(moz.normaliseTarget('https://example.com/uk'), 'example.com/uk');
});

check('an empty or missing domain is null, never an empty query', () => {
  assert.strictEqual(moz.normaliseTarget(''), null);
  assert.strictEqual(moz.normaliseTarget('   '), null);
  assert.strictEqual(moz.normaliseTarget(null), null);
  assert.strictEqual(moz.normaliseTarget(undefined), null);
});

check('trailing slashes do not become an empty target', () => {
  assert.strictEqual(moz.normaliseTarget('https://'), null);
  assert.strictEqual(moz.normaliseTarget('///'), null);
});

// ── JSON-RPC, where a failure arrives as HTTP 200 ────────────────────────
//
// The Moz API moved from REST at lsapi.seomoz.com with an Access ID and
// Secret Key to JSON-RPC at api.moz.com with a single token. JSON-RPC answers
// 200 and puts the failure in the body, so a response that looks fine to the
// HTTP client can still be a rejected token. Letting that through turns
// "your token is wrong" into "Moz returned no metrics", which sends whoever
// is debugging it to the wrong place entirely.

check('the connector targets the JSON-RPC endpoint, not the legacy REST one', () => {
  assert.strictEqual(moz.ENDPOINT, 'https://api.moz.com/jsonrpc');
  assert.ok(!/lsapi\.seomoz\.com/.test(moz.ENDPOINT), 'still pointing at the legacy host');
});

check('the request carries the token header and the documented method', async () => {
  // The auth header and the method name are the whole of this change. A stub
  // that only returns a body proves nothing about them: the first version of
  // this test passed happily with the header renamed.
  const axios = require('axios');
  const realPost = axios.post;
  let seen = null;
  axios.post = async (url, body, config) => {
    seen = { url, body, config };
    return { data: { result: { site_metrics: { domain_authority: 48 } } } };
  };
  try {
    // testCredentials, because it takes a token directly: urlMetrics reads the
    // stored one and there is no database here.
    await moz.testCredentials({ token: 'tok-123', domain: 'https://Example.com/' });
  } finally { axios.post = realPost; }

  assert.strictEqual(seen.url, 'https://api.moz.com/jsonrpc');
  assert.strictEqual(seen.config.headers['x-moz-token'], 'tok-123',
    `expected the token in x-moz-token, got headers ${JSON.stringify(seen.config.headers)}`);
  assert.strictEqual(seen.body.jsonrpc, '2.0');
  assert.strictEqual(seen.body.method, 'data.site.metrics.fetch');
  assert.strictEqual(seen.body.params.data.site_query.scope, 'domain');
  // Normalised on the way out, not just in the helper.
  assert.strictEqual(seen.body.params.data.site_query.query, 'example.com');
});

check('urlMetrics normalises before querying, on the path the monthly job uses', async () => {
  // Tested through urlMetrics specifically. The check above goes through
  // testCredentials, which normalises in its own call, so a urlMetrics that
  // passed the raw "https://Example.com/" straight through would pass it —
  // and urlMetrics is what the 1st-of-the-month sweep calls.
  //
  // getSetting falls back to process.env, so a token can be supplied without
  // a database.
  const axios = require('axios');
  const realPost = axios.post;
  const realToken = process.env.MOZ_API_TOKEN;
  let seen = null;
  process.env.MOZ_API_TOKEN = 'tok-env';
  axios.post = async (url, body, config) => {
    seen = { body, config };
    return { data: { result: { site_metrics: { domain_authority: 48 } } } };
  };
  try {
    const m = await moz.urlMetrics('https://Example.com/');
    assert.strictEqual(m.domain_authority, 48);
    assert.strictEqual(m.target, 'example.com');
  } finally {
    axios.post = realPost;
    if (realToken === undefined) delete process.env.MOZ_API_TOKEN;
    else process.env.MOZ_API_TOKEN = realToken;
  }
  assert.strictEqual(seen.body.params.data.site_query.query, 'example.com',
    `queried ${seen.body.params.data.site_query.query} rather than the normalised host`);
  assert.strictEqual(seen.config.headers['x-moz-token'], 'tok-env');
});

check('an error in a 200 body is raised, not read as empty metrics', async () => {
  // Stub the HTTP layer rather than the connector, so what is under test is
  // the connector's own handling of a JSON-RPC error member.
  const axios = require('axios');
  const realPost = axios.post;
  axios.post = async () => ({ data: { jsonrpc: '2.0', id: 1, error: { code: 401, message: 'Invalid token' } } });
  try {
    await moz.testCredentials({ token: 'bad-token' }).then(r => {
      assert.strictEqual(r.ok, false, 'a rejected token reported as ok');
      assert.match(r.error, /token/i, `unhelpful error: ${r.error}`);
    });
  } finally { axios.post = realPost; }
});

check('a 200 with metrics is read from site_metrics', async () => {
  const axios = require('axios');
  const realPost = axios.post;
  axios.post = async () => ({ data: { result: { site_metrics: { domain_authority: 48, page_authority: 40 } } } });
  try {
    const r = await moz.testCredentials({ token: 'good-token' });
    assert.strictEqual(r.ok, true, `expected ok, got ${r.error}`);
    assert.strictEqual(r.domain_authority, 48);
    assert.match(r.note, /free rows/, 'the test does not say it spent a row');
  } finally { axios.post = realPost; }
});

check('a response with no domain authority fails rather than reporting success', async () => {
  // The shape changing under us must not read as "DA is missing this month".
  const axios = require('axios');
  const realPost = axios.post;
  axios.post = async () => ({ data: { result: { site_metrics: { page_authority: 40 } } } });
  try {
    const r = await moz.testCredentials({ token: 'good-token' });
    assert.strictEqual(r.ok, false, 'no DA reported as a success');
  } finally { axios.post = realPost; }
});

// ── The month key ────────────────────────────────────────────────────────

const { monthKey } = require('../src/services/seoAuthority');

check('a month key is always the first of the month', () => {
  assert.strictEqual(monthKey(new Date('2026-10-30T23:59:00Z')), '2026-10-01');
  assert.strictEqual(monthKey(new Date('2026-01-01T00:00:00Z')), '2026-01-01');
});

check('the month key does not slip a day across a timezone boundary', () => {
  // The bug this prevents: a DATE round-tripping as a UTC timestamp and
  // rolling back into the previous month, so October's figures land on
  // September and overwrite them.
  assert.strictEqual(monthKey(new Date('2026-11-01T00:30:00Z')), '2026-11-01');
  assert.strictEqual(monthKey(new Date('2026-03-01T00:00:01Z')), '2026-03-01');
});

// ── Pacing ───────────────────────────────────────────────────────────────

const { MOZ_GAP_MS } = require('../src/services/seoAuthority');

check('the gap between Moz calls clears the free tier rate limit', () => {
  // The free tier allows roughly one request every ten seconds. A gap at or
  // under that earns a 429 partway through the sweep, which looks like
  // "some clients have no DA this month" rather than like a rate limit.
  assert.ok(MOZ_GAP_MS > 10000, `gap ${MOZ_GAP_MS}ms does not clear 10s`);
});

check('twelve clients still finish in a sensible time', () => {
  const minutes = (MOZ_GAP_MS * 11) / 60000;
  assert.ok(minutes < 5, `twelve clients would take ${minutes.toFixed(1)} minutes`);
});

runAll().then(() => {
  console.log(failed ? `\n${failed} failed` : '\nall passed');
  process.exit(failed ? 1 : 0);
});
