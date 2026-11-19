// Paper-cut title lettering for THE QUARTER: home-made geometric letterforms, straight cuts and
// arcs, uneven stroke weights and a staggered baseline. Drawn for this film, not based on any
// existing title's lettering.
import { g, C, piece, roughC, arcP } from './paper.js';

const D = Math.PI / 180;
const arc = (cx, cy, r, a0, a1, n = 18) => arcP(cx, cy, r, a0 * D, a1 * D, n);

// Letters are 100 units tall, origin at the top left. Each returns [outer, ...cut-outs].
// Stroke weights are deliberately uneven: a hand cutting paper does not keep 22 units twice.
export const GLYPH = {
  T: { w: 64, p: () => [[[0, 0], [64, 1], [63, 21], [43, 20], [42, 100], [21, 99], [22, 21], [1, 22]]] },
  H: { w: 68, p: () => [[[0, 0], [22, 1], [21, 40], [46, 41], [47, 0], [68, 1], [67, 100], [46, 99], [45, 61], [21, 60], [22, 100], [0, 99]]] },
  E: { w: 58, p: () => [[[0, 0], [58, 1], [56, 21], [22, 20], [21, 40], [47, 41], [46, 59], [21, 60], [22, 80], [58, 81], [57, 100], [0, 100]]] },
  Q: {
    w: 92,
    p: () => [
      arc(41, 50, 41, 0, 360, 34),
      arc(41, 50, 20, 360, 0, 26),
      // the tail sits clear of the ring: an even-odd fill would read an overlap as a hole
      [[67, 83], [92, 104], [63, 104], [55, 92]],
    ],
  },
  U: {
    w: 70,
    p: () => [[[0, 0], [21, 0], [21, 62]]
      .concat(arc(35, 62, 14, 180, 0, 14))
      .concat([[49, 62], [49, 0], [70, 0], [70, 62]])
      .concat(arc(35, 62, 35, 0, 180, 20))],
  },
  A: {
    w: 74,
    p: () => [
      [[25, 0], [50, 1], [74, 100], [52, 99], [47, 76], [26, 75], [22, 100], [0, 99]],
      [[31, 55], [43, 56], [37, 28]],
    ],
  },
  R: {
    w: 70,
    p: () => [
      [[0, 0], [38, 0]].concat(arc(38, 30, 30, -90, 82, 16), [[70, 100], [46, 99], [29, 62], [21, 61], [22, 100], [0, 100]]),
      [[21, 18], [35, 19]].concat(arc(35, 30, 12, -90, 90, 10), [[35, 42], [21, 41]]),
    ],
  },
};

// THE small over QUARTER large, staggered, the way a cut title sits on the board.
export function titleLayout(H = 210) {
  const out = [];
  const put = (str, x0, y0, h, rots, dys, seed0) => {
    let x = x0;
    const kk = h / 100, sp = 13 * kk;
    for (let i = 0; i < str.length; i++) {
      const G = GLYPH[str[i]];
      if (!G) { x += 40 * kk; continue; }
      out.push({ ch: str[i], x, y: y0 + (dys[i] || 0) * kk, h, rot: (rots[i] || 0) * D, seed: seed0 + i, w: G.w * kk });
      x += G.w * kk + sp;
    }
    return x;
  };
  put('THE', 0, 0, H * 0.40, [-2, 1.4, -0.8], [0, -4, 3], 610);
  put('QUARTER', 0, H * 0.52, H, [1.2, -1, 0.6, -1.6, 1, -0.6, 1.4], [0, -7, 5, -3, 7, -4, 2], 620);
  return out;
}

export function titleBox(H = 210) {
  const L = titleLayout(H);
  let x1 = 0, y1 = 0;
  for (const l of L) { x1 = Math.max(x1, l.x + l.w); y1 = Math.max(y1, l.y + l.h); }
  return { w: x1, h: y1 };
}

export function drawGlyph(l, col = C.ink, opt = {}) {
  const G = GLYPH[l.ch];
  if (!G) return;
  const k = l.h / 100;
  const polys = roughC(`ti${l.ch}${l.h.toFixed(1)}`, () => {
    const ps = G.p();
    return ps[0].map(([x, y]) => [x * k, y * k]);
  }, l.seed, 2.0, 9);
  const cuts = G.p().slice(1).map((p, j) =>
    roughC(`tc${l.ch}${l.h.toFixed(1)}${j}`, () => p.map(([x, y]) => [x * k, y * k]), l.seed * 3 + j, 1.5, 9));
  g.save();
  g.translate(l.x + (opt.dx || 0), l.y + (opt.dy || 0));
  g.rotate(l.rot + (opt.rot || 0));
  piece([polys, ...cuts], col, opt);
  g.restore();
}

export const CUT_ANG = 30 * D;

// The whole title, with each letter able to arrive from somewhere along the diagonal.
export function drawTitle(x, y, H, opt = {}) {
  const L = titleLayout(H);
  g.save();
  g.translate(x, y);
  L.forEach((l, i) => {
    const e = opt.each ? opt.each(l, i, L.length) : null;
    if (e && e.hide) return;
    drawGlyph(l, e?.col || opt.col || C.ink, { dx: e?.dx || 0, dy: e?.dy || 0, rot: e?.rot || 0, gap: opt.gap, shadow: opt.shadow });
  });
  g.restore();
  return L;
}
