// The Desk — 1-bit Dither.
// One desk under one hard lamp. Everything a sponsor buys arrives on it as a printed object,
// cut on the beat. No overlay captions: every word in the film is printed on a surface and
// dithered with it.

import * as THREE from 'three';
import { Pipe, Present, RW, RH, L_FLAT, L_SCREEN } from './pipe.js';
import { grey, add, box, cyl, screenBox } from './kit.js';
import * as CARD from './cards.js';
import * as T from './story.js';

export const DUR = T.DUR;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const seg = (t, a, b) => (b === a ? (t >= b ? 1 : 0) : clamp((t - a) / (b - a)));
// Camera moves start from rest and end at rest: a velocity cliff freezes the whole pattern at once.
const smooth = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

export let scene, cam, pipe, present, rtA;
const SETS = {};
const CARDS = {};
let renderer;

// a flat card lying on the desk, or standing
function plate(parent, c, w, x, y, z, o = {}) {
  const h = w * c.h / c.w;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), c.mat);
  m.position.set(x, y, z);
  if (o.flat !== false) m.rotation.x = -Math.PI / 2;
  if (o.rot) m.rotation.z = o.rot;
  if (o.stand) { m.rotation.x = o.tilt ?? -0.18; m.rotation.y = o.yaw ?? 0; }
  m.castShadow = false;
  m.receiveShadow = true;
  m.userData.card = c;
  m.userData.cw = w;
  m.userData.ch = h;
  parent.add(m);
  return m;
}

