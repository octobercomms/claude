// ADF 2027 — Direction. Swiss Motion Graphics.
// One 12-column grid, read four ways: thirteen selling weeks, four structural reasons,
// seventeen institutions, twelve months. Everything snaps to the grid and lands on a beat.

import { E, snap, seg, lerp, clamp, steps, track, BEAT, E8, E16, BAR } from './ease.js';
import * as D from './data.js';

export const DUR = 105;

const W = 1920, H = 1080, M = 96, COLS = 12, GUT = 24;
const COLW = (W - 2 * M - (COLS - 1) * GUT) / COLS;   // 122
const BL = 24;                                         // baseline unit
const colX = i => M + i * (COLW + GUT);

const PAGE = '#EFEDE8', PAPER = '#FFFFFF', INK = '#141414';
const G1 = '#D8D5CE', G2 = '#B4B0A8', G3 = '#8C8880', SIG = '#D8432A';

// Section edges, in seconds. Every edge is a bar line at 120 BPM.
export const S = {
  open: [0, 10.5], weeks: [10.5, 30.5], rev: [30.5, 38.5], reasons: [38.5, 48.5],
  empty: [48.5, 53], inst: [53, 62], rot: [62, 70.5], shape: [70.5, 78],
  money: [78, 85], doors: [85, 94], end: [94, 105],
};
const SECN = { open: '01', weeks: '02', rev: '03', reasons: '04', empty: '05', inst: '06', rot: '07', shape: '08', money: '09', doors: '10', end: '11' };

// ---------------------------------------------------------------- text collection for readcheck
let COLLECT = null;
export function collected() { return COLLECT; }

function pushText(g, id, s, x, y, size, align, pass) {
  if (!COLLECT) return;
  const m = g.getTransform();
  const wdt = g.measureText(s).width;
  const x0 = align === 'center' ? x - wdt / 2 : align === 'right' ? x - wdt : x;
  const pts = [[x0, y - size * 0.78], [x0 + wdt, y - size * 0.78], [x0, y + size * 0.24], [x0 + wdt, y + size * 0.24]]
    .map(([px, py]) => [m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f]);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  COLLECT.push({ id, text: s, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), ...(pass ? { pass: true } : {}) });
}

// ---------------------------------------------------------------- type
function font(g, size, weight = 500, trackPct = 0) {
  g.font = `${weight} ${size}px Archivo, sans-serif`;
  g.letterSpacing = `${(size * trackPct) / 100}px`;
}

// Largest size at or below `size` whose line fits `max` pixels.
function fit(g, s, size, max, weight, trk) {
  let z = size;
  for (; z > 18; z -= 1) {
    font(g, z, weight, trk);
    if (g.measureText(s).width <= max) break;
  }
  return z;
}

// Flush-left text. p < 1 clip-reveals it upward out of its baseline.
function txt(g, id, s, x, y, size, { weight = 500, color = INK, trk = 0, p = 1, align = 'left', pass = false, max = 0 } = {}) {
  if (p <= 0) return;
  if (max) size = fit(g, s, size, max, weight, trk);
  font(g, size, weight, trk);
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  if (p >= 1) {
    g.fillText(s, x, y);
  } else {
    const h = size * 1.25;
    g.save();
    g.beginPath();
    g.rect(x - size * 2, y + size * 0.3 - h * p, g.measureText(s).width + size * 4, h * p);
    g.clip();
    g.fillText(s, x, y + (1 - p) * size * 0.45);
    g.restore();
  }
  pushText(g, id, s, x, y, size, align, pass);
  g.letterSpacing = '0px';
}

// Giant numeral: optically flush left (the glyph's left bearing subtracted), climbing in eased steps.
function numeral(g, id, s, x, y, size, { color = INK, weight = 700, p = 1, steps_n = 4 } = {}) {
  font(g, size, weight, -2);
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  const m = g.measureText(s);
  const bearing = m.actualBoundingBoxLeft !== undefined ? -m.actualBoundingBoxLeft : 0;
  const yy = y + (1 - steps(p, 0, 1, steps_n)) * size * 0.22;
  g.save();
  g.beginPath();
  g.rect(x - size, y - size * 1.1, m.width + size * 2, size * 1.35 * clamp(steps(p, 0, 1, steps_n) * 1.02));
  g.clip();
  g.fillStyle = color;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText(s, x - bearing, yy);
  g.restore();
  pushText(g, id, s, x, y, size, 'left', false);
  g.letterSpacing = '0px';
}

