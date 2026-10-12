/**
 * Node-side access to the shared analyser.
 *
 * The implementation lives in dev/platform/shared/humanity.mjs so the React
 * editor and this process run exactly the same code. It is an ES module and
 * this codebase is CommonJS, so it is loaded once with a dynamic import and
 * cached.
 */
const path = require('path');
const { pathToFileURL } = require('url');

const MODULE_PATH = path.join(__dirname, '..', '..', '..', 'shared', 'humanity.mjs');

let _mod = null;
async function mod() {
  if (!_mod) _mod = await import(pathToFileURL(MODULE_PATH).href);
  return _mod;
}

/** Analyse a release body against its fact sheet. Never throws on bad input. */
async function analyse(bodyHtml, brief) {
  try {
    const m = await mod();
    return m.analyse(bodyHtml || '', brief || {});
  } catch (err) {
    console.error('[humanity] analyse failed:', err.message);
    return null;
  }
}

async function thresholds() {
  try { return (await mod()).THRESHOLDS; } catch { return null; }
}

module.exports = { analyse, thresholds, MODULE_PATH };
