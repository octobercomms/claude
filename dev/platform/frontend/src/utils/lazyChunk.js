// A lazy import that survives a deploy.
//
// Six errors in the digest for 31 October, six different pages, one cause:
//
//   TypeError: Failed to fetch dynamically imported module:
//   https://platform.octobercomms.com/assets/ClientSocialPage-B6rMaoX1.js
//
// Every stack carries a different index-*.js hash, which is six different
// deploys. The sequence is always the same. Someone has OMI open. We deploy;
// Vite writes new chunks with new content hashes and the old ones stop being
// served. They click through to a page they have not visited this session,
// the browser asks for the chunk the old index.html told it about, gets a
// 404, and the route throws into the error boundary: a blank "something went
// wrong" on a screen that works perfectly after a refresh.
//
// Nothing is wrong with the app, and nothing the person did caused it, so
// asking them to reload is asking them to understand our deploy process.
// Instead: retry once in case it was the network, then reload the page, which
// fetches the new index.html and with it the chunk names that exist.
//
// Two things stop that becoming a loop:
//   - the reload is recorded in sessionStorage against the chunk's name, so a
//     chunk that is genuinely missing (a bad build) reloads once and then
//     surfaces the real error rather than refreshing for ever
//   - the marker is cleared when the import eventually succeeds
//
// sessionStorage can throw (private windows, blocked site data), so every
// touch is wrapped. With it unavailable the behaviour degrades to "retry
// once, then reload once per navigation", which is still better than a blank
// screen and cannot loop faster than the person clicks.

import { lazy } from 'react';

const KEY = 'omi:chunk-reload:';

function mark(name) {
  try { sessionStorage.setItem(KEY + name, String(Date.now())); return true; }
  catch { return false; }
}
function wasMarked(name) {
  try { return !!sessionStorage.getItem(KEY + name); } catch { return false; }
}
function clearMark(name) {
  try { sessionStorage.removeItem(KEY + name); } catch { /* nothing to clear */ }
}

// A failed dynamic import, as opposed to an error thrown by the module's own
// top-level code. Reloading fixes the first and hides the second, so only the
// first gets a reload.
export function isChunkLoadError(err) {
  const msg = String(err?.message || err || '');
  return /Failed to fetch dynamically imported module/i.test(msg)
    || /error loading dynamically imported module/i.test(msg)
    || /Importing a module script failed/i.test(msg)   // Safari
    || /'text\/html' is not a valid JavaScript MIME type/i.test(msg); // SPA index served for a missing chunk
}

/**
 * React.lazy, with a deploy-aware retry.
 *
 *   name   — a stable label for this chunk, used as the reload marker. It has
 *            to survive the reload, so it cannot be the hashed filename.
 *   loader — the usual () => import('./Page')
 */
export function lazyChunk(name, loader) {
  return lazy(async () => {
    try {
      const mod = await loader();
      clearMark(name);
      return mod;
    } catch (err) {
      if (!isChunkLoadError(err)) throw err;

      // Once, immediately: a dropped request on a flaky connection looks
      // exactly like a stale chunk, and costs nothing to rule out.
      try {
        const mod = await loader();
        clearMark(name);
        return mod;
      } catch (second) {
        if (!isChunkLoadError(second)) throw second;
        if (wasMarked(name)) {
          // Already reloaded for this chunk and it is still missing. This is
          // a real failure now, so let it reach the error boundary rather
          // than refreshing the page under someone a second time.
          clearMark(name);
          throw second;
        }
        mark(name);
        // location.reload() would re-serve the cached index.html in some
        // browsers. Replacing with the same href goes to the network for it.
        window.location.replace(window.location.href);
        // Never resolves; the page is on its way out. Returning a component
        // here would flash it for a frame first.
        return new Promise(() => {});
      }
    }
  });
}

export default lazyChunk;