// ---------------------------------------------------------------- marks
function rule(g, x, y, w, p = 1, color = INK, th = 2) {
  if (p <= 0) return;
  g.fillStyle = color;
  g.fillRect(x, y, w * p, th);
}

function vrule(g, x, y, h, p = 1, color = G1, th = 1) {
  if (p <= 0) return;
  g.fillStyle = color;
  g.fillRect(x, y, th, h * p);
}

// Bars overdraw 1px at seams so antialiasing shows no hairline.
function block(g, x, y, w, h, color = INK) {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w) + 1, Math.round(h) + 1);
}

// A knife cut: a line crosses in 1/16, then the element collapses to its midline in 1/8.
// k 0 → untouched, 1 → gone. Returns false when nothing should be drawn.
function knife(g, x, y, w, h, k, draw) {
  if (k >= 1) return false;
  if (k <= 0) { draw(y, h); return true; }
  const cross = clamp(k / 0.34), coll = clamp((k - 0.34) / 0.66);
  const mid = y + h / 2;
  draw(lerp(y, mid, coll), h * (1 - coll));
  if (cross > 0 && coll < 1) {
    g.fillStyle = SIG;
    g.fillRect(x - 18, mid - 1, (w + 36) * cross, 2);
  }
  return true;
}

// Caption row: a 1px rule with a small medium-weight note under it.
function caption(g, id, s, x, y, w, p = 1, { color = INK, size = 19 } = {}) {
  if (p <= 0) return;
  rule(g, x, y, w, clamp(p * 2), color === SIG ? SIG : G3, 1);
  txt(g, id, s, x, y + 26, size, { weight: 500, color, trk: 2, p: clamp((p - 0.3) / 0.7) });
}

// ---------------------------------------------------------------- camera
// One world → screen function. Every effect that follows something goes through it.
function setCam(g, c) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.translate(W / 2, H / 2);
  g.rotate(c.rot || 0);
  g.scale(c.s, c.s);
  g.translate(-c.x, -c.y);
}

// ---------------------------------------------------------------- the page furniture
function technical(g, t, sec) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  const bar = String(Math.floor(t / BAR) + 1).padStart(3, '0');
  txt(g, 'tech', `MODULE 122 × 24   ·   BAR ${bar}   ·   SECTION ${sec}`, W - M, H - 44, 15,
    { weight: 400, color: G3, trk: 6, align: 'right', pass: true });
}

function ghostGrid(g, p = 1) {
  if (p <= 0) return;
  for (let i = 0; i < COLS; i++) vrule(g, colX(i), 150, 800, p, G1, 1);
}

// ================================================================= 01 OPEN
// A giant 20 that turns out to be one module of the thirteen-week grid.
function sOpen(g, t) {
  const [t0] = S.open;
  const u = t - t0;
  // the camera pulls out from the first week module to the whole spread
  const pull = snap(u, 10.5, 4.5);
  const cx = lerp(216, W / 2, pull);                 // the numeral is flush left, optically
  const cy = lerp(690, H / 2, pull);
  const sc = lerp(6.0, 1, pull);
  setCam(g, { x: cx, y: cy, s: sc });

  rule(g, weekX(0), 762, 108, seg(u, 0.4, 1.0), INK, 3);       // the rule draws, linear
  if (u > 0.9) numeral(g, 'twenty', '20', weekX(0), 742, 128, { p: seg(u, 1.0, 2.6) });

  if (pull > 0.02) weeksGrid(g, t, pull * 0.6);

  g.setTransform(1, 0, 0, 1, 0, 0);
  const noteP = snap(u, 2.6, E8), out = seg(u, 10.2, 10.5);
  if (noteP > 0 && out < 1) {
    caption(g, 'open-note', 'TWENTIETH YEAR · ATLANTA DESIGN FESTIVAL · DIRECTION FOR 2027', M, 150 - out * 40, 780, noteP * (1 - out));
  }
}

// ================================================================= 02 WEEKS
const WCOLW = (W - 2 * M) / 13;           // 132.9
const WBARW = 104;
const weekX = i => M + i * WCOLW + (WCOLW - WBARW) / 2;
const WBASE = 820, WTOP = 300, WSCALE = (WBASE - WTOP) / 8855;

// arrival time of each week bar
const wT = i => (i < 9 ? 11.0 + i * BEAT : i === 9 ? 20.0 : i === 10 ? 21.0 : i === 11 ? 22.0 : 25.0);

