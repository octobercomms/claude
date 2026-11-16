// A Festival Convenes — Swiss Motion Graphics.
// The film is a subtraction: a word is cut out of the sentence, three produced events are cut
// out of the year, and what is left re-flows into five decisions with dates on them.

import { E, snap, seg, lerp, clamp, steps, track, BEAT, E8, E16, BAR } from './ease.js';
import * as D from './data.js';

export const DUR = 108;

const W = 1920, H = 1080, M = 96, COLS = 12, GUT = 24;
const COLW = (W - 2 * M - (COLS - 1) * GUT) / COLS;   // 122
const colX = i => M + i * (COLW + GUT);

const PAGE = '#EFEDE8', PAPER = '#FFFFFF', INK = '#141414';
const G1 = '#D8D5CE', G2 = '#B4B0A8', G3 = '#8C8880', SIG = '#D8432A';
const ONINK = '#EDEAE4', ONSIG = '#F7D9D2';

export const S = {
  thesis: [0, 11], state: [11, 27], year: [27, 39], assets: [39, 53],
  stop: [53, 74], money: [74, 86], ask: [86, 100], end: [100, 108],
};
const SECN = { thesis: '00', state: '01', year: '01', assets: '02', stop: '03', money: '04', ask: '05', end: '05' };

// ---------------------------------------------------------------- text collection for readcheck
let COLLECT = null;

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

function fit(g, s, size, max, weight, trk) {
  let z = size;
  for (; z > 15; z -= 1) {
    font(g, z, weight, trk);
    if (g.measureText(s).width <= max) break;
  }
  return z;
}

function width(g, s, size, weight = 500, trk = 0) {
  font(g, size, weight, trk);
  return g.measureText(s).width;
}

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

// Giant numeral: optically flush left, climbing one module at a time.
function numeral(g, id, s, x, y, size, { color = INK, weight = 700, p = 1, steps_n = 4, max = 0 } = {}) {
  if (max) size = fit(g, s, size, max, weight, -2);
  font(g, size, weight, -2);
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  const m = g.measureText(s);
  const bearing = m.actualBoundingBoxLeft !== undefined ? -m.actualBoundingBoxLeft : 0;
  const k = steps(p, 0, 1, steps_n);
  g.save();
  g.beginPath();
  g.rect(x - size, y - size * 1.1, m.width + size * 2, size * 1.35 * clamp(k * 1.02));
  g.clip();
  g.fillStyle = color;
  g.fillText(s, x - bearing, y + (1 - k) * size * 0.22);
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

function block(g, x, y, w, h, color = INK) {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w) + 1, Math.round(h) + 1);
}

// A knife cut: the line crosses in 1/16, the element collapses to its midline in 1/8.
function knife(g, x, y, w, h, k, draw) {
  if (k >= 1) return false;
  if (k <= 0) { draw(y, h); return true; }
  const cross = clamp(k / 0.34), coll = clamp((k - 0.34) / 0.66);
  const mid = y + h / 2;
  draw(lerp(y, mid, coll), h * (1 - coll));
  if (cross > 0 && coll < 1) {
    g.fillStyle = SIG;
    g.fillRect(x - 20, mid - 1, (w + 40) * cross, 2);
  }
  return true;
}

function caption(g, id, s, x, y, w, p = 1, { color = INK, size = 19, ruleColor = G3 } = {}) {
  if (p <= 0) return;
  rule(g, x, y, w, clamp(p * 2), ruleColor, 1);
  txt(g, id, s, x, y + 26, size, { weight: 500, color, trk: 2, p: clamp((p - 0.3) / 0.7) });
}

function setCam(g, c) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.translate(W / 2, H / 2);
  g.rotate(c.rot || 0);
  g.scale(c.s, c.s);
  g.translate(-c.x, -c.y);
}

function technical(g, t, sec) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  const bar = String(Math.floor(t / BAR) + 1).padStart(3, '0');
  txt(g, 'tech', `MODULE 122 × 24   ·   BAR ${bar}   ·   SECTION ${sec}`, W - M, H - 44, 15,
    { weight: 400, color: G3, trk: 6, align: 'right', pass: true });
}

