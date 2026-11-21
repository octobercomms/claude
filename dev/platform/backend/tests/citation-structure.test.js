// The citation structure scorer has to be able to say no.
//
// A page scorer that rates everything highly is worse than none, because it
// tells an account manager the page is fine when it is a wall of prose. These
// tests are mostly about the floor: a plain article with no structure must
// score badly, a navigation menu must not count as content structure, and the
// features recorded must be the ones actually on the page.
//
// The four features come from AirOps' AI Search Playbook, which is a vendor's
// own self-published research on SaaS and fintech pages. The weights here were
// chosen, not fitted, and this file pins that so nobody later reads the score
// as a measurement.
//
//   node tests/citation-structure.test.js

const assert = require('assert');

// The module opens a pool at require time.
const dbPath = require.resolve('../src/db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { query: async () => ({ rows: [], rowCount: 0 }) },
};

const cs = require('../src/services/citationStructure');
const { scorePage } = cs;
const { WEIGHTS, collectSchemaTypes, contentRoot } = cs._internals;
const cheerio = require('cheerio');

let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; console.log(`PASS  ${what}`); };

const prose = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

// A real-shaped article: one H1, sections, an FAQ, a table, schema.
const GOOD = `<html><head>
<script type="application/ld+json">{"@graph":[
 {"@type":"BlogPosting","headline":"Party walls"},
 {"@type":"BreadcrumbList"},
 {"@type":["FAQPage","WebPage"]}]}</script>
</head><body>
<nav><ul><li><a href="/a">Home</a></li><li><a href="/b">Work</a></li><li><a href="/c">About</a></li></ul></nav>
<main>
  <h1>Party wall agreements</h1>
  <h2>What the act covers</h2><p>${prose(120)}</p>
  <ul><li>Excavation</li><li>Shared walls</li><li>New build at the line</li></ul>
  <h3>Timings</h3><p>${prose(60)}</p>
  <table><tr><th>Stage</th><th>Weeks</th></tr><tr><td>Notice</td><td>2</td></tr><tr><td>Award</td><td>6</td></tr></table>
  <h2>How much does a surveyor cost?</h2><p>${prose(60)}</p>
  <h2>When do I need to serve notice?</h2><p>${prose(60)}</p>
</main></body></html>`;

// The thing most client articles actually are.
const WALL_OF_PROSE = `<html><body><main>
  <h1>Our approach to residential design</h1>
  <p>${prose(500)}</p>
  <p>${prose(400)}</p>
</main></body></html>`;

ok('a wall of prose fails, and says why', () => {
  const r = scorePage(WALL_OF_PROSE);
  assert.ok(r.score < 30,
    `a page with no FAQ, no schema, no H2s and no lists scored ${r.score}; a `
    + 'scorer that cannot fail an unstructured page tells an AM it is fine');
  assert.strictEqual(r.features.faq_present, false);
  assert.strictEqual(r.features.schema_type_count, 0);
  assert.strictEqual(r.features.lists, 0);
  assert.strictEqual(r.features.tables, 0);
  const lists = r.checks.find(c => c.id === 'lists_tables');
  assert.ok(/no lists or tables/i.test(lists.summary), lists.summary);
});

ok('a well-structured article scores well', () => {
  const r = scorePage(GOOD);
  assert.ok(r.score >= 75, `the structured article only scored ${r.score}`);
  assert.strictEqual(r.features.faq_via_schema, true);
  assert.strictEqual(r.features.h1_count, 1);
  assert.strictEqual(r.features.heading_skips, 0);
  assert.strictEqual(r.features.tables, 1);
});

ok('a navigation menu is not counted as content structure', () => {
  // The single most inflating mistake available: every site has <ul> menus.
  //
  // The nav has to sit INSIDE the scored root for this to test anything. On a
  // theme with no <article> or <main> the root falls back to <body>, which is
  // exactly when the exclusion has to work, and exactly the case a first
  // version of this test missed by putting the nav outside <main>.
  const noWrapper = `<html><body>
    <nav><ul><li>One</li><li>Two</li><li>Three</li><li>Four</li><li>Five</li></ul></nav>
    <h1>Title</h1><p>${prose(400)}</p>
    <footer><ul><li>A</li><li>B</li><li>C</li></ul></footer>
    </body></html>`;
  const bare = scorePage(noWrapper);
  assert.strictEqual(contentRoot(cheerio.load(noWrapper)).get(0).tagName, 'body',
    'this page should fall back to <body>, or the test is not exercising the exclusion');
  assert.strictEqual(bare.features.lists, 0,
    'navigation and footer menus were counted as content lists, which would '
    + 'make every site on the web look well structured');
  assert.strictEqual(bare.features.list_items, 0);

  // And a related-posts block inside the article itself.
  const insideArticle = `<html><body><main>
    <h1>Title</h1><p>${prose(300)}</p>
    <aside class="related"><ul><li>Post A</li><li>Post B</li><li>Post C</li></ul></aside>
    </main></body></html>`;
  assert.strictEqual(scorePage(insideArticle).features.lists, 0,
    'a related-posts list inside the article was counted as content structure');
});

