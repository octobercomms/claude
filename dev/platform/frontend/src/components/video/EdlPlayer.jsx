import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as PLAY from '../../../../shared/edlPlay.mjs';
import * as GAIN from './audioGain';

/**
 * Playing the edit, not the clip.
 *
 * What this replaces: a single `<video controls>` showing whichever clip the
 * playhead was over, stopping dead at the block's edge. That was honest but
 * useless — you could not watch your own edit, so every cut was a guess the
 * render settled.
 *
 * Two stacked elements do the work. One plays the block you are on while the
 * other is already loaded and seeked to the next block's in-point, so a cut
 * is a swap rather than a stall. During a cross-fade both play and the
 * opacity ramp is the transition, which is why the overlap `laidOut` already
 * computes is drawn rather than skipped.
 *
 * The position comes from `requestVideoFrameCallback`, which reports the
 * media time of the frame actually painted. That matters more than it
 * sounds: the playhead then follows the picture instead of a clock running
 * beside it, so the two cannot drift apart silently. Where the browser has
 * no such callback the element's `currentTime` is used and the player says
 * the position is approximate rather than implying it is not.
 *
 * On why this is not built on WebCodecs, which was the original plan: a
 * measured probe of Chromium against footage with a frame index burned into
 * every frame found `currentTime` seeking exact on all eleven targets, on
 * both a clean 30fps file and one at 29.97 with B-frames, rotation metadata
 * and a 2.5-second keyframe interval. The premise for decoding frames by
 * hand — that an element seeks to keyframes — did not hold. `driftFrames`
 * keeps the question open at runtime for browsers where it might.
 *
 * Audio above 100% goes through a WebAudio gain node, built only when a block
 * asks for it and only from inside the play gesture. `audioGain.js` has the
 * three ways that can lose all the sound and what is done about each; the
 * player's part is that `graph` is a fact it checks rather than assumes, so a
 * browser that will not route still gets the capped preview and the line
 * saying the render will be louder.
 */

const BLACK = '#000';

function clipUrl(clips, i) {
  const c = clips?.[i];
  return c ? c.url : null;
}

