import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as PB from '@shared/compositionPlayback.mjs';
import { paintFor } from '@shared/compositionFx.mjs';
import * as GAIN from './audioGain';
import useCaptionPreview from '../../hooks/useCaptionPreview';

/**
 * The new-model preview: one compositor, not three approximations.
 *
 * Replaces EdlPlayer's dual-element opacity trick with a canvas that
 * composites per frame, in the same order the render graph does:
 *
 *   1. Base video track, drawn to canvas
 *   2. Higher video tracks, composited in track order
 *   3. (future) Design pages rendered to images with alpha
 *   4. Captions via libass WASM (JASSUB)
 *   5. (future) Guides: safe areas, preview-only
 *
 * The playback model (shared/compositionPlayback.mjs) drives every
 * frame. It was proven to agree with the render graph on fixtures, so
 * the preview shows what the render will produce.
 *
 * Video elements are managed in a pool: each active source gets an
 * element, seeked to the right source time, playing when the compositor
 * is playing. The pool grows as needed and elements are reused across
 * items that share a source.
 *
 * Captions are rendered by JASSUB onto a transparent overlay canvas
 * positioned over the main canvas. The shared ASS compiler
 * (shared/captions/compile.mjs) drives both the preview and the ffmpeg
 * render, so the timing and positioning agree by construction.
 */

const BLACK = '#000';

/**
 * Draw one generated effect layer.
 *
 * An fx source holds no file, so there is no element to draw: the render
 * makes it with a geq expression and the preview paints the same mask as a
 * canvas gradient. Both descriptions come out of `shared/compositionFx.mjs`
 * and an agreement test evaluates the expression numerically against the
 * paint at points across the frame, because two implementations of one
 * description drift and a preview that disagrees with the export is the page
 * lying about its own output.
 *
 * Before this the layer was skipped silently — `getElement` returns null for
 * a source with no url — so a template's scrim was in every rendered file
 * and in none of the previews, which is the state the caption legibility
 * judgement would have been made in.
 */