// ================================================================= 00 THE THESIS
// One sentence. The word that costs the festival its year is cut out of it, and the word
// that replaces it arrives in the signal colour.
function sThesis(g, t) {
  setCam(g, { x: W / 2, y: H / 2, s: 1 });
  const SIZE = 104, Y = 520;
  const pre = 'A FESTIVAL ';
  const wPre = width(g, pre, SIZE, 600, -2);
  const wProd = width(g, 'PRODUCES.', SIZE, 600, -2);

  rule(g, M, Y + 46, 1728, seg(t, 0.3, 1.1), INK, 3);
  txt(g, 'pre', pre.trim(), M, Y, SIZE, { weight: 600, trk: -2, p: snap(t, 1.6, BEAT) });

  // the word is cut at 4.5, and what replaces it lands on the next beat
  const k = clamp((t - 4.5) / 0.7);
  knife(g, M + wPre, Y - SIZE * 0.78, wProd, SIZE, k, (yy, hh) => {
    if (hh < SIZE * 0.5) return;
    g.save();
    g.beginPath();
    g.rect(M + wPre - 10, yy, wProd + 20, hh);
    g.clip();
    txt(g, 'produces', 'PRODUCES.', M + wPre, Y, SIZE, { weight: 600, trk: -2, p: snap(t, 2.4, BEAT), pass: k > 0 });
    g.restore();
  });
  if (t >= 5.2) txt(g, 'convenes', 'CONVENES.', M + wPre, Y, SIZE, { weight: 600, color: SIG, trk: -2, p: snap(t, 5.6, E8) });

  caption(g, 'thesis-note', 'ATTENDANCE IS DOWN AND REVENUE IS DOWN', M, 760, 700, snap(t, 6.4, E8));
  txt(g, 'thesis-foot', 'ATLANTA DESIGN FESTIVAL  ·  THE TWENTIETH YEAR  ·  FIVE DECISIONS', M, 200, 19,
    { weight: 500, color: SIG, trk: 6, p: snap(t, 0.8, E8) });
}

// ================================================================= 01 WHERE WE ARE
function sState(g, t) {
  const u = t - S.state[0];
  setCam(g, { x: W / 2, y: H / 2, s: 1 });
  const cw = (W - 2 * M - GUT) / 2, ch = 272;
  D.STATE.forEach((f, i) => {
    const x = M + (i % 2) * (cw + GUT), y = 240 + Math.floor(i / 2) * (ch + GUT);
    const p = snap(u, 0.5 + i * BEAT, E16);
    if (p <= 0) return;
    block(g, x, y, cw, ch * p, PAPER);
    g.save();
    g.beginPath();
    g.rect(x, y, cw, ch * p);
    g.clip();
    numeral(g, `sb${i}`, f.big, x + 36, y + 128, 108, { color: SIG, p: seg(u, 0.5 + i * BEAT, 1.1 + i * BEAT), max: 400 });
    txt(g, `ss${i}`, f.sub, x + 36, y + 170, 19, { weight: 600, trk: 5, p });
    txt(g, `st${i}`, f.t, x + 36, y + 200, 19, { weight: 500, color: G3, trk: 5, p });
    wrap(g, `sl${i}`, f.s, x + 480, y + 72, cw - 516, 19, 28, p, G3);
    g.restore();
  });

  // the cause, overprinted on ink
  const pc = snap(u, 9.0, BEAT);
  if (pc > 0) {
    const y = 796;
    block(g, M, y, (W - 2 * M) * pc, 164, INK);
    g.save();
    g.beginPath();
    g.rect(M, y, (W - 2 * M) * pc, 164);
    g.clip();
    txt(g, 'cause', 'THE CAUSE IS PRODUCTION, NOT EFFORT', M + 40, y + 62, 42, { weight: 600, color: ONINK, trk: -1, p: pc });
    txt(g, 'cause2', 'Events cost months before they earn a dollar, and that is the time that would go into selling.', M + 40, y + 102, 19, { weight: 400, color: G2, p: snap(u, 9.5, E8) });
    txt(g, 'cause3', 'Portland peaked at $239,630 and shut in 2021.', M + 40, y + 134, 19, { weight: 500, color: SIG, p: snap(u, 10.4, E8) });
    g.restore();
  }
}

