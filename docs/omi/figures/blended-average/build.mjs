// Fig 2 — One average over six unlike things.
//
// The concept: Falcon has six storefronts, consumer DTC and trade portal
// across UK, US and EU, with completely different order values. Every order
// blends into one £174 average, and that average is the only number anyone is
// given. It is arithmetically correct and commercially useless.
//
// The object: a comparator with six weights seated in six bored pockets, and
// two dials. AVERAGE reads the mean. SPREAD reads the gap between the heaviest
// and the lightest. Redistribute the weights without changing the total and
// the AVERAGE needle does not move at all, while SPREAD swings from almost
// nothing to the end of its scale.
//
// That is the whole argument, and it is why the figure has two dials rather
// than one: a single still needle reads as a broken instrument. The needle
// that moves is what makes the still one damning.
//
// The mechanism maps one to one:
//   each weight's height   one storefront's average order value
//   the AVERAGE dial       the £174 everyone quotes
//   the SPREAD dial        the range it is hiding
//   same total, any shape  why the quoted number cannot be acted on

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../kit/iso-kit.mjs";
import { kitScript } from "../../scripts/inline-kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";

const WIDTH = 680;
const HEIGHT = 430;

const PLATE = { x: -142, y: -70, w: 288, d: 140, r: 8 };
const PLATE_H = 12;
const FOOT_H = 5;

// The rack of six pockets. Six because Falcon has six storefronts, and the
// count is the point: one number stands in for all of them.
const STORES = 6;
const RACK = { x: -126, y: -30, w: 132, d: 60, r: 4 };
const RACK_H = 10;
const PITCH = 21;
const BORE_R = 7.4;
const FIRST = RACK.x + 18;
const bore = (i) => [FIRST + i * PITCH, 0];

// Weight heights, in the same units the dials read. The two poses are the
// figure: identical totals, opposite shapes.
const EVEN = [26, 25, 27, 26, 24, 26];
const SPLIT = [8, 9, 10, 44, 45, 38];
const SUM = EVEN.reduce((a, b) => a + b, 0);
const MEAN = SUM / STORES;
const spreadOf = (set) => Math.max(...set) - Math.min(...set);

const COLUMN = [46, 6];
const COLUMN_TOP = 150;
const DIAL_R = 23;
const DIAL_H = 11;
// Two gauges on one column, one above the other.
//
// They were side by side at different depths, and the near one covered a
// third of the far one while the column rose between them. Stacked, neither
// occludes the other, both are read from the same place, and the figure gains
// the height it needed against a wide base plate — which is also how a real
// twin-gauge stand is built.
const DIAL_AT = [100, 6];
const DIALS = [
  { key: "mean", z: 128, label: "BLENDED", full: 60 },
  { key: "spread", z: 62, label: null, full: 60 },
];
const topOf = (d) => d.z + DIAL_H;

const P = k.fitProjection(
  [
    ...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0),
    [COLUMN[0], COLUMN[1], COLUMN_TOP],
    ...DIALS.flatMap(d => [[DIAL_AT[0] + DIAL_R, DIAL_AT[1], topOf(d)], [DIAL_AT[0] - DIAL_R, DIAL_AT[1], topOf(d)]]),
    [bore(0)[0] - BORE_R, 0, RACK_H + 60],
  ],
  WIDTH,
  HEIGHT,
  { pad: 28, azimuth: 40 },
);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

// ---------------------------------------------------------------- base plate