export function build(r) {
  renderer = r;
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(38, 16 / 9, 0.02, 400);

  const key = new THREE.DirectionalLight(0xffffff, 3.3);
  key.position.set(2.2, 3.4, 1.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -6; key.shadow.camera.right = 6;
  key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  scene.add(key, new THREE.AmbientLight(0xffffff, 0.1));

  // the desk: a large grazing plane, so it goes on the screen-locked layer (no octave rings)
  const desk = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), grey(0.42));
  desk.rotation.x = -Math.PI / 2;
  desk.receiveShadow = true;
  desk.layers.set(L_SCREEN);
  scene.add(desk);

  const mk = id => { const g = new THREE.Group(); g.visible = false; scene.add(g); SETS[id] = g; return g; };

  // 01 the hook
  CARDS.hook = CARD.hookCard();
  plate(mk('hook'), CARDS.hook, 1.6, 0, 0.002, 0);

  // 02 the list on a screen
  const sc = mk('screen');
  box(sc, 1.22, 1.08, 0.09, 0, 0.56, -0.25, grey(0.3));
  cyl(sc, 0.22, 0.26, 0.06, 0, 0.03, -0.1, grey(0.26), 16);
  CARDS.list = [];
  for (let n = 1; n <= 6; n++) {
    const c = CARD.listCard(n);
    CARDS.list.push(c);
    const m = plate(sc, c, 0.94, 0, 0.54, -0.2, { flat: false });
    m.rotation.x = -0.06;
    m.visible = false;
    c.mesh = m;
  }

  // 03 the number
  CARDS.num = CARD.bigCard('8,911', 'ON THE LIST', 'ARCHITECTS, DESIGNERS, SPECIFIERS, BUYERS');
  plate(mk('number'), CARDS.num, 1.5, 0, 0.002, 0);

  // 04 three rates
  const rt = mk('rates');
  CARDS.rates = CARD.ratesCard();
  plate(rt, CARDS.rates, 2.2, 0, 0.002, 0);

  // 05 the printer
  const pr = mk('printer');
  box(pr, 1.5, 0.42, 0.9, 0, 0.21, -0.6, grey(0.32));
  box(pr, 1.56, 0.06, 0.1, 0, 0.44, -0.18, grey(0.2));
  CARDS.edition = [];
  for (let n = 0; n <= 16; n += 2) {
    const c = CARD.editionCard(n);
    CARDS.edition.push(c);
    const m = plate(pr, c, 1.0, 0, 0.004, 0.35);
    m.visible = false;
    c.mesh = m;
  }

  // 06 the page
  CARDS.page = CARD.editionCard(16);
  plate(mk('page'), CARDS.page, 1.3, 0, 0.002, 0);

  // 07 the banners
  const bn = mk('banners');
  CARDS.banner = [
    CARD.bannerCard('728 × 90', 'LEADERBOARD · EVERY PAGE'),
    CARD.bannerCard('300 × 250', 'IN ARTICLE AND SIDEBAR'),
    CARD.bannerCard('160 × 600', 'LEFT RAIL, EVERY PAGE'),
  ];
  CARDS.banner.forEach((c, i) => {
    const m = plate(bn, c, 1.1, -0.02 + i * 0.03, 0.002 + i * 0.004, -0.62 + i * 0.62, { rot: (i - 1) * 0.045 });
    c.mesh = m;
  });

  // 08 three posts
  const so = mk('social');
  CARDS.social = [
    CARD.socialCard('POST ONE · WEEK 0', 'THE PROBLEM', 'OPENS ON THE SAME LINE AS THE EMAIL'),
    CARD.socialCard('POST TWO · WEEK 3', 'THE PROOF', 'A REAL PROJECT, NAMED'),
    CARD.socialCard('POST THREE · WEEK 7', 'THE DETAIL', 'THE JUNCTION, THE BRACKET, THE EDGE'),
  ];
  CARDS.social.forEach((c, i) => {
    const m = plate(so, c, 0.72, -0.62 + i * 0.62, 0.002 + i * 0.003, 0.06 - i * 0.05, { rot: (i - 1) * 0.12 });
    c.mesh = m;
  });

  // 09 the guide
  CARDS.guide = CARD.guideCard();
  const gd = mk('guide');
  plate(gd, CARDS.guide, 1.15, 0, 0.002, 0);
  box(gd, 1.22, 0.012, 1.68, 0, -0.006, 0, grey(0.5));

  // 10 the calendar, and the stamp that lands on it
  const cl = mk('cal');
  CARDS.cal = CARD.calCard();
  plate(cl, CARDS.cal, 2.3, 0, 0.002, 0);
  CARDS.sells = CARD.stampCard('Q3 SELLS FIRST');
  const st = plate(cl, CARDS.sells, 1.15, 0.33, 0.012, 0.42, { rot: -0.07 });
  st.visible = false;
  CARDS.sells.mesh = st;

  // 11 the price
  CARDS.price = CARD.priceCard();
  plate(mk('price'), CARDS.price, 2.1, 0, 0.002, 0);

  // 12 the desks it reaches, and the end card standing among them
  const dk = mk('desks');
  CARDS.end = CARD.endCard();
  const endM = plate(dk, CARDS.end, 2.4, 0, 0.02, 0, { flat: false, stand: true, tilt: -0.5 });
  endM.visible = false;
  CARDS.end.mesh = endM;
  const pageMat = grey(0.95);
  const deskMat = grey(0.3);
  for (let i = 0; i < 56; i++) {
    const a = (i / 56) * Math.PI * 2 + (i % 3) * 0.3;
    const r = 2.6 + (i % 7) * 1.5 + (i % 3) * 0.6;
    const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.62;
    const g2 = new THREE.Group();
    g2.position.set(x, 0, z);
    g2.rotation.y = -a + Math.PI / 2;
    box(g2, 0.9, 0.07, 0.6, 0, 0.035, 0, deskMat);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.46), pageMat);
    p.rotation.x = -Math.PI / 2;
    p.position.set(0, 0.075, 0);
    p.receiveShadow = true;
    g2.add(p);
    dk.add(g2);
  }

  pipe = new Pipe(renderer, RW, RH);
  present = new Present(renderer, 0x15110F, 0xEFE3D2);
  rtA = pipe.target();
}