function drawFx(ctx, src, layer, W, H) {
  let paint;
  try {
    paint = paintFor(src.effect, src.params, { width: W, height: H });
  } catch {
    // An effect this build does not know. The render refuses it with a
    // message naming the source; the preview simply does not draw it rather
    // than throwing out of the frame loop.
    return;
  }

  const [r, g, b] = paint.colour;
  const rgba = (a) => `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
  const at = (v) => Math.max(0, Math.min(1, v));

  ctx.save();
  if (layer.opacity < 1) ctx.globalAlpha = layer.opacity;

  // The item transform, the same arithmetic the other layers use, so an
  // effect given a motion moves in the preview as it does in the render.
  const tr = layer.transform;
  if (tr && (tr.scale !== 1 || tr.pos?.x || tr.pos?.y)) {
    ctx.translate(W / 2 + (tr.pos?.x || 0) * W, H / 2 + (tr.pos?.y || 0) * H);
    ctx.scale(tr.scale, tr.scale);
    ctx.translate(-W / 2, -H / 2);
  }

  if (paint.kind === 'rect') {
    ctx.fillStyle = rgba(paint.alpha);
    ctx.fillRect(paint.x * W, paint.y * H, paint.w * W, paint.h * H);
  } else if (paint.kind === 'linear') {
    const grad = ctx.createLinearGradient(
      paint.from.x * W, paint.from.y * H, paint.to.x * W, paint.to.y * H
    );
    for (const stop of paint.stops) grad.addColorStop(at(stop.at), rgba(stop.alpha));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  } else {
    // Radial, described in a space where the frame is a unit square about
    // its centre. Scaling the context by half the frame turns the circle the
    // browser draws into the ellipse the expression describes, which is what
    // keeps a 9:16 vignette circular rather than squashed into a letterbox.
    ctx.translate(paint.centre.x * W, paint.centre.y * H);
    ctx.scale(W / 2, H / 2);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, paint.radius);
    for (const stop of paint.stops) grad.addColorStop(at(stop.at), rgba(stop.alpha));
    ctx.fillStyle = grad;
    ctx.fillRect(-1, -1, 2, 2);
  }

  ctx.restore();
}

const Compositor = React.forwardRef(function Compositor({
  composition,
  sourceUrls = {},   // { [sourceId]: url }
  transcripts = {},  // { [sourceId]: [{ word, start, end }] }
  playhead = 0,
  onSeek,
  maxHeight = '62vh',
  fill = false,
  children,
  onMeta,
}, ref) {
  const canvasRef = useRef(null);
  const captionContainerRef = useRef(null);
  const wrapRef = useRef(null);
  const frameRef = useRef(null);

  const [playing, setPlaying] = useState(false);
  const [natAR, setNatAR] = useState(null);

  // Mutable state for the frame loop, same pattern as EdlPlayer
  const m = useRef({
    playing: false,
    playhead: 0,
    composition: null,
    sourceUrls: {},
    elements: new Map(), // sourceId -> HTMLVideoElement
    raf: null,
    graph: false,
  });
  m.current.composition = composition;
  m.current.sourceUrls = sourceUrls;

  const comp = composition;
  const W = comp?.size?.width || 1080;
  const H = comp?.size?.height || 1920;
  const fps = comp?.fps || 30;

  // ── Caption overlay (JASSUB / libass WASM) ─────────────────────────

  const {
    hasCaptions,
    error: captionError,
    render: renderCaptions,
  } = useCaptionPreview(composition, transcripts, playhead, captionContainerRef, W, H);

  // ── Media element pool (video + image) ──────────────────────────────

  const getElement = useCallback((sourceId) => {
    const st = m.current;
    if (st.elements.has(sourceId)) return st.elements.get(sourceId);

    const url = st.sourceUrls[sourceId];
    if (!url) return null;

    const src = st.composition?.sources?.[sourceId];
    // A PHOTOGRAPH IS AN IMAGE. This read `kind === 'design'` alone, and a
    // photograph is `kind: 'clip'` with `still: true` — so the compositor
    // built a <video> element, pointed it at a JPEG, waited for a readyState
    // that never arrives, and skipped the layer at the draw. Measured on the
    // shipped build: the file was requested with initiatorType "video" and
    // the canvas was 0% non-black on every frame of every photograph, while
    // the render drew the picture correctly. So the six camera-move chips
    // that shipped this morning drove a value nobody could see.
    //
    // The model has always known the difference — compositionPlayback.mjs
    // reads `src.kind === 'clip' && src.still !== true` to decide whether a
    // source has an audio stream. Only this line did not.
    const isImage = src?.kind === 'design' || src?.still === true;
    const isAudio = src?.kind === 'audio';

    if (isAudio) {
      const aud = new Audio();
      aud.preload = 'auto';
      aud.crossOrigin = 'anonymous';
      aud.src = url;
      aud._isAudio = true;
      st.elements.set(sourceId, aud);
      if (onMeta) {
        aud.addEventListener('loadedmetadata', () => {
          onMeta({ sourceId, duration: Number.isFinite(aud.duration) ? aud.duration : null, width: 0, height: 0 });
        });
      }
      return aud;
    }

    if (isImage) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      img._isImage = true;
      st.elements.set(sourceId, img);

      img.addEventListener('load', () => {
        if (img.naturalWidth && img.naturalHeight && !natAR) {
          setNatAR(img.naturalWidth / img.naturalHeight);
        }
        if (onMeta) {
          onMeta({ sourceId, duration: null, width: img.naturalWidth, height: img.naturalHeight });
        }
        // PAINT IT. A source arrives after the frame it belongs to was last
        // drawn, and nothing else was asking for a repaint: the player sat
        // black until the operator moved the playhead or pressed play.
        // Measured at 1280x720: 0% non-black on load, 89% after one arrow
        // key. The fault was mistaken for "the preview cannot draw stills",
        // which was a second, real fault on the line above.
        drawRef.current?.();
      });
      return img;
    }

    const vid = document.createElement('video');
    vid.muted = true;
    vid.playsInline = true;
    vid.preload = 'auto';
    vid.crossOrigin = 'anonymous';
    vid.src = url;
    vid.load();
    st.elements.set(sourceId, vid);

    vid.addEventListener('loadeddata', () => { drawRef.current?.(); });
    vid.addEventListener('seeked', () => { drawRef.current?.(); });

    vid.addEventListener('loadedmetadata', () => {
      if (vid.videoWidth && vid.videoHeight && !natAR) {
        setNatAR(vid.videoWidth / vid.videoHeight);
      }
      if (onMeta) {
        onMeta({
          sourceId,
          duration: Number.isFinite(vid.duration) ? vid.duration : null,
          width: vid.videoWidth,
          height: vid.videoHeight,
        });
      }
    });

    return vid;
  }, [natAR, onMeta]);

  // ── Seek a video element to a source time ───────────────────────────

  const seekTo = useCallback((vid, sourceTime) => {
    if (!vid) return;
    if (Math.abs(vid.currentTime - sourceTime) > 0.05) {
      vid.currentTime = Math.max(0, sourceTime);
    }
  }, []);

  // ── The frame loop ──────────────────────────────────────────────────

  // The latest draw, for the listeners below. An element is created once and
  // kept; `draw` is a new function on every render, so a listener that closed
  // over it would repaint with a stale one.
  const drawRef = useRef(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const st = m.current;
    const comp = st.composition;
    if (!comp) return;

    const scene = PB.sceneAt(comp, st.playhead);

    // Clear to black
    ctx.fillStyle = BLACK;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw each layer bottom to top
    for (const layer of scene.layers) {
      // A generated layer: an effect, painted rather than drawn from a file.
      const srcSpec = comp.sources?.[layer.sourceId];
      if (srcSpec?.kind === 'fx') {
        drawFx(ctx, srcSpec, layer, W, H);
        continue;
      }

      const el = getElement(layer.sourceId);
      if (!el || el._isAudio) continue;

      const isImg = !!el._isImage;
      if (isImg) { if (!el.complete || !el.naturalWidth) continue; }
      else { if (el.readyState < 2) continue; }

      ctx.save();
      if (layer.opacity < 1) {
        ctx.globalAlpha = layer.opacity;
      }

      // The transform, from the same model function the render graph derives
      // its ffmpeg expressions from (`itemTransformAt`, via sceneAt).
      //
      // The renderer fits the item to the frame, scales that frame by
      // `scale`, and overlays it centred plus `pos` as a fraction of the
      // frame. These three canvas operations are the same arithmetic:
      // scaling about the frame centre and then offsetting. Written in this
      // order so that a scale of 1 with no pos leaves the matrix untouched
      // and the untransformed path draws exactly as it did before.
      //
      // `rot` is deliberately NOT drawn. The render graph refuses it (its
      // output box is init-only, so an animated rotation needs a different
      // construction), and a preview that drew a rotation the export cannot
      // produce would be the page lying about its output.
      const tr = layer.transform;
      if (tr && (tr.scale !== 1 || tr.pos?.x || tr.pos?.y)) {
        ctx.translate(W / 2 + (tr.pos?.x || 0) * W, H / 2 + (tr.pos?.y || 0) * H);
        ctx.scale(tr.scale, tr.scale);
        ctx.translate(-W / 2, -H / 2);
      }

      const ew = isImg ? (el.naturalWidth || W) : (el.videoWidth || W);
      const eh = isImg ? (el.naturalHeight || H) : (el.videoHeight || H);
      const fit = layer.item.fit || 'cover';

      if (fit === 'cover') {
        const scale = Math.max(W / ew, H / eh);
        const dw = ew * scale;
        const dh = eh * scale;
        const dx = (W - dw) / 2;
        const dy = (H - dh) / 2;
        ctx.drawImage(el, dx, dy, dw, dh);
      } else {
        const scale = Math.min(W / ew, H / eh);
        const dw = ew * scale;
        const dh = eh * scale;
        const dx = (W - dw) / 2;
        const dy = (H - dh) / 2;
        ctx.drawImage(el, dx, dy, dw, dh);
      }

      ctx.restore();
    }
  }, [getElement, W, H]);

  drawRef.current = draw;

  const tick = useCallback(() => {
    const st = m.current;
    if (!st.composition) return;

    // While playing, advance the playhead from the primary video element's
    // current time, converting source time back to timeline time.
    if (st.playing) {
      const scene = PB.sceneAt(st.composition, st.playhead);
      if (scene.layers.length > 0) {
        const primary = scene.layers[scene.layers.length - 1];
        const vid = st.elements.get(primary.sourceId);
        if (vid && !vid.paused) {
          const inPt = primary.item.in || 0;
          const newT = primary.item.at + (vid.currentTime - inPt);
          st.playhead = Math.max(0, Math.min(newT, PB.duration(st.composition)));
          if (onSeek) onSeek(st.playhead);
        }
      }

      // Check if we've reached the end
      if (st.playhead >= PB.duration(st.composition) - 0.01) {
        stopPlayback();
        st.playhead = PB.duration(st.composition);
        if (onSeek) onSeek(st.playhead);
        return;
      }
    }

    // Ensure video elements are seeked/playing for active items
    const scene = PB.sceneAt(st.composition, st.playhead);
    const activeSourceIds = new Set();

    for (const layer of scene.layers) {
      activeSourceIds.add(layer.sourceId);
      const el = getElement(layer.sourceId);
      if (!el || el._isImage || el._isAudio) continue;

      if (st.playing) {
        seekTo(el, layer.sourceTime);
        if (el.paused) el.play().catch(() => {});
        el.muted = false;
      } else {
        seekTo(el, layer.sourceTime);
        if (!el.paused) el.pause();
      }
    }

    // Handle audio items: play/pause/seek + apply per-item gain
    const audio = PB.audioAt(st.composition, st.playhead);
    for (const a of audio) {
      if (activeSourceIds.has(a.sourceId)) continue;
      activeSourceIds.add(a.sourceId);
      const el = getElement(a.sourceId);
      if (!el || el._isImage) continue;
      if (st.playing) {
        seekTo(el, a.sourceTime);
        if (el.paused) el.play().catch(() => {});
        GAIN.gainNodeFor(el);
        GAIN.setGain(el, a.gain ?? 1);
      } else {
        seekTo(el, a.sourceTime);
        if (!el.paused) el.pause();
      }
    }

    // Also apply gain to video elements that have audio (from scene layers)
    for (const layer of scene.layers) {
      const el = st.elements.get(layer.sourceId);
      if (!el || el._isImage || el._isAudio) continue;
      if (st.playing) {
        GAIN.gainNodeFor(el);
        GAIN.setGain(el, layer.item.gain ?? 1);
      }
    }

    // Pause elements that are no longer active
    for (const [sourceId, el] of st.elements) {
      if (el._isImage) continue;
      if (!activeSourceIds.has(sourceId) && !el.paused) {
        el.pause();
      }
    }

    // Preload upcoming items
    const pre = PB.prerollAt(st.composition, st.playhead);
    if (pre) getElement(pre.sourceId);

    draw();
    // Render captions for the current frame via JASSUB
    renderCaptions(st.playhead);
  }, [draw, getElement, seekTo, onSeek, renderCaptions]);

  const loop = useCallback(() => {
    if (!m.current.playing) return;
    tick();
    m.current.raf = requestAnimationFrame(loop);
  }, [tick]);

  // ── Transport ───────────────────────────────────────────────────────

  const stopPlayback = useCallback(() => {
    const st = m.current;
    st.playing = false;
    if (st.raf) { cancelAnimationFrame(st.raf); st.raf = null; }
    setPlaying(false);
    for (const [, el] of st.elements) {
      if (el._isImage) continue;
      el.pause();
    }
  }, []);

  const startPlayback = useCallback(() => {
    const st = m.current;
    if (!st.composition || !PB.duration(st.composition)) return;

    if (st.playhead >= PB.duration(st.composition) - 0.01) {
      st.playhead = 0;
      if (onSeek) onSeek(0);
    }

    GAIN.wake();

    st.playing = true;
    setPlaying(true);

    // Start all active video elements
    const scene = PB.sceneAt(st.composition, st.playhead);
    for (const layer of scene.layers) {
      const el = getElement(layer.sourceId);
      if (!el || el._isImage || el._isAudio) continue;
      seekTo(el, layer.sourceTime);
      el.muted = false;
      el.play().catch(() => {});
    }

    // Start audio items
    const audio = PB.audioAt(st.composition, st.playhead);
    for (const a of audio) {
      const el = getElement(a.sourceId);
      if (!el || el._isImage) continue;
      seekTo(el, a.sourceTime);
      if (el.paused) el.play().catch(() => {});
      GAIN.gainNodeFor(el);
      GAIN.setGain(el, a.gain ?? 1);
    }

    if (st.raf) cancelAnimationFrame(st.raf);
    st.raf = requestAnimationFrame(loop);
  }, [getElement, seekTo, onSeek, loop]);

  const step = useCallback((dir) => {
    stopPlayback();
    const st = m.current;
    const next = PB.stepFrame(st.composition, st.playhead, dir, fps);
    st.playhead = next;
    if (onSeek) onSeek(next);
    tick();
  }, [fps, onSeek, stopPlayback, tick]);

  useImperativeHandle(ref, () => ({
    play: startPlayback,
    pause: stopPlayback,
    toggle: () => (m.current.playing ? stopPlayback() : startPlayback()),
    step,
    isPlaying: () => m.current.playing,
  }), [startPlayback, stopPlayback, step]);

  // ── Follow external playhead ────────────────────────────────────────

  useEffect(() => {
    const st = m.current;
    if (st.playing) return;
    st.playhead = playhead;
    tick();
  }, [playhead, tick]);

  // ── Canvas sizing ───────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = W;
    canvas.height = H;
    draw();
  }, [W, H, draw]);

  // ── Cleanup ─────────────────────────────────────────────────────────

  useEffect(() => () => {
    if (m.current.raf) cancelAnimationFrame(m.current.raf);
    m.current.playing = false;
    for (const [, el] of m.current.elements) {
      if (!el._isImage) {
        el.pause();
        el.removeAttribute('src');
        el.load();
      }
      if (el.__omiSource) { try { el.__omiSource.disconnect(); } catch {} }
      if (el.__omiGain) { try { el.__omiGain.disconnect(); } catch {} }
    }
    m.current.elements.clear();
  }, []);

  // Prune stale elements when sources change (prevents memory leaks in long sessions).
  useEffect(() => {
    const st = m.current;
    const liveSources = composition?.sources || {};
    for (const [sourceId, el] of st.elements) {
      if (liveSources[sourceId]) continue;
      if (!el._isImage) {
        el.pause();
        el.removeAttribute('src');
        el.load();
      }
      if (el.__omiSource) { try { el.__omiSource.disconnect(); } catch {} }
      if (el.__omiGain) { try { el.__omiGain.disconnect(); } catch {} }
      st.elements.delete(sourceId);
    }
  }, [composition?.sources]);

  // Stop when composition changes
  useEffect(() => { stopPlayback(); }, [composition]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard ────────────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e) {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        m.current.playing ? stopPlayback() : startPlayback();
      } else if (e.key === 'ArrowRight' && !e.shiftKey) {
        e.preventDefault(); step(+1);
      } else if (e.key === 'ArrowLeft' && !e.shiftKey) {
        e.preventDefault(); step(-1);
      }
    }
    const node = wrapRef.current;
    if (!node) return undefined;
    node.addEventListener('keydown', onKey);
    return () => node.removeEventListener('keydown', onKey);
  }, [startPlayback, stopPlayback, step]);

  // ── Render ──────────────────────────────────────────────────────────

  const total = comp ? PB.duration(comp) : 0;
  const ar = comp ? W / H : (natAR || 9 / 16);

  /**
   * The picture's size, fitted to the well, in pixels.
   *
   * CSS cannot do this one on its own. A canvas's `max-height: 100%`
   * resolves against its containing block, and every box that could be its
   * containing block here is auto-height — so the percentage is dropped, the
   * canvas falls back to its intrinsic 1080x1920, and a 791px picture runs
   * under the timeline in a 391px row. Giving an ancestor a definite height
   * instead moves the caption overlay off the picture and onto the black.
   *
   * The well's own box never depends on the picture (`width: 100%`,
   * `height: 100%` of a row the grid has already sized), so measuring it is
   * not circular. The arithmetic is the same fit a browser gives an image,
   * and the ratio is exact rather than nearly right, which is the fault this
   * screen has already shipped once.
   */
  const wellRef = useRef(null);
  const [fitted, setFitted] = useState(null);
  useEffect(() => {
    const el = wellRef.current;
    if (!fill || !el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      // One axis is rounded and the other derived from the rounded value, so
      // the box that ends up on screen holds the composition's ratio as
      // closely as whole pixels allow. Rounding both independently is what
      // leaves a frame measurably the wrong shape at small sizes.
      const fitsHeight = r.height * ar <= r.width;
      const h = Math.max(1, Math.round(fitsHeight ? r.height : r.width / ar));
      setFitted({ w: Math.max(1, Math.round(h * ar)), h });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [fill, ar]);

  return (
    /* `fill` hands the player the height of whatever box it is in, rather
       than a fraction of the window. Every ancestor from here down carries a
       definite height so the canvas's own `max-height: 100%` has something to
       resolve against; without that chain the percentage is ignored and the
       player sizes to its content, which is how a 450px frame came to run
       under the timeline in a 403px row. */
    <div ref={wrapRef} tabIndex={0} data-testid="compositor"
      style={{ outline: 'none', ...(fill ? { height: '100%', minHeight: 0 } : null) }}>
      <div ref={wellRef} style={{
        display: 'flex', justifyContent: 'center', background: BLACK,
        borderRadius: 'var(--r-md)', overflow: 'hidden',
        /* The well. In fill mode it takes the height of the row it is in and
           centres the picture inside itself, which is what gives the canvas
           a DEFINITE height to resolve `max-height: 100%` against. Without
           that the percentage is ignored, the canvas sizes to its intrinsic
           1080x1920, and a 791px picture runs under the timeline. */
        ...(fill ? { height: '100%', minHeight: 0, alignItems: 'center' } : null),
      }}>
        {/* The frame is bounded on BOTH axes and sized by its ratio, never
            given a height and a width that can disagree.
            It used to carry `height: maxHeight` together with
            `maxWidth: 100%`, so in a column narrower than the frame the width
            was clamped while the height stood its ground. Measured on the
            shipped build: at 1280x800 a 1080x1920 composition drew into a
            188x400 box — ratio 0.470 against the model's 0.5625 — so THE
            PREVIEW SQUASHED THE PICTURE BY 16.4%. It was correct at 1440 and
            at 1600, which is why it survived: a colleague judging a frame at
            1280 was judging a frame that was not the frame, and everyone
            else saw it right.
            `maxHeight` with `width: 100%` lets `aspect-ratio` do the work;
            the browser shrinks both axes together. */}
        <div ref={frameRef} style={{
          position: 'relative', background: BLACK,
          display: 'inline-block', maxWidth: '100%', lineHeight: 0,
          /* Shrink-wrapped to the picture in both modes, so the caption
             overlay below — which is 100% of this box — tracks the picture
             and not the black around it. */
          /* When filling, this IS the well: a definite height, with the
             picture centred in it. That definite height is the whole point —
             the canvas's `max-height: 100%` has to resolve against
             something, and against an auto height it is ignored, which is
             how a 791px picture came to run under the timeline. */
          /* In fill mode the frame IS the picture, at the size measured
             above, so the caption overlay below — 100% of this box — tracks
             the picture rather than the black around it. */
          ...(fill && fitted ? { width: fitted.w, height: fitted.h } : null),
        }}>
          <div style={{ position: 'relative', display: 'grid', lineHeight: 0, height: '100%' }}>
          {/* The canvas fits itself, and the frame shrink-wraps it.
              A <canvas> has an intrinsic size from its width and height
              attributes, which are the composition's own, so `max-width` and
              `max-height` with both dimensions `auto` is the same fit a
              browser gives an image: it shrinks on whichever axis runs out
              first and takes the other with it.
              It used to be `width: 100%; height: 100%` inside a frame given
              BOTH a height and a max-width, which can disagree. Measured on
              the shipped build at 1280x800: a 1080x1920 composition drew into
              188x400 — ratio 0.470 against 0.5625 — so the preview squashed
              the picture by 16.4%. It was right at 1440 and 1600, which is
              how it survived: the person judging a frame at 1280 was judging
              a frame that was not the frame, and everyone else saw it
              correctly. */}
          <canvas
            ref={canvasRef}
            style={{
              display: 'block',
              width: 'auto', height: 'auto',
              maxWidth: '100%',
              maxHeight: fill ? '100%' : maxHeight,
              ...(fill && fitted ? { width: '100%', height: '100%' } : null),
            }}
          />
          {/* JASSUB creates and owns its canvas inside this container */}
          <div
            ref={captionContainerRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
            }}
          />
          {captionError && (
            <div style={{
              position: 'absolute',
              bottom: 'var(--s2)',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.7)',
              color: '#ccc',
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: '11px',
              pointerEvents: 'none',
            }}>
              {captionError}
            </div>
          )}
          {children}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginTop: 'var(--s2)', flexWrap: 'wrap' }}>
        {/* Secondary, deliberately. Play was the only accent fill on the
            Studio while Export — the thing the screen exists to produce —
            was drawn in the same class as "-1 frame". One accent per screen,
            and it belongs to the control that commits rather than the one
            that previews. The transport reads fine without a fill; it is the
            leftmost control under the picture and it answers the space bar. */}
        <button type="button" className="btn btn-secondary btn-sm" data-testid="play"
          onClick={() => (playing ? stopPlayback() : startPlayback())} disabled={!total}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="btn btn-secondary btn-sm" data-testid="step-back"
          onClick={() => step(-1)} disabled={!total} title="One frame back (left arrow)">-1 frame</button>
        <button type="button" className="btn btn-secondary btn-sm" data-testid="step-fwd"
          onClick={() => step(+1)} disabled={!total} title="One frame on (right arrow)">+1 frame</button>
        <button type="button" className="btn btn-secondary btn-sm" data-testid="to-start"
          onClick={() => { stopPlayback(); m.current.playhead = 0; if (onSeek) onSeek(0); tick(); }}
          disabled={!total}>Start</button>

        <span className="body-xs text-subtle" data-testid="position" style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
          {PB.timecode(playhead, fps)} / {PB.timecode(total, fps)}
          {` · ${fps}fps`}
        </span>
      </div>

      <div className="body-xs text-subtle" style={{ marginTop: 'var(--s1)' }}>
        <div>
          {hasCaptions
            ? 'Ducking and audio processing (afftdn/loudnorm) are render-only; this preview does not show them.'
            : 'Captions, ducking, and audio processing (afftdn/loudnorm) are render-only; this preview does not show them.'}
        </div>
      </div>
    </div>
  );
});

export default Compositor;
