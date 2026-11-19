// The Quarter — 60s Spy Title Sequence.
// A courier carries one package through the four things a sponsor buys: the list, the inbox,
// the network, the guide. Then the price stops the music, and the pieces assemble the title.

import {
  W, H, C, S, g, clear, piece, rough, roughC, rectP, circP, ellP, arcP, smooth, xf,
  paperFinish, curScale, silhouette, label,
} from './paper.js';
import { loadFonts, layout, drawLine } from './glyph.js';
import { courierSide, walkPose, coRunPose, COURIER_POSE } from './chars.js';
import { drawTitle, titleBox, CUT_ANG } from './cuttitle.js';
import * as T from './story.js';
import { hash, vnoise, clamp, lerp } from '/core/lib.js';

export const DUR = T.DUR;
export { loadFonts };

const seg = (t, a, b) => (b === a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a), 0, 1));
const eo = t => 1 - Math.pow(1 - t, 3);
const ei = t => t * t * t;
// Credits stop dead on the beat: a short ease-out landing, never a drift.
const land = (t, t1, d = T.BEAT) => eo(seg(t, t1 - d, t1));
// Puppets act on twos; the camera runs on ones.
const twos = t => Math.floor(t * 12) / 12;

let COLLECT = null;
function note(id, text, x, y, size, pass, w) {
  if (!COLLECT) return;
  const wdt = w || size * text.length * 0.5;
  COLLECT.push({ id, text, x0: x, y0: y - size * 0.78, x1: x + wdt, y1: y + size * 0.26, ...(pass ? { pass: true } : {}) });
}

// ---------------------------------------------------------------- credit lines
// A credit line is the set: it is architecture, not a caption.
function credit(str, x, y, size, col, t, t1, opt = {}) {
  const p = land(t, t1);
  if (p <= 0) return null;
  const lay = layout(str, size, { track: opt.track ?? 0.06 });
  const dx = (1 - p) * -(opt.from ?? 520);
  drawLine(lay, x + dx, y, {
    col, seed: opt.seed ?? 7, jit: 1.1, amp: 1.7, gap: opt.gap, shadow: opt.shadow,
    each: (L, i) => ({ dy: (1 - land(t, t1 + i * 0.012)) * 6 }),
  });
  note(opt.id || str.slice(0, 8), str, x + dx, y, size, opt.pass);
  return lay;
}

// ---------------------------------------------------------------- the package
// The object of the chase, on a black backing so it reads on any ground.
function packageP() {
  return roughC('pkg', () => rectP(-54, -38, 108, 76), 31, 1.8, 9);
}
function packageBack() {
  return roughC('pkgb', () => rectP(-62, -46, 124, 92), 32, 2.0, 9);
}
function pkg(x, y, s = 1, rot = 0, opt = {}) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.scale(s, s);
  piece(packageBack(), C.ink, { shadow: true });
  piece(packageP(), C.red, { gap: 0, shadow: false });
  // the band across it, in the secondary ink
  piece(roughC('pkgband', () => rectP(-54, -8, 108, 16), 33, 1.2, 9), C.mus, { gap: 0, shadow: false });
  g.restore();
}