// ================================================================= 01 THE YEAR
// Fifty-two modules. Two of them earn.
const YC = 13, YR = 4, YW = 121, YH = 88, YGX = 13, YGY = 14;
const yX = c => M + c * (YW + YGX);
const yY = r => 300 + r * (YH + YGY);
const EARN = [37, 38];                      // the two weeks that carry the year

function sYear(g, t) {
  const u = t - S.year[0];
  setCam(g, { x: W / 2, y: H / 2, s: 1 });
  txt(g, 'yearhead', 'FIFTY-TWO WEEKS', M, 236, 54, { weight: 600, trk: -1, p: snap(u, 0.5, E8) });

  for (let i = 0; i < 52; i++) {
    const c = i % YC, r = Math.floor(i / YC);
    const x = yX(c), y = yY(r);
    const pOutline = snap(u, 0.6 + r * E16, E16);
    if (pOutline <= 0) continue;
    g.strokeStyle = G1;
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, YW * pOutline, YH);
    const earn = EARN.includes(i);
    // the costing weeks fill in light grey, ordered across the year; the two earning weeks land black
    const pf = earn ? snap(u, 6.0, BEAT) : snap(u, 2.0 + i * 0.055, E16);
    if (pf > 0) block(g, x, y, YW, YH * pf, earn ? INK : '#E4E1DA');
  }
  const pl = snap(u, 6.4, E8);
  if (pl > 0) {
    const er = Math.floor(EARN[0] / YC), ey = yY(er) + YH;
    rule(g, yX(EARN[0] % YC), ey + 10, YW * 2 + YGX, pl, INK, 2);
    txt(g, 'earnl', 'WE EARN HERE', yX(EARN[0] % YC) + YW + YGX / 2, ey + 40, 17,
      { weight: 600, color: INK, trk: 4, p: pl, align: 'center' });
  }
  caption(g, 'yearnote', 'THE OTHER ELEVEN MONTHS COST MONEY AND RETURN NONE', M, 790, 800, snap(u, 7.4, E8));
}

// ================================================================= 02 WHAT WE ARE GOOD AT
function sAssets(g, t) {
  const u = t - S.assets[0];
  setCam(g, { x: W / 2, y: H / 2, s: 1 });
  txt(g, 'assethead', 'THE THINGS NOBODY ELSE IN ATLANTA CAN DO', M, 236, 54, { weight: 600, trk: -1, p: snap(u, 0.5, E8) });

  const cw = (W - 2 * M - GUT * 4) / 5, cy = 300, ch = 430;
  D.ASSETS.forEach((a, i) => {
    const x = M + i * (cw + GUT);
    const p = snap(u, 1.0 + i * BEAT, E16);
    if (p <= 0) return;
    block(g, x, cy, cw, ch * p, PAPER);
    g.save();
    g.beginPath();
    g.rect(x, cy, cw, ch * p);
    g.clip();
    rule(g, x + 28, cy + 36, 54, p, SIG, 4);
    txt(g, `at${i}`, a.t, x + 28, cy + 92, 25, { weight: 600, trk: -1, p, max: cw - 56 });
    txt(g, `av${i}`, a.v, x + 28, cy + 146, 19, { weight: 600, color: SIG, p, max: cw - 56 });
    wrap(g, `as${i}`, a.s, x + 28, cy + 196, cw - 56, 19, 26, p, G3);
    g.restore();
  });
  caption(g, 'assetnote', 'NOT ONE OF THESE REQUIRES US TO PRODUCE AN EVENT', M, 790, 760, snap(u, 7.0, E8));
}

// Wrapped body copy, reported to readcheck as one piece.
function wrap(g, id, s, x, y, maxW, size, lh, p, color) {
  font(g, size, 400, 0);
  const words = s.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > maxW && line) { lines.push(line); line = w; } else { line = test; }
  }
  if (line) lines.push(line);
  lines.forEach((l, i) => {
    txt(g, `${id}_${i}`, l, x, y + i * lh, size, { weight: 400, color, p, pass: i > 0 });
  });
}

