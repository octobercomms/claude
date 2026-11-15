// Where the Year Goes — Visual Investigation.
// One question: why is the pipeline empty every spring? The sources are the festival's own two
// decks and the trading figures inside them, laid on one calendar until they meet.

const W = 1920, H = 1080, M = 60;
const GROUND = '#0B0C0E', PANEL = '#141619', LINE = '#2E3238';
const TEXT = '#ECEAE4', TEXT2 = '#8B9097', TICK = '#4A4F57', RED = '#FF4A2E';
const PAPER = '#E4E0D4', PAPERINK = '#1D1D1B';
const GRADE_PAPER = 'grayscale(1) contrast(1.05) brightness(0.86)';
// The decks mix dark and light slides. Dark pages are lifted so they read as evidence
// rather than as a black hole; light pages are pressed down, as the style asks.
const GRADE_DARK = 'grayscale(1) contrast(1.12) brightness(1.9)';
const DARKPAGE = { b1: 1, b2: 1, a18: 1 };
const gradeOf = k => (DARKPAGE[k] ? GRADE_DARK : GRADE_PAPER);

let FILM = null, IMG = {}, COLLECT = null;
export function setFilm(f) { FILM = f; }
export function setImages(i) { IMG = i; }

const sec = id => FILM.sections.find(s => s.id === id);
const cue = id => FILM.cues.find(c => c.id === id);
const cT = id => cue(id).t0;

// ---------------------------------------------------------------- maths
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => (b === a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));
const easeOut = t => 1 - Math.pow(1 - t, 3);
// Elements cut in: a hard appearance with a 3-4 frame white flash, never a fade.
const cutIn = (t, t0) => (t >= t0 ? 1 : 0);
const flash = (t, t0) => (t >= t0 && t < t0 + 4 / 30 ? 1 - (t - t0) / (4 / 30) : 0);

function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let z = Math.imul(a ^ (a >>> 15), 1 | a);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- grain
let GRAIN = null;
function grainTiles() {
  if (GRAIN) return GRAIN;
  const rnd = mulberry(7261);
  GRAIN = [];
  for (let k = 0; k < 6; k++) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d');
    const d = x.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) {
      // Box-Muller, so the grain is Gaussian rather than flat
      const u = Math.max(1e-6, rnd()), v = rnd();
      const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      const g = clamp(128 + n * 34, 0, 255);
      d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = g;
      d.data[i * 4 + 3] = 255;
    }
    x.putImageData(d, 0, 0);
    GRAIN.push(c);
  }
  return GRAIN;
}

// One grain for everything, rotated per frame, over sources only, never over type.
function grain(g, x, y, w, h, t, alpha) {
  const tiles = grainTiles();
  const f = Math.round(t * 30);
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = alpha;
  const tile = tiles[f % 6], rot = ((f * 90) % 360) * Math.PI / 180;
  for (let iy = 0; iy < Math.ceil(h / 256) + 1; iy++) {
    for (let ix = 0; ix < Math.ceil(w / 256) + 1; ix++) {
      g.save();
      g.translate(x + ix * 256 + 128, y + iy * 256 + 128);
      g.rotate(rot);
      g.drawImage(tile, -128, -128);
      g.restore();
    }
  }
  g.restore();
}

