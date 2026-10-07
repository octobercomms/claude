/**
 * Guard: the paste-and-sort contact import must not silently import nothing.
 *
 * It did. The extractor made one Claude call with the pasted text cut at
 * 12,000 characters and max_tokens at 3,000. A list over roughly 50 contacts
 * had its JSON reply truncated mid-object; parseArray found no closing bracket,
 * returned [], and the import reported "0 added, 0 updated" as though the paste
 * had been empty. The operator pasted a real CSV of press targets, saw a
 * success toast, and got 0 recipients.
 *
 * Three defences, each tested here:
 *   1. parseDelimited — a CSV with an email column skips the model entirely, so
 *      the common case cannot truncate at all.
 *   2. chunkText — freeform text is split on line boundaries so no single reply
 *      approaches the output cap.
 *   3. parseArray/salvageObjects — a truncated reply yields the objects that did
 *      close, instead of none.
 *
 * smartImport throws on an empty extraction, so a no-op can never again be
 * reported as a success. That path needs a database, so it is asserted by
 * reading the source here rather than executed.
 *
 * Run: node tests/press-import.test.js
 */
const fs = require('fs');
const path = require('path');
const m = require('../src/services/pressImport');

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label}`); failures++; }
};

console.log('\nCSV / TSV fast path (no AI call)');
{
  const csv = 'name,title,outlet,email,beat,location\n'
    + 'Jane Doe,Arts Editor,The Times,jane@thetimes.co.uk,arts,London\n'
    + 'Bob Roe,Design Writer,Dezeen,bob@dezeen.com,design,Manchester\n';
  const r = m.parseDelimited(csv) || [];
  ok(r.length === 2, 'two rows parsed');
  ok(r[0]?.email === 'jane@thetimes.co.uk', 'email mapped');
  ok(r[0]?.company === 'The Times', 'outlet mapped to company');
  ok(r[0]?.beat === 'arts' && r[0]?.location === 'London', 'beat and location mapped');

  // The size that used to fail. 600 rows is well past the old output cap.
  const big = 'name,outlet,email\n'
    + Array.from({ length: 600 }, (_, i) => `P${i},Outlet ${i},p${i}@x.com`).join('\n');
  ok((m.parseDelimited(big) || []).length === 600, '600 rows all parsed, none lost');

  const tsv = 'First Name\tLast Name\tE-mail\tPublication\tTags\n'
    + 'Jane\tDoe\tJANE@X.COM\t"Smith, Jones & Co"\tarts;property\n';
  const t = m.parseDelimited(tsv) || [];
  ok(t[0]?.name === 'Jane Doe', 'tab-separated: name built from first + last');
  ok(t[0]?.email === 'jane@x.com', 'email lowercased');
  ok(t[0]?.company === 'Smith, Jones & Co', 'quoted field keeps its comma');
  ok(t[0]?.tags.length === 2, 'tags split on semicolon');

  const bad = m.parseDelimited('name,email\nJane Doe,not-an-email\n') || [];
  ok(bad[0]?.email === null && bad[0]?.name === 'Jane Doe', 'invalid email dropped, row kept');
}

console.log('\nFalling through to the model when it is not a contact CSV');
{
  ok(m.parseDelimited('Jane Doe, arts editor, The Times, jane@x.com') === null,
    'freeform line with no header returns null');
  ok(m.parseDelimited('col_a,col_b\n1,2') === null,
    'header row without an email column returns null');
  ok(m.parseDelimited('') === null, 'empty text returns null');
}

console.log('\nChunking freeform text');
{
  const lines = Array.from({ length: 500 }, (_, i) => `Person ${i}, Outlet ${i}, p${i}@x.com`);
  const chunks = m.chunkText(lines.join('\n'));
  ok(chunks.length > 1, `split into ${chunks.length} chunks`);
  ok(chunks.join('\n').split('\n').length === 500, 'every line survives the split');
  ok(chunks.every((c) => c.length <= 6000 || !c.includes('\n')), 'no chunk exceeds the cap');
  ok(m.chunkText('x'.repeat(14000)).length === 3, 'one line longer than a chunk is hard-split');
}

console.log('\nSalvaging a truncated model reply');
{
  const truncated = '[\n{"name":"A One","email":"a@x.com","tags":["arts"]},\n{"name":"B Two","email":"b@x.com"},\n{"name":"C Thr';
  ok(m.parseArray(truncated).length === 2, 'keeps the 2 objects that closed (was 0)');
  ok(m.parseArray('[{"name":"A {weird} \\"q\\"","email":"a@x.com"},{"name":"B').length === 1,
    'braces and escaped quotes inside a value do not break depth tracking');
  ok(m.parseArray('[{"name":"A"},{"name":"B"}]').length === 2, 'an intact array still parses normally');
  ok(m.parseArray('```json\n[{"name":"A"}]\n```').length === 1, 'fenced JSON still parses');
  ok(m.parseArray('no json here').length === 0, 'genuinely empty text yields nothing');
}

console.log('\nNo-op can never be reported as a success');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'pressImport.js'), 'utf8');
  ok(/if \(!extracted\.length\)[\s\S]{0,400}throw e;/.test(src),
    'smartImport throws when extraction yields no contacts');
  ok(/max_tokens:\s*8000/.test(src), 'extractChunk asks for enough output headroom');
  ok(!/slice\(0,\s*12000\)/.test(src), 'the silent 12,000-character input cut is gone');
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