// ================================================================= 01 THE ASSIGNMENT
function sAssign(g2, t) {
  clear(C.paper);
  const u = t - T.SEC.assign;

  // a hand enters from the left and sets the package down on the stab at bar 2
  const landT = T.bar(2);
  const inP = eo(seg(t, 0.35, landT));
  const px = lerp(-300, 1360, inP), py = lerp(600, 690, inP);
  if (t < landT + 0.5) {
    const hx = px - 300 + 300 * seg(t, landT, landT + 0.5);
    g.save();
    g.translate(hx, py + 20);
    g.scale(1.5, 1.5);
    piece(roughC('hand', () => [[-230, -26], [-40, -34], [8, -14], [10, 16], [-44, 28], [-230, 22]], 41, 1.6, 10), C.ink, { shadow: true });
    g.restore();
  }
  pkg(px, py, 3.0, (1 - inP) * -0.22);

  // the assignment, read wide before anything moves
  credit('ATLANTA DESIGN FESTIVAL', 150, 300, 118, C.ink, t, T.bar(3), { id: 'c-adf', seed: 11 });
  credit('INDUSTRY RESOURCES 2027', 150, 392, 60, C.red, t, T.bar(3) + T.BEAT * 2, { id: 'c-ir', seed: 12, from: 380 });
  if (t >= T.bar(4.5)) {
    credit('ONE SPONSOR A QUARTER', 150, 760, 44, C.ink, t, T.bar(4.5), { id: 'c-one', seed: 13, from: 300 });
  }

  // the courier walks in from the right and takes it
  if (t >= T.bar(5)) {
    const wp = seg(t, T.bar(5), T.bar(6.6));
    const cx = lerp(2100, 760, eo(wp));
    const ph = twos(t) * 2.3;
    courierSide(cx, 860, 0.62, walkPose(ph % 1, { flip: true }), { flip: true, noKey: true });
  }
}

// ================================================================= 02 THE LIST
// A column of type, descended. The names are the stairs.
const ROLES = ['ARCHITECTS', 'SPECIFIERS', 'INTERIOR DESIGNERS', 'SHOWROOMS', 'BUILDERS',
  'CONTRACTORS', 'DEALERS AND REPS', 'PRESS AND EDITORS', 'STYLISTS', 'BUYERS',
  'ARCHITECTS', 'SPECIFIERS', 'INTERIOR DESIGNERS', 'SHOWROOMS'];
const ROW = 190;

function sList(g2, t) {
  clear(C.ink);
  const u = t - T.SEC.list;
  // the camera pans down the column on ones
  const pan = eo(seg(u, 0.2, 7.2)) * (ROLES.length - 3.2) * ROW;

  g.save();
  g.translate(0, -pan);
  ROLES.forEach((r, i) => {
    const y = 300 + i * ROW;
    const t1 = T.SEC.list + 0.1 + i * 0.10;
    if (t < t1) return;
    const lay = layout(r, 96, { track: 0.05 });
    drawLine(lay, 150, y, { col: i % 3 === 1 ? C.paperD : C.paper, seed: 40 + i, jit: 1.2, amp: 1.8 });
    if (i === 0) note('c-list', r, 150, y, 96, true);
    // the tread the courier walks on
    piece(roughC('tread' + i, () => rectP(120, 24, 1500, 12), 60 + i, 1.1, 12), C.inkL, { gap: 0, shadow: false, force: true });
  });
  g.restore();

  // the courier walks down the column, one step a beat
  const ph = twos(t) * 2.4;
  if (u > 0.4) {
    courierSide(1230, 726, 0.56, walkPose(ph % 1), { noKey: true });
    pkg(1322, 560 + Math.sin(twos(t) * 7) * 5, 0.46, 0.06);
  }

  // the number the column adds up to
  if (t >= T.bar(11)) {
    const lay = layout('8,911', 300, { track: 0.03 });
    const p = land(t, T.bar(11) + 0.3);
    drawLine(lay, 980, 940, {
      col: C.mus, seed: 77, jit: 1.4, amp: 2.4, shadow: true,
      each: (L, i) => ({ dy: (1 - land(t, T.bar(11) + 0.2 + i * T.BEAT * 0.5)) * -90, hide: t < T.bar(11) + i * T.BEAT * 0.5 }),
    });
    note('c-8911', '8,911', 980, 940, 300);
    if (t >= T.bar(12)) credit('ON THE LIST', 980, 1010, 46, C.paper, t, T.bar(12), { id: 'c-onlist', from: 220 });
  }
}