ok('question headings count as an FAQ, but score below real markup', () => {
  const headingsOnly = `<html><body><main><h1>T</h1>
    <h2>What does it cost?</h2><p>${prose(50)}</p>
    <h2>How long does it take?</h2><p>${prose(50)}</p></main></body></html>`;
  const withSchema = headingsOnly.replace('<main>',
    '<script type="application/ld+json">{"@type":"FAQPage"}</script><main>');

  const a = scorePage(headingsOnly).checks.find(c => c.id === 'faq');
  const b = scorePage(withSchema).checks.find(c => c.id === 'faq');

  assert.strictEqual(a.detail.present, true, 'two question headings were not read as an FAQ');
  assert.ok(b.score > a.score,
    'marked-up questions scored no better than inferred ones; the whole point '
    + 'of the schema is that an engine does not have to guess the pairing');
  assert.strictEqual(b.detail.via_schema, true);
});

ok('one question heading is not an FAQ', () => {
  const one = `<html><body><main><h1>T</h1>
    <h2>What we do</h2><p>${prose(50)}</p></main></body></html>`;
  // "What we do" matches the question pattern but is a section title, not a
  // question. One alone must not trip the check.
  assert.strictEqual(scorePage(one).features.faq_present, false,
    'a single heading starting with "What" was treated as an FAQ');
});

ok('schema types are found through @graph, arrays and nested entities', () => {
  const $ = cheerio.load(`<script type="application/ld+json">
    {"@graph":[{"@type":"Article","author":{"@type":"Person"}},
               {"@type":["FAQPage","WebPage"]}]}</script>
    <script type="application/ld+json">[{"@type":"BreadcrumbList"}]</script>`);
  const { types } = collectSchemaTypes($);
  assert.deepStrictEqual(types, ['Article', 'BreadcrumbList', 'FAQPage', 'Person', 'WebPage'],
    'the WordPress SEO plugins all emit @graph and type arrays; missing those '
    + 'would read a fully marked-up page as having no schema');
});

ok('broken JSON-LD is reported, not silently counted as zero', () => {
  const r = scorePage(`<html><body><script type="application/ld+json">{nope</script>
    <main><h1>T</h1><p>${prose(100)}</p></main></body></html>`);
  const schema = r.checks.find(c => c.id === 'schema');
  assert.strictEqual(schema.detail.invalid_blocks, 1);
  assert.ok(/failed to parse/i.test(schema.summary),
    `a page whose schema is broken should say so rather than read as having `
    + `none; got: ${schema.summary}`);
});

ok('a skipped heading level is caught and named', () => {
  const skip = `<html><body><main><h1>T</h1><h3>Jumped</h3><p>${prose(100)}</p></main></body></html>`;
  const h = scorePage(skip).checks.find(c => c.id === 'headings');
  assert.strictEqual(h.detail.skip_count, 1);
  assert.strictEqual(h.detail.skips[0].from, 'h1');
  assert.strictEqual(h.detail.skips[0].to, 'h3');
  assert.ok(/skipped/i.test(h.summary), h.summary);
});

ok('two H1s is a fault, not a pass', () => {
  const two = `<html><body><main><h1>One</h1><h1>Two</h1><h2>s</h2><h3>t</h3><p>${prose(100)}</p></main></body></html>`;
  const h = scorePage(two).checks.find(c => c.id === 'headings');
  assert.strictEqual(h.detail.h1_count, 2);
  assert.ok(h.score < 1, 'two H1s scored a clean hierarchy');
  assert.ok(/2 H1s/.test(h.summary), h.summary);
});

ok('list density is measured against the prose, not counted raw', () => {
  const short = `<html><body><main><h1>T</h1><p>${prose(60)}</p>
    <ul><li>a</li><li>b</li><li>c</li><li>d</li></ul></main></body></html>`;
  const long = `<html><body><main><h1>T</h1><p>${prose(3000)}</p>
    <ul><li>a</li><li>b</li><li>c</li><li>d</li></ul></main></body></html>`;
  const s = scorePage(short).checks.find(c => c.id === 'lists_tables');
  const l = scorePage(long).checks.find(c => c.id === 'lists_tables');
  assert.ok(s.score > l.score,
    'the same four bullets scored the same in 60 words and in 3,000; density '
    + 'is the point, otherwise one stray list passes any article');
  assert.ok(l.detail.density < 1);
});

ok('the content root is the article, not the whole page', () => {
  const $ = cheerio.load(`<html><body><div id="wrap"><p>chrome</p></div>
    <article><p>${prose(100)}</p></article></body></html>`);
  const root = contentRoot($);
  assert.strictEqual(root.get(0).tagName, 'article');
});