function plate() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 24))) {
    out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid" }));
  out.push(L(k.sideSeam(PLATE, -3, P), { tone: "faint" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));

  const strip = { x: -124, y: PLATE.y + PLATE.d - 15, w: 252, d: 7, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y + 0.8, 0.6, [2, 3.6], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(D([at([strip.x + 2, strip.y + 3.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.6])], { size: 0.45 }));

  const label = { x: -118, y: PLATE.y + 8, w: 54, d: 18, r: 1.5 };
  out.push(S(k.slabOf(label, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  [0, 1, 2].forEach((row, index) => {
    const y = label.y + 5 + index * 4;
    out.push(L(k.lineOnTop([label.x + 5, y], [label.x + label.w - 7 - index * 9, y], 0.8, P), { tone: "faint", free: true }));
  });
  out.push(D([at([label.x + 3, label.y + 3, 0.8]), at([label.x + label.w - 3, label.y + label.d - 3, 0.8])], { size: 0.4, tone: "lo" }));
  return out.join("");
}

// ------------------------------------------------------------- the six bores

// The rack the weights seat in. The bores and their chamfers are what stop
// this reading as six bars on a chart: a weight sits IN something, and the
// seat is drawn.
function rack() {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(RACK, 2), 0, 0.1, P)}" style="filter:blur(5px)"/>`];
  out.push(S(k.slabOf(RACK, 0, RACK_H, P, 4, 0.8), { tone: "mid" }));
  out.push(L(k.sideSeam(RACK, RACK_H - 3, P), { tone: "faint" }));
  out.push(L(k.planOutline(k.insetPlan(RACK, 4), RACK_H, P), { tone: "faint" }));
  for (let i = 0; i < STORES; i++) {
    const [x, y] = bore(i);
    // The seat: a chamfer ring and the bore under it, so the weight has
    // somewhere to be rather than standing on a surface.
    out.push(L(k.ring(x, y, BORE_R, RACK_H, P, 28), { tone: "mid" }));
    out.push(L(k.ring(x, y, BORE_R - 1.5, RACK_H - 0.8, P, 28), { tone: "faint" }));
    // A witness tick per pocket, hanging off the rack's front edge, so you
    // can see there are six of them without counting the weights.
    out.push(L(k.lineOnTop([x, RACK.y + RACK.d - 4], [x, RACK.y + RACK.d], RACK_H, P), { tone: "lo" }));
    out.push(D([at([x, RACK.y + RACK.d - 4, RACK_H])], { size: 0.4, tone: "lo" }));
  }
  return out.join("");
}

// One weight: a seated body, a waist, and a knurled lifting knob. The knob is
// what makes it a weight you pick up rather than a column someone drew.
function weightSvg(i, height) {
  const [x, y] = bore(i);
  const base = RACK_H;
  const body = Math.max(4, height - 6);
  return [
    k.solidSvg(k.cylinder(x, y, BORE_R - 1.4, base, body, P, 28, 0.6), { tone: "hi", crease: "lo" }),
    k.lineSvg(k.sideArc(x, y, BORE_R - 1.4, base + body - 2.4, P, 18), { tone: "faint" }),
    k.solidSvg(k.cylinder(x, y, 2.4, base + body, 2.4, P, 18), { tone: "hi", crease: "none" }),
    k.solidSvg(k.cylinder(x, y, 4.2, base + body + 2.4, 3.4, P, 24), { tone: "hi" }),
    k.lineSvg(k.knurl(x, y, 4.2, base + body + 2.4, base + body + 5.8, 20, P), { tone: "lo" }),
    k.dotsSvg([at([x, y, base + body + 5.8])], { size: 0.5, tone: "lo" }),
  ].join("");
}

// ------------------------------------------------------- the column and dials

function column() {
  const out = [];
  const foot = { x: COLUMN[0] - 15, y: COLUMN[1] - 15, w: 30, d: 30, r: 4 };
  out.push(S(k.slabOf(foot, 0, 9, P, 5, 0.8), { tone: "mid" }));
  out.push(L(k.sideSeam(foot, 4, P), { tone: "faint" }));
  out.push(D(k.corners(foot, 7).map(([x, y]) => at([x, y, 9])), { size: 0.45 }));
  out.push(S(k.cylinder(COLUMN[0], COLUMN[1], 6.5, 9, 5, P, 28), { tone: "mid" }));
  out.push(S(k.cylinder(COLUMN[0], COLUMN[1], 4.2, 14, COLUMN_TOP - 14, P, 28), { tone: "mid", crease: "none" }));
  out.push(L([36, 62, 96].map((z) => k.sideArc(COLUMN[0], COLUMN[1], 4.2, z, P, 16)).join(""), { tone: "faint" }));
  out.push(S(k.cylinder(COLUMN[0], COLUMN[1], 5, COLUMN_TOP, 2.4, P, 28), { tone: "mid" }));
  // One clamp and one arm per gauge, each at its own height on the column.
  for (const d of DIALS) {
    const clamp = { x: COLUMN[0] - 8, y: COLUMN[1] - 8, w: 16, d: 16, r: 3 };
    out.push(S(k.slabOf(clamp, d.z - 8, 10, P, 4, 0.6), { tone: "mid" }));
    out.push(L(k.sideSeam(clamp, d.z - 3, P), { tone: "faint" }));
    const thumb = [clamp.x + 8, clamp.y + clamp.d + 3];
    out.push(S(k.cylinder(thumb[0], thumb[1], 2.8, d.z - 7, 6, P, 20), { tone: "mid" }));
    out.push(L(k.knurl(thumb[0], thumb[1], 2.8, d.z - 7, d.z - 1, 18, P), { tone: "lo" }));
    out.push(D([at([thumb[0], thumb[1], d.z - 1])], { size: 0.5, tone: "lo" }));
    const span = { x: COLUMN[0], y: DIAL_AT[1] - 3.5, w: DIAL_AT[0] - COLUMN[0] - DIAL_R + 4, d: 7, r: 2 };
    out.push(S(k.slabOf(span, d.z - 6, 5, P, 3, 0.5), { tone: "mid" }));
    out.push(D([at([span.x + 7, DIAL_AT[1], d.z - 1]), at([span.x + span.w - 5, DIAL_AT[1], d.z - 1])], { size: 0.45 }));
  }
  return out.join("");
}

// A dial reading a quantity over a 270 degree scale, which is how a real gauge
// is laid out: the reader can see where the needle sits in its travel, and a
// needle parked at the bottom of its range still looks parked rather than
// broken.
const SPAN = Math.PI * 1.5;
const FROM = -Math.PI * 0.75;

function dialFace(d) {
  const out = [];
  const [x, y] = DIAL_AT;
  const DIAL_Z = d.z;
  const DIAL_TOP = topOf(d);
  out.push(S(k.cylinder(x, y, DIAL_R, DIAL_Z, DIAL_H, P, 64, 0.8), { tone: "hi", crease: "lo" }));
  out.push(L(k.knurl(x, y, DIAL_R, DIAL_TOP - 3.4, DIAL_TOP, 88, P, 0.3), { tone: "lo" }));
  out.push(L(k.sideArc(x, y, DIAL_R, DIAL_TOP - 3.4, P, 40), { tone: "faint" }));
  out.push(L(k.ring(x, y, DIAL_R - 2.4, DIAL_TOP, P, 64), { tone: "lo" }));
  // The ticks hang FROM the ring, so their outer ends have something to land
  // on. At DIAL_R - 3.6 against a ring at DIAL_R - 2.4 they stopped 1.2 units
  // short and the line check counted twelve floating ends.
  const ticks = k.radialTicks(x, y, DIAL_R - 2.4, 30, 5, DIAL_TOP, [1.4, 3.2], P, FROM, SPAN);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(S(k.slabOf({ x: x + DIAL_R - 1, y: y - 2.6, w: 5, d: 5.2, r: 1.2 }, DIAL_Z + 2, 5, P, 3), { tone: "mid" }));
  out.push(S(k.slabOf({ x: x + DIAL_R + 3.6, y: y - 3.4, w: 2.8, d: 6.8, r: 1.2 }, DIAL_Z + 1.2, 6.6, P, 3), { tone: "mid" }));
  out.push(S(k.slabOf({ x: x - DIAL_R - 4, y: y - 2.6, w: 5, d: 5.2, r: 1.2 }, DIAL_Z + 2, 5, P, 3), { tone: "mid" }));
  out.push(L(k.ring(x, y, 1.8, DIAL_TOP, P, 16), { tone: "mid" }));
  // The one engraved label the craft rules allow, on the dial that matters.
  if (d.label) out.push(k.faceTextSvg(k.topMatrix([x, y + 11], DIAL_TOP, P, "x"), d.label, { size: 2.6, tone: "lo", anchor: "middle" }));
  return out.join("");
}

const needleAt = (top, share) => {
  const angle = FROM + Math.max(0, Math.min(1, share)) * SPAN;
  const [x, y] = DIAL_AT;
  return k.lineOnTop(
    [x - Math.sin(angle) * 3.8, y + Math.cos(angle) * 3.8],
    // The tip lands on the tick ring rather than stopping in the face. A
    // pointer's tip is one of the few ends the craft rules let float, but a
    // gauge needle that reaches its scale is what a gauge looks like, and the
    // line check was right to flag the gap.
    [x + Math.sin(angle) * (DIAL_R - 2.4), y - Math.cos(angle) * (DIAL_R - 2.4)],
    top + 0.2,
    P,
  );
};

const weightsSvg = (set) => set.map((h, i) => weightSvg(i, h)).join("");

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "A comparator on a surface plate. Six weights of different heights sit in six bored pockets; a column beside them carries two dials. The upper dial reads the average of the six, the lower one the spread between the heaviest and the lightest. Rearranging the weights without changing their total leaves the average needle exactly where it is while the spread needle swings across its scale.",
  body: [
    plate(),
    rack(),
    `<g data-part="weights">${weightsSvg(EVEN)}</g>`,
    column(),
    // Upper gauge and its needle first, then the lower one over it: the lower
    // gauge is nearer the viewer and must paint last.
    dialFace(DIALS[0]),
    `<path data-part="needle-mean" class="iso-line" data-tone="hi" data-free="start" d="${needleAt(topOf(DIALS[0]), MEAN / DIALS[0].full)}" style="stroke-width:1.1"/>`,
    dialFace(DIALS[1]),
    `<path data-part="needle-spread" class="iso-line" data-tone="lit" data-free="start" d="${needleAt(topOf(DIALS[1]), spreadOf(EVEN) / DIALS[1].full)}" style="stroke-width:1.1"/>`,
  ],
});

const live = `
const P = ${JSON.stringify(P)};
const DIALS = ${JSON.stringify(DIALS)};
const EVEN = ${JSON.stringify(EVEN)};
const SPLIT = ${JSON.stringify(SPLIT)};
const STORES = ${STORES}, RACK_H = ${RACK_H}, BORE_R = ${BORE_R}, PITCH = ${PITCH}, FIRST = ${FIRST};
const DIAL_R = ${DIAL_R}, DIAL_AT = ${JSON.stringify(DIAL_AT)}, SPAN = ${SPAN}, FROM = ${FROM};
const TOPS = ${JSON.stringify(DIALS.map(topOf))};
const MEAN = ${MEAN};
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const weights = svg.querySelector('[data-part="weights"]');
const needleMean = svg.querySelector('[data-part="needle-mean"]');
const needleSpread = svg.querySelector('[data-part="needle-spread"]');
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const bore = ${bore.toString()};
const at = (point) => iso(point, P);
const weightSvg = ${weightSvg.toString().replace(/k\./g, "")};
const weightsSvg = ${weightsSvg.toString()};
const needleAt = ${needleAt.toString().replace(/k\./g, "")};
const spreadOf = ${spreadOf.toString()};

// The two poses share a total exactly, which is what makes the still needle
// honest rather than a rounding artefact. Anything in between is a blend of
// the two, so every frame on the way across has the same total too.
let share = 0, target = 0;
let frame = 0, last = 0, clock = 0, touring = true, visible = false, idleTimer = 0;
const tourAt = (t) => { const cycle = t % 7.6; return cycle < 3.8 ? 0 : 1; };
const mix = (s) => EVEN.map((a, i) => a + (SPLIT[i] - a) * s);

function draw() {
  const set = mix(share);
  weights.innerHTML = weightsSvg(set);
  const mean = set.reduce((a, b) => a + b, 0) / STORES;
  const spread = spreadOf(set);
  needleMean.setAttribute("d", needleAt(TOPS[0], mean / DIALS[0].full));
  needleSpread.setAttribute("d", needleAt(TOPS[1], spread / DIALS[1].full));
  const text = "average " + mean.toFixed(1) + " · spread " + spread.toFixed(1);
  if (readout.textContent !== text) readout.textContent = text;
  stage.setAttribute("aria-valuenow", String(Math.round(spread)));
  stage.setAttribute("aria-valuetext", text);
}

function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;
  if (touring) { clock += dt; target = tourAt(clock); }
  share = calm ? target : share + (target - share) * (1 - Math.exp(-dt / 0.42));
  if (Math.abs(target - share) < 0.002) share = target;
  draw();
  const settled = !touring && share === target;
  frame = visible && !settled ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
const steer = (next) => {
  touring = false;
  target = clamp(next, 0, 1);
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { touring = !still.matches; clock = 0; run(); }, 3600);
  run();
};
new IntersectionObserver((e) => { visible = e[e.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
if (still.matches) touring = false;
stage.addEventListener("pointermove", (event) => {
  const box = svg.getBoundingClientRect();
  steer(clamp(((event.clientX - box.left) / box.width - 0.22) / 0.56, 0, 1));
});
stage.addEventListener("pointerleave", () => steer(target));
stage.addEventListener("keydown", (event) => {
  let to = null;
  if (event.key === "ArrowRight" || event.key === "ArrowUp") to = Math.min(1, target + 0.2);
  if (event.key === "ArrowLeft" || event.key === "ArrowDown") to = Math.max(0, target - 0.2);
  if (event.key === "Home") to = 0;
  if (event.key === "End") to = 1;
  if (to === null) return;
  event.preventDefault();
  steer(to);
});
draw();
`;

const body = k.plateHtml({
  fig: "Fig 2",
  title: "One average, six stores",
  hint: "Hover to redistribute the weights",
  readout: `average ${MEAN.toFixed(1)} · spread ${spreadOf(EVEN).toFixed(1)}`,
  keys: [
    { mark: "lit", label: "Spread: the range the average is standing in for" },
    { mark: "raised", label: "Six weights, one per storefront, same total throughout" },
  ],
  caption:
    "Six weights in six pockets, and two dials reading them. Move the weight around without changing the total and the upper needle does not shift by a hair, because the average cannot: it is the same arithmetic over the same sum. The lower needle swings from almost nothing to the end of its scale. Both of these are one £174 average order value, and only one of them is a business you would run the same way.",
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="Comparator: arrow keys redistribute the weights without changing their total" aria-valuemin="0" aria-valuemax="60" aria-valuenow="${Math.round(spreadOf(EVEN))}">${svg}</div>`,
});

const name = theme === "light" ? "blended-average-light.html" : "blended-average.html";
writeFileSync(join(HERE, name), k.pageHtml({ title: "One average, six stores", theme, body, script: kitScript() + live }));
console.log("wrote", name, "· mean", MEAN.toFixed(2), "· spreads", spreadOf(EVEN), "→", spreadOf(SPLIT));