// ================================================================= 03 THE INBOX
// Push into the O of OPEN until the letter is the room.
function sInbox(g2, t) {
  const u = t - T.SEC.inbox;
  const push = eo(seg(u, 2.2, 4.2));
  const flip = u >= 4.2;
  clear(flip ? C.mus : C.ink);

  if (!flip) {
    // the word, then the camera into its O
    const size = 520;
    const lay = layout('OPEN', size, { track: 0.02 });
    const O = lay.letters[0];
    const ox = 330 + O.x + (O.x0 + O.x1) / 2, oy = 760 - size * 0.37;
    const sc = lerp(1, 13, push);
    g.save();
    g.translate(W / 2, H / 2);
    g.scale(sc, sc);
    g.translate(-ox, -oy);
    drawLine(lay, 330, 760, { col: C.paper, seed: 88, jit: 1.0, amp: 2.2 });
    if (push < 0.3) {
      const l2 = layout('39%', 200, { track: 0.03 });
      drawLine(l2, 330, 330, { col: C.mus, seed: 89, jit: 1.1, amp: 2.0 });
    }
    g.restore();
    // the counter of the O opens in the room's own ink, so the push lands straight inside it
    if (push > 0.72) {
      const r = eo(seg(push, 0.72, 1.0)) * 1500;
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.translate(W / 2, H / 2);
      g.scale(r / 100, r / 100);
      piece(roughC('counter', () => circP(0, 0, 100, 64), 95, 2.2, 10), C.mus, { gap: 0, shadow: false });
      g.restore();
    }
    if (u < 2.2) note('c-open', '39% OPEN', 330, 760, size, false, lay.width);

  } else {
    // inside: the room is the O, one edition on the table
    const v = u - 4.2;
    g.save();
    g.translate(W / 2, H / 2 + 40);
    piece(roughC('room', () => circP(0, 0, 520, 72), 91, 2.6, 10), C.musD, { gap: 0, shadow: false });
    g.restore();
    // the table
    piece(roughC('table', () => rectP(520, 700, 880, 30), 92, 1.6, 11), C.ink, { shadow: true });
    // the edition, landing on the beat
    const lp = land(t, T.SEC.inbox + 4.9);
    if (lp > 0) {
      g.save();
      g.translate(960, 700 - 40 * lp);
      g.scale(1, lp);
      piece(roughC('edi', () => rectP(-150, -190, 300, 200), 93, 2.0, 9), C.paper, { shadow: true });
      piece(roughC('edih', () => rectP(-150, -190, 300, 44), 94, 1.4, 9), C.ink, { gap: 0, shadow: false });
      g.restore();
    }
    if (t >= T.SEC.inbox + 5.3) {
      credit('ONE EDITION', 150, 300, 110, C.ink, t, T.SEC.inbox + 5.3, { id: 'c-edition' });
      credit('YOUR SUBJECT. NOBODY ELSE IN IT.', 150, 372, 46, C.red, t, T.SEC.inbox + 5.9, { id: 'c-subject', from: 300 });
      credit('19% CLICK   0.2% UNSUBSCRIBE', 150, 1000, 44, C.redD, t, T.SEC.inbox + 6.4, { id: 'c-click', from: 260 });
    }
    // the courier sets the package on the table
    const ph = twos(t) * 2.2;
    const wp = seg(t, T.SEC.inbox + 4.2, T.SEC.inbox + 6.0);
    const cx2 = lerp(2050, 1320, eo(wp));
    courierSide(cx2, 760, 0.56, walkPose(ph % 1, { flip: true }), { flip: true, noKey: true });
    if (wp < 1) pkg(cx2 - 96, 600, 0.5, -0.05);
    if (wp >= 1) pkg(1105, 640, 1.05, 0.05);
  }
}

// ================================================================= 04 THE NETWORK
// Three sites as three buildings of type, passed in one direction.
const SITES = ['FESTIVAL', 'TOURS', 'JOURNAL'];