const EdlPlayer = React.forwardRef(function EdlPlayer({
  clips = [],
  edl,
  playhead = 0,
  onSeek,
  frameAR = null,
  maxHeight = '62vh',
  children,
  onFpsMeasured,
  frameRef,
  onMeta,
}, ref) {
  const aRef = useRef(null);
  const bRef = useRef(null);
  const wrapRef = useRef(null);
  const ownFrame = useRef(null);
  const frame = frameRef || ownFrame;

  const [playing, setPlaying] = useState(false);
  const [active, setActive] = useState('a');       // which element is the main one
  const [blend, setBlend] = useState(0);           // 0..1 across a cross-fade
  const [transType, setTransType] = useState('cut');
  const [drawable, setDrawable] = useState(true);
  const [drift, setDrift] = useState(null);        // frames between asked-for and shown
  const [approx, setApprox] = useState(false);     // no frame callback in this browser
  const [boosted, setBoosted] = useState(false);   // a block louder than volume can show
  // Whether the gain graph is actually running. Not whether we tried: a
  // suspended context or a CORS-tainted element both leave this false, and
  // the warning stays up, which is the honest answer.
  const [graph, setGraph] = useState(false);
  // The shape of the footage itself, used when no output aspect is chosen.
  // Without it a vertical reel previews inside a letterboxed 16:9 box, which
  // is most of the picture missing to make room for black.
  const [natAR, setNatAR] = useState(null);

  // Everything the frame loop touches lives here. React state inside a
  // per-frame callback is a queue of re-renders the loop then races; the
  // element positions are read and written directly and only what the
  // interface shows is lifted into state.
  const m = useRef({
    playhead: 0, edl: null, clips: [], playing: false,
    active: 'a', loadedInto: { a: null, b: null }, sparePlaying: false,
    // Read by the frame loop, so it lives here as well as in state.
    graph: false,
    fps: new Map(), samples: new Map(), seeking: false,
    // The last frame each element reported painting, and the animation frame
    // driving the machine. These are separate on purpose: see `loop`.
    latest: { a: null, b: null }, raf: null, rvfc: { a: false, b: false },
  });
  m.current.edl = edl;
  m.current.clips = clips;

  const el = useCallback((key) => (key === 'a' ? aRef.current : bRef.current), []);
  const fpsOf = useCallback((clip) => m.current.fps.get(clip) || null, []);

  // ---- loading and seeking ---------------------------------------------

  // Put a cue onto an element: the right file, at the right point inside it.
  const place = useCallback((key, cue) => {
    const node = el(key);
    if (!node || !cue) return;
    const url = clipUrl(m.current.clips, cue.clip);
    if (!url) return;
    if (m.current.loadedInto[key] !== cue.clip) {
      node.src = url;
      node.load();
      m.current.loadedInto[key] = cue.clip;
    }
    const v = PLAY.levelFor(cue.gain, { graph: m.current.graph });
    node.muted = v.muted;
    node.volume = v.volume;
    if (v.gainValue != null) GAIN.setGain(node, v.gainValue);
    if (Math.abs(node.currentTime - cue.sourceTime) > 0.001) {
      node.currentTime = Math.max(0, cue.sourceTime);
      // What the element last reported painting described where it was. Held
      // on to, it would be used as the current frame by the next settle.
      m.current.latest[key] = null;
    }
  }, [el]);

  // ---- frame rate, measured rather than assumed ------------------------

  const sample = useCallback((clip, meta) => {
    if (!meta || m.current.fps.get(clip)) return;
    const prev = m.current.samples.get(clip);
    if (!prev) { m.current.samples.set(clip, meta); return; }
    const fps = PLAY.rateFrom(prev, meta);
    if (fps) {
      m.current.fps.set(clip, fps);
      m.current.samples.delete(clip);
      if (onFpsMeasured) onFpsMeasured(clip, fps);
    }
  }, [onFpsMeasured]);

  // ---- the frame loop ---------------------------------------------------

  const tick = useCallback(() => {
    const st = m.current;
    const cue = PLAY.cueAt(st.edl, st.playhead);
    if (!cue) return;
    const node = el(st.active);
    if (!node) return;

    // Where we are. The painted frame's media time is the honest answer and
    // is used whenever it is current; `currentTime` is the fallback, because
    // the frame callback stops firing the moment the picture stops changing
    // — at the end of a clip, in a background tab, in a browser without it —
    // and a position that freezes there takes the hand-off down with it.
    const painted = st.latest[st.active];
    const clock = node.currentTime;
    const fresh = painted != null && Math.abs(painted.mediaTime - clock) < 0.5;
    const mediaTime = fresh ? painted.mediaTime : null;
    const shown = fresh ? painted.mediaTime : clock;
    const t = PLAY.timelineTime(cue, shown);
    st.playhead = t;
    if (onSeek) onSeek(t);

    const scene = PLAY.sceneAt(st.edl, t);
    if (scene) {
      setTransType(scene.type);
      setDrawable(scene.drawable);
      setBlend(scene.drawable ? scene.blend : (scene.blend >= 0.5 ? 1 : 0));

      // A cross-fade: the next block is already loaded and seeked, so it only
      // has to be told to play, and both levels follow the ramp.
      if (scene.incoming && !st.sparePlaying) {
        const spare = st.active === 'a' ? 'b' : 'a';
        const node = el(spare);
        if (node && st.loadedInto[spare] === scene.incoming.clip) {
          node.play().catch(() => {});
          st.sparePlaying = true;
        }
      }
      if (scene.incoming) {
        const outV = PLAY.levelFor(scene.main.gain, { graph: st.graph, blend: 1 - scene.blend });
        const inV = PLAY.levelFor(scene.incoming.gain, { graph: st.graph, blend: scene.blend });
        const outNode = el(st.active);
        const inNode = el(st.active === 'a' ? 'b' : 'a');
        // With a graph the ramp runs on the node, because the element's own
        // volume is capped at 1 and a boosted block fading out from 160%
        // would otherwise sit at 100% for the first third of the fade.
        if (outNode && !outNode.muted) {
          outNode.volume = outV.volume;
          if (outV.gainValue != null) GAIN.setGain(outNode, outV.gainValue);
        }
        if (inNode && !inNode.muted) {
          inNode.volume = inV.volume;
          if (inV.gainValue != null) GAIN.setGain(inNode, inV.gainValue);
        }
      }
    }

    // Drift: did the frame on screen land where it was asked to?
    const d = PLAY.driftFrames(cue.sourceTime, mediaTime,
      fpsOf(cue.clip) || PLAY.FALLBACK_FPS);
    setDrift(d);

    // Hand over when this block runs out.
    if (PLAY.reachedEnd(cue, shown)) {
      handOff(cue);
      return;
    }

    // Load the next block before it is needed.
    const pre = PLAY.prerollAt(st.edl, t);
    if (pre && pre.due) {
      const spare = st.active === 'a' ? 'b' : 'a';
      if (st.loadedInto[spare] !== pre.cue.clip || !st.sparePlaying) place(spare, pre.cue);
    }
  }, [el, onSeek, place, fpsOf]);

  const handOff = useCallback((cue) => {
    const st = m.current;
    const list = PLAY.rows(st.edl);
    const next = list[cue.index + 1];
    const old = st.active;
    const spare = old === 'a' ? 'b' : 'a';

    if (!next) {
      // The edit is over. Hold the last frame rather than snapping to black.
      stop();
      st.playhead = PLAY.total(st.edl);
      if (onSeek) onSeek(st.playhead);
      return;
    }

    const nextCue = PLAY.cueAt(st.edl, next.start);
    const node = el(spare);
    if (node && st.loadedInto[spare] !== nextCue.clip) place(spare, nextCue);
    if (node) {
      const v = PLAY.levelFor(nextCue.gain, { graph: st.graph });
      node.muted = v.muted;
      node.volume = v.volume;
      if (v.gainValue != null) GAIN.setGain(node, v.gainValue);
      node.play().catch(() => {});
    }
    const oldNode = el(old);
    if (oldNode) oldNode.pause();

    st.active = spare;
    st.sparePlaying = false;
    setActive(spare);
    setBlend(0);
    setTransType('cut');
    st.playhead = next.start;
    if (onSeek) onSeek(next.start);
    // And start preparing the one after.
    const after = PLAY.prerollAt(st.edl, next.start);
    if (after) place(old, after.cue);
  }, [el, place, onSeek]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Record which frame an element has painted.
   *
   * This only observes. Driving the machine from inside the frame callback
   * was the first shape of this code and it deadlocked at every clip's
   * natural end: the element stops painting, the callback stops firing, and
   * the hand-off that would have moved to the next clip lives inside the
   * callback that is no longer running. The machine runs on its own clock
   * below; this supplies the precision when there is any to supply.
   */
  const attach = useCallback((key) => {
    const st = m.current;
    const node = el(key);
    if (!node) return;
    if (typeof node.requestVideoFrameCallback !== 'function') {
      setApprox(true);
      return;
    }
    if (st.rvfc[key]) return;
    st.rvfc[key] = true;
    const step = (_now, meta) => {
      const cur = m.current;
      cur.latest[key] = { mediaTime: meta.mediaTime, presentedFrames: meta.presentedFrames };
      const clip = cur.loadedInto[key];
      if (clip != null) sample(clip, meta);
      const n = el(key);
      if (n && typeof n.requestVideoFrameCallback === 'function') n.requestVideoFrameCallback(step);
      else cur.rvfc[key] = false;
    };
    node.requestVideoFrameCallback(step);
  }, [el, sample]);

  // The machine's own heartbeat, which keeps running when the picture does
  // not. One tick per animation frame is far more often than a hand-off
  // needs and costs nothing beyond the arithmetic.
  const loop = useCallback(() => {
    if (!m.current.playing) return;
    tick();
    m.current.raf = requestAnimationFrame(loop);
  }, [tick]);

  // ---- transport ---------------------------------------------------------

  const stop = useCallback(() => {
    const st = m.current;
    const wasPlaying = st.playing;
    st.playing = false;
    st.sparePlaying = false;
    if (st.raf) { cancelAnimationFrame(st.raf); st.raf = null; }
    setPlaying(false);
    for (const k of ['a', 'b']) { const n = el(k); if (n) n.pause(); }

    // Settle onto the frame on screen. Playback leaves the element's clock
    // and its last painted frame up to a frame apart, and stepping from the
    // clock while looking at the picture is out by one from the first press.
    //
    // Only off the back of playback, though. A paused element paints nothing,
    // so the last frame it reported is from whenever it last moved; settling
    // on that drags the playhead back to where play stopped and every
    // subsequent step fights it.
    if (!wasPlaying) return;
    const node = el(st.active);
    const cue = PLAY.cueAt(st.edl, st.playhead);
    if (!node || !cue) return;
    const painted = st.latest[st.active];
    const clock = node.currentTime;
    const shown = painted != null && Math.abs(painted.mediaTime - clock) < 0.5
      ? painted.mediaTime : clock;
    const at = PLAY.snapToFrame(cue, shown, fpsOf(cue.clip));
    st.playhead = at;
    if (onSeek) onSeek(at);
    const settled = PLAY.cueAt(st.edl, at);
    if (settled) { node.currentTime = Math.max(0, settled.sourceTime); st.latest[st.active] = null; }
  }, [el, fpsOf, onSeek]);

  // Build the gain graph, if this edit needs one and the browser will.
  //
  // Called from the play gesture and nowhere else. `createMediaElementSource`
  // is irreversible and a suspended context is silent, so an edit with no
  // boosted block is never routed at all: there is nothing to gain and a way
  // to lose the audio.
  const wireGain = useCallback(async () => {
    const st = m.current;
    if (st.graph) return true;
    if (!PLAY.rows(st.edl).some((r) => PLAY.volumeFor(r.gain).needsAudioGraph)) return false;
    if (!(await GAIN.wake())) return false;
    const a = el('a');
    const b = el('b');
    const okA = !!GAIN.gainNodeFor(a);
    const okB = !!GAIN.gainNodeFor(b);
    // Both or neither. One routed element and one not means a cut swaps
    // between two different audio paths, and the one that is not routed
    // cannot go above 100% anyway.
    if (!okA || !okB) return false;
    st.graph = true;
    setGraph(true);
    return true;
  }, [el]);

  const start = useCallback(() => {
    const st = m.current;
    if (!PLAY.total(st.edl)) return;
    // Starting at the very end replays from the top, which is what a play
    // button on a finished edit is always asking for.
    if (st.playhead >= PLAY.total(st.edl) - 1e-3) {
      st.playhead = 0;
      if (onSeek) onSeek(0);
    }
    const cue = PLAY.cueAt(st.edl, st.playhead);
    if (!cue) return;
    place(st.active, cue);
    const node = el(st.active);
    if (!node) return;
    st.playing = true;
    setPlaying(true);
    node.play().catch(() => { stop(); });
    // After play(), not before: awaiting the context first would put the
    // element's own play() outside the gesture and some browsers refuse it.
    // The level is re-applied once the graph is up, because `place` ran while
    // st.graph was still false.
    wireGain().then((up) => {
      if (!up) return;
      const cue2 = PLAY.cueAt(m.current.edl, m.current.playhead);
      if (cue2) place(m.current.active, cue2);
    });
    attach('a'); attach('b');
    if (st.raf) cancelAnimationFrame(st.raf);
    st.raf = requestAnimationFrame(loop);
    const pre = PLAY.prerollAt(st.edl, st.playhead);
    if (pre) place(st.active === 'a' ? 'b' : 'a', pre.cue);
  }, [attach, el, place, onSeek, stop, loop, wireGain]);

  const step = useCallback((dir) => {
    const st = m.current;
    stop();
    const at = PLAY.stepFrame(st.edl, st.playhead, dir, fpsOf);
    st.playhead = at;
    if (onSeek) onSeek(at);
  }, [fpsOf, onSeek, stop]);

  useImperativeHandle(ref, () => ({
    play: start,
    pause: stop,
    toggle: () => (m.current.playing ? stop() : start()),
    step,
    isPlaying: () => m.current.playing,
    fpsOf,
  }), [start, stop, step, fpsOf]);

  // ---- following the playhead from outside -------------------------------

  // A scrub, a click on the ruler, a trim: whatever moved the playhead, the
  // picture follows it. While playing the loop owns the position instead, or
  // the two would fight each other every frame.
  useEffect(() => {
    const st = m.current;
    if (st.playing) return;
    st.playhead = playhead;
    const cue = PLAY.cueAt(edl, playhead);
    if (!cue) return;
    place(st.active, cue);
    const scene = PLAY.sceneAt(edl, playhead);
    if (scene) {
      setTransType(scene.type);
      setDrawable(scene.drawable);
      // Paused inside a cross-fade, show the blend rather than one clip: the
      // frame under the playhead genuinely is both.
      setBlend(scene.drawable ? scene.blend : (scene.blend >= 0.5 ? 1 : 0));
      if (scene.incoming) place(st.active === 'a' ? 'b' : 'a', scene.incoming);
    }
    // The warning is about being capped, not about being boosted: with the
    // graph running, a boosted block plays at its gain and there is nothing
    // to warn about.
    setBoosted(PLAY.levelFor(cue.gain, { graph }).capped);
  }, [playhead, edl, place, graph]);

  // Stop when the edit or the clips change under us: the element would
  // otherwise keep playing a block that no longer exists.
  useEffect(() => { stop(); }, [clips.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (m.current.raf) cancelAnimationFrame(m.current.raf);
    m.current.playing = false;
    for (const k of ['a', 'b']) { const n = el(k); if (n) { n.pause(); n.removeAttribute('src'); n.load(); } }
  }, [el]);

  // ---- keyboard ----------------------------------------------------------

  useEffect(() => {
    function onKey(e) {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); m.current.playing ? stop() : start(); }
      else if (e.key === 'ArrowRight' && !e.shiftKey) { e.preventDefault(); step(+1); }
      else if (e.key === 'ArrowLeft' && !e.shiftKey) { e.preventDefault(); step(-1); }
    }
    const node = wrapRef.current;
    if (!node) return undefined;
    node.addEventListener('keydown', onKey);
    return () => node.removeEventListener('keydown', onKey);
  }, [start, stop, step]);

  // An element running out of media is a hand-off even if nothing else
  // noticed: it is the one moment the picture stops of its own accord.
  const onEnded = useCallback((key) => {
    const st = m.current;
    if (!st.playing || st.active !== key) return;
    const cue = PLAY.cueAt(st.edl, st.playhead);
    if (cue) handOff(cue);
  }, [handOff]);

  // A clip's real duration and the frame's drawn height both arrive with the
  // element's metadata, and the page needs both: an uploaded clip's length is
  // unknown until something loads it, and the caption preview is sized
  // against the picture rather than against the viewport.
  const announce = useCallback((key) => {
    const node = el(key);
    if (!node) return;
    if (node.videoWidth && node.videoHeight && m.current.active === key) {
      setNatAR(node.videoWidth / node.videoHeight);
    }
    if (!onMeta) return;
    const clip = m.current.loadedInto[key];
    if (clip == null) return;
    onMeta({
      clip,
      duration: Number.isFinite(node.duration) ? node.duration : null,
      height: frame.current ? frame.current.clientHeight : 0,
    });
  }, [el, onMeta, frame]);

  // ---- drawing ------------------------------------------------------------

  const total = PLAY.total(edl);
  const cue = PLAY.cueAt(edl, playhead);
  const fps = cue ? fpsOf(cue.clip) : null;

  const vidStyle = (key) => {
    const isActive = active === key;
    // During a drawable transition the incoming element rides up over the
    // outgoing one. Outside one, the main element is simply the visible one.
    const opacity = blend > 0 ? (isActive ? 1 : blend) : (isActive ? 1 : 0);
    // `cover` only where an output aspect is set, because that is the crop the
    // render will apply. With none chosen, cropping would be inventing one.
    const fit = frameAR ? 'cover' : 'contain';
    return {
      position: 'absolute', inset: 0, width: '100%', height: '100%',
      objectFit: fit, background: BLACK, opacity, transition: 'none',
    };
  };

  // fadeblack dips through black at the midpoint, which no opacity ramp
  // between two pictures produces on its own.
  const veil = transType === 'fadeblack' && blend > 0 && blend < 1
    ? 1 - Math.abs(2 * blend - 1)
    : 0;

  return (
    <div ref={wrapRef} tabIndex={0} style={{ outline: 'none' }} data-testid="edl-player">
      <div style={{ display: 'flex', justifyContent: 'center', background: BLACK, borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
        <div ref={frame} style={frameAR
          ? { position: 'relative', aspectRatio: `${frameAR[0]} / ${frameAR[1]}`, height: maxHeight, maxWidth: '100%', background: BLACK }
          : {
            position: 'relative', background: BLACK, maxWidth: '100%',
            // The footage's own shape until it is known, then 16:9 as a
            // placeholder rather than a guess at vertical.
            aspectRatio: natAR ? `${natAR}` : '16 / 9',
            height: natAR && natAR < 1 ? maxHeight : undefined,
            width: natAR && natAR < 1 ? undefined : '100%',
            maxHeight,
          }}>
          <video ref={aRef} playsInline preload="auto" data-el="a" style={vidStyle('a')}
            onLoadedMetadata={() => announce('a')} onEnded={() => onEnded('a')} />
          <video ref={bRef} playsInline preload="auto" data-el="b" style={vidStyle('b')}
            onLoadedMetadata={() => announce('b')} onEnded={() => onEnded('b')} />
          {veil > 0 && (
            <div data-testid="veil" style={{ position: 'absolute', inset: 0, background: BLACK, opacity: veil, pointerEvents: 'none' }} />
          )}
          {children}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginTop: 'var(--s2)', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary btn-sm" data-testid="play"
          onClick={() => (playing ? stop() : start())} disabled={!total}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" data-testid="step-back"
          onClick={() => step(-1)} disabled={!total} title="One frame back (left arrow)">−1 frame</button>
        <button type="button" className="btn btn-secondary btn-sm" data-testid="step-fwd"
          onClick={() => step(+1)} disabled={!total} title="One frame on (right arrow)">+1 frame</button>
        <button type="button" className="btn btn-secondary btn-sm" data-testid="to-start"
          onClick={() => { stop(); m.current.playhead = 0; if (onSeek) onSeek(0); }} disabled={!total}>Start</button>

        <span className="body-xs text-subtle" data-testid="position" style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
          {tc(playhead, fps)} / {tc(total, fps)}
          {cue ? ` · clip ${cue.clip + 1}` : ''}
          {fps ? ` · ${fps}fps` : ''}
        </span>
      </div>

      {(approx || (drift != null && Math.abs(drift) >= 1) || boosted || (!drawable && transType !== 'cut')) && (
        <div className="body-xs text-subtle" data-testid="caveats" style={{ marginTop: 'var(--s1)' }}>
          {approx && <div>This browser does not report which frame it painted, so the position is approximate.</div>}
          {drift != null && Math.abs(drift) >= 1 && (
            <div data-testid="drift">The frame on screen is {Math.abs(drift)} frame{Math.abs(drift) === 1 ? '' : 's'} {drift > 0 ? 'after' : 'before'} the one asked for. The render cuts where the playhead is, not where this picture is.</div>
          )}
          {boosted && <div>This block is boosted above 100%, which a preview cannot play louder than full. The render applies the full gain.</div>}
          {!drawable && transType !== 'cut' && (
            <div data-testid="undrawable">A {transType} is previewed as a cut. The render applies the real transition.</div>
          )}
        </div>
      )}
    </div>
  );
});

/** Timecode, to the frame where the rate is known and to hundredths where it
 *  is not, because showing a frame number from a guessed rate is a lie. */
export function tc(seconds, fps) {
  const s = Math.max(0, Number(seconds) || 0);
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  if (fps && fps > 0) {
    // Floored, like every frame count in this feature: a playhead nine tenths
    // of the way through a frame is still in that frame, and rounding it up
    // is the timecode disagreeing with the picture beside it.
    const f = PLAY.frameIndex(s - Math.floor(s), fps);
    const frame = f >= Math.round(fps) ? Math.round(fps) - 1 : f;
    return `${pad(mm)}:${pad(ss)}:${pad(frame)}`;
  }
  return `${pad(mm)}:${pad(ss)}.${pad(Math.floor((s % 1) * 100))}`;
}

export default EdlPlayer;