ok('a page with no semantic wrapper still gets scored', () => {
  // Falling back to <body> matters: plenty of client sites have no <article>
  // or <main>, and returning zero for those would look like a site fault.
  const bare = `<html><body><h1>T</h1><h2>s</h2><p>${prose(200)}</p>
    <ul><li>a</li><li>b</li></ul></body></html>`;
  const r = scorePage(bare);
  assert.ok(r.features.words > 150, `fell back to an empty root: ${r.features.words} words`);
  assert.strictEqual(r.features.lists, 1);
});

ok('the weights are declared as a choice, and sum to one', () => {
  const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `weights sum to ${total}, not 1`);
  assert.ok(WEIGHTS.schema < WEIGHTS.faq && WEIGHTS.schema < WEIGHTS.headings,
    'schema is a template-level decision a writer cannot usually change, so '
    + 'it carries less than the three things they can');
});

ok('every check returns what the screen and the analysis both need', () => {
  const r = scorePage(GOOD);
  assert.strictEqual(r.checks.length, 4);
  for (const c of r.checks) {
    for (const k of ['id', 'label', 'weight', 'score', 'status', 'summary', 'fix', 'detail']) {
      assert.ok(c[k] !== undefined, `check ${c.id} has no ${k}`);
    }
    assert.ok(c.score >= 0 && c.score <= 1, `${c.id} scored ${c.score}, outside 0..1`);
    assert.ok(['pass', 'warn', 'fail'].includes(c.status), `${c.id} status ${c.status}`);
  }
  // The flat features are what gets joined against citation data later, so a
  // missing one is a silent hole in the analysis rather than a visible bug.
  for (const k of ['faq_present', 'schema_type_count', 'h1_count', 'heading_depth',
    'heading_skips', 'lists', 'tables', 'words', 'structure_density']) {
    assert.ok(r.features[k] !== undefined, `features.${k} is missing`);
  }
});

ok('scoring is deterministic and needs no network or model call', () => {
  const a = scorePage(GOOD), b = scorePage(GOOD);
  assert.strictEqual(a.score, b.score);
  assert.deepStrictEqual(a.features, b.features);
});

// ── the sweep, with fetching and the database stubbed ────────────────────

const fetchPath = require.resolve('../src/utils/fetchHtml');

(async () => {
  const PAGES = {
    'https://ok.test/a': `<html><body><main><h1>A</h1><h2>s</h2><p>${prose(200)}</p><ul><li>x</li></ul></main></body></html>`,
    'https://ok.test/b': `<html><body><main><h1>B</h1><p>${prose(300)}</p></main></body></html>`,
  };
  const order = [];
  let concurrent = 0, maxConcurrent = 0;

  require.cache[fetchPath] = {
    id: fetchPath, filename: fetchPath, loaded: true,
    exports: {
      fetchRenderedHtml: async (url) => {
        concurrent += 1; maxConcurrent = Math.max(maxConcurrent, concurrent);
        order.push(url);
        await new Promise(r => setTimeout(r, 5));
        concurrent -= 1;
        if (url.includes('/broken')) throw new Error('connection reset');
        return { html: PAGES[url] || '', status: 200, via: 'fetch' };
      },
    },
  };

  const inserted = [];
  require.cache[dbPath].exports.query = async (sql, params) => {
    if (/INSERT INTO citation_structure_scans/.test(sql)) {
      inserted.push({ url: params[1], score: params[2] });
      return { rows: [], rowCount: 1 };
    }
    return {
      rows: [
        { external_url: 'https://ok.test/a' },
        { external_url: 'https://ok.test/broken' },
        { external_url: 'https://ok.test/b' },
      ],
    };
  };

  delete require.cache[require.resolve('../src/services/citationStructure')];
  const svc = require('../src/services/citationStructure');
  const result = await svc.analyzeClientPages('client-1', { limit: 25 });

  ok('one unreachable page does not abandon the sweep', () => {
    assert.strictEqual(result.checked, 3);
    assert.strictEqual(result.scored, 2,
      'a page that failed to fetch took the whole sweep down with it');
    assert.strictEqual(result.failed, 1);
    const broken = result.results.find(r => r.url.includes('/broken'));
    assert.ok(/connection reset/.test(broken.error),
      `the failure should say what went wrong, got: ${broken.error}`);
  });

  ok('the client site is fetched one page at a time', () => {
    assert.strictEqual(maxConcurrent, 1,
      `${maxConcurrent} concurrent requests to the client's own site — bot `
      + 'protection reads a burst like that as an attack, and the sweep is '
      + 'not urgent enough to risk it');
    assert.strictEqual(order.length, 3);
  });

  ok('only pages that scored are averaged', () => {
    const scores = result.results.filter(r => typeof r.score === 'number').map(r => r.score);
    assert.strictEqual(result.average, Math.round(scores.reduce((a, b) => a + b, 0) / scores.length));
    assert.ok(result.average > 0, 'the failed page dragged the average toward zero');
  });

  ok('each scored page is persisted', () => {
    assert.strictEqual(inserted.length, 2);
    assert.ok(inserted.every(r => typeof r.score === 'number'));
  });

  console.log(`\n${passed} passed, 0 failed`);
})().catch(e => { console.error(e.message); process.exit(1); });
