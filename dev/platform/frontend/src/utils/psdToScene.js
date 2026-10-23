// Turn parsed PSD layers into a scene the design editor can open.
//
// The scene is built by making real Fabric objects on a detached canvas and
// asking Fabric to serialise them, rather than hand-writing the JSON. Fabric's
// format has required fields that change between releases; a hand-rolled
// object loads as something subtly wrong, and the first sign of it is a page
// that opens blank.

import { StaticCanvas, FabricImage, Textbox } from 'fabric';
import { fitFontSize, resolveFamily } from './psdImport';

// Measure the longest line at a given size, in the face the layer will
// actually render in. This is what the fit searches against — the reported
// size is unreliable, the recorded box is not.
function measurer(family, weight) {
  const ctx = document.createElement('canvas').getContext('2d');
  return (text) => (size) => {
    ctx.font = `${weight} ${size}px "${family}", sans-serif`;
    return ctx.measureText(text).width;
  };
}

const longestLine = (text) =>
  String(text || '').split('\n').reduce((a, b) => (b.length > a.length ? b : a), '');

/**
 * @param parsed        the result of parsePsd
 * @param uploadImage   async (layer) => url for a layer's pixels, deduplicated
 * @param ensureFont    async (family) => void, loads a face before measuring
 * @param fonts         families the editor can render, best match wins
 * @returns { scene, used } — Fabric JSON, and the families it ended up using
 */
export async function psdToScene(parsed, { uploadImage, ensureFont, fonts = [] }) {
  const canvas = new StaticCanvas(undefined, {
    width: parsed.width,
    height: parsed.height,
    backgroundColor: '#ffffff',
  });
  const used = new Set();

  for (const layer of parsed.layers) {
    if (layer.kind === 'image') {
      const url = await uploadImage(layer);
      if (!url) continue;
      const img = await FabricImage.fromURL(url, { crossOrigin: 'anonymous' });
      // The exported PNG is already the layer's own size, so it is placed, not
      // scaled. Scaling here would compound with whatever Photoshop baked in.
      img.set({
        left: layer.left,
        top: layer.top,
        scaleX: layer.width / (img.width || layer.width || 1),
        scaleY: layer.height / (img.height || layer.height || 1),
        opacity: layer.opacity,
      });
      canvas.add(img);
      continue;
    }

    const family = resolveFamily(layer.family, fonts) || fonts[0] || 'Brockmann';
    used.add(family);
    await ensureFont(family);

    const measure = measurer(family, layer.weight)(longestLine(layer.text));

    // Normally the recorded box decides the size, because the reported one
    // cannot be trusted. A few text layers arrive with no bounds at all, and
    // then there is nothing to fit to: fall back to the reported size, and
    // give the box the width the text actually measures. Without that the
    // Textbox is created at Fabric's minimum and silently stretched to the
    // longest unbreakable word, which is not where the text was.
    const box = layer.width > 0 ? layer.width : null;
    const fontSize = box
      ? fitFontSize(measure, box, layer.reportedSize)
      : Math.round(layer.reportedSize > 0 ? layer.reportedSize : 48);
    const width = box ? box + 1 : Math.ceil(measure(fontSize)) + 2;

    const t = new Textbox(layer.text, {
      left: layer.left,
      top: layer.top,
      // A pixel of slack: a box measured to the exact width of its own ink
      // will wrap the last word on a different renderer.
      width: Math.max(20, width),
      fontFamily: family,
      fontWeight: layer.weight,
      fontStyle: layer.italic ? 'italic' : 'normal',
      fontSize,
      fill: layer.fill,
      textAlign: layer.align,
      lineHeight: 1.1,
      opacity: layer.opacity,
    });
    canvas.add(t);
  }

  const scene = canvas.toJSON();
  canvas.dispose();
  return { scene, used: [...used] };
}

/**
 * Upload a layer's pixels once.
 *
 * `existing` is a map of content hash to URL, seeded from the client's assets
 * and added to as the run goes on. Forty posts sharing one logo upload it
 * once; without this an import of a back catalogue fills the asset library
 * with forty identical files on the first run.
 */
export function imageUploader({ clientId, api, existing, onUpload }) {
  const seen = new Map(existing || []);
  return async function uploadImage(layer) {
    const hit = seen.get(layer.hash);
    if (hit) return hit;
    const fd = new FormData();
    fd.append('file', new File([layer.blob], `${layer.name || 'layer'}.png`, { type: 'image/png' }));
    fd.append('kind', 'product_image');
    fd.append('name', layer.name || 'Layer');
    fd.append('sha256', layer.hash);
    const asset = await api.postForm(`/brand/clients/${clientId}/assets`, fd);
    if (!asset || !asset.url) return null;
    seen.set(layer.hash, asset.url);
    if (onUpload) onUpload(asset);
    return asset.url;
  };
}

/** Hash -> url for assets already in the library, so a re-import reuses them. */
export function hashIndex(assets) {
  const m = new Map();
  for (const a of assets || []) {
    const h = a.metadata && a.metadata.sha256;
    if (h && a.url && !m.has(h)) m.set(h, a.url);
  }
  return m;
}
