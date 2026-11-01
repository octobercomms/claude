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
