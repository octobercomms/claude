// Exposes the release highlighter to the Playwright run in highlight.mjs. It is
// the real module from src/utils, bundled the way the app bundles it.
import { highlightLayers, unmark } from '../../src/utils/releaseHighlight';
import { stripHtml, flatten, locateSegment } from '../../../shared/humanity.mjs';

window.releaseHighlight = { highlightLayers, unmark, stripHtml, flatten, locateSegment };
window.__ready = true;
