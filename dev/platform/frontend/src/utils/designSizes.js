// The sizes actually asked for, named the way they are named in a brief
// rather than by their pixels. Print sizes are at 300dpi, which is what a
// printer expects and what makes A4 2480x3508 rather than something smaller
// that looks fine on screen and prints soft.
export const PRESETS = [
  { label: 'Instagram portrait', w: 1080, h: 1350 },
  { label: 'Instagram square', w: 1080, h: 1080 },
  { label: 'Story / Reel', w: 1080, h: 1920 },
  { label: 'LinkedIn', w: 1200, h: 627 },
  { label: 'A4 portrait', w: 2480, h: 3508 },
  { label: 'A4 landscape', w: 3508, h: 2480 },
  { label: 'US Letter portrait', w: 2550, h: 3300 },
  { label: 'US Letter landscape', w: 3300, h: 2550 },
];

// A canvas has to be a real size before anything is built on it. The ceiling
// is memory: a page is held as pixels while it is edited, and 8000 square is
// already 256MB before a single layer is added.
export function cleanSize(w, h) {
  const n = (v) => Math.round(Number(v));
  const ok = (v) => Number.isFinite(v) && v >= 50 && v <= 8000;
  return ok(n(w)) && ok(n(h)) ? { width: n(w), height: n(h) } : null;
}

// Zoom steps. A fixed ladder rather than a multiplier so the same presses
// always land on the same sizes, and 100% is one of them: judging type at
// 46%, which is where a 1080x1350 page sits when it is fitted to the frame,
// is how a headline ships two points too small.
export const ZOOMS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

export function nextZoom(current, direction) {
  const eps = 1e-4;
  if (direction > 0) {
    return ZOOMS.find(z => z > current + eps) ?? ZOOMS[ZOOMS.length - 1];
  }
  const below = ZOOMS.filter(z => z < current - eps);
  return below.length ? below[below.length - 1] : ZOOMS[0];
}
