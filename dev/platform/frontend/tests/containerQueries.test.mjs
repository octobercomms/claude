// Layout inside the page responds to the page, not the window.
//
// Chrome is no longer one fixed width. The nav collapses to an icon rail and a
// section panel opens beside it, so the gap between the window and the content
// box moves by ~170px while you work. A viewport media query cannot see any of
// that: a grid told to fold at 900px kept two columns in a 560px box and got
// cramped instead of folding.
//
// So in-content layout belongs in `@container appmain (...)`. The failure this
// guards is quiet — the rule still works, it just measures the wrong thing, and
// only on some window widths — which is why it is a check rather than a note.
//
//   node --test tests/containerQueries.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Comments are stripped before anything is parsed. A comment sitting above a
// rule inside a block otherwise reads as part of that rule's selector list,
// and the whole block then looks like it targets something it does not.
const CSS = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

// Split the file into top-level at-rule blocks, so a rule can be attributed to
// the query that holds it. Brace counting rather than a regex: the bodies
// contain nested rules and a non-greedy match stops at the first inner `}`.
function atRuleBlocks(css) {
  const out = [];
  const re = /@(media|container)[^{]*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 1, i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    out.push({ kind: m[1], head: m[0].slice(0, -1).trim(), body: css.slice(re.lastIndex, i - 1) });
    re.lastIndex = i;
  }
  return out;
}

const blocks = atRuleBlocks(CSS);

test('the file still has both kinds of query, so neither assertion is vacuous', () => {
  assert.ok(blocks.filter(b => b.kind === 'container').length >= 10,
    'almost no container queries left — did they get reverted?');
  assert.ok(blocks.filter(b => b.kind === 'media').length >= 4,
    'no media queries left — chrome and the marketing page still need them');
});

// Some viewport rules legitimately set grid columns, and they have a property
// in common rather than a list of line numbers: every selector in them either
// reaches inline-styled grids anywhere in the document (`[style*=...]`) or is
// scoped to the marketing homepage. Neither is inside .app-main, so a
// container query there would bind to nothing. Testing the property instead of
// pinning the query strings means a fourth one of the same shape passes and a
// genuine in-content rule still fails.
// Only the rules that actually set grid-template-columns are judged; a block
// can hold plenty of other declarations. Reading the first selector list alone
// got this wrong, because the grid rule is rarely the first rule in the block.
function gridSelectors(body) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(body))) {
    if (!/grid-template-columns/.test(m[2])) continue;
    out.push(...m[1].split(',').map(s => s.trim()).filter(Boolean));
  }
  return out;
}

const outsideAppMain = (body) => {
  const sels = gridSelectors(body);
  return sels.length > 0 && sels.every(sel => /\[style\*=/.test(sel) || /(^|\s)\.home\b/.test(sel));
};

test('no viewport query lays out content inside .app-main', () => {
  const offenders = blocks
    .filter(b => b.kind === 'media')
    .filter(b => /grid-template-columns/.test(b.body))
    .filter(b => !outsideAppMain(b.body))
    .map(b => `${b.head} sets grid-template-columns`);
  assert.deepEqual(offenders, [],
    'in-content layout must use @container appmain (...) so it tracks the content box:\n  ' + offenders.join('\n  '));
});

test('every container query is named, so a nested container cannot capture it', () => {
  const unnamed = blocks
    .filter(b => b.kind === 'container')
    .filter(b => !/^@container\s+appmain\b/.test(b.head))
    .map(b => b.head);
  assert.deepEqual(unnamed, [], 'unnamed container queries bind to the nearest container, not .app-main');
});

test('.app-main is the named container those queries resolve against', () => {
  assert.match(CSS, /\.app-main\s*\{[^}]*container:\s*appmain\s*\/\s*inline-size/,
    '.app-main is not declaring `container: appmain / inline-size`, so every @container appmain rule is dead');
});
