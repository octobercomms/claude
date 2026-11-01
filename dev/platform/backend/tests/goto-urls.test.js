// Google GoTo URLs, which have been quietly wrong since the end of August.
//
// Google stopped putting destination URLs in its search results and started
// putting google.com/goto passthrough links there. DataForSEO follows them,
// but on 30 October Google began throttling how many can be followed from one
// SERP page, and on the Live endpoint — which is the only endpoint this
// codebase uses — about half now come back unresolved.
//
// The reason this is a correctness bug and not a formatting one is one line:
//
//   rankHost('https://google.com/goto?url=CAES…')  ->  'google.com'
//
// so the client's own result never matches their host, checkRank returns
// position: null, and Owned reports "not in the top 50" for a page at number
// four. These guards hold the resolution in front of every read of a url.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dfs = require('../src/connectors/dataforseo');
const src = fs.readFileSync(path.join(__dirname, '..', 'src/connectors/dataforseo.js'), 'utf8');
let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

const GOTO = 'https://google.com/goto?url=CAESUgHrOzAVUmaPVYaIqAxsVfX1yhtfUhPvPHc';

ok('a GoTo URL is recognised, and a real one is not', () => {
  assert.strictEqual(dfs.isGotoUrl(GOTO), true);
  assert.strictEqual(dfs.isGotoUrl('http://www.google.co.uk/goto?url=X'), true, 'other Google domains too');
  assert.strictEqual(dfs.isGotoUrl('https://dezeen.com/2026/a-house'), false);
  // Near misses that must not be rewritten.
  assert.strictEqual(dfs.isGotoUrl('https://google.com/search?q=goto'), false);
  assert.strictEqual(dfs.isGotoUrl('https://notgoogle.com/goto?url=X'), false);
  assert.strictEqual(dfs.isGotoUrl('https://example.com/goto?url=X'), false);
  assert.strictEqual(dfs.isGotoUrl(null), false);
  assert.strictEqual(dfs.isGotoUrl(undefined), false);
});

ok('this is why it matters: the host of a GoTo URL is google.com', () => {
  assert.strictEqual(dfs.rankHost(GOTO), 'google.com');
  assert.notStrictEqual(dfs.rankHost(GOTO), 'dezeen.com');
});

ok('every SERP reader resolves before it reads a url', () => {
  // The order is the whole fix. Resolving after the filter, the host match or
  // the citation check would leave each of them reading google.com.
  // Each row names the FIRST thing in that function that reads a SERP url.
  // `rankHost(keyword.target_url)` in checkRank is not one of them: it reads
  // the client's own stored target, which never came from Google.
  const checks = [
    ['fetchTopSerpResults', 'async function fetchTopSerpResults', '// ── Google GoTo URLs',
      '.filter(i => i.type'],
    ['checkRank', 'async function checkRank(keyword, matchDomain)', '// AI Overview is NOT a standalone',
      ".filter(r => r.type === 'organic' && r.url"],
    ['checkAIOverview', 'async function checkAIOverview', '// Domain Intersection',
      'aiOverviewFromResult(r)'],
    ['fetchLLMVisibility', 'async function fetchLLMVisibility', 'module.exports',
      'aiOverviewFromResult(r)'],
  ];
  for (const [name, from, to, firstRead] of checks) {
    const body = src.slice(src.indexOf(from), src.indexOf(to));
    assert.ok(body.length > 100, `${name} is still where this test looks`);
    const resolve = body.indexOf('resolveGotoInItems');
    assert.ok(resolve > 0, `${name} resolves GoTo URLs`);
    const read = body.indexOf(firstRead);
    assert.ok(read > 0, `${name} still reads a url at ${firstRead}`);
    assert.ok(resolve < read, `${name} resolves before it reads a url`);
  }
});

ok('checkRank resolves before the host match that decides the rank', () => {
  const body = src.slice(src.indexOf('async function checkRank(keyword, matchDomain)'), src.indexOf('// AI Overview is NOT a standalone'));
  const resolve = body.indexOf('await resolveGotoInItems(results, client)');
  const match = body.indexOf('const ih = rankHost(item.url)');
  assert.ok(resolve > 0 && match > 0 && resolve < match);
});

