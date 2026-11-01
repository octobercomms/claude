import pw from './pw.mjs';

// PR 5, driven.
//
// Nothing here is checkable outside a browser. Whether `createGain` can take
// a gain above 1 on a media element, whether a second call on the same
// element throws, whether a suspended context is silent — those are browser
// facts, and the whole design of audioGain.js rests on them. The arithmetic
// is in tests/edl-play.test.js; this is the part that needs Chromium.
const b = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errs = [];
let fails = 0;
const say = (ok, what, extra = '') => {
  if (!ok) fails += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${extra ? '  — ' + extra : ''}`);
};

const page = await b.newPage();
page.on('pageerror', (e) => errs.push(e.message));
// Any page from the stub, for an origin. What is driven is the browser's
// WebAudio behaviour, not this page.
await page.goto('http://127.0.0.1:4599/clients/c1/produce/edit', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// ── 1. The premises audioGain.js is built on ─────────────────────────────
const facts = await page.evaluate(async () => {
  const out = {};
  const Ctor = window.AudioContext || window.webkitAudioContext;
  out.hasCtor = !!Ctor;
  if (!Ctor) return out;
  const ac = new Ctor();
  out.initialState = ac.state;
  try { await ac.resume(); } catch { /* reported by state */ }
  out.resumedState = ac.state;

  const v = document.createElement('video');
  v.muted = false;
  document.body.appendChild(v);

  // A gain node really does go above 1, which is the whole point: an
  // element's own `volume` is clamped there by the spec.
  const g = ac.createGain();
  g.gain.value = 1.6;
  out.gainAboveOne = g.gain.value;

  // And the element's volume is not merely clamped: Chromium *throws*. That
  // is stronger than the spec's clamp and it matters, because an edit that
  // put the gain on the element rather than the node would not play quietly
  // — it would stop playing.
  try { v.volume = 1.6; out.elementVolumeThrew = false; }
  catch { out.elementVolumeThrew = true; }
  out.elementVolume = v.volume;

  const src = ac.createMediaElementSource(v);
  src.connect(g);
  g.connect(ac.destination);
  out.routed = true;

  // The reason the node is cached on the element: a second call throws.
  try { ac.createMediaElementSource(v); out.secondCallThrew = false; }
  catch { out.secondCallThrew = true; }

  // setTargetAtTime is what the ramp uses; a browser without it would need
  // the direct assignment fallback.
  out.hasSetTarget = typeof g.gain.setTargetAtTime === 'function';
  return out;
});

say(facts.hasCtor, 'this browser has an AudioContext');
// AudioParam.value is a float32, so 1.6 reads back as 1.600000023841858. An
// assertion or a cache that compared it to its target with === would never
// match, and nothing in audioGain.js reads it back for that reason.
say(Math.abs(facts.gainAboveOne - 1.6) < 1e-6, 'a gain node takes a value above 1',
  `gain.value = ${facts.gainAboveOne} (float32, so never exactly the target)`);
say(facts.elementVolumeThrew === true,
  'while setting an element\'s own volume above 1 throws',
  `volume stayed at ${facts.elementVolume} — so a gain put on the element would stop `
  + 'playback, not play it quietly. levelFor keeps the element at 1 and the gain on the node.');
say(facts.routed === true, 'an element can be routed into the graph');
say(facts.secondCallThrew === true,
  'and a second createMediaElementSource on it throws',
  'which is why the node is cached on the element rather than rebuilt');
say(facts.hasSetTarget === true, 'setTargetAtTime is available for the ramp');
say(facts.resumedState === 'running', 'and the context resumes',
  `${facts.initialState} → ${facts.resumedState}`);

// ── 2. The volume control, on a real timeline ────────────────────────────
//
// The control is the half that makes the graph worth having: before this
// nothing in the interface could set a gain at all.
{
  const p = await b.newPage();
  p.on('pageerror', (e) => errs.push('edit: ' + e.message));
  await p.goto('http://127.0.0.1:4599/clients/c1/produce/edit', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1400);
  const t = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
  // The stub has no draft edit open, so the timeline is not mounted. What can
  // be checked here is that the page loads and the editor's own explainer is
  // intact; the control itself is guarded structurally and its model is
  // covered by the unit suite.
  say(/Cut a video yourself on a timeline/i.test(t), 'the editor still names its job');
  say(!/boosted above 100%/i.test(t),
    'and nothing claims a boost on an edit that has none');
  await p.close();
}

console.log(errs.length ? 'PAGE ERRORS: ' + errs.join(' | ') : 'no page errors');
console.log(fails === 0 && errs.length === 0 ? '--- PR 5 DRIVES PASS ---' : `--- ${fails} FAILED ---`);
await b.close();