// ---------------------------------------------------------------- type
function font(g, fam, size, weight = 400, italic = false) {
  g.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${fam}`;
  g.letterSpacing = '0px';
}

function pushText(g, id, s, x, y, size, align, pass) {
  if (!COLLECT) return;
  const m = g.getTransform();
  const wdt = g.measureText(s).width;
  const x0 = align === 'center' ? x - wdt / 2 : align === 'right' ? x - wdt : x;
  const pts = [[x0, y - size * 0.8], [x0 + wdt, y - size * 0.8], [x0, y + size * 0.25], [x0 + wdt, y + size * 0.25]]
    .map(([px, py]) => [m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f]);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  COLLECT.push({ id, text: s, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys), ...(pass ? { pass: true } : {}) });
}

function heading(g, id, s, x, y, size = 54, { color = TEXT, align = 'left', p = 1, max = 0 } = {}) {
  if (!p) return;
  let z = size;
  if (max) { for (; z > 20; z -= 1) { font(g, 'Archivo', z, 700); if (g.measureText(s).width <= max) break; } }
  font(g, 'Archivo', z, 700);
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  g.fillText(s, x, y);
  pushText(g, id, s, x, y, z, align, false);
}

function mono(g, id, s, x, y, size = 17, { color = TEXT2, weight = 400, align = 'left', p = 1, pass = true, track = 0.06 } = {}) {
  if (!p) return;
  font(g, 'PlexMono', size, weight);
  g.letterSpacing = `${size * track}px`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  g.fillText(s, x, y);
  pushText(g, id, s, x, y, size, align, pass);
  g.letterSpacing = '0px';
}

function body(g, id, s, x, y, maxW, size = 22, { color = TEXT, lh = 32, p = 1, weight = 400 } = {}) {
  if (!p) return y;
  font(g, 'Archivo', size, weight);
  const words = s.split(' ');
  let line = '', n = 0;
  g.fillStyle = color;
  g.textAlign = 'left';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > maxW && line) {
      g.fillText(line, x, y + n * lh);
      pushText(g, `${id}_${n}`, line, x, y + n * lh, size, 'left', n > 0);
      n++; line = w;
    } else line = test;
  }
  if (line) { g.fillText(line, x, y + n * lh); pushText(g, `${id}_${n}`, line, x, y + n * lh, size, 'left', n > 0); n++; }
  return y + n * lh;
}

// The quoted original, in serif italic, as it reads on the page it came from.
function quote(g, id, s, x, y, maxW, size = 27, { p = 1, hp = 0, ink = TEXT } = {}) {
  if (!p) return y;
  font(g, 'SourceSerif', size, 400, true);
  const words = s.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  const lh = size * 1.42;
  lines.forEach((l, i) => {
    const ly = y + i * lh;
    if (hp > 0) {
      // the decisive line highlighted: red, multiply, wiped left to right
      const wdt = g.measureText(l).width;
      const per = clamp((hp * lines.length) - i);
      if (per > 0) {
        g.save();
        g.globalCompositeOperation = 'multiply';
        g.globalAlpha = 0.6;
        g.fillStyle = RED;
        g.fillRect(x - 4, ly - size * 0.86, (wdt + 8) * per, size * 1.2);
        g.restore();
      }
    }
    font(g, 'SourceSerif', size, 400, true);
    g.fillStyle = ink;
    g.textAlign = 'left';
    g.fillText(l, x, ly);
    pushText(g, `${id}_${i}`, l, x, ly, size, 'left', i > 0);
  });
  return y + lines.length * lh;
}

// ---------------------------------------------------------------- marks
function panel(g, x, y, w, h, { fill = PANEL, stroke = LINE } = {}) {
  g.fillStyle = fill;
  g.fillRect(x, y, w, h);
  g.strokeStyle = stroke;
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

// A 6x12 chip plus `type · source`, sitting just above its frame.
function tag(g, id, x, y, s, { color = RED, text = TEXT2 } = {}) {
  g.fillStyle = color;
  g.fillRect(x, y - 10, 6, 12);
  mono(g, id, s, x + 13, y, 15, { color: text, weight: 600, track: 0.08 });
}

// cover-fit an image into a panel; returns the source → screen mapping
function cover(g, im, x, y, w, h, zoom = 1) {
  const s = Math.max(w / im.width, h / im.height) * zoom;
  const dw = im.width * s, dh = im.height * s;
  const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
  g.drawImage(im, dx, dy, dw, dh);
  return { dx, dy, s, map: (sx, sy) => [dx + sx * s, dy + sy * s] };
}

// An evidence frame: graded, grained, hard-edged, with a white flash on the cut.
function plate(g, key, x, y, w, h, t, t0, { zoom = 1, grade = null, alpha = 0.10, focus = null } = {}) {
  grade = grade || gradeOf(key);
  if (t < t0) return null;
  const im = IMG[key];
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = '#000';
  g.fillRect(x, y, w, h);
  let m = null;
  if (im) {
    g.filter = grade;
    if (focus) {
      // show one region of the page, scaled to the panel
      const s = Math.max(w / focus.w, h / focus.h) * zoom;
      const dx = x + w / 2 - (focus.x + focus.w / 2) * s;
      const dy = y + h / 2 - (focus.y + focus.h / 2) * s;
      g.drawImage(im, dx, dy, im.width * s, im.height * s);
      m = { map: (sx, sy) => [dx + sx * s, dy + sy * s], s };
    } else {
      m = cover(g, im, x, y, w, h, zoom);
    }
    g.filter = 'none';
  }
  g.restore();
  grain(g, x, y, w, h, t, alpha);
  g.strokeStyle = LINE;
  g.lineWidth = 1;
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  const fl = flash(t, t0);
  if (fl > 0) {
    g.save();
    g.globalAlpha = fl * 0.85;
    g.fillStyle = '#FFF';
    g.fillRect(x, y, w, h);
    g.restore();
  }
  return m;
}

// A red circle drawn clockwise in 0.5 s, with a leader and label from 60 %.
function ring(g, id, cx, cy, rx, ry, t, t0, label, { lead = [0, 0] } = {}) {
  const p = easeOut(seg(t, t0, t0 + 0.5));
  if (p <= 0) return;
  g.save();
  g.strokeStyle = RED;
  g.lineWidth = 2.5;
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
  g.stroke();
  g.restore();
  if (p > 0.6 && label) {
    const lx = cx + lead[0], ly = cy + lead[1];
    g.strokeStyle = RED;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(cx + Math.sign(lead[0] || 1) * rx, cy);
    g.lineTo(lx, ly);
    g.stroke();
    const al = lead[0] < 0 ? 'right' : 'left';
    mono(g, id, label, lx + (lead[0] < 0 ? -8 : 8), ly + 5, 17, { color: RED, weight: 600, pass: false, align: al });
  }
}

// Mark a region of a page: a red rectangle drawn edge by edge, then a leader and label.
function boxMark(g, map, sx, sy, sw, sh, t, t0, label, lead = [0, 0]) {
  const p = easeOut(seg(t, t0, t0 + 0.6));
  if (p <= 0) return;
  const [x1, y1] = map(sx, sy), [x2, y2] = map(sx + sw, sy + sh);
  const w = x2 - x1, h = y2 - y1, per = 2 * (w + h), run = per * p;
  const segs = [[x1, y1, w, 0], [x1 + w, y1, 0, h], [x1 + w, y1 + h, -w, 0], [x1, y1 + h, 0, -h]];
  g.save();
  g.strokeStyle = RED;
  g.lineWidth = 2.5;
  let left = run;
  for (const [ax, ay, dx, dy] of segs) {
    const len = Math.abs(dx || dy);
    if (left <= 0) break;
    const f = Math.min(1, left / len);
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(ax + dx * f, ay + dy * f);
    g.stroke();
    left -= len;
  }
  g.restore();
  if (p > 0.75 && label) {
    const lx = x1 + lead[0], ly = y1 + lead[1];
    g.strokeStyle = RED;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x1 + w / 2, lead[1] < 0 ? y1 : y1 + h);
    g.lineTo(lx, ly);
    g.stroke();
    mono(g, 'boxlab', label, lx + 8, ly + 5, 18, { color: RED, weight: 600, pass: false });
  }
}

function badge(g, x, y, p = 1) {
  if (p <= 0) return;
  g.strokeStyle = RED;
  g.lineWidth = 1.5;
  g.strokeRect(x + 0.5, y + 0.5, 20, 20);
  g.beginPath();
  g.moveTo(x + 5, y + 11);
  g.lineTo(x + 9, y + 15);
  g.lineTo(x + 16, y + 6);
  g.stroke();
}

function dashBox(g, x, y) {
  g.save();
  g.strokeStyle = TICK;
  g.lineWidth = 1.5;
  g.setLineDash([3, 3]);
  g.strokeRect(x + 0.5, y + 0.5, 20, 20);
  g.restore();
}

// ---------------------------------------------------------------- subtitles
export function subs() {
  const SUB = FILM.subs;
  // One line per cue, measured against about 1,500 px: a long sentence becomes two cues.
  const MAXC = 76;
  const out = [];
  for (const c of FILM.cues) {
    const txt = SUB[c.id] || '';
    const t1 = c.t1 + 0.25;
    if (txt.length <= MAXC) { out.push({ t0: c.t0, t1, text: txt }); continue; }
    const words = txt.split(' ');
    let best = 0, bestd = 1e9, run = 0;
    for (let i = 0; i < words.length - 1; i++) {
      run += words[i].length + 1;
      const d = Math.abs(run - txt.length / 2);
      if (d < bestd) { bestd = d; best = i; }
    }
    const a = words.slice(0, best + 1).join(' '), b = words.slice(best + 1).join(' ');
    const split = c.t0 + (t1 - c.t0) * (a.length / txt.length);
    out.push({ t0: c.t0, t1: split, text: a }, { t0: split, t1, text: b });
  }
  return out;
}

function subtitle(g, t) {
  const s = subs().find(x => t >= x.t0 && t < x.t1);
  if (!s) return;
  font(g, 'Archivo', 34, 700);
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.92)';
  g.shadowBlur = 10;
  g.fillStyle = TEXT;
  g.fillText(s.text, W / 2, 984);
  g.restore();
}

// ---------------------------------------------------------------- data
const WEEKS = [100, 20, 80, 250, 500, 100, 100, 150, 120, 780, 900, 2730, 8855];
const CUM = WEEKS.reduce((a, v) => (a.push((a[a.length - 1] || 0) + v), a), []);
const TOTAL = 14685;
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const SOURCES = [
  { k: 'a5', tag: 'DOC · ADF 09/2026', n: '18 slides' },
  { k: 'b2', tag: 'DOC · ADF 10/2026', n: '6 slides' },
  { k: 'a4', tag: 'DATA · sales by week', n: '13 weeks' },
];

// ================================================================= 00 COLD OPEN
// The decisive sentence, frozen, circled and magnified, then the sources slam in.
function sOpen(g, t) {
  const s = sec('open'), u = t - s.t0;
  // the page it comes from
  const big = plate(g, 'b2', M, 96, 1180, 744, t, 0.4, { zoom: 1.0 + 0.04 * seg(t, 0.4, 12), grade: GRADE_PAPER, alpha: 0.10 });
  tag(g, 'tg1', M, 84, 'DOC · ADF 10/2026 · p.2');

  // the cause bar on that page, marked where it actually sits
  if (big && t >= cT('l02')) {
    boxMark(g, big.map, 112, 797, 1775, 193, t, cT('l02'), 'THE CAUSE', [40, -70]);
  }

  // the quoted line, typeset on a paper card so the red highlight reads as a highlight
  if (t >= cT('l03') - 0.4) {
    const x = 1300, y = 150, cw = W - M - x + 24;
    g.fillStyle = PAPER;
    g.fillRect(x - 24, y - 60, cw, 470);
    grain(g, x - 24, y - 60, cw, 470, t, 0.10);
    tag(g, 'tg2', x, y - 24, 'TRANSCRIPTION', { color: RED });
    quote(g, 'q1', 'Events cost months before they earn a dollar, and the time that goes into building them is the time that would otherwise go into selling sponsorship, winning grants and signing partners. That is why the pipeline is empty every spring.',
      x, y + 36, cw - 48, 26, { hp: seg(t, cT('l03'), cT('l03') + 3.2), ink: PAPERINK });
    mono(g, 'tg2b', 'ADF 10/2026 · p.2', x, y + 380, 15, { color: '#6A6760' });
  }

  // the title, cut in over the evidence
  if (t >= cT('l04')) {
    panel(g, M, 726, 1180, 114, { fill: 'rgba(11,12,14,0.94)' });
    heading(g, 'title', 'WHERE THE YEAR GOES', M + 28, 800, 58);
    mono(g, 'titlesub', "AN INVESTIGATION INTO ONE FESTIVAL'S CALENDAR", M + 28, 758, 16, { color: RED, weight: 600, pass: false });
  }
}

// ================================================================= 01 THE RECORD
function sRecord(g, t) {
  const s = sec('record');
  heading(g, 'h-rec', 'THE RECORD', M, 120, 44, { p: cutIn(t, s.t0 + 0.2) });
  mono(g, 'h-rec2', 'TWO INTERNAL DOCUMENTS · ONE SET OF FIGURES', M, 150, 16, { color: TEXT2, pass: false, p: cutIn(t, s.t0 + 0.2) });

  // three source columns, each lighting up when it enters
  const cw = 388, gap = 26, x0 = M;
  SOURCES.forEach((src, i) => {
    const x = x0 + i * (cw + gap), t0 = cT('l05') + i * 0.7;
    if (t < t0) return;
    tag(g, `src${i}`, x, 212, src.tag);
    plate(g, src.k, x, 226, cw, 244, t, t0, { alpha: 0.10 });
    mono(g, `srcn${i}`, src.n, x, 496, 15, { color: TICK });
  });

  // what the documents agree on
  const FIG = [
    { v: '$14,685', l: 'TOUR REVENUE 2026', s: '70% below peak' },
    { v: '−25%', l: 'WEBSITE TRAFFIC', s: '32,342 → 21,308 sessions' },
    { v: '9,400', l: 'NAMES ON THE LIST', s: 'remarketed, not grown' },
    { v: '11', l: 'MONTHS WITH NO INCOME', s: 'earned in two weeks' },
  ];
  FIG.forEach((f, i) => {
    const t0 = cT('l06') + i * 0.85;
    if (t < t0) return;
    const x = M + i * ((W - 2 * M) / 4), cw2 = (W - 2 * M) / 4 - 24;
    panel(g, x, 540, cw2, 190);
    heading(g, `fv${i}`, f.v, x + 20, 612, 50, { color: RED, max: cw2 - 40 });
    mono(g, `fl${i}`, f.l, x + 20, 646, 15, { color: TEXT, weight: 600, pass: false });
    mono(g, `fs${i}`, f.s, x + 20, 676, 15, { color: TEXT2, pass: false });
    if (flash(t, t0) > 0) { g.save(); g.globalAlpha = flash(t, t0) * 0.6; g.fillStyle = '#FFF'; g.fillRect(x, 540, cw2, 190); g.restore(); }
  });
  mono(g, 'recfoot', 'BOTH DOCUMENTS STATE THE SAME FIGURES · NO THIRD SOURCE EXISTS', M, 790, 16, { color: TICK, p: cutIn(t, cT('l07') + 2.4) });
}

// ================================================================= 02 THE SALE
// A data chart with a playhead: the thirteen selling weeks, read at one tick a week.
function sSale(g, t) {
  const s = sec('sale'), u = t - s.t0;
  heading(g, 'h-sale', 'THE SELLING YEAR IS THIRTEEN WEEKS LONG', M, 120, 44, { p: cutIn(t, s.t0 + 0.2), max: 1300 });
  tag(g, 'tg-sale', M, 176, 'DATA · ADF 09/2026 · p.4');

  const x0 = M + 40, y0 = 700, cw = W - 2 * M - 300, ch = 440;
  // axes
  g.strokeStyle = LINE;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x0, y0 - ch);
  g.lineTo(x0, y0);
  g.lineTo(x0 + cw, y0);
  g.stroke();
  for (let i = 0; i <= 13; i++) {
    const x = x0 + (i / 13) * cw;
    g.strokeStyle = TICK;
    g.beginPath();
    g.moveTo(x, y0);
    g.lineTo(x, y0 + 7);
    g.stroke();
    if (i < 13) mono(g, `wk${i}`, i === 12 ? 'EV' : String(-12 + i), x + cw / 26, y0 + 28, 14, { color: TICK, align: 'center' });
  }

  // what each week actually took, behind the line it adds up to
  const run0 = clamp((t - cT('l08')) / 7.5), n0 = run0 * 13, bw = (cw / 13) * 0.52;
  for (let i = 0; i < 13; i++) {
    const p = clamp(n0 - i);
    if (p <= 0) break;
    const bx = x0 + ((i + 0.5) / 13) * cw - bw / 2;
    const bh = (WEEKS[i] / TOTAL) * ch * p;
    g.fillStyle = '#272B32';
    g.fillRect(bx, y0 - bh, bw, bh);
  }
  mono(g, 'leg1', 'BARS: TAKEN THAT WEEK    LINE: TAKEN SO FAR', x0, y0 + 56, 15, { color: TICK });

  // the playhead runs one tick per selling week
  const run = clamp((t - cT('l08')) / 7.5);
  const n = run * 13;
  g.strokeStyle = RED;
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i < 13; i++) {
    const p = clamp(n - i);
    if (p <= 0) break;
    const x1 = x0 + (i / 13) * cw, x2 = x0 + ((i + 1) / 13) * cw;
    const v1 = i === 0 ? 0 : CUM[i - 1], v2 = CUM[i];
    const yy1 = y0 - (v1 / TOTAL) * ch, yy2 = y0 - (lerp(v1, v2, p) / TOTAL) * ch;
    if (i === 0) g.moveTo(x1, yy1);
    g.lineTo(lerp(x1, x2, p), yy2);
  }
  g.stroke();
  // the head itself, carrying the clock
  const hi = Math.min(12, Math.floor(n)), hp = clamp(n - hi);
  const hx = x0 + ((hi + hp) / 13) * cw;
  const hv = lerp(hi === 0 ? 0 : CUM[hi - 1], CUM[hi], hp);
  const hy = y0 - (hv / TOTAL) * ch;
  if (n > 0) {
    g.strokeStyle = RED;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(hx, y0 - ch);
    g.lineTo(hx, y0);
    g.stroke();
    g.fillStyle = RED;
    g.beginPath();
    g.arc(hx, hy, 4, 0, 7);
    g.fill();
    mono(g, 'head', `WEEK ${hi < 12 ? -12 + hi : 'EVENT'}   $${Math.round(hv).toLocaleString('en-US')}`, W - M, 176, 20, { color: RED, weight: 600, align: 'right' });
  }

  // two pins the voice names
  if (t >= cT('l09') + 2.0) {
    const px = x0 + (9 / 13) * cw, py = y0 - (CUM[8] / TOTAL) * ch;
    ring(g, 'pin1', px, py, 26, 26, t, cT('l09') + 2.0, '10% AT FOUR WEEKS OUT', { lead: [60, -90] });
  }
  if (t >= cT('l10') + 1.2) {
    const px = x0 + cw, py = y0 - ch;
    ring(g, 'pin2', px, py, 30, 30, t, cT('l10') + 1.2, '60% IN THE FINAL WEEK', { lead: [-80, 120] });
  }

  if (t >= cT('l11')) finding(g, t, cT('l11'), '01', 'THE FESTIVAL CANNOT FORECAST, SO IT CANNOT COMMIT');
}

// A verdict card. Holds still, as the style asks of findings.
function finding(g, t, t0, n, s) {
  if (t < t0) return;
  const x = M, y = 812, w = W - 2 * M, h = 92;
  panel(g, x, y, w, h, { fill: '#17100E', stroke: RED });
  g.fillStyle = RED;
  g.fillRect(x, y, 7, h);
  mono(g, `fn${n}`, `FINDING ${n}`, x + 30, y + 36, 16, { color: RED, weight: 600, pass: false });
  heading(g, `fh${n}`, s, x + 30, y + 72, 32, { max: w - 80 });
  if (flash(t, t0) > 0) { g.save(); g.globalAlpha = flash(t, t0) * 0.5; g.fillStyle = '#FFF'; g.fillRect(x, y, w, h); g.restore(); }
}

// ================================================================= 03 THE YEAR
// The same year as a plan: what is built, when it must be sold, and the months they share.
const PRODUCE = [
  { t: 'CREATIVE FUTURES CONFERENCE', a: 0, b: 8 },
  { t: 'CREATIVE BUSINESS WORKSHOP', a: 1, b: 7 },
  { t: 'DESIGNSTATION BUILD', a: 2, b: 8 },
];
const SELL = [
  { t: 'SPONSORS APPROACHED', a: 0, b: 3 },
  { t: 'CHAPTER PROGRAM BUDGETS SET', a: 8, b: 11 },
];

function sYear(g, t) {
  const s = sec('year');
  heading(g, 'h-year', 'THE SAME YEAR, AS A CALENDAR', M, 120, 44, { p: cutIn(t, s.t0 + 0.2) });
  mono(g, 'h-year2', 'SCHEMATIC · MONTHS, NOT DATES', M, 150, 16, { color: TICK, pass: false, p: cutIn(t, s.t0 + 0.2) });

  const x0 = M + 230, cw = W - M - 40 - x0, mw = cw / 12;
  const rowY = [292, 540];
  const GTOP = 256, GBOT = 700;
  for (let i = 0; i <= 12; i++) {
    const x = x0 + i * mw;
    g.strokeStyle = '#363B43';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x + 0.5, GTOP);
    g.lineTo(x + 0.5, GBOT);
    g.stroke();
    if (i < 12) mono(g, `mo${i}`, MONTHS[i], x + mw / 2, 238, 17, { color: TEXT2, align: 'center', weight: 600 });
  }

  // what gets produced
  mono(g, 'lab-prod', 'PRODUCED', M, rowY[0] - 24, 17, { color: TEXT, weight: 600, pass: false, p: cutIn(t, cT('l13')) });
  PRODUCE.forEach((b, i) => {
    const t0 = cT('l13') + 0.9 + i * 0.8;
    if (t < t0) return;
    const y = rowY[0] + i * 56, bx = x0 + b.a * mw, bw2 = (b.b - b.a + 1) * mw;
    g.fillStyle = '#39404B';
    g.fillRect(bx, y, bw2, 42);
    g.strokeStyle = '#5A6472';
    g.strokeRect(bx + 0.5, y + 0.5, bw2, 42);
    g.save();
    g.beginPath();
    g.rect(bx, y, bw2, 42);
    g.clip();
    mono(g, `pb${i}`, b.t, bx + 12, y + 27, 15, { color: '#F2F0EB', weight: 600, pass: false });
    g.restore();
    if (flash(t, t0) > 0) { g.save(); g.globalAlpha = flash(t, t0) * 0.6; g.fillStyle = '#FFF'; g.fillRect(x0 + b.a * mw, y, (b.b - b.a + 1) * mw, 40); g.restore(); }
  });

  // when it has to be sold
  mono(g, 'lab-sell', 'SOLD', M, rowY[1] - 24, 17, { color: RED, weight: 600, pass: false, p: cutIn(t, cT('l14')) });
  SELL.forEach((b, i) => {
    const t0 = cT('l14') + 1.4 + i * 1.6;
    if (t < t0) return;
    const y = rowY[1] + i * 56, bx = x0 + b.a * mw, bw2 = (b.b - b.a + 1) * mw;
    g.fillStyle = 'rgba(255,74,46,0.14)';
    g.fillRect(bx, y, bw2, 42);
    g.strokeStyle = RED;
    g.lineWidth = 1.5;
    g.strokeRect(bx + 0.5, y + 0.5, bw2, 42);
    g.save();
    g.beginPath();
    g.rect(bx, y, bw2, 42);
    g.clip();
    mono(g, `sb${i}`, b.t, bx + 12, y + 27, 15, { color: RED, weight: 600, pass: false });
    g.restore();
  });

  // put the two on the same axis: the selling band rises into the produced rows
  const over = easeOut(seg(t, cT('l15'), cT('l15') + 1.6));
  if (over > 0 && t < cT('l16')) {
    const yb = rowY[1] + 42, yt = lerp(yb, GTOP, over);
    g.save();
    g.strokeStyle = RED;
    g.lineWidth = 2;
    g.globalAlpha = 0.9;
    g.beginPath();
    g.moveTo(x0 + 0.5, yb);
    g.lineTo(x0 + 0.5, yt);
    g.moveTo(x0 + 3 * mw + 0.5, yb);
    g.lineTo(x0 + 3 * mw + 0.5, yt);
    g.stroke();
    g.restore();
  }

  // the months they share, hatched
  if (t >= cT('l16')) {
    const x = x0, w = 3 * mw, y = GTOP, h = rowY[1] + 42 - GTOP;
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.strokeStyle = RED;
    g.lineWidth = 1;
    g.globalAlpha = 0.55;
    for (let i = -h; i < w; i += 11) { g.beginPath(); g.moveTo(x + i, y + h); g.lineTo(x + i + h, y); g.stroke(); }
    g.restore();
    g.strokeStyle = RED;
    g.lineWidth = 2.5;
    g.strokeRect(x + 0.5, y + 0.5, w, h);
    mono(g, 'overlap', 'THE SAME MONTHS', x, 224, 20, { color: RED, weight: 600, pass: false });
    if (flash(t, cT('l16')) > 0) { g.save(); g.globalAlpha = flash(t, cT('l16')) * 0.7; g.fillStyle = '#FFF'; g.fillRect(x, y, w, h); g.restore(); }
  }

  // the quoted line this rests on
  if (t >= cT('l14') + 0.2 && t < cT('l17')) {
    quote(g, 'q-year', '“Sponsors are approached in the first quarter, not in the summer when the work is already done.”', M, 772, W - 2 * M, 25);
    mono(g, 'q-year-s', 'ADF 10/2026 · p.6', M, 812, 15, { color: TICK });
  }
  if (t >= cT('l17')) finding(g, t, cT('l17'), '02', 'PRODUCTION COMPETES FOR JANUARY, FEBRUARY AND MARCH');
}

// ================================================================= 04 WHAT IT COSTS
const COSTS = [
  {
    h: 'THE AUDIENCE CANNOT GROW', q: '“Every ADF product is paid. There is no point at which somebody who does not already know us can enter.”',
    src: 'ADF 09/2026 · p.5', fig: 'NO FREE ENTRY POINT',
  },
  {
    h: 'THE LIST CANNOT GROW', q: '“A single list, remarketed annually. Almost everything else follows from this.”',
    src: 'ADF 09/2026 · p.5', fig: '9,400 NAMES, FLAT',
  },
  {
    h: 'THE INVENTORY IS UNSOLD', q: '“Two of these have ever been sold.”',
    src: 'ADF 10/2026 · p.5', fig: '2 OF 6 LINES',
  },
];

function sCosts(g, t) {
  const s = sec('costs');
  heading(g, 'h-cost', 'WHAT THE OVERLAP COSTS', M, 120, 44, { p: cutIn(t, s.t0 + 0.2) });
  mono(g, 'h-cost2', 'NONE OF IT APPEARS IN AN EVENT BUDGET', M, 150, 16, { color: TEXT2, pass: false, p: cutIn(t, s.t0 + 0.2) });

  const cw = (W - 2 * M - 48) / 3;
  COSTS.forEach((c, i) => {
    const t0 = cT(['l19', 'l20', 'l21'][i]);
    if (t < t0) return;
    const x = M + i * (cw + 24);
    panel(g, x, 212, cw, 470);
    mono(g, `cn${i}`, `0${i + 1}`, x + 24, 256, 17, { color: RED, weight: 600, pass: false });
    heading(g, `ch${i}`, c.h, x + 24, 306, 30, { max: cw - 48 });
    quote(g, `cq${i}`, c.q, x + 24, 364, cw - 48, 22);
    mono(g, `cs${i}`, c.src, x + 24, 616, 14, { color: TICK });
    g.fillStyle = RED;
    g.fillRect(x + 24, 640, 5, 18);
    mono(g, `cf${i}`, c.fig, x + 38, 655, 16, { color: RED, weight: 600, pass: false });
    if (flash(t, t0) > 0) { g.save(); g.globalAlpha = flash(t, t0) * 0.55; g.fillStyle = '#FFF'; g.fillRect(x, 212, cw, 470); g.restore(); }
  });

  if (t >= cT('l22')) finding(g, t, cT('l22'), '03', 'THE LOSS ON THE EVENTS IS THE SMALL NUMBER');
  else mono(g, 'cost-foot', 'EACH CONSEQUENCE IS QUOTED FROM THE FESTIVAL’S OWN DOCUMENTS', M, 760, 16, { color: TICK, p: cutIn(t, cT('l18') + 1.6) });
}

// ================================================================= 05 COMPARISON
function sCompare(g, t) {
  const s = sec('compare');
  heading(g, 'h-cmp', 'TWO FESTIVALS, ONE VARIABLE', M, 120, 44, { p: cutIn(t, s.t0 + 0.2) });

  const cw = (W - 2 * M - 40) / 2;
  const CMP = [
    { t0: cT('l23'), name: 'SEATTLE', s: 'CONVENES', fig: 'FIVE FIGURES FROM ONE SPONSOR', l: ['Raw, deliberately unglossy program', 'An institution behind it, with a board', 'Published numbers to sell against', '99% of the program free'], ok: true },
    { t0: cT('l24'), name: 'PORTLAND', s: 'PRODUCED', fig: 'PEAKED, THEN SHUT IN 2021', l: ['Kept producing its own events', 'Peak revenue $239,630', 'Closed in 2021', 'No successor organisation'], ok: false },
  ];
  CMP.forEach((c, i) => {
    if (t < c.t0) return;
    const x = M + i * (cw + 40);
    panel(g, x, 206, cw, 470, { stroke: c.ok ? RED : LINE });
    heading(g, `cmn${i}`, c.name, x + 28, 276, 46);
    mono(g, `cms${i}`, c.s, x + 28, 310, 17, { color: c.ok ? RED : TEXT2, weight: 600, pass: false });
    c.l.forEach((l, j) => {
      const ty = 370 + j * 56;
      if (t < c.t0 + 0.6 + j * 0.3) return;
      if (c.ok) badge(g, x + 28, ty - 16); else dashBox(g, x + 28, ty - 16);
      body(g, `cml${i}${j}`, l, x + 64, ty, cw - 100, 21, { color: TEXT, lh: 26 });
    });
    g.fillStyle = c.ok ? RED : TICK;
    g.fillRect(x + 28, 616, 5, 18);
    mono(g, `cmf${i}`, c.fig, x + 42, 631, 16, { color: c.ok ? RED : TEXT2, weight: 600, pass: false });
    if (flash(t, c.t0) > 0) { g.save(); g.globalAlpha = flash(t, c.t0) * 0.55; g.fillStyle = '#FFF'; g.fillRect(x, 206, cw, 470); g.restore(); }
  });
  if (t >= cT('l25')) {
    panel(g, M, 716, W - 2 * M, 84, { fill: '#17100E', stroke: RED });
    heading(g, 'cmp-v', 'THE VARIABLE IS NOT PRODUCTION VALUE. IT IS WHO DOES THE PRODUCING.', M + 28, 770, 30, { max: W - 2 * M - 60 });
  }
}

// ================================================================= 06 KNOWN / UNRESOLVED
const KNOWN = [
  'Revenue, traffic and list size, stated twice',
  'When the money arrives, week by week',
  'What each produced event costs in months',
  'What the chapters and sponsors do, and when',
];
const UNRESOLVED = [
  'What a sponsor would have paid',
  'What the unsold inventory is worth',
  'The cost of the months already spent',
  'Any figure the festival measured itself',
];

function sBoard(g, t) {
  const s = sec('board');
  heading(g, 'h-brd', 'WHAT THE RECORD ESTABLISHES', M, 120, 44, { p: cutIn(t, s.t0 + 0.2) });
  const cw = (W - 2 * M - 40) / 2;
  [[KNOWN, 'KNOWN', true], [UNRESOLVED, 'UNRESOLVED', false]].forEach(([list, title, ok], i) => {
    const x = M + i * (cw + 40);
    panel(g, x, 200, cw, 420, { stroke: ok ? LINE : TICK });
    mono(g, `bt${i}`, title, x + 28, 248, 18, { color: ok ? TEXT : RED, weight: 600, pass: false });
    list.forEach((l, j) => {
      const t0 = s.t0 + 1.0 + (i * 4 + j) * 0.55;
      if (t < t0) return;
      const ty = 310 + j * 70;
      if (ok) badge(g, x + 28, ty - 16); else dashBox(g, x + 28, ty - 16);
      body(g, `bl${i}${j}`, l, x + 68, ty, cw - 110, 22, { color: ok ? TEXT : TEXT2, lh: 28 });
    });
  });
  if (t >= cT('l27')) {
    quote(g, 'q-brd', '“Every figure above is published. Ours are not measured.”', M, 700, W - 2 * M, 28);
    mono(g, 'q-brd-s', 'ADF 09/2026 · p.5 · on a comparable festival', M, 744, 15, { color: TICK });
  }
}

// ================================================================= 07 EVIDENCE MAP
function sMap(g, t) {
  const s = sec('map'), u = t - s.t0;
  heading(g, 'h-map', 'EVERY SOURCE POINTS AT THE SAME QUARTER', M, 120, 44, { p: cutIn(t, s.t0 + 0.2), max: 1400 });

  // the calendar again, small, with Q1 marked
  const x0 = M + 420, cw = W - M - 60 - x0, mw = cw / 12;
  const gy = 300, gh = 150;
  for (let i = 0; i < 12; i++) {
    const x = x0 + i * mw;
    g.strokeStyle = LINE;
    g.strokeRect(x + 0.5, gy + 0.5, mw, gh);
    mono(g, `mm${i}`, MONTHS[i], x + mw / 2, gy - 14, 16, { color: TEXT2, align: 'center' });
  }
  g.save();
  g.globalAlpha = 0.5;
  g.fillStyle = RED;
  g.fillRect(x0, gy, 3 * mw, gh);
  g.restore();
  g.strokeStyle = RED;
  g.lineWidth = 2.5;
  g.strokeRect(x0 + 0.5, gy + 0.5, 3 * mw, gh);
  mono(g, 'q1lab', 'Q1', x0 + 1.5 * mw, gy + gh / 2 + 8, 26, { color: TEXT, align: 'center', weight: 600, pass: false });

  // every source thumbnail, each linked to that quarter
  const zx = x0 + 1.5 * mw, zy = gy + gh;
  SOURCES.forEach((src, i) => {
    const t0 = s.t0 + 0.8 + i * 0.5;
    if (t < t0) return;
    const x = M + i * 134, y = 300;
    plate(g, src.k, x, y, 120, 76, t, t0, { alpha: 0.10 });
    const p = easeOut(seg(t, t0 + 0.2, t0 + 0.9));
    g.save();
    g.strokeStyle = RED;
    g.lineWidth = 1.2;
    g.setLineDash([5, 4]);
    g.beginPath();
    g.moveTo(x + 120, y + 38);
    g.lineTo(lerp(x + 120, zx, p), lerp(y + 38, zy, p));
    g.stroke();
    g.restore();
  });
  // the findings converge too
  ['01', '02', '03'].forEach((n, i) => {
    const t0 = s.t0 + 2.4 + i * 0.4;
    if (t < t0) return;
    const x = M, y = 470 + i * 46;
    g.fillStyle = RED;
    g.fillRect(x, y - 13, 4, 16);
    mono(g, `mf${i}`, `FINDING ${n}`, x + 14, y, 16, { color: RED, weight: 600, pass: false });
    const p = easeOut(seg(t, t0, t0 + 0.6));
    g.save();
    g.strokeStyle = RED;
    g.lineWidth = 1;
    g.setLineDash([5, 4]);
    g.beginPath();
    g.moveTo(x + 140, y - 5);
    g.lineTo(lerp(x + 140, zx, p), lerp(y - 5, zy, p));
    g.stroke();
    g.restore();
  });

  if (t >= cT('l29')) {
    panel(g, M, 640, W - 2 * M, 104, { fill: '#17100E', stroke: RED });
    heading(g, 'verdict', 'BUILD EVENTS IN THOSE MONTHS, OR SELL THE FESTIVAL IN THEM', M + 28, 706, 36, { max: W - 2 * M - 60 });
  }

  // end card: sources and licences
  if (u > sec('map').t1 - s.t0 - 2.6) {
    panel(g, M, 780, W - 2 * M, 112, { fill: GROUND, stroke: LINE });
    mono(g, 'end1', 'SOURCES · ADF INTERNAL DECK 09/2026 (18PP) · ADF INTERNAL DECK 10/2026 (6PP) · FIGURES AS STATED IN BOTH', M + 24, 820, 15, { color: TEXT2 });
    mono(g, 'end2', 'ALL FIGURES QUOTED VERBATIM · SCHEMATIC CALENDAR INFERRED FROM THE DOCUMENTS · NO THIRD-PARTY MATERIAL', M + 24, 848, 15, { color: TICK });
    mono(g, 'end3', 'TYPE: ARCHIVO, IBM PLEX MONO, SOURCE SERIF 4 (OFL)', M + 24, 876, 15, { color: TICK });
  }
}

// ================================================================= frame
export function renderFilm(g, t, opts = {}) {
  COLLECT = opts.collect ? [] : null;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = GROUND;
  g.fillRect(0, 0, W, H);
  g.filter = 'none';
  g.globalAlpha = 1;
  g.setLineDash([]);
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.letterSpacing = '0px';

  const s = FILM.sections.find(x => t >= x.t0 && t < x.t1) || FILM.sections[0];
  ({
    open: sOpen, record: sRecord, sale: sSale, year: sYear,
    costs: sCosts, compare: sCompare, board: sBoard, map: sMap,
  })[s.id](g, t);

  // the running clock, in the corner, as a readout rather than a band
  g.setTransform(1, 0, 0, 1, 0, 0);
  const mm = String(Math.floor(t / 60)).padStart(2, '0'), ss = String(Math.floor(t % 60)).padStart(2, '0');
  mono(g, 'clock', `${mm}:${ss}`, W - M, 932, 18, { color: TICK, align: 'right', weight: 600 });

  if (!opts.nosub) subtitle(g, t);
  return COLLECT;
}

// ================================================================= sound events
export function buildEvents() {
  const ev = [];
  const at = (t, type, o = {}) => ev.push({ t: Math.round(t * 1000) / 1000, type, ...o });

  at(0.4, 'paper', { g: 1.0 });
  at(cT('l02'), 'pencil', { g: 0.9 });
  at(cT('l03'), 'paper', { g: 0.7 });
  at(cT('l04'), 'thump', { g: 1.0 });

  SOURCES.forEach((_, i) => at(cT('l05') + i * 0.7, 'paper', { g: 0.8 }));
  for (let i = 0; i < 4; i++) at(cT('l06') + i * 0.85, 'key', { g: 0.7 });

  at(cT('l08'), 'pencil', { g: 0.8 });
  for (let i = 0; i < 13; i++) at(cT('l08') + (i / 13) * 7.5, 'tick', { g: 0.55 });
  at(cT('l09') + 2.0, 'pencil', { g: 0.8 });
  at(cT('l10') + 1.2, 'pencil', { g: 0.8 });
  at(cT('l11'), 'stamp', { g: 1.0 });

  for (let i = 0; i < 3; i++) at(cT('l13') + 0.9 + i * 0.8, 'key', { g: 0.8 });
  for (let i = 0; i < 2; i++) at(cT('l14') + 1.4 + i * 1.6, 'pencil', { g: 0.8 });
  at(cT('l15'), 'sweep', { g: 0.9 });
  at(cT('l16'), 'thump', { g: 1.2 });
  at(cT('l17'), 'stamp', { g: 1.0 });

  ['l19', 'l20', 'l21'].forEach(l => at(cT(l), 'paper', { g: 0.8 }));
  at(cT('l22'), 'stamp', { g: 1.0 });

  at(cT('l23'), 'paper', { g: 0.8 });
  at(cT('l24'), 'paper', { g: 0.8 });
  at(cT('l25'), 'thump', { g: 0.9 });

  const b = sec('board');
  for (let i = 0; i < 8; i++) at(b.t0 + 1.0 + i * 0.55, 'tap', { g: 0.5 });

  const m = sec('map');
  for (let i = 0; i < 3; i++) at(m.t0 + 0.8 + i * 0.5, 'paper', { g: 0.7 });
  for (let i = 0; i < 3; i++) at(m.t0 + 2.4 + i * 0.4, 'tap', { g: 0.8 });
  at(cT('l29'), 'thump', { g: 1.1 });

  return ev.sort((a, b2) => a.t - b2.t);
}
