import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as PB from '@shared/compositionPlayback.mjs';
import * as GAIN from './audioGain';

/**
 * The new-model preview: one compositor, not three approximations.
 *
 * Replaces EdlPlayer's dual-element opacity trick with a canvas that
 * composites per frame, in the same order the render graph does:
 *
 *   1. Base video track, drawn to canvas
 *   2. Higher video tracks, composited in track order
 *   3. (future) Design pages rendered to images with alpha
 *   4. (future) Captions via libass WASM (JASSUB)
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
 */

const BLACK = '#000';

const Compositor = React.forwardRef(function Compositor({
  composition,
  sourceUrls = {},   // { [sourceId]: url }
  playhead = 0,
  onSeek,
  maxHeight = '62vh',
  children,
  onMeta,
}, ref) {
  const canvasRef = useRef(null);
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

  // ── Video element pool ──────────────────────────────────────────────

  const getElement = useCallback((sourceId) => {
    const st = m.current;
    if (st.elements.has(sourceId)) return st.elements.get(sourceId);

    const url = st.sourceUrls[sourceId];
    if (!url) return null;

    const vid = document.createElement('video');
    vid.muted = true;
    vid.playsInline = true;
    vid.preload = 'auto';
    vid.crossOrigin = 'anonymous';
    vid.src = url;
    vid.load();
    st.elements.set(sourceId, vid);

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
      const vid = getElement(layer.sourceId);
      if (!vid || vid.readyState < 2) continue;

      ctx.save();
      if (layer.opacity < 1) {
        ctx.globalAlpha = layer.opacity;
      }

      // Cover fit: scale up to fill, then crop to canvas
      const vw = vid.videoWidth || W;
      const vh = vid.videoHeight || H;
      const fit = layer.item.fit || 'cover';

      if (fit === 'cover') {
        const scale = Math.max(W / vw, H / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        const dx = (W - dw) / 2;
        const dy = (H - dh) / 2;
        ctx.drawImage(vid, dx, dy, dw, dh);
      } else {
        // Contain: scale down to fit, letterbox
        const scale = Math.min(W / vw, H / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        const dx = (W - dw) / 2;
        const dy = (H - dh) / 2;
        ctx.drawImage(vid, dx, dy, dw, dh);
      }

      ctx.restore();
    }
  }, [getElement, W, H]);

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
      const vid = getElement(layer.sourceId);
      if (!vid) continue;

      if (st.playing) {
        seekTo(vid, layer.sourceTime);
        if (vid.paused) vid.play().catch(() => {});
        vid.muted = false;
      } else {
        seekTo(vid, layer.sourceTime);
        if (!vid.paused) vid.pause();
      }
    }

    // Handle audio-only items
    const audio = PB.audioAt(st.composition, st.playhead);
    for (const a of audio) {
      if (activeSourceIds.has(a.sourceId)) continue;
      activeSourceIds.add(a.sourceId);
      const vid = getElement(a.sourceId);
      if (!vid) continue;
      if (st.playing) {
        seekTo(vid, a.sourceTime);
        if (vid.paused) vid.play().catch(() => {});
      }
    }

    // Pause elements that are no longer active
    for (const [sourceId, vid] of st.elements) {
      if (!activeSourceIds.has(sourceId) && !vid.paused) {
        vid.pause();
      }
    }

    // Preload upcoming items
    const pre = PB.prerollAt(st.composition, st.playhead);
    if (pre) getElement(pre.sourceId);

    draw();
  }, [draw, getElement, seekTo, onSeek]);

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
    for (const [, vid] of st.elements) vid.pause();
  }, []);

  const startPlayback = useCallback(() => {
    const st = m.current;
    if (!st.composition || !PB.duration(st.composition)) return;

    if (st.playhead >= PB.duration(st.composition) - 0.01) {
      st.playhead = 0;
      if (onSeek) onSeek(0);
    }

    st.playing = true;
    setPlaying(true);

    // Start all active video elements
    const scene = PB.sceneAt(st.composition, st.playhead);
    for (const layer of scene.layers) {
      const vid = getElement(layer.sourceId);
      if (vid) {
        seekTo(vid, layer.sourceTime);
        vid.muted = false;
        vid.play().catch(() => {});
      }
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
    for (const [, vid] of m.current.elements) {
      vid.pause();
      vid.removeAttribute('src');
      vid.load();
    }
    m.current.elements.clear();
  }, []);

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

  return (
    <div ref={wrapRef} tabIndex={0} style={{ outline: 'none' }} data-testid="compositor">
      <div style={{ display: 'flex', justifyContent: 'center', background: BLACK, borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
        <div ref={frameRef} style={{
          position: 'relative', background: BLACK, maxWidth: '100%',
          aspectRatio: `${ar}`,
          height: ar < 1 ? maxHeight : undefined,
          width: ar >= 1 ? '100%' : undefined,
          maxHeight,
        }}>
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
          {children}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', marginTop: 'var(--s2)', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary btn-sm" data-testid="play"
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
        <div>Captions and audio processing (afftdn/loudnorm) are render-only; this preview does not show them.</div>
      </div>
    </div>
  );
});

export default Compositor;
