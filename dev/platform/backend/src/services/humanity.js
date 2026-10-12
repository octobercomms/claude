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

/**
 * Analyse a release body against its fact sheet. Never throws on bad input.
 *
 * `opts` has to carry the same names the editor passes — the brand above all.
 * Without it the stored score and the one on screen come out different for the
 * same text, which is the worst of both.
 */
async function analyse(bodyHtml, brief, opts) {
  try {
    const m = await mod();
    return m.analyse(bodyHtml || '', brief || {}, opts || {});
  } catch (err) {
    console.error('[humanity] analyse failed:', err.message);
    return null;
  }
}

async function thresholds() {
  try { return (await mod()).THRESHOLDS; } catch { return null; }
}

/**
 * The shared HTML-to-text conversion, which decodes entities as well as
 * stripping tags.
 *
 * Anything sent to a paid detector has to go through this rather than a local
 * tag-strip. The first live call was billed on text still carrying literal
 * "&amp;" and "&nbsp;", which is not the text anyone reads and not what we
 * meant to pay to have analysed.
 */
async function toText(html) {
  try {
    const m = await mod();
    return m.stripHtml(html || '');
  } catch {
    return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

module.exports = { analyse, toText, thresholds, MODULE_PATH };
