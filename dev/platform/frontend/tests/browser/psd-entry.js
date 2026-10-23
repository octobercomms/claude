// Exposes the PSD importer to the Playwright run in psd.mjs. It is the real
// module from src/utils, bundled the way the app bundles it.
import { parsePsd, fitFontSize, mapFont, resolveFamily } from '../../src/utils/psdImport';

window.psdImport = { parsePsd, fitFontSize, mapFont, resolveFamily };
window.__ready = true;
