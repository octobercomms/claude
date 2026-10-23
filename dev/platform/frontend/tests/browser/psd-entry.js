// Exposes the PSD importer to the Playwright run in psd.mjs. It is the real
// module from src/utils, bundled the way the app bundles it.
import { parsePsd, fitFontSize, mapFont, resolveFamily, commonName } from '../../src/utils/psdImport';
import { psdToScene, hashIndex } from '../../src/utils/psdToScene';

window.psdImport = { parsePsd, fitFontSize, mapFont, resolveFamily, psdToScene, hashIndex, commonName };
window.__ready = true;