function sNet(g2, t) {
  clear(C.mus);
  const u = t - T.SEC.net;
  const track = eo(seg(u, 0.1, 6.4)) * 1680;

  g.save();
  g.translate(-track, 0);
  SITES.forEach((s, i) => {
    const x = 760 + i * 820;
    // the building is the word, set vertically
    for (let j = 0; j < s.length; j++) {
      const lay = layout(s[j], 112, { track: 0 });
      drawLine(lay, x, 290 + j * 98, { col: C.ink, seed: 120 + i * 9 + j, jit: 1.3, amp: 1.9 });
    }
    if (i === 0) note('c-sites', 'FESTIVAL TOURS JOURNAL', 420, 300, 150, true);
    // banners as lit windows, landing on beats
    for (let k = 0; k < 3; k++) {
      const t1 = T.SEC.net + 1.0 + (i * 3 + k) * T.BEAT * 0.8;
      if (t < t1) continue;
      const p = land(t, t1);
      g.save();
      g.translate(x + 250, 320 + k * 170);
      g.scale(p, p);
      piece(roughC(`ban${i}${k}`, () => rectP(0, 0, 200, 62), 130 + i * 3 + k, 1.5, 10), C.red, { shadow: true });
      g.restore();
    }
  });
  g.restore();

  // the courier runs the length of it
  const rp = seg(u, 0.3, 6.2);
  const ph = twos(t) * 3.4;
  const rx = lerp(-200, 2180, rp);
  courierSide(rx, 940, 0.6, coRunPose(ph % 1), { noKey: true });
  pkg(rx - 110, 700 + Math.sin(twos(t) * 9) * 8, 0.5, -0.12);

  credit('THREE SITES', 150, 1000, 86, C.ink, t, T.SEC.net + 0.6, { id: 'c-three' });
  if (t >= T.SEC.net + 4.0) credit('A FULL QUARTER OF DISPLAY', 620, 1000, 46, C.redD, t, T.SEC.net + 4.0, { id: 'c-quarterdisp', from: 240 });
}

// ================================================================= 05 THE GUIDE
// A graphic match: the last building becomes the page that stays standing.
function sGuide(g2, t) {
  clear(C.paper);
  const u = t - T.SEC.guide;
  // the page, same rectangle and position the last banner left
  const rise = eo(seg(u, 0, 0.9));
  g.save();
  g.translate(960, 560);
  g.scale(lerp(1.0, 1.0, rise), 1);
  piece(roughC('page', () => rectP(-250, -330, 500, 660), 150, 2.2, 10), C.paperD, { shadow: true });
  piece(roughC('pagehead', () => rectP(-250, -330, 500, 86), 151, 1.6, 10), C.ink, { gap: 0, shadow: false });
  for (let i = 0; i < 7; i++) {
    const t1 = T.SEC.guide + 1.0 + i * T.BEAT * 0.5;
    if (t < t1) continue;
    const w = 380 - (i % 3) * 70;
    piece(roughC('pl' + i, () => rectP(-200, -200 + i * 62, w, 20), 152 + i, 1.1, 11), C.inkL, { gap: 0, shadow: false });
  }
  g.restore();

  // every link points at it; the arrows land one a beat
  for (let i = 0; i < 5; i++) {
    const t1 = T.SEC.guide + 2.0 + i * T.BEAT;
    if (t < t1) continue;
    const p = land(t, t1);
    const a = -2.5 + i * 1.25;
    const r = lerp(900, 330, p);
    const ax = 960 + Math.cos(a) * r, ay = 560 + Math.sin(a) * r;
    g.save();
    g.translate(ax, ay);
    g.rotate(a + Math.PI);
    piece(roughC('arr' + i, () => [[0, -16], [66, 0], [0, 16], [16, 0]], 160 + i, 1.3, 9), C.red, { shadow: true });
    g.restore();
  }

  credit('THE GUIDE', 150, 258, 110, C.ink, t, T.SEC.guide + 0.5, { id: 'c-guide' });
  if (t >= T.SEC.guide + 3.4) credit('IT KEEPS WORKING AFTER THE QUARTER CLOSES', 150, 352, 42, C.red, t, T.SEC.guide + 3.4, { id: 'c-keeps', from: 280 });
}