function weeksGrid(g, t, alpha = 1) {
  g.save();
  g.globalAlpha = alpha;
  rule(g, M, WBASE, W - 2 * M, 1, G2, 1);
  rule(g, M, WTOP, W - 2 * M, 1, G1, 1);
  g.restore();
}

function sWeeks(g, t) {
  setCam(g, { x: W / 2, y: H / 2, s: 1 });
  weeksGrid(g, t, 1);

  for (let i = 0; i < 13; i++) {
    const wk = D.WEEKS[i], ta = wT(i), p = snap(t, ta, E16);
    if (p <= 0) continue;
    const x = weekX(i), last = i === 12;
    const h = Math.max(5, wk.v * WSCALE * (last ? 1.12 : 1)) * p;   // the event week is oversized: it is the exception
    const bw = last ? WBARW + 26 : WBARW;
    const bx = last ? x - 13 : x;
    block(g, bx, WBASE - h, bw, h, last ? SIG : INK);
    txt(g, `wl${i}`, wk.label, x + WBARW / 2, WBASE + 30, 16,
      { weight: 500, color: last ? SIG : G3, trk: 4, align: 'center', p: 1, pass: !last });
  }

  // nine weeks produced a tenth of the year
  const p9 = snap(t, 15.5, E8), o9 = seg(t, 22.0, 22.4);
  if (p9 > 0 && o9 < 1) {
    g.save();
    g.globalAlpha = 1 - o9;
    caption(g, 'nine', `NINE WEEKS  ·  $1,420  ·  10% OF THE YEAR`, M, 880, 560, p9);
    g.restore();
  }

  // the slam
  if (t >= 25.0) {
    const pc = snap(t, 26.0, E8);
    caption(g, 'slam', `$8,855 IN EVENT WEEK  ·  60% OF THE YEAR`, M, 880, 620, pc, { color: SIG });
    // the exception's readout: it is the only thing not on the grid
    const x = weekX(12) - 24;
    txt(g, 'offgrid', 'OFF GRID', x, WTOP - 54, 17, { weight: 600, color: SIG, trk: 6, p: snap(t, 25.4, E16), align: 'right' });
    txt(g, 'offgrid2', 'col 13.00   row −0.42', x, WTOP - 26, 15, { weight: 400, color: SIG, trk: 2, p: snap(t, 25.6, E16), align: 'right', pass: true });
  }
  const pt = snap(t, 11.0, E8);
  txt(g, 'wkhead', 'THIRTEEN WEEKS OF SALES', M, 230, 54, { weight: 600, trk: -1, p: pt });
}

// ================================================================= 03 REVENUE
function sRev(g, t) {
  const u = t - S.rev[0];
  setCam(g, { x: W / 2, y: H / 2, s: 1 });
  const base = 760, top = 330, sc = (base - top) / 50000;
  rule(g, M, base, W - 2 * M, 1, G2, 1);
  txt(g, 'revhead', 'TOUR REVENUE, FOUR YEARS', M, 250, 54, { weight: 600, trk: -1, p: snap(u, 0.5, E8) });

  const BW = 2 * COLW + GUT;                                     // two modules wide: bars with mass
  D.YEARS.forEach((y, i) => {
    const x = colX(i * 3), p = snap(u, 0.5 + i * 0.5, E16);
    if (p <= 0) return;
    const k = i < 3 ? clamp((u - (5.5 + i * 0.12)) / 0.5) : 0;    // the first three are cut away
    const h = y.v * sc * p;
    knife(g, x, base - h, BW, h, k, (yy, hh) => {
      block(g, x, yy, BW, hh, i === 3 ? SIG : INK);
    });
    if (k < 0.5) {
      txt(g, `yv${i}`, y.s, x, base - h - 24, 30, { weight: 600, color: i === 3 ? SIG : INK, p });
      txt(g, `yl${i}`, y.label, x, base + 36, 17, { weight: 500, color: G3, trk: 4, p, pass: true });
    }
  });

  const p47 = snap(u, 5.6, E8);
  if (p47 > 0) {
    numeral(g, 'p47', '+47%', M, 560, 190, { color: SIG, p: seg(u, 5.6, 6.4) });
  }
  caption(g, 'below', 'STILL 70% BELOW PEAK  ·  407 TICKETS, NO ADVERTISING BEHIND IT', M, 880, 860, snap(u, 2.4, E8));
}