// ================================================================= 03 WHAT GOES, WHAT ARRIVES
// Three produced events are cut away one at a time, and the space re-flows into two things
// that need no production at all.
function sStop(g, t) {
  const u = t - S.stop[0];
  setCam(g, { x: W / 2, y: H / 2, s: 1 });
  txt(g, 'stophead', u < 5.8 ? 'WHAT WE STOP PRODUCING' : 'WHAT HAPPENS INSTEAD', M, 236, 54,
    { weight: 600, trk: -1, p: snap(u, 0.5, E8) });

  const bw = W - 2 * M, bh = 112;
  D.STOPS.forEach((o, i) => {
    const y = 300 + i * (bh + 18);
    const p = snap(u, 1.0 + i * 1.0, E16);
    if (p <= 0) return;
    const k = clamp((u - (5.5 + i * 1.0)) / 0.8);
    knife(g, M, y, bw, bh, k, (yy, hh) => {
      block(g, M, yy, bw * p, hh, INK);
      if (hh < 60) return;
      g.save();
      g.beginPath();
      g.rect(M, yy, bw, hh);
      g.clip();
      txt(g, `pt${i}`, o.t, M + 36, yy + 50, 30, { weight: 600, color: ONINK, trk: -1, p });
      txt(g, `pw${i}`, o.why, M + 36, yy + 86, 19, { weight: 400, color: G2, p });
      g.restore();
    });
    // what happens instead, written in the space the cut leaves
    const pt = clamp((u - (6.1 + i * 1.0)) / 0.6);
    if (pt > 0 && u < 13.9) {
      rule(g, M + 36, y + 40, 420, pt, G2, 1);
      txt(g, `pn${i}`, o.then, M + 36, y + 70, 19, { weight: 500, color: G3, p: pt, max: bw - 72 });
    }
  });

  // the re-flow: two things that need no production
  D.ADDS.forEach((a, i) => {
    const p = snap(u, 14.0 + i * 0.6, E16);
    if (p <= 0) return;
    const y = 320 + i * 170;
    block(g, M, y, bw * p, 146, i === 0 ? SIG : PAPER);
    g.save();
    g.beginPath();
    g.rect(M, y, bw * p, 146);
    g.clip();
    txt(g, `adt${i}`, a.t, M + 36, y + 58, 34, { weight: 600, color: i === 0 ? PAPER : INK, trk: -1, p });
    txt(g, `ads${i}`, a.s, M + 36, y + 102, 19, { weight: 400, color: i === 0 ? ONSIG : G3, p, max: bw - 72 });
    g.restore();
  });
  const pa = snap(u, 13.8, E16);
  if (pa > 0) txt(g, 'addhead', 'AND TWO THINGS WE ADD', M, 280, 19, { weight: 600, color: SIG, trk: 6, p: pa });
  caption(g, 'keep', D.KEEP, M, 700, 760, snap(u, 15.6, E8));
}