// ================================================================= 06 STOP-TIME, THEN THE PRICE
function sPrice(g2, t) {
  // the picture freezes on the stab and holds in silence
  if (t < T.FREEZE.t1) { sGuide(g2, T.FREEZE.t0 - 0.001); return; }
  clear(C.ink);
  const u = t - T.FREEZE.t1;
  const lay = layout('$2,500', 360, { track: 0.02 });
  drawLine(lay, 150, 620, {
    col: C.mus, seed: 200, jit: 1.5, amp: 2.6, shadow: true,
    each: (L, i) => ({ hide: u < i * 0.06, dy: (1 - land(t, T.FREEZE.t1 + i * 0.06 + 0.12)) * -40 }),
  });
  note('c-price', '$2,500', 150, 620, 360);
  if (u > 0.8) credit('FOUR SLOTS A YEAR', 150, 740, 64, C.paper, t, T.FREEZE.t1 + 0.8, { id: 'c-four' });
  if (u > 1.6) credit('THE 2027 RATE. IT RISES IN 2028.', 150, 812, 40, C.red, t, T.FREEZE.t1 + 1.6, { id: 'c-rate', from: 240 });
}

// ================================================================= 07 THE HAND-OFF
function sHand(g2, t) {
  clear(C.red);
  const u = t - T.SEC.hand;
  // the circle rises behind the figure
  const rise = eo(seg(u, 0.2, 1.6));
  g.save();
  g.translate(960, 760 - rise * 300);
  piece(roughC('bigcirc', () => circP(0, 0, 420, 90), 210, 2.8, 11), C.paper, { gap: 0, shadow: true });
  g.restore();

  const ph = twos(t) * 2.0;
  const wp = seg(u, 0.1, 1.8);
  const cx = lerp(2050, 1060, eo(wp));
  courierSide(cx, 980, 0.72, wp < 1 ? walkPose(ph % 1, { flip: true }) : COURIER_POSE.stand, { flip: true, noKey: true });
  if (u < 1.9) pkg(cx - 120, 740, 0.62, -0.06);
  // the package is set down
  if (u >= 1.9) {
    const dp = eo(seg(u, 1.9, 2.5));
    pkg(900, lerp(700, 940, dp), 1.0, 0);
  }
  if (u > 2.6) credit('ONE SPONSOR. ONE QUARTER.', 150, 250, 86, C.ink, t, T.SEC.hand + 2.6, { id: 'c-onesponsor' });
}

// ================================================================= 08 THE TITLE
function sTitle(g2, t) {
  clear(C.paper);
  const u = t - T.SEC.title;
  const box = titleBox(210);
  const x0 = (W - box.w) / 2, y0 = (H - box.h) / 2 - 40;
  // the pieces fly back along the diagonal and stop dead, one after another
  drawTitle(x0, y0, 210, {
    col: C.ink,
    each: (l, i, n) => {
      const t1 = T.SEC.title + 0.25 + i * 0.09;
      const p = land(t, t1, T.BEAT * 0.9);
      const d = (1 - p) * 1500 * (i % 2 ? 1 : -1);
      return { dx: Math.cos(CUT_ANG) * d, dy: Math.sin(CUT_ANG) * d, rot: (1 - p) * 0.25 * (i % 2 ? 1 : -1) };
    },
  });
  note('c-title', 'THE QUARTER', x0, y0 + box.h, 210);

  // the package, set into the title as the last piece
  if (u > 1.6) pkg(x0 + box.w + 90, y0 + box.h - 70, 0.78 * land(t, T.SEC.title + 1.7), 0.08);

  if (u > 2.2) {
    credit('INDUSTRY RESOURCES 2027', 150, 980, 54, C.red, t, T.SEC.title + 2.2, { id: 'c-ir2', from: 300 });
    credit('ATLANTADESIGNFESTIVAL.ORG', W - 740, 980, 40, C.ink, t, T.SEC.title + 2.6, { id: 'c-url', from: 220, pass: true });
  }
}