ok('the converter is batched at the documented cap', () => {
  const fn = src.slice(src.indexOf('async function resolveGotoUrls'), src.indexOf('async function resolveGotoInItems'));
  assert.ok(/i \+= 100/.test(fn), '100 URLs per request');
  assert.ok(/\/appendix\/goto_url_converter/.test(fn), 'and the free endpoint, not a paid one');
  assert.ok(/new Set\(/.test(fn), 'deduplicated, because a SERP repeats links');
});

ok('a converter failure leaves the SERP alone rather than losing it', () => {
  const fn = src.slice(src.indexOf('async function resolveGotoUrls'), src.indexOf('async function resolveGotoInItems'));
  assert.ok(/catch \(err\)/.test(fn));
  assert.ok(!/throw/.test(fn), 'a SERP with unresolved links beats no SERP');
});

ok('a destination that is itself a GoTo URL is refused', () => {
  const fn = src.slice(src.indexOf('async function resolveGotoUrls'), src.indexOf('async function resolveGotoInItems'));
  assert.ok(/!isGotoUrl\(to\)/.test(fn), 'otherwise the rewrite is a no-op that looks like a fix');
});

ok('both response shapes are read', () => {
  // The field names have moved once already; reading only one would resolve
  // nothing and report success.
  const fn = src.slice(src.indexOf('async function resolveGotoUrls'), src.indexOf('async function resolveGotoInItems'));
  assert.ok(/it\?\.goto_url \|\| it\?\.url/.test(fn));
  assert.ok(/destination_url \|\| it\?\.resolved_url \|\| it\?\.direct_url/.test(fn));
});

ok('nothing is resolved when there is nothing to resolve', () => {
  // The converter is slow — up to 40–60s for a page — so a clean SERP must
  // not pay for it.
  const fn = src.slice(src.indexOf('async function resolveGotoInItems'), src.indexOf('// Bare hostname for rank matching'));
  assert.ok(/if \(!found\.length\) return items;/.test(fn));
  const batch = src.slice(src.indexOf('async function resolveGotoUrls'), src.indexOf('async function resolveGotoInItems'));
  assert.ok(/if \(!unique\.length\) return out;/.test(batch));
});

ok('the rewrite reaches nested citations, not only top-level items', () => {
  const fn = src.slice(src.indexOf('async function resolveGotoInItems'), src.indexOf('// Bare hostname for rank matching'));
  assert.ok(/d > 6/.test(fn), 'walks the tree, the same depth aiOverviewFromResult walks');
  assert.ok(/v\.url = map\.get\(v\.url\)/.test(fn), 'and rewrites in place, so the caller sees it');
});

// Behavioural, against a stubbed client: the thing the guards above describe.
// Awaited properly at the bottom — an async assertion that only increments a
// counter in a microtask reports a pass it has not earned.
async function behavioural() {
  const items = [
    { type: 'organic', rank_absolute: 4, url: GOTO, title: 'A house' },
    { type: 'organic', rank_absolute: 5, url: 'https://dezeen.com/b', title: 'B' },
    { type: 'ai_overview', references: [{ url: GOTO + 'XX' }] },
  ];
  const calls = [];
  const stub = {
    post: async (url, body) => {
      calls.push({ url, count: body[0].goto_urls.length });
      return { data: { tasks: [{ result: body[0].goto_urls.map((g) => ({
        goto_url: g, destination_url: g.endsWith('XX') ? 'https://wallpaper.com/c' : 'https://oculimundi.com/a-house',
      })) }] } };
    },
  };
  await dfs.resolveGotoInItems(items, stub);
  assert.strictEqual(items[0].url, 'https://oculimundi.com/a-house');
  assert.strictEqual(dfs.rankHost(items[0].url), 'oculimundi.com', 'which is now the client, so it ranks at 4');
  assert.strictEqual(items[1].url, 'https://dezeen.com/b', 'a real URL is untouched');
  assert.strictEqual(items[2].references[0].url, 'https://wallpaper.com/c', 'and a nested citation is rewritten');
  assert.strictEqual(calls.length, 1, 'one request for the pair');
  assert.strictEqual(calls[0].count, 2, 'deduplicated and batched');
  assert.ok(calls[0].url.includes('goto_url_converter'));
  passed += 1;

  // And a converter that falls over leaves the SERP readable.
  const items2 = [{ type: 'organic', url: GOTO, rank_absolute: 1 }];
  await dfs.resolveGotoInItems(items2, { post: async () => { throw new Error('502'); } });
  assert.strictEqual(items2[0].url, GOTO, 'unresolved, not lost');
  passed += 1;

  // A clean SERP must not pay for the converter: it can take 40-60s.
  let posted = 0;
  await dfs.resolveGotoInItems(
    [{ type: 'organic', url: 'https://dezeen.com/a' }],
    { post: async () => { posted += 1; return { data: {} }; } },
  );
  assert.strictEqual(posted, 0, 'no request when there is nothing to resolve');
  passed += 1;
}

behavioural().then(() => {
  console.log(`goto-urls       ✓ ${passed} assertions passed`);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
