// Fig 1 — Measuring against a false zero.
//
// The concept: a broken Meta Pixel reports 0% paid conversion while the store
// takes 809 real orders. Benchmark anything against that zero and every future
// trend is measured from a datum that was never true.
//
// The object: a dial indicator on a surface plate, its probe parked clear of
// the workpiece. The work is plainly there, with real height. The needle sits
// at zero because nothing is touching it. Lower the arm until the tip lands
// and the needle swings to the height that was there the whole time.
//
// The mechanism maps one to one:
//   the work's height   the orders that are actually happening
//   the air gap         the Pixel not firing
//   the needle at zero  "0% paid conversion rate"
//   the bezel's zero    the benchmark you set against that reading
//   closing the gap     fixing the tracking, and the number appearing

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../kit/iso-kit.mjs";
import { kitScript } from "../../scripts/inline-kit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const theme = process.argv.includes("--light") ? "light" : "dark";

const WIDTH = 640;
const HEIGHT = 420;

const PLATE = { x: -132, y: -64, w: 272, d: 128, r: 8 };
const PLATE_H = 12;
const FOOT_H = 5;

const MAG = { x: -116, y: -22, w: 46, d: 44, r: 3 };
const MAG_H = 24;
const POST = [-100, 0];
const POST_TOP = 132;
const CLAMP_Z = 86;

// The workpiece: a ground block sitting on the plate, under the probe.
const WORK = { x: 24, y: -24, w: 52, d: 48, r: 2 };
const WORK_H = 26;

const DIAL = [WORK.x + WORK.w / 2, 0];
const DIAL_R = 21;

// The travel that matters. GAP is how far the probe hangs clear of the work;
// TRAVEL is the reading that appears once it lands. One turn is 20 units, so
// 18 is most of a turn: a big, obvious swing from a needle that read nothing.
const GAP = 20;
const TRAVEL = 18;
const PER_TURN = 20;

// Heights in the head's rest frame, measured from the plate.
const TIP_Z = WORK_H + GAP;   // bottom of the probe tip, parked clear
const TIP_H = 3;
const STEM_TOP = 80;
const NECK_Z = STEM_TOP;
const NECK_H = 8;
const DIAL_Z = NECK_Z + NECK_H;
const DIAL_H = 12;
const DIAL_TOP = DIAL_Z + DIAL_H;

const P = k.fitProjection(
  [
    ...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0),
    [POST[0], POST[1], POST_TOP + 2],
    [DIAL[0] + DIAL_R, 0, DIAL_TOP],
    [DIAL[0] - DIAL_R, 0, DIAL_TOP],
  ],
  WIDTH,
  HEIGHT,
  { pad: 30, azimuth: 42 },
);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

// ---------------------------------------------------------------- base plate