// ---------------------------------------------------------------- cameras
// Each shot starts from rest and drifts; the camera never cuts or crosses a line being read.
const CAM = {
  hook: u => {
    const k = smooth(seg(u, 0, 7));
    return { p: V3(lerp(-0.1, 0.08, k), lerp(1.62, 1.86, k), lerp(1.04, 1.2, k)), l: V3(0, 0, lerp(0.02, -0.03, k)) };
  },
  screen: u => {
    const k = smooth(seg(u, 0, 5));
    return { p: V3(lerp(-0.26, 0.2, k), lerp(1.06, 0.98, k), lerp(1.52, 1.36, k)), l: V3(0, 0.6, -0.2) };
  },
  number: u => {
    const k = smooth(seg(u, 0, 3));
    return { p: V3(lerp(0.08, -0.06, k), lerp(1.72, 1.62, k), lerp(0.9, 1.02, k)), l: V3(0, 0, 0) };
  },
  rates: u => {
    const k = smooth(seg(u, 0, 4));
    return { p: V3(lerp(-0.06, 0.05, k), lerp(2.05, 1.95, k), lerp(1.08, 1.18, k)), l: V3(0, 0, 0) };
  },
  printer: u => {
    const k = smooth(seg(u, 0, 5));
    return { p: V3(lerp(-1.05, 0.45, k), lerp(0.66, 0.8, k), lerp(1.35, 1.5, k)), l: V3(0, 0.1, 0.3) };
  },
  page: u => {
    const k = smooth(seg(u, 0, 3));
    return { p: V3(lerp(-0.1, 0.06, k), lerp(1.5, 1.4, k), lerp(0.72, 0.6, k)), l: V3(0, 0, -0.06) };
  },
  banners: u => {
    const k = smooth(seg(u, 0, 4));
    return { p: V3(lerp(-0.2, 0.18, k), lerp(2.35, 2.2, k), lerp(1.5, 1.4, k)), l: V3(0, 0, -0.02) };
  },
  social: u => {
    const a = lerp(-0.5, 0.42, smooth(seg(u, 0, 3)));
    return { p: V3(Math.sin(a) * 1.3, 1.08, Math.cos(a) * 1.3), l: V3(0, 0, 0) };
  },
  guide: u => {
    const k = smooth(seg(u, 0, 4));
    return { p: V3(lerp(0.3, -0.16, k), lerp(1.42, 1.3, k), lerp(0.9, 0.74, k)), l: V3(0, 0, -0.02) };
  },
  cal: u => {
    const k = smooth(seg(u, 0, 7));
    return { p: V3(lerp(0.18, 0, k), lerp(1.9, 2.6, k), lerp(1.0, 1.6, k)), l: V3(0, 0, 0) };
  },
  price: u => {
    const k = smooth(seg(u, 0, 5));
    return { p: V3(lerp(-0.04, 0.04, k), lerp(2.2, 2.34, k), lerp(1.1, 1.2, k)), l: V3(0, 0, 0) };
  },
  // the pull-back is keyed on log distance, from rest, or the first frame smears
  desks: u => {
    const k = smooth(seg(u, 0.2, 5.2));
    const d = Math.exp(lerp(Math.log(1.2), Math.log(19), k));
    return { p: V3(0, d * 0.5, d * 0.86), l: V3(0, 0.1, 0) };
  },
};

// ---------------------------------------------------------------- the frame
let COLLECT = null;

function visible(id) {
  for (const k in SETS) SETS[k].visible = (k === id);
}

function note(mesh, card, filter) {
  if (!COLLECT || !mesh || !mesh.visible) return;
  const c = card, w = mesh.userData.cw, h = mesh.userData.ch;
  for (const L of c.lines) {
    if (filter && !filter(L)) continue;
    const u0 = L.x0 / c.w - 0.5, u1 = L.x1 / c.w - 0.5;
    const v0 = 0.5 - L.y0 / c.h, v1 = 0.5 - L.y1 / c.h;
    const corners = [V3(u0 * w, v0 * h, 0), V3(u1 * w, v0 * h, 0), V3(u0 * w, v1 * h, 0), V3(u1 * w, v1 * h, 0)];
    const b = screenBox(mesh, corners, cam, 1920, 1080);
    if (!b) continue;
    COLLECT.push({ id: L.id, text: L.text, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, ...(L.size < 56 ? { pass: true } : {}) });
  }
}

