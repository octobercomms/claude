// Read a Photoshop file into something the design editor can hold.
//
// The shape of this is dictated by four things real exports from Adobe Express
// do, every one of which produces a visibly wrong import if ignored. They were
// found by running four of October's own ADF posts through a parser and
// reading what came back, not from the format's documentation.
//
//  1. Photoshop ends a line with a carriage return, not a newline. Miss it and
//     a two-line headline imports as one long line running off the page.
//
//  2. A logo lockup can arrive as one vector shape per letter, nested several
//     groups deep: one post had thirteen "Custom Shape" layers that are really
//     a single wordmark. Groups are therefore flattened to one image by
//     default, which turned that file's 22 layers into 7 usable ones.
//
//  3. A layer mask is a separate greyscale channel. Ignore it and the layer
//     imports as the full rectangle it was cut out of. The mask is baked into
//     the layer's alpha here instead.
//
//  4. A background's colour is not in its pixels. Express writes the layer
//     white and puts the colour in a Color Overlay effect, so reading pixels
//     alone imports a white background and the colour appears to vanish. One
//     of October's files: white pixels, solidFill rgb(209,73,0).
//
//  5. The reported font size cannot be trusted. Across two files it was right
//     in one and 33% too large in the other (86.67 reported where the ink
//     bounds imply ~62), and in a third it came back null. The recorded bounds
//     were right in all of them, so type is fitted to its box and the reported
//     size is only the opening guess.
//
// Nothing here uploads. Parsing happens in the browser so a 200MB PSD never
// crosses the network, and the server needs no native image library.

const BREAKS = /\r\n|\r|\n/g;

// "ADF 2026-44.psd" and "ADF 2026-39.psd" -> "ADF 2026". A campaign's files
// are nearly always named for the campaign, so their shared prefix is the set
// name without anyone having to type it.
export function commonName(names) {
  const list = (names || []).map(n => String(n).replace(/\.psd$/i, ''));
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  let i = 0;
  while (i < list[0].length && list.every(n => n[i] === list[0][i])) i += 1;
  // Walk back out of a number the prefix cut in half: "Q4 launch 01" and
  // "Q4 launch 02" share "Q4 launch 0", and that stray 0 is half an index,
  // not part of the name. "ADF 2026-1" and "ADF 2026-44" share "ADF 2026-",
  // which stops at the separator, so 2026 is left alone.
  while (i > 0 && /\d/.test(list[0][i] || '') && /\d/.test(list[0][i - 1])) i -= 1;
  const prefix = list[0].slice(0, i).replace(/[\s\-_.]+$/, '').trim();
  return prefix.length >= 3 ? prefix : '';
}


// 'GTAmerica-Bold' -> { family: 'GT America', weight: 700, italic: false }
export function mapFont(postscriptName) {
  const raw = String(postscriptName || '').trim();
  if (!raw) return { family: '', weight: 400, italic: false };
  const [face, style = ''] = raw.split('-');
  // 'GTAmerica' -> 'GT America'. The second rule is the one that matters for
  // October: a run of capitals followed by a capitalised word needs splitting
  // too, which a plain camel-case rule misses.
  const family = face
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
  const s = style.toLowerCase();
  const weight = /black|heavy/.test(s) ? 900
    : /extrabold|ultrabold/.test(s) ? 800
      : /bold/.test(s) ? 700
        : /semibold|demi/.test(s) ? 600
          : /medium/.test(s) ? 500
            : /light|thin/.test(s) ? 300 : 400;
  return { family, weight, italic: /italic|oblique/.test(s) };
}

// Pick the closest family the editor can actually render. An uploaded brand
// face wins over a Google one: importing GT America as Inter is worse than
// obvious, it is quietly wrong on every post.
export function resolveFamily(wanted, available) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(wanted);
  if (!target) return null;
  const exact = available.find(f => norm(f) === target);
  if (exact) return exact;
  return available.find(f => norm(f).startsWith(target) || target.startsWith(norm(f))) || null;
}

const px = (n) => Math.round(Number(n) || 0);

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