// ================================================================= 04 HOW IT GETS PAID FOR
function sMoney(g, t) {
  const u = t - S.money[0];
  setCam(g, { x: W / 2, y: H / 2, s: 1 });
  txt(g, 'moneyhead', 'A NONPROFIT FESTIVAL, SELLING ALL YEAR', M, 236, 54, { weight: 600, trk: -1, p: snap(u, 0.5, E8) });

  const cw = (W - 2 * M - GUT) / 2, cy = 300, ch = 470;
  // the structure
  const p1 = snap(u, 1.0, E16);
  if (p1 > 0) {
    block(g, M, cy, cw, ch * p1, INK);
    g.save();
    g.beginPath();
    g.rect(M, cy, cw, ch * p1);
    g.clip();
    numeral(g, 'struct', D.STRUCTURE.t, M + 36, cy + 110, 86, { color: SIG, p: seg(u, 1.0, 1.8) });
    wrap(g, 'structs', D.STRUCTURE.s, M + 36, cy + 164, cw - 72, 20, 28, p1, ONINK);
    D.STRUCTURE.opens.forEach((o, i) => {
      const p = snap(u, 2.2 + i * E8, E16);
      if (p <= 0) return;
      txt(g, `op${i}`, o, M + 36, cy + 268 + i * 34, 19, { weight: 500, color: G2, p });
    });
    rule(g, M + 36, cy + 408, cw - 72, p1, '#3A3A3A', 1);
    txt(g, 'cost', D.STRUCTURE.cost, M + 36, cy + 442, 19, { weight: 600, color: SIG, trk: 2, p: snap(u, 4.0, E8) });
    g.restore();
  }

  // what we sell, and what has ever sold
  const x2 = M + cw + GUT;
  const p2 = snap(u, 1.5, E16);
  if (p2 > 0) {
    block(g, x2, cy, cw, ch * p2, PAPER);
    g.save();
    g.beginPath();
    g.rect(x2, cy, cw, ch * p2);
    g.clip();
    txt(g, 'sellhead', 'WHAT WE SELL', x2 + 36, cy + 56, 19, { weight: 600, color: G3, trk: 6, p: p2 });
    D.SELL.forEach((s, i) => {
      const p = snap(u, 2.0 + i * E8, E16);
      if (p <= 0) return;
      const y = cy + 110 + i * 56;
      txt(g, `se${i}`, s.t, x2 + 36, y, 21, { weight: 500, p });
      txt(g, `sv${i}`, s.v, x2 + cw - 36, y, 21, { weight: 600, color: SIG, p, align: 'right' });
      rule(g, x2 + 36, y + 18, cw - 72, p, G1, 1);
    });
    // six lines, two of which have ever sold. The deck does not say which two, so neither does this.
    const pm = snap(u, 6.4, E8);
    if (pm > 0) {
      for (let i = 0; i < 6; i++) {
        const bx = x2 + 36 + i * 34, by = cy + 420;
        if (i < 2) block(g, bx, by, 24, 24, SIG);
        else { g.strokeStyle = G2; g.lineWidth = 1; g.strokeRect(bx + 0.5, by + 0.5, 24, 24); }
      }
      txt(g, 'soldn', 'TWO HAVE EVER BEEN SOLD', x2 + 36 + 6 * 34 + 16, cy + 438, 17, { weight: 600, color: SIG, trk: 4, p: pm });
    }
    g.restore();
  }
  caption(g, 'sellnote', 'EVERY FESTIVAL WE COMPARED OURSELVES AGAINST IS A 501(C)(3)', M, 820, 860, snap(u, 6.6, E8));
}

// ================================================================= 05 THE ASK
function sAsk(g, t) {
  const u = t - S.ask[0];
  setCam(g, { x: W / 2, y: H / 2, s: 1 });
  txt(g, 'askhead', 'FIVE DECISIONS, AND WHEN EACH ONE IS NEEDED', M, 236, 54, { weight: 600, trk: -1, p: snap(u, 0.5, E8) });

  const bw = W - 2 * M, bh = 86;
  D.DECISIONS.forEach((d, i) => {
    const y = 300 + i * (bh + 14);
    const p = snap(u, 1.0 + i * BEAT, E16);
    if (p <= 0) return;
    block(g, M, y, bw * p, bh, PAPER);
    g.save();
    g.beginPath();
    g.rect(M, y, bw * p, bh);
    g.clip();
    txt(g, `dn${i}`, String(i + 1).padStart(2, '0'), M + 32, y + 54, 20, { weight: 600, color: SIG, trk: 6, p });
    txt(g, `dt${i}`, d.t, M + 110, y + 56, 30, { weight: 500, trk: -1, p, max: bw - 460 });
    const cwid = 236;
    block(g, M + bw - cwid - 24, y + 18, cwid, 50, d.by === 'TWO WEEKS' ? INK : SIG);
    txt(g, `db${i}`, d.by, M + bw - cwid / 2 - 24, y + 50, 20, { weight: 600, color: PAPER, trk: 4, p, align: 'center' });
    g.restore();
  });
  caption(g, 'asknote', 'DOING NOTHING IS ALSO A DECISION: ANOTHER YEAR OF PRODUCING EVENTS THAT LOSE MONEY', M, 810, 1200, snap(u, 7.0, E8));
}

