// The briefs folder has to stay findable, and its index has to stay true.
//
// docs/omi/briefs/ exists because an agreed decision that lives only in a
// conversation does not survive the session that heard it. The Produce studio
// layout was agreed, mocked as an artifact, and then production shipped six
// separate nav rows, because the mockup was a chat link and the only thing in
// the repo was a plan that had taken three model fields from it and left the
// IA behind.
//
// Two things could quietly undo the fix, and neither would fail anything else:
// the pointer in agent-guide.md rotting away (nothing loads briefs/ on its
// own), and a brief landing in the folder without reaching the README table,
// so an index that reads as complete is not.
//
//   node tests/briefs-contract.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '../../../../docs/omi');
const BRIEFS = path.join(DOCS, 'briefs');

const read = (p) => fs.readFileSync(p, 'utf8');
let passed = 0;
const ok = (what, fn) => { fn(); passed += 1; void what; };

ok('the folder and its rule exist', () => {
  assert.ok(fs.existsSync(BRIEFS), 'docs/omi/briefs/ is gone');
  const readme = read(path.join(BRIEFS, 'README.md'));
  assert.match(readme, /A brief outranks a plan/,
    'the README no longer states the rule that gives a brief its authority');
});

ok('the guide still points at the folder', () => {
  const guide = read(path.join(DOCS, 'agent-guide.md'));
  assert.match(guide, /docs\/omi\/briefs\//,
    'agent-guide.md stopped pointing at briefs/ — nothing else loads it, so the '
    + 'folder becomes invisible exactly the way the mockup was');
  // CLAUDE.md is what points at the guide, which is what points at briefs.
  // If that chain breaks anywhere, the folder is unreachable by a fresh
  // session, which is the whole failure being fixed.
  const claude = read(path.join(DOCS, '../../CLAUDE.md'));
  assert.match(claude, /agent-guide\.md/,
    'root CLAUDE.md stopped pointing at agent-guide.md, breaking the chain');
});

ok('every brief is in the README table, and every table row is a brief', () => {
  const readme = read(path.join(BRIEFS, 'README.md'));
  const files = fs.readdirSync(BRIEFS)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .sort();
  assert.ok(files.length >= 1, 'no briefs at all — the folder should not be empty');

  // Table rows only. The prose above the table names other files
  // (video-batch-plan.md, agent-guide.md) to explain the rule, and a regex
  // over the whole README reads those as index entries.
  const table = readme.split('\n').filter(l => l.startsWith('| '));
  const listed = [...table.join('\n').matchAll(/`([a-z0-9-]+\.md)`/g)].map(m => m[1]);
  const missing = files.filter(f => !listed.includes(f));
  assert.deepStrictEqual(missing, [],
    `a brief is not in the README table: ${missing.join(', ')}`);
  const dangling = [...new Set(listed)].filter(f => !files.includes(f));
  assert.deepStrictEqual(dangling, [],
    `the README lists a brief that does not exist: ${dangling.join(', ')}`);
});

ok('every brief names its source and carries the precedence header', () => {
  for (const f of fs.readdirSync(BRIEFS).filter(x => x.endsWith('.md') && x !== 'README.md')) {
    const body = read(path.join(BRIEFS, f));
    assert.match(body, /this file wins/i,
      `${f} does not say it outranks a plan, so nothing tells a session to obey it`);
    assert.match(body, /\*\*Source:\*\*/,
      `${f} does not name where it was agreed`);
  }
});

// The specific regression: the plan that lost this brief now cites it.
ok('video-batch-plan.md cites the brief it serves', () => {
  const plan = read(path.join(DOCS, 'video-batch-plan.md'));
  assert.match(plan, /briefs\/produce-studio\.md/,
    'the plan that dropped the studio IA no longer names the brief it serves');
});

console.log(`${passed} guards`);
console.log('---');
console.log('A BRIEF CANNOT GO MISSING QUIETLY');
