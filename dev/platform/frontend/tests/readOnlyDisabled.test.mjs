// roWrite(readOnly, {...}) returns `disabled: false` when the user can
// write, and a JSX spread beats the props written before it. So a
// `disabled={…}` prop sitting beside a roWrite spread is thrown away and
// the button stays live. Shared's batch download and the bulk report
// delete were both built that way and neither ever disabled.
//
// The fix is to pass disabled inside roWrite, which takes it. This checks
// nothing drifts back: within one JSX tag, a roWrite spread and a sibling
// disabled prop cannot both appear.
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { fileURLToPath } from 'url';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : /\.jsx?$/.test(e.name) ? [full] : [];
  });
}

const files = walk(src);
assert.ok(files.length > 100, `expected to scan the frontend tree, found ${files.length} files`);

let tags = 0, withRoWrite = 0;
const offenders = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('roWrite')) continue;
  // Each opening tag, from '<' to the '>' that ends it. Good enough: the
  // props it misses are the ones on no tag at all.
  for (const m of text.matchAll(/<[A-Za-z][^<>]*?>/gs)) {
    const tag = m[0];
    tags++;
    if (!/\{\.\.\.roWrite\(/.test(tag)) continue;
    withRoWrite++;
    if (/(^|\s)disabled\s*=/.test(tag)) {
      const line = text.slice(0, m.index).split('\n').length;
      offenders.push(`${path.relative(src, file)}:${line}`);
    }
  }
}
assert.ok(withRoWrite >= 20,
  `expected to find roWrite on at least twenty controls, found ${withRoWrite} across ${tags} tags`);
assert.deepStrictEqual(offenders, [],
  `these pass disabled beside a roWrite spread, where it is discarded — move it inside roWrite: ${offenders.join(', ')}`);

console.log(`ok  read-only writes: ${withRoWrite} roWrite controls, none with a discarded disabled prop`);
