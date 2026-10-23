// Getting work back out of OMI.
//
// Three formats, for two different jobs. PNG and JPEG are for posting: one
// file per page, zipped, named so they sort the way the set reads. PSD is for
// not being stuck here: the same layers go back to Photoshop, so nothing made
// in this editor is trapped in it. That second one is the point of the whole
// feature, and it is why the PSD keeps layers rather than exporting a
// flattened picture that happens to have a .psd extension.
//
// Everything renders in the browser. The scenes are already here, the fonts
// are already loaded, and a server-side renderer would substitute a fallback
// face for the client's own typeface — the trap the editor's own export was
// built to avoid in the first place.

import { StaticCanvas } from 'fabric';
import { zipSync } from 'fflate';

const safe = (s) => String(s || 'untitled').replace(/[^\w .()-]+/g, '-').replace(/\s+/g, ' ').trim();

// Page 9 before page 10, and both before page 44.
export const pageFilename = (setName, index, total, ext) => {
  const width = String(total).length;
  return `${safe(setName)}/${safe(setName)} ${String(index + 1).padStart(width, '0')}.${ext}`;
};

// Build a canvas from a saved scene.
//
// Fonts first, always. A headline rasterised before its face arrives comes out
// in the fallback, and the file looks right on screen while being wrong in the
// zip someone already sent to a client.
async function sceneCanvas(scene, size, ensureFont) {
  const families = [...new Set((scene?.objects || []).map(o => o.fontFamily).filter(Boolean))];
  if (ensureFont) await Promise.all(families.map(ensureFont));
  try { await document.fonts.ready; } catch { /* no font loading API; carry on */ }

  const canvas = new StaticCanvas(undefined, {
    width: size.width, height: size.height, backgroundColor: '#ffffff',
  });
  if (scene && Object.keys(scene).length) await canvas.loadFromJSON(scene);
  canvas.renderAll();
  return canvas;
}

export async function renderPage(scene, size, { ensureFont, format = 'png', scale = 1 } = {}) {
  const canvas = await sceneCanvas(scene, size, ensureFont);
  const url = canvas.toDataURL({
    format: format === 'jpeg' ? 'jpeg' : 'png',
    quality: format === 'jpeg' ? 0.92 : undefined,
    multiplier: scale,
  });
  canvas.dispose();
  return url;
}

const dataUrlBytes = (url) => {
  const base64 = String(url).slice(String(url).indexOf(',') + 1);
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

export { dataUrlBytes };

/**
 * One PSD layer per layer in the scene, cropped to what it actually covers.
 *
 * Each object is rendered alone on a full-size canvas and then cropped to its
 * bounding box. Rendering alone is what keeps a layer's own pixels separate;
 * cropping is what keeps the file from being every layer at full page size,
 * which for ten layers on a 1080x1350 page is 58MB of raw pixels.
 *
 * A text layer is written as text as well as pixels. If Photoshop reads the
 * text it stays editable; if it does not, the pixels are still there, so the
 * layer is never empty either way.
 */
export async function psdLayers(scene, size, { ensureFont } = {}) {
  const canvas = await sceneCanvas(scene, size, ensureFont);
  const objects = canvas.getObjects();
  const visibility = objects.map(o => o.visible !== false);
  const layers = [];

  for (let i = 0; i < objects.length; i += 1) {
    objects.forEach((o, j) => o.set('visible', j === i));
    canvas.renderAll();

    const o = objects[i];
    const b = o.getBoundingRect();
    const left = Math.max(0, Math.floor(b.left));
    const top = Math.max(0, Math.floor(b.top));
    const right = Math.min(size.width, Math.ceil(b.left + b.width));
    const bottom = Math.min(size.height, Math.ceil(b.top + b.height));
    if (right <= left || bottom <= top) continue;

    const crop = document.createElement('canvas');
    crop.width = right - left;
    crop.height = bottom - top;
    crop.getContext('2d').drawImage(
      canvas.getElement(), left, top, crop.width, crop.height, 0, 0, crop.width, crop.height);

    const layer = {
      name: layerName(o, i),
      left, top, right, bottom,
      canvas: crop,
      opacity: o.opacity === undefined ? 1 : o.opacity,
    };

    if (typeof o.text === 'string') {
      const fill = typeof o.fill === 'string' ? o.fill : '#000000';
      layer.text = {
        // Photoshop ends a line with a carriage return, which is the same
        // thing the importer had to learn reading them.
        text: o.text.replace(/\n/g, '\r'),
        style: {
          font: { name: psFontName(o.fontFamily, o.fontWeight) },
          fontSize: o.fontSize,
          fillColor: rgbOf(fill),
        },
        paragraphStyle: { justification: o.textAlign || 'left' },
      };
    }
    layers.push(layer);
  }

  objects.forEach((o, j) => o.set('visible', visibility[j]));
  canvas.dispose();
  return layers;
}

const layerName = (o, i) => {
  if (typeof o.text === 'string' && o.text.trim()) return o.text.split('\n')[0].slice(0, 40);
  const t = String(o.type || 'layer').toLowerCase();
  return `${t.charAt(0).toUpperCase()}${t.slice(1)} ${i + 1}`;
};

// 'GT America' at 700 -> 'GTAmerica-Bold', the shape Photoshop expects and
// the inverse of what the importer reads.
export function psFontName(family, weight) {
  const base = String(family || 'Helvetica').replace(/\s+/g, '');
  const w = Number(weight) || 400;
  const style = w >= 900 ? 'Black' : w >= 800 ? 'ExtraBold' : w >= 700 ? 'Bold'
    : w >= 600 ? 'SemiBold' : w >= 500 ? 'Medium' : w <= 300 ? 'Light' : 'Regular';
  return `${base}-${style}`;
}

export function rgbOf(colour) {
  const s = String(colour).trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map(c => c + c).join('') : hex[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(s);
  if (m) return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]) };
  return { r: 0, g: 0, b: 0 };
}

export async function renderPsd(scene, size, { ensureFont } = {}) {
  // writePsdBuffer wants Node's Buffer and throws in a browser. The Uint8Array
  // writer is the same encoder without that dependency.
  const { writePsdUint8Array } = await import('ag-psd');
  const children = await psdLayers(scene, size, { ensureFont });
  return writePsdUint8Array({ width: size.width, height: size.height, children });
}

/** Zip a map of filename -> bytes. Stored, not deflated: these are already
 *  compressed images, and deflating them again spends time to save nothing. */
export function zipBlob(files) {
  const entries = {};
  for (const [name, bytes] of Object.entries(files)) entries[name] = [bytes, { level: 0 }];
  return new Blob([zipSync(entries)], { type: 'application/zip' });
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
