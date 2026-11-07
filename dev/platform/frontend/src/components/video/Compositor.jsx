import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as PB from '@shared/compositionPlayback.mjs';
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

const Compositor = React.forwardRef(function Compositor({
  composition,
  sourceUrls = {},   // { [sourceId]: url }
  transcripts = {},  // { [sourceId]: [{ word, start, end }] }
  playhead = 0,
  onSeek,
  maxHeight = '62vh',
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
    const isImage = src?.kind === 'design';
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
      const el = getElement(layer.sourceId);
      if (!el || el._isAudio) continue;

      const isImg = !!el._isImage;
      if (isImg) { if (!el.complete || !el.naturalWidth) continue; }
      else { if (el.readyState < 2) continue; }

      ctx.save();
      if (layer.opacity < 1) {
        ctx.globalAlpha = layer.opacity;
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
