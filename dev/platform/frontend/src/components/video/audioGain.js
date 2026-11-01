/**
 * Playing a block louder than the source.
 *
 * The last thing left in section 2.2 of the timeline spec. An HTML element's
 * `volume` is clamped to 1 by the spec, so a block boosted to 160% played at
 * 100% and the player told you the render would be louder than what you were
 * hearing. Which is honest, and no use when the reason you boosted it is that
 * the speaker is quiet and you want to know whether 160% is enough.
 *
 * Exceeding 1 means a WebAudio graph: element → MediaElementAudioSourceNode →
 * GainNode → destination. Three things about that are worth knowing before
 * reading the code, because each one is a way to lose all the audio.
 *
 * 1. `createMediaElementSource` can be called **once** per element, and it
 *    permanently diverts that element's output into the graph. There is no
 *    undoing it. So the graph is built lazily, only for a player that has a
 *    boosted block, and the source node is kept for the element's lifetime.
 *
 * 2. An AudioContext starts suspended under the autoplay policy. An element
 *    routed into a suspended context is silent — worse than capped. So
 *    `resume()` is awaited from inside the user gesture that starts playback,
 *    and a context that will not resume is treated as no graph at all.
 *
 * 3. `volume` applies before the tap, so element volume and node gain
 *    multiply. `levelFor` in shared/edlPlay.mjs owns that arithmetic; this
 *    file owns the plumbing and nothing else.
 *
 * Every failure here falls back to the capped behaviour and says so, because
 * a preview that is quieter than the render is a worse outcome than a preview
 * with no sound only if you know which one you got.
 */

let ctx = null;

function context() {
  if (ctx) return ctx;
  const Ctor = typeof window !== 'undefined'
    && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) return null;
  try { ctx = new Ctor(); } catch { ctx = null; }
  return ctx;
}

/**
 * Route one element through a gain node, once.
 *
 * Returns the node, or null if this browser cannot do it. The node is cached
 * on the element itself rather than in a map, so it cannot outlive the
 * element or be looked up for the wrong one.
 */
export function gainNodeFor(element) {
  if (!element) return null;
  if (element.__omiGain !== undefined) return element.__omiGain;
  const ac = context();
  if (!ac) { element.__omiGain = null; return null; }
  try {
    const src = ac.createMediaElementSource(element);
    const gain = ac.createGain();
    gain.gain.value = 1;
    src.connect(gain);
    gain.connect(ac.destination);
    element.__omiGain = gain;
    // Kept so a later read can tell "not tried" from "tried and failed".
    element.__omiSource = src;
  } catch {
    // CORS is the usual reason: an element whose media is cross-origin
    // without permission taints the graph and throws here. Nothing is routed,
    // so the element keeps playing on its own.
    element.__omiGain = null;
  }
  return element.__omiGain;
}

/** Has this element already been routed? Does not build the graph. */
export function isRouted(element) {
  return !!(element && element.__omiGain);
}

/**
 * Make the context usable, from inside a user gesture.
 *
 * Resolves true only when audio can actually come out. Called from play(),
 * where the gesture is, and never speculatively: resuming a context nobody
 * asked for keeps an audio device awake for a page that may never play.
 */
export async function wake() {
  const ac = context();
  if (!ac) return false;
  if (ac.state === 'running') return true;
  try { await ac.resume(); } catch { return false; }
  return ac.state === 'running';
}

/** What the context is doing, for the interface to report honestly. */
export function state() {
  return ctx ? ctx.state : 'none';
}

/** Set a routed element's gain. A no-op on one that is not routed. */
export function setGain(element, value) {
  const node = element && element.__omiGain;
  if (!node) return false;
  const v = Number.isFinite(value) ? Math.max(0, Math.min(4, value)) : 1;
  try {
    // setTargetAtTime over a direct assignment: a step change on a gain node
    // is an audible click, and a 10ms constant is below the threshold where a
    // cross-fade would sound late.
    node.gain.setTargetAtTime(v, node.context.currentTime, 0.01);
  } catch {
    try { node.gain.value = v; } catch { return false; }
  }
  return true;
}

// Test seam. The module holds one context for the page, which is right at
// runtime and wrong for a test that wants to start from nothing.
export function __reset() { ctx = null; }