// ================================================================= 04 REASONS
function sReasons(g, t) {
  const u = t - S.reasons[0];
  setCam(g, { x: W / 2, y: H / 2, s: 1 });
  const cw = (W - 2 * M - GUT) / 2, ch = 254;
  D.REASONS.forEach((r, i) => {
    const x = M + (i % 2) * (cw + GUT), y = 300 + Math.floor(i / 2) * (ch + GUT);
    const p = snap(u, 0.5 + i * 1.0, E16);
    if (p <= 0) return;
    const k = clamp((u - 9.9) / 0.6);
    knife(g, x, y, cw, ch, k, (yy, hh) => {
      g.save();
      g.beginPath();
      g.rect(x, yy, cw, hh);
      g.clip();
      block(g, x, yy, cw * p, hh, PAPER);
      if (hh > 60) {
        txt(g, `rn${i}`, r.n, x + 36, yy + 58, 20, { weight: 600, color: SIG, trk: 6, p });
        txt(g, `rt${i}`, r.t, x + 36, yy + 136, 38, { weight: 600, trk: -1, p, max: cw - 72 });
        txt(g, `rs${i}`, r.s, x + 36, yy + 186, 19, { weight: 400, color: G3, p, max: cw - 72 });
      }
      g.restore();
    });
  });
  txt(g, 'reahead', 'FOUR REASONS, NONE OF THEM EFFORT', M, 230, 54, { weight: 600, trk: -1, p: snap(u, 5.0, E8) });
}

// ================================================================= 05 EMPTY
// Two people in the middle of an empty grid. The silence before the turn.
const MODX = 4, MODY = 5;                       // 20 modules; 17 fill, the centre is ADF
const MW = 376, MH = 112, MGX = 28, MGY = 20;
const modX = c => (W - (MODX * MW + (MODX - 1) * MGX)) / 2 + c * (MW + MGX);
const modY = r => 232 + r * (MH + MGY);

function moduleGrid(g, p) {
  for (let r = 0; r < MODY; r++) {
    for (let c = 0; c < MODX; c++) {
      g.strokeStyle = G1;
      g.lineWidth = 1;
      g.strokeRect(modX(c) + 0.5, modY(r) + 0.5, MW * p, MH);
    }
  }
}

function adfModule(g, x, y, p, onGrid) {
  block(g, x, y, MW, MH, SIG);
  txt(g, 'adf', 'ADF', x + 26, y + 60, 40, { weight: 700, color: PAPER, trk: -1, p });
  txt(g, 'adfs', onGrid ? 'CONVENES' : 'TWO FOUNDERS', x + 26, y + 90, 16, { weight: 500, color: '#F7D9D2', trk: 4, p });
}

function sEmpty(g, t) {
  const u = t - S.empty[0];
  setCam(g, { x: W / 2, y: H / 2, s: 1 });
  moduleGrid(g, snap(u, 0.6, BEAT));
  const p = snap(u, 0.8, E8);
  adfModule(g, modX(1), modY(2), p, false);
  caption(g, 'alone', 'TWO FOUNDERS, EIGHT DISCIPLINES', M, 900, 560, snap(u, 0.8, E8));
}

// ================================================================= 06 INSTITUTIONS
// The re-flow: seventeen institutions arrive, ordered by distance from the centre.
const CENTRE = [1, 2];
const CELLS = (() => {
  const out = [];
  for (let r = 0; r < MODY; r++) for (let c = 0; c < MODX; c++) {
    if (c === CENTRE[0] && r === CENTRE[1]) continue;
    out.push({ c, r, d: Math.hypot(c - CENTRE[0], (r - CENTRE[1]) * 1.1) });
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, 17);
})();
const instT = i => 53.5 + Math.floor(i / 2) * E16 * 2 + (i % 2) * E16;