export function renderFilm(t, opt = {}) {
  COLLECT = opt.collect ? [] : null;
  const sh = T.shotAt(t), u = t - sh.t0;
  visible(sh.id);

  // what is printed, and how much of it, inside each shot
  if (sh.id === 'screen') {
    const n = clamp(Math.floor(u / 0.45) + 1, 1, 6);
    CARDS.list.forEach((c, i) => { c.mesh.visible = (i === n - 1); });
    note(CARDS.list[n - 1].mesh, CARDS.list[n - 1]);
  }
  if (sh.id === 'printer') {
    const n = clamp(Math.floor(u / 0.3), 0, CARDS.edition.length - 1);
    CARDS.edition.forEach((c, i) => { c.mesh.visible = (i === n); });
    const m = CARDS.edition[n].mesh;
    m.position.z = 0.35 + Math.min(0.5, u * 0.12);
    note(m, CARDS.edition[n], L => L.size >= 100);
  }
  if (sh.id === 'banners') CARDS.banner.forEach((c, i) => { c.mesh.visible = u >= i * 0.5; if (c.mesh.visible) note(c.mesh, c); });
  if (sh.id === 'social') CARDS.social.forEach((c, i) => { c.mesh.visible = u >= i * 0.4; if (c.mesh.visible) note(c.mesh, c); });
  if (sh.id === 'cal') {
    CARDS.sells.mesh.visible = u >= 4.4;
    // the stamp lands with a two-frame scale pop
    const p = clamp((u - 4.4) / (2 / 30));
    CARDS.sells.mesh.scale.setScalar(lerp(1.22, 1, p));
    if (CARDS.sells.mesh.visible) note(CARDS.sells.mesh, CARDS.sells);
  }
  if (sh.id === 'desks') {
    CARDS.end.mesh.visible = u >= 2.4;
    if (CARDS.end.mesh.visible) {
      const w = u - 2.4;
      CARDS.end.mesh.position.set(0, 0.02 + w * 0.62, 0.3);
      CARDS.end.mesh.scale.setScalar(1 + w * 0.78);
      note(CARDS.end.mesh, CARDS.end);
    }
  }
  // the still cards
  const stat = { hook: CARDS.hook, number: CARDS.num, rates: CARDS.rates, guide: CARDS.guide, cal: CARDS.cal, price: CARDS.price };
  if (stat[sh.id]) {
    const m = SETS[sh.id].children.find(ch => ch.userData.card === stat[sh.id]);
    note(m, stat[sh.id]);
  }
  // the edition's masthead is a letterhead to recognise, not a line to read
  if (sh.id === 'page') {
    const m = SETS.page.children.find(ch => ch.userData.card === CARDS.page);
    note(m, CARDS.page, L => L.size >= 100);
  }


  const c = (CAM[sh.id] || CAM.hook)(u);
  cam.position.copy(c.p);
  cam.lookAt(c.l);

  // the 1-bit pass. A coarse-cell resolve opens the film: cells halve, each splitting into four.
  let cell = 1;
  if (t < 1.1) cell = [32, 16, 8, 4, 2, 1][Math.min(5, Math.floor(t / 0.18))];
  pipe.render(scene, cam, rtA, {
    lo: 0.055, hi: 0.86, edge: 1, edgeK: 0.05, lineLum: 0.32,
    cell, screenT: 0,
  });

  // inversion strikes: one or two frames at an impact, never decoration
  const f = Math.round(t * 30);
  const inv = T.STRIKES.some(s => { const sf = Math.round(s * 30); return f >= sf && f < sf + 2; });
  present.draw(rtA, null, 0, inv);
  return COLLECT;
}

// ---------------------------------------------------------------- sound events
export function buildEvents() {
  const ev = [];
  const at = (t, type, o = {}) => ev.push({ t: Math.round(t * 1000) / 1000, type, ...o });

  at(0.1, 'relay', { g: 0.9 });
  at(0.5, 'stamp', { g: 1.0 });
  at(2.5, 'stamp', { g: 0.8 });

  for (let i = 0; i < 6; i++) at(7.0 + i * 0.45, 'step', { g: 0.7 });
  at(12.0, 'stamp', { g: 1.0 });
  for (let i = 0; i < 3; i++) at(15.0 + i * 0.34, 'stamp', { g: 0.85 });

  at(19.0, 'motor', { g: 0.9 });
  for (let i = 0; i < 16; i++) at(19.2 + i * 0.3, 'step', { g: 0.5 });
  at(24.0, 'paper', { g: 0.8 });
  for (let i = 0; i < 3; i++) at(27.0 + i * 0.5, 'slap', { g: 0.9 });
  for (let i = 0; i < 3; i++) at(31.0 + i * 0.4, 'slap', { g: 0.75 });
  at(34.0, 'paper', { g: 0.8 });
  at(38.0, 'drawer', { g: 0.8 });
  at(42.4, 'stamp', { g: 1.1 });
  at(45.0, 'stamp', { g: 1.2 });
  at(50.0, 'motor', { g: 0.5 });
  at(52.4, 'slap', { g: 0.9 });

  return ev.sort((a, b) => a.t - b.t);
}