// A mask is greyscale: white keeps the pixel, black drops it. Canvas composite
// operations work on alpha, not luminance, so the mask is converted first.
function maskToAlpha(maskCanvas) {
  const out = makeCanvas(maskCanvas.width, maskCanvas.height);
  const ctx = out.getContext('2d');
  ctx.drawImage(maskCanvas, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i + 3] = d[i];       // luminance of a greyscale channel is its red
    d[i] = 0; d[i + 1] = 0; d[i + 2] = 0;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

// A Color Overlay, if one is switched on.
//
// This is what Adobe Express writes when a background is given a colour: the
// layer's own pixels stay white and the colour lives in the effect. An
// importer that reads pixels alone brings in a white background and the
// colour looks like it never came through. Found by reading one of October's
// own files: white pixels, solidFill rgb(209,73,0).
//
// Only `normal` is applied. Another blend mode depends on what is underneath,
// which a per-layer import does not have, and a wrong guess is worse than the
// note saying it was left out.
export function colourOverlay(effects) {
  const list = effects && effects.solidFill;
  const fx = Array.isArray(list) ? list.find(f => f && f.enabled !== false && f.color) : null;
  if (!fx) return null;
  const mode = fx.blendMode || 'normal';
  if (mode !== 'normal') return null;
  const o = fx.opacity;
  const opacity = typeof o === 'number' ? (o > 1 ? o / 100 : o) : 1;
  const c = fx.color;
  return {
    colour: `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`,
    opacity: Math.max(0, Math.min(1, opacity)),
  };
}

// Draw one layer's pixels, with its mask applied, at its own size.
function layerCanvas(layer) {
  if (!layer.canvas) return null;
  const w = layer.canvas.width;
  const h = layer.canvas.height;
  const out = makeCanvas(w, h);
  const ctx = out.getContext('2d');
  ctx.drawImage(layer.canvas, 0, 0);

  const m = layer.mask;
  if (m && m.canvas) {
    const alpha = maskToAlpha(m.canvas);
    // Outside the mask's own rectangle the mask's defaultColor applies: black
    // means those pixels are cut away, so start from nothing and paint the
    // mask in. White means they are kept, so start from fully opaque.
    const field = makeCanvas(w, h);
    const fctx = field.getContext('2d');
    if ((m.defaultColor || 0) > 127) {
      fctx.fillStyle = '#000';
      fctx.fillRect(0, 0, w, h);
    }
    fctx.drawImage(alpha, (m.left || 0) - (layer.left || 0), (m.top || 0) - (layer.top || 0));
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(field, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  // Painted after the mask, over the pixels that survived it. source-atop
  // keeps the layer's own alpha, so a cut-out shape stays cut out rather than
  // becoming a filled rectangle.
  const overlay = colourOverlay(layer.effects);
  if (overlay) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = overlay.opacity;
    ctx.fillStyle = overlay.colour;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  return out;
}

// A group's own bounds are usually empty, so take the union of what is in it.
function unionBounds(node, box) {
  const b = box || { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  const kids = node.children;
  if (kids && kids.length) {
    kids.forEach(k => unionBounds(k, b));
  } else if (node.canvas || node.text) {
    b.left = Math.min(b.left, node.left || 0);
    b.top = Math.min(b.top, node.top || 0);
    b.right = Math.max(b.right, node.right || 0);
    b.bottom = Math.max(b.bottom, node.bottom || 0);
  }
  return b;
}

// Everything inside a group, painted onto one canvas. This is what turns a
// wordmark exported as thirteen letter shapes back into a logo.
function flattenGroup(group) {
  const b = unionBounds(group);
  if (!isFinite(b.left) || b.right <= b.left || b.bottom <= b.top) return null;
  const out = makeCanvas(b.right - b.left, b.bottom - b.top);
  const ctx = out.getContext('2d');
  const paint = (node) => {
    if (node.hidden) return;
    if (node.children) { node.children.forEach(paint); return; }
    const c = layerCanvas(node);
    if (!c) return;
    ctx.save();
    ctx.globalAlpha = node.opacity === undefined ? 1 : node.opacity;
    ctx.drawImage(c, (node.left || 0) - b.left, (node.top || 0) - b.top);
    ctx.restore();
  };
  (group.children || []).forEach(paint);
  return { canvas: out, left: b.left, top: b.top, width: out.width, height: out.height };
}

const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

// Identify a layer's pixels by their content, so the same logo across forty
// posts is stored once rather than forty times.
export async function hashBlob(blob) {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function textLayer(layer) {
  const t = layer.text || {};
  const style = t.style || {};
  const font = mapFont(style.font && style.font.name);
  const c = style.fillColor;
  const fill = c
    ? `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`
    : '#000000';
  const justify = (t.paragraphStyle && t.paragraphStyle.justification) || 'left';
  return {
    kind: 'text',
    name: layer.name || 'Text',
    left: px(layer.left),
    top: px(layer.top),
    width: px((layer.right || 0) - (layer.left || 0)),
    height: px((layer.bottom || 0) - (layer.top || 0)),
    opacity: layer.opacity === undefined ? 1 : layer.opacity,
    text: String(t.text || '').replace(BREAKS, '\n'),
    family: font.family,
    weight: font.weight,
    italic: font.italic,
    // Kept only as the opening guess for the fit; see the header.
    reportedSize: typeof style.fontSize === 'number' ? style.fontSize : null,
    fill,
    align: justify === 'center' ? 'center' : justify === 'right' ? 'right' : 'left',
  };
}

/**
 * Read a PSD File into positioned layers, ready to become a design page.
 * Returns { name, width, height, layers, notes }.
 */
export async function parsePsd(file, { flattenGroups = true } = {}) {
  const { readPsd } = await import('ag-psd');
  const psd = readPsd(await file.arrayBuffer(), {
    skipCompositeImageData: true,
    skipThumbnail: true,
  });

  const layers = [];
  const notes = [];

  const addImage = async (name, canvas, left, top, opacity) => {
    const blob = await toBlob(canvas);
    if (!blob) return;
    layers.push({
      kind: 'image',
      name: name || 'Image',
      left: px(left),
      top: px(top),
      width: canvas.width,
      height: canvas.height,
      opacity: opacity === undefined ? 1 : opacity,
      blob,
      hash: await hashBlob(blob),
    });
  };

  const walk = async (nodes) => {
    for (const layer of nodes || []) {
      if (layer.hidden) continue;
      if (layer.text) { layers.push(textLayer(layer)); continue; }

      if (layer.children) {
        if (flattenGroups) {
          const flat = flattenGroup(layer);
          if (flat) {
            await addImage(layer.name, flat.canvas, flat.left, flat.top, layer.opacity);
          }
        } else {
          await walk(layer.children);
        }
        continue;
      }

      const c = layerCanvas(layer);
      if (c) {
        await addImage(layer.name, c, layer.left, layer.top, layer.opacity);
        if (layer.mask) notes.push(`${layer.name || 'A layer'}: mask baked into the image`);
        if (layer.effects) {
          notes.push(colourOverlay(layer.effects)
            ? `${layer.name || 'A layer'}: colour overlay applied, other effects flattened`
            : `${layer.name || 'A layer'}: layer effects are flattened`);
        }
      }
    }
  };

  await walk(psd.children);

  return {
    name: file.name.replace(/\.psd$/i, ''),
    width: psd.width,
    height: psd.height,
    layers,
    notes,
  };
}

/**
 * Size a text layer so it fills the box Photoshop recorded for it.
 *
 * The reported size is unreliable — right in one of October's files and a
 * third too large in another, absent in a third — while the bounds were right
 * in all of them. `measure(size)` returns the rendered width of the longest
 * line at that size; the search finds the largest size that still fits.
 */
export function fitFontSize(measure, targetWidth, guess) {
  const start = guess && guess > 0 ? guess : 64;
  if (!(targetWidth > 0)) return Math.round(start);
  const at = (s) => measure(s);
  if (!(at(start) > 0)) return Math.round(start);

  // Scale straight to the target first: text width is near enough linear in
  // size, so this lands within a few percent and the search only tidies up.
  let size = Math.max(4, Math.min(800, start * (targetWidth / at(start))));
  for (let i = 0; i < 12; i += 1) {
    const w = at(size);
    if (!(w > 0)) break;
    const ratio = targetWidth / w;
    if (ratio > 0.99 && ratio <= 1.01) break;
    size = Math.max(4, Math.min(800, size * ratio));
  }
  // Never grow past the box.
  while (size > 5 && at(size) > targetWidth) size -= 0.5;
  return Math.round(size * 2) / 2;
}