function instBlock(g, t, { labelOut = 0, cut = 0 } = {}) {
  if (cut < 1) moduleGrid(g, 1);
  D.INSTITUTIONS.forEach((o, i) => {
    const cell = CELLS[i], p = snap(t, instT(i), E16);
    if (p <= 0) return;
    const x = modX(cell.c), y = modY(cell.r);
    // the cut is ordered by distance from the centre, like the arrival
    const k = clamp((cut - i / 34) * 2.2);
    if (k >= 1) return;
    knife(g, x, y, MW, MH, k, (yy, hh) => {
      g.save();
      g.beginPath();
      g.rect(x, yy, MW, hh);
      g.clip();
      block(g, x, yy, MW, hh * (hh === MH ? p : 1), PAPER);
      if (labelOut < 1 && hh > 60) {
        const ly = yy - labelOut * 36;
        txt(g, `in${i}`, o.n, x + 24, ly + 56, 24, { weight: 600, trk: -1, p, max: MW - 48 });
        txt(g, `id${i}`, o.d, x + 24, ly + 88, 15, { weight: 500, color: G3, trk: 5, p, pass: true });
      }
      g.restore();
    });
  });
}

function sInst(g, t) {
  const u = t - S.inst[0];
  setCam(g, { x: W / 2, y: H / 2, s: 1 });
  instBlock(g, t);
  // the red element finally lands on the grid
  const land = snap(t, 59.0, BEAT);
  const x = lerp(modX(CENTRE[0]) - 26, modX(CENTRE[0]), land);
  const y = lerp(modY(CENTRE[1]) - 18, modY(CENTRE[1]), land);
  adfModule(g, x, y, 1, land > 0.98);
  caption(g, 'seventeen', 'SEVENTEEN ORGANISATIONS  ·  EIGHT DISCIPLINES  ·  ONE GAP', M, 940, 860, snap(u, 3.8, E8));
}

// ================================================================= 07 ROTATION
// The same grid read another way: rotate, hold, then label.
function sRot(g, t) {
  const u = t - S.rot[0];
  // rotate · hold · cut away · the same area read as twelve months
  const turn = snap(u, 2.0, 1.5);
  const labelOut = clamp(seg(u, 3.3, 3.7));
  const cut = clamp(seg(u, 3.6, 4.4));
  if (cut < 1) {
    setCam(g, { x: W / 2, y: H / 2, s: lerp(1, 0.55, turn), rot: turn * Math.PI / 2 });
    instBlock(g, 62, { labelOut, cut });
  }

  const mp = seg(u, 4.4, 5.0);
  if (mp > 0) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    const x = M, bw = W - 2 * M, top = 250, rowH = 54;
    D.MONTHS.forEach((mo, i) => {
      const p = snap(u, 4.4 + i * E16 * 0.7, E16);
      if (p <= 0) return;
      const y = top + i * rowH;
      const fest = i === 8 || i === 9, craft = i === 10, hot = fest || craft;
      block(g, x, y, bw * p, rowH - 10, hot ? SIG : PAPER);
      txt(g, `mo${i}`, mo, x + 24, y + 31, 22, { weight: 600, color: hot ? PAPER : INK, trk: 3, p, pass: true });
      const lab = i === 8 ? 'FESTIVAL WEEK  ·  SEPT 25 – OCT 3' : craft ? 'CRAFT WEEKEND' : '';
      if (lab) txt(g, `mof${i}`, lab, x + 150, y + 31, 19, { weight: 500, color: PAPER, trk: 2, p });
    });
    txt(g, 'rothead', 'TWELVE MONTHS, NOT TWO WEEKS', M, 200, 54, { weight: 600, trk: -1, p: snap(u, 5.2, E8) });
  }
}

// ================================================================= 08 SHAPE
function sShape(g, t) {
  const u = t - S.shape[0];
  const scroll = snap(u, 4.0, 2.0) * 60;
  setCam(g, { x: W / 2, y: H / 2 + scroll, s: 1 });
  const x = M, bw = W - 2 * M;
  D.SHAPE.forEach((b, i) => {
    const p = snap(u, 0.5 + i * BEAT * 2, E16);
    if (p <= 0) return;
    const y = 300 + i * 172;
    const free = i === 0;
    block(g, x, y, bw * p, 142, free ? SIG : PAPER);
    txt(g, `sn${i}`, b.n, x + 32, y + 58, 24, { weight: 700, color: free ? PAPER : SIG, p });
    txt(g, `st${i}`, b.t, x + 92, y + 60, 38, { weight: 600, color: free ? PAPER : INK, trk: -1, p, max: bw - 150 });
    txt(g, `ss${i}`, b.s, x + 92, y + 102, 19, { weight: 400, color: free ? '#F7D9D2' : G3, p, max: bw - 150 });
  });
  g.setTransform(1, 0, 0, 1, 0, 0);
  txt(g, 'shapehead', 'FREE AT THE TOP, PAID BENEATH', x, 196, 48, { weight: 600, trk: -1, p: snap(u, 4.0, E8) });
}

