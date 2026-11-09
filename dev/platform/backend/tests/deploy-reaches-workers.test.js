/**
 * Guard — every long-running process in this repo is actually deployed.
 *
 * `update.sh` pulled the source, migrated, installed the backend, built the
 * frontend, synced nginx and handled the Shopify app. It had no step for
 * `dev/platform/worker/`, which is the encode box: a merge touching
 * `dev/platform/**` updated the source there and the worker went on running
 * the OLD CODE until somebody connected and restarted it by hand.
 *
 * That is the quietest class of deploy fault there is. Every check is green,
 * the commit is on the box, and the fix in it has not shipped. The video
 * worker was started by hand with `pm2 start index.js --name video-worker`,
 * so nothing in the repo even named it.
 *
 * The rule this encodes: an ecosystem config is a declaration that something
 * runs forever, so the deploy has to know about it. Add a third one and this
 * fails until `update.sh` does.
 *
 *   node tests/deploy-reaches-workers.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const PLATFORM = path.join(__dirname, '..', '..');
const update = fs.readFileSync(path.join(PLATFORM, 'update.sh'), 'utf8');

/** Every pm2 ecosystem config under dev/platform, and the app names in it. */
function ecosystems(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { ecosystems(p, found); continue; }
    if (!/^ecosystem\.config\.(js|cjs)$/.test(entry.name)) continue;
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const config = require(p);
    for (const app of config.apps || []) {
      found.push({ file: path.relative(PLATFORM, p), name: app.name, script: app.script });
    }
  }
  return found;
}

const APPS = ecosystems(PLATFORM);

describe('the deploy reaches every process that runs forever', () => {
  it('finds the configs at all, so an empty list cannot pass this file', () => {
    assert.ok(APPS.length >= 2, `found ${APPS.map((a) => a.name).join(', ') || 'none'}`);
    assert.ok(APPS.some((a) => a.name === 'october-platform'), 'the backend');
    assert.ok(APPS.some((a) => a.name === 'video-worker'), 'the encode worker');
  });

  for (const app of APPS) {
    it(`deploys ${app.name}`, () => {
      // By NAME, because that is what `pm2 list` shows and what somebody
      // greps for when a deploy looks wrong.
      assert.ok(
        update.includes(app.name),
        `${app.file} declares "${app.name}" and update.sh never mentions it`
      );
    });

    it(`reloads ${app.name} by its config file, not by its name alone`, () => {
      // `pm2 reload <name>` fails on a box where the process has never been
      // started; pointed at the ecosystem file it STARTS it instead. That is
      // what makes a deploy step safe to run on a fresh box and on every box
      // after.
      //
      // The path may be literal or behind a shell variable — the backend's is
      // spelt out and the worker's is `$WORKER_DIR` — so what is checked is
      // that the deploy names the app's DIRECTORY and reloads an ecosystem
      // file within the same step. The first version of this looked for the
      // directory name inside the reload line itself and failed on the
      // variable, which is the test being wrong rather than the deploy.
      const dir = path.dirname(app.file);
      // ANY mention, not the first. The first mention of a directory is often
      // a comment or an unrelated step — `dev/platform/backend` appears at
      // the migrations step, thousands of characters before its reload — so
      // the check is that SOME mention of the directory is followed by a
      // reload of an ecosystem file in the same step.
      const mentions = [];
      for (let i = update.indexOf(dir); i >= 0; i = update.indexOf(dir, i + 1)) mentions.push(i);
      assert.ok(mentions.length, `update.sh never names ${dir}`);
      const reloaded = mentions.some((i) => (
        /pm2 reload [^\n]*ecosystem\.config\.(js|cjs)/.test(update.slice(i, i + 900))
      ));
      assert.ok(
        reloaded,
        `${app.name} is reloaded by name only, which cannot start it on a fresh box`
      );
    });

    it(`lists ${app.name} in the status line at the end`, () => {
      // The last thing a deploy prints is what somebody reads to see whether
      // it worked. A process missing from it is a process nobody checks.
      const status = update.match(/pm2 list --no-color \| grep -E "([^"]+)"/);
      assert.ok(status, 'the deploy still ends with a pm2 status line');
      assert.ok(
        status[1].split('|').includes(app.name),
        `"${app.name}" is not in the final status line`
      );
    });
  }

  it('does not abort the whole deploy when one worker cannot be reloaded', () => {
    // `set -e` is on. A `pm2 reload` that fails for the worker must not take
    // the backend's successful deploy down with it — the same reasoning the
    // nginx block already carries.
    assert.match(update, /pm2 reload "\$WORKER_DIR\/ecosystem\.config\.js" --update-env \\\n\s*\|\| echo/);
  });

  it('skips a worker this box has not set up, rather than failing', () => {
    // The worker may well run somewhere else. Guarded on its own `.env`, the
    // same signal the Shopify block uses.
    assert.match(update, /if \[ -f "\$WORKER_DIR\/\.env" \]; then/);
    assert.match(update, /Skipping video worker deploy/);
  });

  it('keeps the whole deploy inside main(), including the new step', () => {
    // `git reset --hard` overwrites update.sh while bash is still reading it,
    // and bash reads by byte offset. A step added outside `main()` shifts
    // everything past the read head and the rest of the deploy runs from the
    // wrong offsets — which is exactly how deploy 700 silently skipped a fix
    // it was carrying.
    const open = update.indexOf('main() {');
    const close = update.lastIndexOf('\n}\n');
    const worker = update.indexOf('WORKER_DIR=');
    assert.ok(open > 0 && close > open, 'main() is still the wrapper');
    assert.ok(worker > open && worker < close, 'the worker step is inside it');
    assert.match(update, /main "\$@"; exit \$\?/, 'and the call and the exit still share a line');
  });
});