// ---------------------------------------------------------------- subtitles
// A narrow scissor-cut paper strip, bottom left, sliding in from the left.
function subs(t) {
  const cue = T.VO.find(v => t >= v.t - 0.12 && t < v.t + v.hold);
  if (!cue) return;
  const p = eo(seg(t, cue.t - 0.12, cue.t + 0.06));
  const dark = ['list', 'inbox', 'price'].includes(T.secAt(t)) || T.secAt(t) === 'hand';
  const strip = dark ? C.paper : C.ink;
  const ink = dark ? C.ink : C.paper;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.translate(lerp(-900, 110, p), 968);
  g.rotate(-0.012);
  const wdt = 34 + cue.sub.length * 20.5;
  piece(roughC('strip' + cue.id, () => rectP(0, 0, wdt, 74), 300, 2.0, 11), strip, { gap: 0, shadow: true });
  piece(roughC('bullet' + cue.id, () => rectP(22, 30, 16, 16), 301, 1.0, 8), dark ? C.red : C.red, { gap: 0, shadow: false });
  label(cue.sub, 56, 50, '600 40px LSpartan', ink);
  g.restore();
  if (COLLECT) COLLECT.push({ id: 'sub', text: cue.sub, x0: 110, y0: 968, x1: 110 + wdt, y1: 1042 });
}

// ---------------------------------------------------------------- frame
const SCENES = {
  assign: sAssign, list: sList, inbox: sInbox, net: sNet,
  guide: sGuide, price: sPrice, hand: sHand, title: sTitle,
};

export function renderFilm(ctx, t, opt = {}) {
  COLLECT = opt.collect ? [] : null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  SCENES[T.secAt(t)](ctx, t);
  if (!opt.nosub) subs(t);
  paperFinish(1);
  return COLLECT;
}

// ---------------------------------------------------------------- sound events
export function buildEvents() {
  const ev = [];
  const at = (t, type, o = {}) => ev.push({ t: Math.round(t * 1000) / 1000, type, ...o });

  T.STABS.forEach(s => at(s, 'stab', { g: 1.0 }));
  at(T.bar(2), 'slap', { g: 1.0 });                       // the package lands
  at(T.bar(3), 'cardslide', { g: 0.9 });
  at(T.bar(3) + T.BEAT * 2, 'cardslide', { g: 0.7 });
  at(T.bar(4.5), 'cardslide', { g: 0.7 });

  for (let i = 0; i < 14; i++) at(T.SEC.list + 0.6 + i * T.BEAT, 'step', { g: 0.6 });
  for (let i = 0; i < 5; i++) at(T.bar(11) + 0.2 + i * T.BEAT * 0.5, 'slap', { g: 0.8 });

  at(T.SEC.inbox + 0.1, 'tape', { g: 0.8 });
  at(T.SEC.inbox + 4.2, 'blind', { g: 0.9 });
  at(T.SEC.inbox + 4.9, 'slap', { g: 0.9 });
  at(T.SEC.inbox + 5.3, 'cardslide', { g: 0.7 });
  at(T.SEC.inbox + 6.4, 'cardslide', { g: 0.6 });

  for (let i = 0; i < 9; i++) at(T.SEC.net + 0.8 + i * T.BEAT, 'slap', { g: 0.55 });
  at(T.SEC.net + 0.3, 'shake', { g: 0.8 });

  for (let i = 0; i < 5; i++) at(T.SEC.guide + 2.0 + i * T.BEAT, 'tick', { g: 0.8 });
  at(T.SEC.guide + 0.2, 'settle', { g: 0.8 });

  at(T.FREEZE.t0 + 0.35, 'tape', { g: 0.5 });             // the only sound in the stop-time
  for (let i = 0; i < 6; i++) at(T.FREEZE.t1 + i * 0.06, 'slap', { g: 0.5 });

  at(T.SEC.hand + 2.1, 'slap', { g: 1.0 });
  for (let i = 0; i < 10; i++) at(T.SEC.title + 0.25 + i * 0.09, 'slap', { g: 0.75 });
  at(T.SEC.title + 2.2, 'cardslide', { g: 0.8 });
  at(T.END - 1.2, 'crash', { g: 1.0 });

  return ev.sort((a, b) => a.t - b.t);
}