// ================================================================= 09 MONEY
function sMoney(g, t) {
  const u = t - S.money[0];
  setCam(g, { x: W / 2, y: H / 2, s: 1 });
  const total = D.MONEY.reduce((a, b) => a + b.w, 0);
  let x = M;
  D.MONEY.forEach((m, i) => {
    const p = snap(u, 0.5 + i * BEAT * 2, E16);
    const bw = (W - 2 * M - GUT * 2) * (m.w / total);
    if (p > 0) {
      const top = 340, h = 360;
      block(g, x, top, bw, h * p, i === 1 ? SIG : PAPER);
      g.save();
      g.beginPath();
      g.rect(x, top, bw, h * p);
      g.clip();
      txt(g, `mt${i}`, m.t, x + 28, top + 62, 26, { weight: 600, color: i === 1 ? PAPER : INK, trk: 3, p, max: bw - 56 });
      txt(g, `mv${i}`, m.v, x + 28, top + 140, 52, { weight: 700, color: i === 1 ? PAPER : SIG, trk: -1, p, max: bw - 56 });
      txt(g, `ms${i}`, m.s, x + 28, top + 192, 18, { weight: 400, color: i === 1 ? '#F7D9D2' : G3, p, max: bw - 56 });
      g.restore();
    }
    x += bw + GUT;
  });
  txt(g, 'moneyhead', 'THREE SOURCES, SOLD THREE WAYS', M, 268, 54, { weight: 600, trk: -1, p: snap(u, 3.5, E8) });
  caption(g, 'moneynote', 'FROM PROGRAMMING BUDGETS THEY ALREADY HOLD', M, 790, 700, snap(u, 2.5, E8));
}

// ================================================================= 10 DOORS
function sDoors(g, t) {
  const u = t - S.doors[0];
  setCam(g, { x: W / 2, y: H / 2, s: 1 });
  const cw = (W - 2 * M - GUT) / 2;
  D.DOORS.forEach((d, i) => {
    const p = snap(u, 0.5 + i * BEAT * 2, E16);
    if (p <= 0) return;
    const x = M + i * (cw + GUT), y = 270, h = 470;
    block(g, x, y, cw, h * p, PAPER);
    g.save();
    g.beginPath();
    g.rect(x, y, cw, h * p);
    g.clip();
    txt(g, `dk${i}`, d.k, x + 44, y + 86, 46, { weight: 700, color: i === 1 ? SIG : G2, trk: -1, p });
    txt(g, `dt${i}`, d.t, x + 44, y + 196, 58, { weight: 600, color: i === 1 ? INK : G3, trk: -1, p, max: cw - 88 });
    txt(g, `ds${i}`, d.s, x + 44, y + 258, 21, { weight: 500, color: i === 1 ? INK : G3, p, max: cw - 88 });
    rule(g, x + 44, y + 296, cw - 88, p, G1, 1);
    txt(g, `ds2${i}`, d.s2, x + 44, y + 346, 19, { weight: 400, color: G3, p, max: cw - 88 });
    g.restore();
    // B's border draws in, linear and unsnapped: the exception's own movement
    if (i === 1) {
      const q = seg(u, 5.0, 7.0), per = (cw + h) * 2;
      g.globalAlpha = 1;
      g.strokeStyle = SIG;
      g.lineWidth = 4;
      g.setLineDash([per * q, per]);
      g.strokeRect(x, y, cw, h);
      g.setLineDash([]);
    }
  });
  txt(g, 'doorhead', 'TWO DIRECTIONS, AND A CLOCK', M, 190, 48, { weight: 600, trk: -1, p: snap(u, 3.0, E8) });
}

