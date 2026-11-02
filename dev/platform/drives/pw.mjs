// Where Playwright and Chromium live, resolved rather than assumed.
//
// Every drive used to open with
//   import pw from '/opt/node-tools/node_modules/playwright/index.js';
// which is the path inside the cloud container these were written in. On any
// other machine that is a module-not-found and the drive never runs, which
// is a quiet way for a whole verification step to disappear.
//
// Usage:  import { chromium } from './pw.mjs';
export async function load() {
  const tries = [
    '/opt/node-tools/node_modules/playwright/index.js',  // the cloud container
    'playwright',                                        // an ordinary install
    'playwright-core',
  ];
  const failures = [];
  for (const spec of tries) {
    try { return (await import(spec)).default ?? await import(spec); }
    catch (e) { failures.push(`${spec}: ${e.message.split('\n')[0]}`); }
  }
  throw new Error(
    'No Playwright found. Tried:\n  ' + failures.join('\n  ')
    + '\nInstall it, or run this where /opt/node-tools has it.');
}

const pw = await load();

// A matching Chromium is pre-installed in the container at a fixed path; a
// local install finds its own. Passing an executablePath that does not exist
// fails louder than letting Playwright choose, so only set it if it is there.
import { existsSync } from 'node:fs';
const BUNDLED = '/opt/pw-browsers/chromium';
export const chromium = {
  launch: (opts = {}) => pw.chromium.launch(
    existsSync(BUNDLED) && !opts.executablePath
      ? { executablePath: BUNDLED, args: ['--no-sandbox'], ...opts }
      : opts
  ),
};
export default { chromium };

// Where a drive puts a screenshot or a log it writes for a human to look at.
//
// These used to be absolute paths into one session's working directory under
// /tmp, named after a container that has since been destroyed. On any other
// machine the write either lands somewhere meaningless or throws — and
// drive-thread, which READ its fixture from the same dead directory, had been
// unrunnable for days before anything ran it.
//
// Beside the drives instead, in a directory that is created on demand and
// gitignored. Call it for every artefact a drive writes.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ARTIFACTS = join(dirname(fileURLToPath(import.meta.url)), '.artifacts');

export function artifact(name) {
  mkdirSync(ARTIFACTS, { recursive: true });
  return join(ARTIFACTS, name);
}