// ================================================================= END
// The sentence returns, with the word still gone.
function sEnd(g, t) {
  const u = t - S.end[0];
  setCam(g, { x: W / 2, y: H / 2, s: 1 });
  const SIZE = 104, Y = 480;
  const wPre = width(g, 'A FESTIVAL ', SIZE, 600, -2);

  // the decisions are cut away first, nearest the top first
  D.DECISIONS.forEach((d, i) => {
    const k = clamp((u - (0.2 + i * 0.16)) / 0.6);
    const y = 300 + i * 100, bh = 86;
    knife(g, M, y, W - 2 * M, bh, k, (yy, hh) => {
      block(g, M, yy, W - 2 * M, hh, PAPER);
    });
  });

  const p = snap(u, 2.6, BEAT);
  if (p > 0) {
    txt(g, 'end1', 'A FESTIVAL', M, Y, SIZE, { weight: 600, trk: -2, p });
    txt(g, 'end2', 'CONVENES.', M + wPre, Y, SIZE, { weight: 600, color: SIG, trk: -2, p: snap(u, 3.0, E8) });
    rule(g, M, Y + 46, (W - 2 * M) * clamp(seg(u, 3.0, 4.0) - seg(u, 7.6, 8.0)), 1, INK, 3);
  }
  txt(g, 'end3', '2027 IS THE TWENTIETH YEAR', M, 630, 30, { weight: 600, color: SIG, trk: 2, p: snap(u, 4.4, E8) });
  caption(g, 'end4', 'THE LAST EASY MOMENT TO CHANGE WHAT THIS IS', M, 700, 700, snap(u, 4.0, E8));
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
    thesis: sThesis, state: sState, year: sYear, assets: sAssets,
    stop: sStop, money: sMoney, ask: sAsk, end: sEnd,
  })[sec](g, t);

  technical(g, t, SECN[sec]);
  g.setTransform(1, 0, 0, 1, 0, 0);
  return COLLECT;
}

// ================================================================= sound events
export function buildEvents() {
  const ev = [];
  const at = (t, type, o = {}) => ev.push({ t: Math.round(t * 1000) / 1000, type, ...o });

  at(0.3, 'pen');
  at(1.6, 'clack', { g: 1.0 });
  at(2.4, 'clack', { g: 0.9 });
  at(4.5, 'knife', { g: 1.1 });          // the word is cut out of the sentence
  at(5.1, 'thump', { g: 0.8 });
  at(5.6, 'stamp', { g: 1.1 });          // and replaced
  at(6.6, 'clack', { g: 0.6 });

  for (let i = 0; i < 4; i++) at(11.5 + i * BEAT, 'snap', { g: 0.9 });
  for (let i = 0; i < 4; i++) at(11.6 + i * BEAT, 'thunk', { g: 0.5 });
  at(20.0, 'slide', { g: 1.0 });
  at(21.4, 'clack', { g: 0.6 });

  at(27.5, 'pen', { g: 0.7 });
  for (let i = 0; i < 50; i++) at(29.0 + i * 0.055, 'snap', { g: 0.18 });
  at(33.0, 'thump', { g: 1.0 });
  at(34.4, 'clack', { g: 0.7 });

  for (let i = 0; i < 5; i++) at(40.0 + i * BEAT, 'stamp', { g: 0.8 });
  at(46.0, 'clack', { g: 0.6 });

  for (let i = 0; i < 3; i++) at(54.0 + i * BEAT, 'snap', { g: 0.9 });
  for (let i = 0; i < 3; i++) { at(58.5 + i, 'knife', { g: 1.1 }); at(58.75 + i, 'thump', { g: 0.7 }); }
  at(67.0, 'stamp', { g: 1.1 });
  at(67.6, 'stamp', { g: 1.0 });
  at(68.6, 'clack', { g: 0.6 });

  at(75.0, 'slide', { g: 0.9 });
  for (let i = 0; i < 6; i++) at(76.0 + i * 0.25, 'snap', { g: 0.5 });
  at(80.4, 'clack', { g: 0.8 });

  for (let i = 0; i < 5; i++) { at(87.0 + i * BEAT, 'snap', { g: 0.9 }); at(87.1 + i * BEAT, 'stamp', { g: 0.6 }); }
  at(93.0, 'carriage', { g: 0.8 });

  for (let i = 0; i < 5; i++) at(100.2 + i * 0.16, 'knife', { g: 0.6 });
  at(102.6, 'thunk', { g: 1.1 });
  at(103.0, 'stamp', { g: 1.0 });
  at(107.4, 'pen', { g: 0.8 });

  return ev.sort((a, b) => a.t - b.t);
}