function plate() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 22))) {
    out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid" }));
  out.push(L(k.sideSeam(k.insetPlan(PLATE, 0), -3, P), { tone: "faint" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));

  // Ruler strip along the back edge, ticks hanging from its edge.
  const strip = { x: -114, y: PLATE.y + PLATE.d - 15, w: 238, d: 7, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y + 0.8, 0.6, [2, 3.6], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(D([at([strip.x + 2, strip.y + 3.5, 0.6]), at([strip.x + strip.w - 2, strip.y + 3.5, 0.6])], { size: 0.45 }));

  // Label plate: three rule lines standing for printed text, and its screws.
  const label = { x: -58, y: PLATE.y + 7, w: 54, d: 18, r: 1.5 };
  out.push(S(k.slabOf(label, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  for (const [index, inset] of [0, 1, 2].entries()) {
    const y = label.y + 5 + index * 4;
    // Marked free: these stand for printed text on the plate, which is the one
    // case the craft rules let a line stop on a bare face. Without it the line
    // check counts five floating ends and is right to.
    out.push(L(k.lineOnTop([label.x + 5, y], [label.x + label.w - 7 - inset * 9, y], 0.8, P), { tone: "faint", free: true }));
  }
  out.push(D([at([label.x + 3, label.y + 3, 0.8]), at([label.x + label.w - 3, label.y + label.d - 3, 0.8])], { size: 0.4, tone: "lo" }));
  return out.join("");
}

// ------------------------------------------------------------- the workpiece

// The part being measured. It has real height whether or not anything is
// touching it, which is the whole point of the figure.
function work() {
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(WORK, 2), 0, 0.1, P)}" style="filter:blur(5px)"/>`];
  out.push(S(k.slabOf(WORK, 0, WORK_H - 2, P, 4, 0.8), { tone: "hi", crease: "lo" }));
  // A chamfered cap, so the top reads as ground rather than as a flat lid.
  out.push(S(k.slabOf(k.insetPlan(WORK, 1.2), WORK_H - 2, 2, P, 3, 0.6), { tone: "hi", crease: "lo" }));
  out.push(L(k.sideSeam(WORK, WORK_H - 2, P), { tone: "faint" }));
  out.push(L(k.planOutline(k.insetPlan(WORK, 5), WORK_H, P, 3), { tone: "faint" }));
  // A vee groove across the top, ending on the outline at both ends.
  out.push(L(k.lineOnTop([WORK.x + 5, WORK.y + WORK.d - 12], [WORK.x + WORK.w - 5, WORK.y + WORK.d - 12], WORK_H, P), { tone: "lo" }));
  out.push(L(k.lineOnTop([WORK.x + 5, WORK.y + WORK.d - 14.6], [WORK.x + WORK.w - 5, WORK.y + WORK.d - 14.6], WORK_H, P), { tone: "faint" }));
  // Dowel holes, rings with their own dots.
  const dowels = [[WORK.x + 9, WORK.y + 9], [WORK.x + WORK.w - 9, WORK.y + 9]];
  out.push(L(dowels.map(([x, y]) => k.ring(x, y, 2.4, WORK_H, P, 16)).join(""), { tone: "lo" }));
  out.push(D(dowels.map(([x, y]) => at([x, y, WORK_H])), { size: 0.5, tone: "lo" }));
  out.push(witness());
  return out.join("");
}

// --------------------------------------------------------- base, post, clamp

function fixture() {
  const out = [];
  out.push(S(k.slabOf(MAG, 0, 11, P, 6, 0.8), { tone: "mid" }));
  out.push(S(k.slabOf(k.insetPlan(MAG, 0.8), 11, MAG_H - 11, P, 6, 0.8), { tone: "mid" }));
  out.push(L(k.sideSeam(MAG, 11, P), { tone: "faint" }));
  out.push(L(k.planOutline(k.insetPlan(MAG, 3), MAG_H, P), { tone: "faint" }));
  out.push(D([
    at([MAG.x + 5, MAG.y + 5, MAG_H]),
    at([MAG.x + 5, MAG.y + MAG.d - 5, MAG_H]),
    at([MAG.x + MAG.w - 5, MAG.y + 5, MAG_H]),
    at([MAG.x + MAG.w - 5, MAG.y + MAG.d - 5, MAG_H]),
  ], { size: 0.45 }));

  // The on/off knob of the magnetic base, with its index line.
  const knob = [MAG.x + 34, MAG.y + 32];
  out.push(S(k.cylinder(knob[0], knob[1], 6, MAG_H, 4, P, 32), { tone: "mid" }));
  out.push(L(k.knurl(knob[0], knob[1], 6, MAG_H, MAG_H + 4, 36, P), { tone: "lo" }));
  out.push(L(k.lineOnTop([knob[0], knob[1]], [knob[0] + 6, knob[1]], MAG_H + 4, P), { tone: "hi" }));
  out.push(D([at([knob[0], knob[1], MAG_H + 4])], { size: 0.5, tone: "hi" }));

  // Post: a collar, the shaft with two wear rings, the clamp, the capped top.
  out.push(S(k.cylinder(POST[0], POST[1], 5, MAG_H, 4, P, 28), { tone: "mid" }));
  out.push(S(k.cylinder(POST[0], POST[1], 3.2, MAG_H + 4, CLAMP_Z - 4 - MAG_H - 4, P, 28), { tone: "mid", crease: "none" }));
  out.push(L([42, 56].map((z) => k.sideArc(POST[0], POST[1], 3.2, z, P, 16)).join(""), { tone: "faint" }));
  // One shaft the whole way up. The clamp that rides it belongs to the head.
  out.push(S(k.cylinder(POST[0], POST[1], 3.2, MAG_H + 4, POST_TOP - MAG_H - 4, P, 28), { tone: "mid", crease: "none" }));
  out.push(L([44, 62, 80].map((z) => k.sideArc(POST[0], POST[1], 3.2, z, P, 16)).join(""), { tone: "faint" }));
  out.push(S(k.cylinder(POST[0], POST[1], 3.8, POST_TOP, 2, P, 28), { tone: "mid" }));
  return out.join("");
}

// The clamp and its thumb screw, drawn in the head's rest frame: slacken it
// and the whole gauge slides down the post, which is the motion the figure is
// about. Drawn before the arm it holds.
function clampBlock() {
  const out = [];
  const clamp = { x: POST[0] - 7, y: POST[1] - 7, w: 14, d: 14, r: 2.5 };
  out.push(S(k.slabOf(clamp, CLAMP_Z - 4, 12, P, 4, 0.6), { tone: "mid" }));
  out.push(L(k.sideSeam(clamp, CLAMP_Z + 2, P), { tone: "faint" }));
  const thumb = [clamp.x + 7, clamp.y + clamp.d + 3];
  out.push(S(k.slabOf({ x: thumb[0] - 1.4, y: clamp.y + clamp.d, w: 2.8, d: 3, r: 0.8 }, CLAMP_Z + 1, 4, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(thumb[0], thumb[1] + 1.4, 2.8, CLAMP_Z, 6, P, 20), { tone: "mid" }));
  out.push(L(k.knurl(thumb[0], thumb[1] + 1.4, 2.8, CLAMP_Z, CLAMP_Z + 6, 18, P), { tone: "lo" }));
  out.push(D([at([thumb[0], thumb[1] + 1.4, CLAMP_Z + 6])], { size: 0.5, tone: "lo" }));
  return out.join("");
}

// ------------------------------------------------- the head: arm, dial, stem

// The arm from the post to the dial's neck. Drawn in the head's rest frame;
// the whole group moves down in z.
function arm() {
  const out = [];
  const plan = { x: POST[0] + 7, y: -3.5, w: DIAL[0] - POST[0] - 7 - 4, d: 7, r: 2 };
  out.push(S(k.slabOf(plan, CLAMP_Z, 5, P, 4, 0.5), { tone: "mid" }));
  out.push(L(k.lineOnTop([plan.x + 3, 0], [plan.x + plan.w - 3, 0], CLAMP_Z + 5, P), { tone: "faint" }));
  out.push(D([at([plan.x + 5, 0, CLAMP_Z + 5]), at([plan.x + plan.w - 6, 0, CLAMP_Z + 5])], { size: 0.45 }));
  // The split clamp that grips the indicator's neck, with its pinch screw.
  const grip = { x: DIAL[0] - 9, y: -8, w: 18, d: 16, r: 3 };
  out.push(S(k.slabOf(grip, CLAMP_Z - 1, 8, P, 4, 0.6), { tone: "mid" }));
  out.push(L(k.sideSeam(grip, CLAMP_Z + 3, P), { tone: "faint" }));
  out.push(D([at([grip.x + 4, grip.y + 3, CLAMP_Z + 7]), at([grip.x + grip.w - 4, grip.y + 3, CLAMP_Z + 7])], { size: 0.45 }));
  return out.join("");
}

function dial() {
  const out = [];
  const [x, y] = DIAL;
  // The neck below the head, and the gland the plunger runs in.
  out.push(S(k.cylinder(x, y, 4, NECK_Z, NECK_H, P, 28), { tone: "mid" }));
  out.push(L(k.sideArc(x, y, 4, NECK_Z + 4, P, 16), { tone: "faint" }));
  out.push(S(k.cylinder(x, y, 5.2, NECK_Z - 4, 4, P, 28), { tone: "mid" }));
  out.push(L(k.knurl(x, y, 5.2, NECK_Z - 4, NECK_Z, 24, P), { tone: "lo" }));

  // The head itself.
  out.push(S(k.cylinder(x, y, DIAL_R, DIAL_Z, DIAL_H, P, 64, 0.8), { tone: "hi", crease: "lo" }));
  out.push(L(k.knurl(x, y, DIAL_R, DIAL_TOP - 3.4, DIAL_TOP, 84, P, 0.3), { tone: "lo" }));
  out.push(L(k.sideArc(x, y, DIAL_R, DIAL_TOP - 3.4, P, 40), { tone: "faint" }));
  out.push(L(k.ring(x, y, DIAL_R - 2.2, DIAL_TOP, P, 64), { tone: "lo" }));
  const ticks = k.radialTicks(x, y, DIAL_R - 3.4, 50, 5, DIAL_TOP, [1.4, 3], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));

  // The bezel lugs and the crown, so the head has something to hold.
  out.push(S(k.slabOf({ x: x + DIAL_R - 1, y: -2.6, w: 5, d: 5.2, r: 1.2 }, DIAL_Z + 2, 5, P, 3), { tone: "mid" }));
  out.push(S(k.slabOf({ x: x + DIAL_R + 3.6, y: -3.4, w: 2.8, d: 6.8, r: 1.2 }, DIAL_Z + 1.2, 6.6, P, 3), { tone: "mid" }));
  out.push(S(k.slabOf({ x: x - DIAL_R - 4, y: -2.6, w: 5, d: 5.2, r: 1.2 }, DIAL_Z + 2, 5, P, 3), { tone: "mid" }));

  // The hub the needle turns on.
  out.push(L(k.ring(x, y, 1.8, DIAL_TOP, P, 16), { tone: "mid" }));

  // The one engraved label the craft rules allow.
  out.push(k.faceTextSvg(k.topMatrix([x, y + 10], DIAL_TOP, P, "x"), "CONV", { size: 2.6, tone: "lo", anchor: "middle" }));
  return out.join("");
}

// The zero index: the mark someone set the bezel to while the needle read
// nothing. It is the benchmark, and it is wrong, which is why it is drawn in
// the tone that says "look at this" without being the one lit part.
const zeroMark = () => {
  const [x, y] = DIAL;
  return k.lineOnTop([x, y - (DIAL_R - 1.6)], [x, y - (DIAL_R - 5.4)], DIAL_TOP + 0.1, P);
};

const needleAt = (turn) => {
  const angle = turn * Math.PI * 2;
  const [x, y] = DIAL;
  return k.lineOnTop(
    [x - Math.sin(angle) * 3.6, y + Math.cos(angle) * 3.6],
    [x + Math.sin(angle) * (DIAL_R - 4.4), y - Math.cos(angle) * (DIAL_R - 4.4)],
    DIAL_TOP + 0.2,
    P,
  );
};

// The witness mark: the spot on the work the probe is supposed to land on.
//
// This is the part that makes the figure work, and it took two goes. In
// isometric a floating object reads as resting on whatever surface is behind
// it, so at 1x the parked probe looked like it was touching the block — and a
// figure about a gap in which the gap is invisible explains nothing.
//
// The first fix was a blurred contact shadow, which was wrong twice over: the
// kit's halo is dark, so on a dark block in the dark theme it showed nothing,
// and a blur is a trick rather than a part. A machinist scribes a witness ring
// where the probe should sit. It is a real feature, it is always there, and a
// probe hanging over a target it is not touching is unmistakable.
const WITNESS = 4.6;
const witness = () => [
  k.lineSvg(k.ring(DIAL[0], DIAL[1], WITNESS, WORK_H, P, 28), { tone: "mid" }),
  k.lineSvg(k.ring(DIAL[0], DIAL[1], WITNESS - 1.6, WORK_H, P, 24), { tone: "faint" }),
  k.dotsSvg([at([DIAL[0], DIAL[1], WORK_H])], { size: 0.55, tone: "mid" }),
].join("");

// The plunger. Its stem is the one part whose shape changes: the tip stops on
// the work and the stem shortens as the head keeps coming down.
const plungerSvg = (tipZ, stemTop) => [
  k.solidSvg(k.cylinder(DIAL[0], DIAL[1], 1.5, tipZ + TIP_H, Math.max(0.1, stemTop - tipZ - TIP_H), P, 16), { tone: "hi", crease: "none", lit: true }),
  k.solidSvg(k.cylinder(DIAL[0], DIAL[1], 2.6, tipZ, TIP_H, P, 20), { tone: "hi", lit: true }),
].join("");

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "A dial indicator on a surface plate. A magnetic base holds a post; an arm clamped to the post carries the indicator over a ground block. The probe hangs clear of the block, so the needle reads zero while the block is plainly there. Lower the arm until the probe lands and the needle swings to the block's real height.",
  body: [
    plate(),
    work(),
    fixture(),
    `<g data-part="head">${clampBlock()}${arm()}${dial()}` +
      `<path data-part="zero" class="iso-line" data-tone="hi" data-free="end" d="${zeroMark()}" style="stroke-width:1"/>` +
      `<path data-part="needle" class="iso-line" data-tone="lit" data-free="start" d="${needleAt(0)}" style="stroke-width:1.1"/></g>`,
    `<g data-part="plunger">${plungerSvg(TIP_Z, STEM_TOP)}</g>`,
  ],
});

const live = `
const P = ${JSON.stringify(P)};
const DIAL = ${JSON.stringify(DIAL)};
const DIAL_R = ${DIAL_R}, DIAL_TOP = ${DIAL_TOP}, PER_TURN = ${PER_TURN};
const TIP_Z = ${TIP_Z}, TIP_H = ${TIP_H}, STEM_TOP = ${STEM_TOP}, GAP = ${GAP}, TRAVEL = ${TRAVEL};
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const head = svg.querySelector('[data-part="head"]');
const plunger = svg.querySelector('[data-part="plunger"]');
const needle = svg.querySelector('[data-part="needle"]');
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const needleAt = ${needleAt.toString().replace(/k\./g, "")};
const plungerSvg = ${plungerSvg.toString().replace(/k\./g, "")};


// How far the head has come down, 0 (parked) to GAP + TRAVEL (fully read).
let drop = 0, target = 0;
let frame = 0, last = 0, clock = 0, touring = true, visible = false, idleTimer = 0;
// The tour dwells on the two states that make the point: parked at zero, then
// in contact. The pause at each end is what lets the zero reading land.
const tourAt = (t) => { const cycle = t % 7.2; return cycle < 3.6 ? 0 : GAP + TRAVEL; };

function draw() {
  head.setAttribute("transform", translateAlong(P, [0, 0, -drop]));
  // The tip stops on the work; past that the stem shortens instead.
  const squash = Math.max(0, drop - GAP);
  const tipZ = TIP_Z - Math.min(drop, GAP);
  plunger.innerHTML = plungerSvg(tipZ, STEM_TOP - drop);
  const reads = squash;
  needle.setAttribute("d", needleAt(reads / PER_TURN));
  const text = squash > 0.05
    ? "contact · reads " + reads.toFixed(1)
    : "no contact · reads 0.0";
  if (readout.textContent !== text) readout.textContent = text;
  stage.setAttribute("aria-valuenow", String(Math.round(reads)));
  stage.setAttribute("aria-valuetext", text);
}

function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;
  if (touring) { clock += dt; target = tourAt(clock); }
  drop = calm ? target : drop + (target - drop) * (1 - Math.exp(-dt / 0.34));
  if (Math.abs(target - drop) < 0.01) drop = target;
  draw();
  const settled = !touring && drop === target;
  frame = visible && !settled ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
const steer = (next) => {
  touring = false;
  target = clamp(next, 0, GAP + TRAVEL);
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { touring = !still.matches; clock = 0; run(); }, 3600);
  run();
};
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
if (still.matches) touring = false;
stage.addEventListener("pointermove", (event) => {
  const box = svg.getBoundingClientRect();
  const share = clamp(((event.clientX - box.left) / box.width - 0.22) / 0.56, 0, 1);
  steer(share * (GAP + TRAVEL));
});
stage.addEventListener("pointerleave", () => steer(target));
stage.addEventListener("keydown", (event) => {
  let to = null;
  if (event.key === "ArrowRight" || event.key === "ArrowUp") to = Math.min(GAP + TRAVEL, target + 3);
  if (event.key === "ArrowLeft" || event.key === "ArrowDown") to = Math.max(0, target - 3);
  if (event.key === "Home") to = 0;
  if (event.key === "End") to = GAP + TRAVEL;
  if (to === null) return;
  event.preventDefault();
  steer(to);
});
draw();
`;

const body = k.plateHtml({
  fig: "Fig 1",
  title: "A false zero",
  hint: "Hover to lower the probe",
  readout: "no contact · reads 0.0",
  keys: [
    { mark: "lit", label: "Probe and needle: nothing moves until the tip lands" },
    { mark: "raised", label: "The workpiece, 18 units tall whether or not anything is reading it" },
  ],
  caption:
    "A dial indicator whose probe is parked clear of the work. The needle reads zero and the block is still 18 units tall. Set the bezel to that reading and every measurement after it is taken from a datum that was never true. Lower the arm, and the number that was there the whole time appears at once.",
  body: `<div class="iso-stage" tabindex="0" role="slider" aria-label="Dial indicator: arrow keys lower the probe onto the work" aria-valuemin="0" aria-valuemax="${TRAVEL}" aria-valuenow="0">${svg}</div>`,
});

const name = theme === "light" ? "false-zero-light.html" : "false-zero.html";
writeFileSync(join(HERE, name), k.pageHtml({ title: "A false zero", theme, body, script: kitScript() + live }));
console.log("wrote", name);