// ================================================================= 11 END
// Knife cuts take everything, nearest first, and the grid is empty again.
function sEnd(g, t) {
  const u = t - S.end[0];
  setCam(g, { x: W / 2, y: H / 2, s: 1 });
  const cw = (W - 2 * M - GUT) / 2;
  ghostGrid(g, clamp(seg(u, 2.6, 3.4)));                 // the empty grid the elements leave behind
  D.DOORS.forEach((d, i) => {
    const k = clamp((u - (0.3 + i * 0.5)) / 0.8);
    const x = M + i * (cw + GUT), y = 270, h = 470;
    knife(g, x, y, cw, h, k, (yy, hh) => {
      block(g, x, yy, cw, hh, PAPER);
      if (hh > 200) {
        g.save();
        g.beginPath();
        g.rect(x, yy, cw, hh);
        g.clip();
        txt(g, `ek${i}`, d.k, x + 44, yy + 86, 46, { weight: 700, color: i === 1 ? SIG : G2, trk: -1, pass: true });
        txt(g, `et${i}`, d.t, x + 44, yy + 196, 58, { weight: 600, color: i === 1 ? INK : G3, trk: -1, pass: true, max: cw - 88 });
        g.restore();
      }
    });
  });
  const base = 700;
  rule(g, M, base, (W - 2 * M) * clamp(seg(u, 2.0, 3.0) - seg(u, 10.0, 11.0) * 1.0), 1, G2, 1);
  txt(g, 'decide', 'DECIDE BY DECEMBER', M, base - 40, 96, { weight: 700, trk: -2, p: snap(u, 4.5, BEAT), color: INK });
  caption(g, 'why', 'CHAPTERS SET BUDGETS IN THE FALL', M, base + 60, 620, snap(u, 6.0, E8) * (1 - seg(u, 10.5, 11.0)));
}

// ================================================================= frame
export function renderFilm(g, t, opts = {}) {
  COLLECT = opts.collect ? [] : null;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = PAGE;
  g.fillRect(0, 0, W, H);
  g.letterSpacing = '0px';
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.globalAlpha = 1;
  g.setLineDash([]);

  let sec = 'end';
  for (const k of Object.keys(S)) {
    const [a, b] = S[k];
    if (t >= a && t < b) { sec = k; break; }
  }
  ({
    open: sOpen, weeks: sWeeks, rev: sRev, reasons: sReasons, empty: sEmpty,
    inst: sInst, rot: sRot, shape: sShape, money: sMoney, doors: sDoors, end: sEnd,
  })[sec](g, t);

  technical(g, t, SECN[sec]);
  g.setTransform(1, 0, 0, 1, 0, 0);
  return COLLECT;
}

// ================================================================= sound events
// Picture and sound share these times: every snap in the film is a hit in the mix.
export function buildEvents() {
  const ev = [];
  const at = (t, type, o = {}) => ev.push({ t: Math.round(t * 1000) / 1000, type, ...o });

  at(0.4, 'pen');                                   // the rule draws
  for (let i = 0; i < 4; i++) at(1.0 + i * 0.4, 'thunk', { g: 0.5 + i * 0.12 });   // the numeral climbs
  at(2.6, 'stamp');
  at(10.5, 'slide');                                // the pull-out lands

  for (let i = 0; i < 12; i++) at(wT(i), 'snap', { g: 0.45 + D.WEEKS[i].v / 8855 });
  at(15.5, 'clack');
  at(25.0, 'slam');                                 // the exception
  at(25.0, 'stop');
  at(26.0, 'clack');

  at(30.5, 'slide');
  for (let i = 0; i < 4; i++) at(31.0 + i * 0.5, 'snap', { g: 0.8 });
  for (let i = 0; i < 3; i++) at(36.0 + i * 0.12, 'knife');
  at(36.1, 'thunk', { g: 1 });

  at(38.5, 'slide');
  for (let i = 0; i < 4; i++) at(39.0 + i, 'clack');
  at(48.4, 'knife');
  at(48.5, 'knife');

  at(49.3, 'thump');
  at(53.5, 'stamp');
  for (let i = 0; i < 17; i++) at(instT(i), 'stamp', { g: 0.55 });
  at(59.0, 'thump', { g: 1.0 });                    // the red element lands on grid

  at(64.0, 'slide');
  for (let i = 0; i < 5; i++) at(65.7 + i * 0.14, 'knife', { g: 0.5 });
  for (let i = 0; i < 12; i++) at(66.4 + i * 0.175, 'snap', { g: 0.4 });

  for (let i = 0; i < 4; i++) at(71.0 + i, 'snap', { g: 0.7 });
  at(74.5, 'carriage');
  for (let i = 0; i < 3; i++) at(78.5 + i, 'snap', { g: 0.8 });

  at(85.5, 'stamp', { g: 1 });
  at(86.5, 'stamp', { g: 1 });
  at(90.0, 'glide');

  for (let i = 0; i < 2; i++) at(94.3 + i * 0.5, 'knife');
  at(98.5, 'thunk', { g: 1.1 });
  at(104.0, 'pen');

  return ev.sort((a, b) => a.t - b.t);
}
