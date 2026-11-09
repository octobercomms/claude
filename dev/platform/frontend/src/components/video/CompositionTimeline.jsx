import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as C from '@shared/composition.mjs';
import { rippleRemoveItem, rippleTrimStart, rippleTrimEnd } from '@shared/composition.mjs';
import * as PB from '@shared/compositionPlayback.mjs';
import { useFilmstrips, thumbsForBlock, THUMB_HEIGHT } from '../../utils/filmstrip';
import { useWaveforms } from '../../utils/waveform';
import { peaksForBlock, peaksPath } from '../../utils/waveformPeaks';
import { findSnap } from '@shared/snap.mjs';
import TimelineMinimap from './TimelineMinimap';

/**
 * Multi-track composition timeline.
 *
 * Replaces the single-track Timeline.jsx for the new composition model.
 * Each track is a horizontal lane; items are positioned absolutely by
 * their `at` property. Overlapping items on a track show transition
 * hatching. The whole surface scrolls horizontally.
 *
 * Drag modes: move (change item.at), trim-in (left edge), trim-out
 * (right edge), scrub (ruler). Every drag snapshots the composition at
 * pointer-down and recomputes from the snapshot, so a drag is one edit
 * and not a hundred accumulating rounding errors.
 */

const MIN_PPS = 2;
const MAX_PPS = 400;
const TRACK_H = 64;
const RULER_H = 22;
const HANDLE_W = 10;
const TRACK_GAP = 4;
const TRACK_LABEL_W = 52;
const WAVE_H = 16;
const MIN_ITEM_LEN = 0.05;

function tickStep(pps) {
  const target = 80 / Math.max(0.0001, pps);
  for (const step of [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) {
    if (step >= target) return step;
  }
  return 900;
}

export { TRACK_H, RULER_H, TRACK_GAP, TRACK_LABEL_W };

/**
 * What to write on a block.
 *
 * The name first, then what the thing is, then the id as a last resort. An id
 * is a true answer to "which source is this" and a useless one to "which clip
 * is this", which is the question somebody scanning a lane is asking.
 *
 * `design` and `captions` keep their kind words rather than a file name: a
 * design block is one page of a set and a captions block is derived from
 * another source, so neither has a name of its own worth more than the word.
 */
export function labelFor(src, item, names = {}) {
  const named = names[item.source];
  if (src?.kind === 'design') return 'Design';
  if (src?.kind === 'captions') return 'Captions';
  if (src?.kind === 'fx') return src.fx || 'Effect';
  if (named) return named;
  if (src?.kind === 'audio') return src.asset ? String(src.asset) : 'Audio';
  return String(src?.asset || item.source);
}

export default function CompositionTimeline({
  composition,
  sourceUrls = {},
  // What each source is called, which the editor has always known and never
  // handed over. Without it a lane reads `11 | 12 | 13` — or, once the asset
  // ids are the UUIDs they really are, a row of truncated hex. The editor
  // computes these names at load and spends them in exactly one place, the
  // inspector heading, so the clip you are looking at is named and the block
  // you are looking at is not.
  sourceNames = {},
  onChange,
  playhead = 0,
  onSeek,
  selectedId = null,
  selectedTrackId = null,
  onSelect,
  readOnly = false,
  onDragStart,
  onDragEnd,
  onDragCancel,
  ripple = false,
}) {
  const scrollRef = useRef(null);
  const laneRef = useRef(null);
  const [pps, setPps] = useState(null);
  const [drag, setDrag] = useState(null);
  const [laneWidth, setLaneWidth] = useState(0);
  const [snapLine, setSnapLine] = useState(null);
  const [scrollLeftVal, setScrollLeftVal] = useState(0);
  const [hoverTrackId, setHoverTrackId] = useState(null);

  const comp = composition;
  const total = useMemo(() => comp ? C.duration(comp) : 0, [comp]);
  const fps = comp?.fps || 30;
  const tracks = comp?.tracks || [];

  // ── Filmstrips from video sources ────────────────────────────────────

  const filmstripSources = useMemo(() => {
    if (!comp?.sources) return [];
    return Object.entries(comp.sources)
      .filter(([, s]) => s.kind === 'clip')
      .map(([id, s]) => ({ id, url: sourceUrls[id] || s.url }));
  }, [comp?.sources, sourceUrls]);
  const strips = useFilmstrips(filmstripSources);

  // ── Waveforms from all sources with audio ────────────────────────────

  const waveformSources = useMemo(() => {
    if (!comp?.sources) return [];
    return Object.entries(comp.sources)
      .filter(([, s]) => s.kind === 'clip' || s.kind === 'audio')
      .map(([id, s]) => ({ id, url: sourceUrls[id] || s.url }));
  }, [comp?.sources, sourceUrls]);
  const waves = useWaveforms(waveformSources);

  // ── Resize observer for fit-to-width ─────────────────────────────────

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setLaneWidth(el.clientWidth));
    ro.observe(el);
    setLaneWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Scale frozen during drag so a trim that changes the total does not
  // make the surface chase the pointer.
  const frozen = useRef(null);
  const scale = useMemo(() => {
    if (frozen.current != null) return frozen.current;
    if (pps) return pps;
    if (!total || !laneWidth) return 40;
    const usable = laneWidth - TRACK_LABEL_W - 24;
    return Math.max(MIN_PPS, usable / total);
  }, [pps, total, laneWidth, drag]); // eslint-disable-line react-hooks/exhaustive-deps

  const xOf = useCallback((seconds) => TRACK_LABEL_W + seconds * scale, [scale]);

  // ── Track layout ─────────────────────────────────────────────────────

  const trackLayout = useMemo(() => {
    let y = RULER_H;
    return tracks.map((track, ti) => {
      const layout = { track, y, h: TRACK_H, index: ti };
      y += TRACK_H + TRACK_GAP;
      return layout;
    });
  }, [tracks]);

  const totalHeight = useMemo(() => {
    if (!trackLayout.length) return RULER_H + TRACK_H + 10;
    const last = trackLayout[trackLayout.length - 1];
    return last.y + last.h + 10;
  }, [trackLayout]);

  const contentWidth = useMemo(
    () => Math.max(laneWidth, xOf(total) + 12),
    [laneWidth, xOf, total]
  );

  const onMinimapNavigate = useCallback((newScrollLeft) => {
    if (scrollRef.current) scrollRef.current.scrollLeft = newScrollLeft;
  }, []);

  const commit = useCallback((next) => {
    if (readOnly || !onChange || next === comp) return;
    onChange(next);
  }, [readOnly, onChange, comp]);

  // ── Coordinate helpers ───────────────────────────────────────────────

  const laneSeconds = useCallback((clientX) => {
    const el = laneRef.current;
    if (!el) return 0;
    const box = el.getBoundingClientRect();
    return Math.max(0, (clientX - box.left - TRACK_LABEL_W) / scale);
  }, [scale]);

  const trackFromY = useCallback((clientY) => {
    const el = laneRef.current;
    if (!el) return null;
    const y = clientY - el.getBoundingClientRect().top;
    for (const tl of trackLayout) {
      if (y >= tl.y && y < tl.y + tl.h) return tl.track;
    }
    return null;
  }, [trackLayout]);

  // Track label: V1, V2, A1, A2, etc.
  const trackLabel = useCallback((track) => {
    const prefix = track.kind === 'video' ? 'V' : 'A';
    const sameKind = tracks.filter(t => t.kind === track.kind);
    return prefix + (sameKind.indexOf(track) + 1);
  }, [tracks]);

  // ── Dragging ─────────────────────────────────────────────────────────

  const startDrag = (e, mode, item, trackId) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    onSelect?.(item.id, trackId);
    onDragStart?.();
    frozen.current = scale;
    setHoverTrackId(null);
    setDrag({
      mode,
      itemId: item.id,
      trackId,
      pointerId: e.pointerId,
      originX: e.clientX,
      originY: e.clientY,
      baseComp: comp,
      baseAt: item.at,
      baseIn: item.in || 0,
      baseLen: item.len,
    });
  };

  const onPointerMove = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.mode === 'scrub') return;

    const dx = e.clientX - drag.originX;
    const dt = dx / scale;
    const snapThreshold = Math.max(0.05, 5 / scale);
    const snapOpts = { threshold: snapThreshold, playhead };

    if (drag.mode === 'trim-in') {
      let adj = dt;
      if (drag.baseIn + adj < 0) adj = -drag.baseIn;
      if (drag.baseAt + adj < 0) adj = -drag.baseAt;
      if (drag.baseLen - adj < MIN_ITEM_LEN) adj = drag.baseLen - MIN_ITEM_LEN;
      const snap = findSnap(
        { trackId: drag.trackId, itemId: drag.itemId, edge: 'start', time: drag.baseAt + adj },
        drag.baseComp, snapOpts
      );
      if (snap.snapped) {
        const snapAdj = snap.time - drag.baseAt;
        if (drag.baseIn + snapAdj >= 0 && drag.baseLen - snapAdj >= MIN_ITEM_LEN) {
          adj = snapAdj;
        }
      }
      setSnapLine(snap.snapped ? snap.time : null);
      commit(C.updateItem(drag.baseComp, drag.trackId, drag.itemId, {
        at: drag.baseAt + adj,
        in: drag.baseIn + adj,
        len: drag.baseLen - adj,
      }));
      return;
    }

    if (drag.mode === 'trim-out') {
      let newLen = drag.baseLen + dt;
      if (newLen < MIN_ITEM_LEN) newLen = MIN_ITEM_LEN;
      const item = drag.baseComp.tracks.find(t => t.id === drag.trackId)
        ?.items.find(i => i.id === drag.itemId);
      const src = item ? drag.baseComp.sources?.[item.source] : null;
      if (src?.duration) {
        const maxLen = src.duration - drag.baseIn;
        if (maxLen > 0 && newLen > maxLen) newLen = maxLen;
      }
      const endTime = drag.baseAt + newLen;
      const snap = findSnap(
        { trackId: drag.trackId, itemId: drag.itemId, edge: 'end', time: endTime },
        drag.baseComp, snapOpts
      );
      if (snap.snapped) {
        const snappedLen = snap.time - drag.baseAt;
        if (snappedLen >= MIN_ITEM_LEN) newLen = snappedLen;
      }
      setSnapLine(snap.snapped ? snap.time : null);
      commit(C.updateItem(drag.baseComp, drag.trackId, drag.itemId, { len: newLen }));
      return;
    }

    if (drag.mode === 'move') {
      const targetTrack = trackFromY(e.clientY);
      const targetTrackId = targetTrack?.id || drag.trackId;
      setHoverTrackId(targetTrackId !== drag.trackId ? targetTrackId : null);

      const proposedAt = Math.max(0, drag.baseAt + dt);
      const snapStart = findSnap(
        { trackId: targetTrackId, itemId: drag.itemId, edge: 'start', time: proposedAt },
        drag.baseComp, snapOpts
      );
      const snapEnd = findSnap(
        { trackId: targetTrackId, itemId: drag.itemId, edge: 'end', time: proposedAt + drag.baseLen },
        drag.baseComp, snapOpts
      );

      let finalAt = proposedAt;
      let snappedTime = null;

      if (snapStart.snapped && snapEnd.snapped) {
        const dStart = Math.abs(snapStart.time - proposedAt);
        const dEnd = Math.abs(snapEnd.time - (proposedAt + drag.baseLen));
        if (dStart <= dEnd) {
          finalAt = snapStart.time;
          snappedTime = snapStart.time;
        } else {
          finalAt = snapEnd.time - drag.baseLen;
          snappedTime = snapEnd.time;
        }
      } else if (snapStart.snapped) {
        finalAt = snapStart.time;
        snappedTime = snapStart.time;
      } else if (snapEnd.snapped) {
        finalAt = snapEnd.time - drag.baseLen;
        snappedTime = snapEnd.time;
      }

      setSnapLine(snappedTime);
      let next = C.updateItem(drag.baseComp, drag.trackId, drag.itemId, { at: Math.max(0, finalAt) });
      if (targetTrackId !== drag.trackId) {
        next = C.moveItemToTrack(next, drag.trackId, drag.itemId, targetTrackId);
      }
      commit(next);
    }
  };

  const endDrag = (e) => {
    if (!drag || (e && e.pointerId !== drag.pointerId)) return;
    if (drag.mode === 'move' && hoverTrackId && hoverTrackId !== drag.trackId) {
      onSelect?.(drag.itemId, hoverTrackId);
    }
    frozen.current = null;
    setSnapLine(null);
    setHoverTrackId(null);
    if (drag.mode !== 'scrub') onDragEnd?.();
    setDrag(null);
  };

  const cancelDrag = useCallback(() => {
    if (!drag) return;
    if (drag.baseComp) commit(drag.baseComp);
    frozen.current = null;
    setSnapLine(null);
    setHoverTrackId(null);
    onDragCancel?.();
    setDrag(null);
  }, [drag, commit, onDragCancel]);

  useEffect(() => {
    if (!drag) return undefined;
    const onKey = (ev) => { if (ev.key === 'Escape') cancelDrag(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drag, cancelDrag]);

  // ── Scrubbing ────────────────────────────────────────────────────────

  const scrub = (e) => {
    if (!onSeek) return;
    const at = laneSeconds(e.clientX);
    onSeek(Math.min(total || at, at));
  };

  const onRulerPointerDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ mode: 'scrub', pointerId: e.pointerId });
    scrub(e);
  };

  const onRulerPointerMove = (e) => {
    if (drag?.mode === 'scrub' && e.pointerId === drag.pointerId) scrub(e);
  };

  // ── Keyboard ─────────────────────────────────────────────────────────

  const onLaneKeyDown = (e) => {
    if (readOnly) return;
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;

    const id = selectedId;
    const tId = selectedTrackId;
    const nudge = e.shiftKey ? 1 : 0.1;

    if (e.key === 's' || e.key === 'S') {
      if (!id || !tId) return;
      e.preventDefault();
      const { comp: next } = C.splitItem(comp, tId, id, playhead);
      if (next !== comp) commit(next);
      return;
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (!id || !tId) return;
      e.preventDefault();
      commit(ripple ? rippleRemoveItem(comp, tId, id) : C.removeItem(comp, tId, id));
      onSelect?.(null, null);
      return;
    }

    if (!id || !tId) return;
    const track = tracks.find(t => t.id === tId);
    const item = track?.items.find(i => i.id === id);
    if (!item) return;

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (e.altKey) {
        commit(C.updateItem(comp, tId, id, { len: Math.max(MIN_ITEM_LEN, item.len - nudge) }));
      } else {
        commit(C.updateItem(comp, tId, id, { at: Math.max(0, item.at - nudge) }));
      }
      return;
    }

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (e.altKey) {
        commit(C.updateItem(comp, tId, id, { len: item.len + nudge }));
      } else {
        commit(C.updateItem(comp, tId, id, { at: item.at + nudge }));
      }
    }
  };

  // ── Rendering ────────────────────────────────────────────────────────

  const step = tickStep(scale);
  const ticks = [];
  for (let t = 0; t <= total + 0.001; t += step) ticks.push(t);

  const selected = selectedId && selectedTrackId
    ? tracks.find(t => t.id === selectedTrackId)?.items.find(i => i.id === selectedId)
    : null;

  return (
    <div data-testid="composition-timeline">
      {/* Header: zoom and summary */}
      <div className="row between center wrap" style={{ gap: 'var(--s2)', marginBottom: 'var(--s2)' }}>
        <span className="caption">
          Timeline · {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'} · {PB.timecode(total, fps)}
        </span>
        <div className="row center" style={{ gap: 'var(--s1)' }}>
          <button type="button" className="btn-chip" style={{ fontSize: 'var(--fs-caption)' }}
            onClick={() => setPps(null)} title="Show the whole composition">Fit</button>
          <button type="button" className="btn-chip" style={{ fontSize: 'var(--fs-caption)' }}
            onClick={() => setPps(Math.max(MIN_PPS, scale / 1.6))} title="Zoom out">&minus;</button>
          <button type="button" className="btn-chip" style={{ fontSize: 'var(--fs-caption)' }}
            onClick={() => setPps(Math.max(scale, Math.min(MAX_PPS, scale * 1.6)))} title="Zoom in">+</button>
        </div>
      </div>

      {/* Minimap */}
      <div style={{ marginBottom: 'var(--s1)' }}>
        <TimelineMinimap
          composition={comp}
          duration={total}
          zoom={scale}
          scrollLeft={scrollLeftVal}
          viewportWidth={laneWidth}
          onNavigate={onMinimapNavigate}
          playhead={playhead}
        />
      </div>

      {/* The scrollable surface */}
      <div ref={scrollRef} onScroll={(e) => setScrollLeftVal(e.currentTarget.scrollLeft)} style={{
        overflowX: 'auto', overflowY: 'hidden',
        border: 'var(--border-w) solid var(--card-border)',
        borderRadius: 'var(--r-sm)',
        background: 'var(--surface-sunken)',
        touchAction: 'pan-y',
      }}>
        <div
          ref={laneRef}
          role="application"
          aria-label="Multi-track composition timeline"
          tabIndex={0}
          onKeyDown={onLaneKeyDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={cancelDrag}
          style={{
            position: 'relative',
            width: contentWidth,
            minWidth: '100%',
            height: totalHeight,
            outlineOffset: -2,
          }}
        >
          {/* Ruler */}
          <div
            onPointerDown={onRulerPointerDown}
            onPointerMove={onRulerPointerMove}
            onPointerUp={endDrag}
            style={{
              position: 'absolute', inset: '0 0 auto 0', height: RULER_H,
              borderBottom: 'var(--border-w) solid var(--card-border)',
              cursor: onSeek ? 'ew-resize' : 'default',
              userSelect: 'none',
            }}
          >
            {ticks.map((t) => (
              <div key={t} style={{
                position: 'absolute', left: xOf(t), top: 0, height: '100%',
                borderLeft: '1px solid var(--card-border)', paddingLeft: 3,
                fontSize: 10, lineHeight: `${RULER_H}px`, color: 'var(--text-subtle)',
                whiteSpace: 'nowrap', pointerEvents: 'none',
              }}>{PB.timecode(t, fps)}</div>
            ))}
          </div>

          {/* Track lanes */}
          {trackLayout.map((tl) => {
            const track = tl.track;
            const ovs = C.overlaps(track);

            const isDropTarget = drag?.mode === 'move' && hoverTrackId === track.id && hoverTrackId !== drag.trackId;

            return (
              <div key={track.id} data-testid={`track-${track.id}`} style={{
                position: 'absolute',
                top: tl.y, left: 0, right: 0,
                height: tl.h,
                borderBottom: '1px solid var(--card-border)',
                background: isDropTarget ? 'var(--accent-soft)' : undefined,
                transition: 'background 100ms ease',
              }}>
                {/* Track label badge */}
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: TRACK_LABEL_W,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                  color: 'var(--text-subtle)',
                  borderRight: '1px solid var(--card-border)',
                  background: 'var(--surface-sunken)',
                  zIndex: 2,
                }}>{trackLabel(track)}</div>

                {/* Items */}
                {track.items.map((item) => {
                  const isSel = item.id === selectedId;
                  const isDragging = drag?.itemId === item.id && drag.mode === 'move';
                  const left = xOf(item.at);
                  const w = Math.max(HANDLE_W * 2 + 4, item.len * scale);
                  const inPt = item.in || 0;
                  const outPt = inPt + item.len;
                  const src = comp?.sources?.[item.source];
                  const isVideo = src?.kind === 'clip' || src?.kind === 'design';

                  const ov = ovs.find(o => o.items[1].id === item.id);

                  return (
                    <div
                      key={item.id}
                      data-testid={`item-${item.id}`}
                      onPointerDown={(e) => startDrag(e, 'move', item, track.id)}
                      onPointerUp={endDrag}
                      title={`${src?.kind || 'item'} · ${PB.timecode(item.at, fps)} to ${PB.timecode(C.itemEnd(item), fps)}`}
                      style={{
                        position: 'absolute', top: 0, left, width: w, height: tl.h,
                        background: isSel ? 'var(--accent-soft)' : 'var(--surface)',
                        border: `var(--border-w) solid ${isSel ? 'var(--accent)' : 'var(--card-border)'}`,
                        borderRadius: 'var(--r-sm)',
                        cursor: readOnly ? 'default' : 'grab',
                        opacity: isDragging ? 0.55 : 1,
                        overflow: 'hidden',
                        touchAction: 'none',
                        boxSizing: 'border-box',
                      }}
                    >
                      {/* Filmstrip for video clips */}
                      {isVideo && (() => {
                        const strip = strips[item.source];
                        const shots = thumbsForBlock(strip, inPt, outPt);
                        if (!shots.length) return null;
                        return (
                          <div aria-hidden="true" style={{
                            position: 'absolute', inset: 0, overflow: 'hidden',
                            pointerEvents: 'none', opacity: isSel ? 0.5 : 0.72,
                          }}>
                            {shots.map((sh) => (
                              <img key={sh.t} src={sh.src} alt=""
                                style={{
                                  position: 'absolute', left: `${sh.at * 100}%`, top: 0,
                                  height: Math.min(tl.h, THUMB_HEIGHT + 20),
                                  objectFit: 'cover',
                                }} />
                            ))}
                          </div>
                        );
                      })()}

                      {/* Label */}
                      <div style={{
                        position: 'relative',
                        padding: '4px 6px', fontSize: 'var(--fs-caption)', lineHeight: 1.3,
                        pointerEvents: 'none', whiteSpace: 'nowrap',
                        background: 'linear-gradient(to bottom, var(--surface) 0%, var(--surface) 62%, transparent 100%)',
                      }}>
                        <div style={{ fontWeight: 700 }}>
                          {labelFor(src, item, sourceNames)}
                        </div>
                        <div className="text-subtle">
                          {PB.timecode(item.len, fps)}
                          {item.gain != null && item.gain !== 1 ? ` · ${Math.round(item.gain * 100)}%` : ''}
                          {item.opacity != null && item.opacity !== 1 ? ` · ${Math.round(item.opacity * 100)}% opaque` : ''}
                        </div>
                      </div>

                      {/* Trim handles */}
                      {!readOnly && w > HANDLE_W * 3 && ['in', 'out'].map((edge) => (
                        <div
                          key={edge}
                          onPointerDown={(e) => startDrag(e, `trim-${edge}`, item, track.id)}
                          onPointerUp={endDrag}
                          title={edge === 'in' ? 'Drag to trim the start' : 'Drag to trim the end'}
                          className="trim-handle"
                          style={{
                            position: 'absolute', top: 0, bottom: 0,
                            [edge === 'in' ? 'left' : 'right']: 0,
                            width: HANDLE_W, cursor: 'ew-resize',
                            background: isSel ? 'var(--accent)' : 'var(--card-border)',
                            touchAction: 'none',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            borderRadius: edge === 'in' ? 'var(--r-sm) 0 0 var(--r-sm)' : '0 var(--r-sm) var(--r-sm) 0',
                          }}
                        >
                          <svg width="4" height="16" viewBox="0 0 4 16" style={{ opacity: 0.6 }}>
                            <line x1="1" y1="2" x2="1" y2="14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                            <line x1="3" y1="2" x2="3" y2="14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                          </svg>
                        </div>
                      ))}

                      {/* Waveform peaks */}
                      {(() => {
                        const wave = waves[item.source];
                        if (!wave) return null;
                        if (wave.state !== 'working' && wave.state !== 'done') return null;
                        const px = Math.max(8, Math.round(w));
                        const cols = peaksForBlock(wave, inPt, outPt,
                          Math.max(8, Math.min(240, Math.round(px / 3))));
                        const d = peaksPath(cols, px, WAVE_H);
                        if (!d) return null;
                        return (
                          <svg aria-hidden="true" width={px} height={WAVE_H}
                            viewBox={`0 0 ${px} ${WAVE_H}`} preserveAspectRatio="none"
                            style={{
                              position: 'absolute', left: 0, bottom: 0, width: '100%',
                              height: WAVE_H, pointerEvents: 'none',
                              background: 'color-mix(in srgb, var(--surface) 72%, transparent)',
                            }}>
                            <path d={d} fill={isSel ? 'var(--accent)' : 'var(--text-muted)'} />
                          </svg>
                        );
                      })()}

                      {/* Transition hatching on the overlap region */}
                      {ov && (() => {
                        const ovPx = ov.duration * scale;
                        if (ovPx < 3) return null;
                        return (
                          <div aria-hidden="true" style={{
                            position: 'absolute', top: 0, bottom: 0, left: 0,
                            width: ovPx, pointerEvents: 'none',
                            background: 'repeating-linear-gradient(135deg, var(--accent-soft) 0 3px, transparent 3px 6px)',
                            borderRight: '1px solid var(--accent)',
                          }} />
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Playhead */}
          <div data-testid="playhead" style={{
            position: 'absolute', top: 0, bottom: 0,
            left: xOf(Math.min(playhead, total)),
            width: 2, background: 'var(--negative)',
            pointerEvents: 'none', zIndex: 3,
          }} />

          {/* Snap indicator */}
          {snapLine != null && (
            <div style={{
              position: 'absolute', top: 0, bottom: 0,
              left: xOf(snapLine),
              width: 1, borderLeft: '1px dashed var(--positive)',
              pointerEvents: 'none', zIndex: 3, opacity: 0.8,
            }} />
          )}
        </div>
      </div>

      {/* Selected item controls */}
      {selected && selectedTrackId && !readOnly && (() => {
        const track = tracks.find(t => t.id === selectedTrackId);
        const src = comp?.sources?.[selected.source];
        const idx = track?.items.findIndex(i => i.id === selected.id) ?? -1;
        const hasPrev = idx > 0;
        const currentTrans = selected.trans?.type || 'cut';

        return (
          <div style={{ marginTop: 'var(--s2)' }}>
            {/* Position info */}
            <div className="row center wrap" style={{ gap: 'var(--s2)', marginBottom: 'var(--s2)' }}>
              <span className="caption">Selected</span>
              <span className="body-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {src?.kind || 'item'} · at {PB.timecode(selected.at, fps)} · {PB.timecode(selected.len, fps)} long
                {selected.in ? ` · from ${PB.timecode(selected.in, fps)} in source` : ''}
              </span>
            </div>

            {/* Transition picker */}
            {hasPrev && (
              <div className="row center wrap" style={{ gap: 'var(--s2)', marginBottom: 'var(--s2)' }}>
                <span className="caption">Transition</span>
                {['cut', ...C.TRANSITION_TYPES].map((t) => (
                  <button key={t} type="button" className="btn-chip"
                    style={{
                      fontSize: 'var(--fs-caption)',
                      borderColor: currentTrans === t ? 'var(--accent)' : undefined,
                      fontWeight: currentTrans === t ? 700 : undefined,
                    }}
                    onClick={() => {
                      if (t === 'cut') {
                        commit(C.updateItem(comp, selectedTrackId, selected.id, { trans: null }));
                      } else {
                        commit(C.updateItem(comp, selectedTrackId, selected.id, { trans: { type: t } }));
                      }
                    }}>
                    {t === 'cut' ? 'Cut' : t === 'wipeleft' ? 'Wipe' : t === 'fadeblack' ? 'Via black'
                      : t === 'dissolve' ? 'Dissolve' : 'Fade'}
                  </button>
                ))}
                <span className="body-xs text-subtle">
                  {currentTrans !== 'cut'
                    ? 'Overlap the previous item to set the transition length.'
                    : ''}
                </span>
              </div>
            )}

            {/* Volume */}
            <div className="row center wrap" style={{ gap: 'var(--s2)' }}>
              <span className="caption">Volume</span>
              <input type="range" min="0" max="2" step="0.05"
                value={Math.min(2, selected.gain ?? 1)}
                onChange={(e) => commit(C.updateItem(comp, selectedTrackId, selected.id,
                  { gain: Number(e.target.value) }))}
                style={{ width: 130 }} aria-label="Item volume" />
              <span className="body-xs" style={{ fontVariantNumeric: 'tabular-nums', minWidth: 42 }}>
                {(selected.gain ?? 1) === 0 ? 'Silent' : `${Math.round((selected.gain ?? 1) * 100)}%`}
              </span>
              {(selected.gain ?? 1) !== 1 && (
                <button type="button" className="btn-chip" style={{ fontSize: 'var(--fs-caption)' }}
                  onClick={() => commit(C.updateItem(comp, selectedTrackId, selected.id, { gain: 1 }))}>
                  Back to 100%
                </button>
              )}
            </div>

            {/* Opacity for video items */}
            {(src?.kind === 'clip' || src?.kind === 'design') && (
              <div className="row center wrap" style={{ gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
                <span className="caption">Opacity</span>
                <input type="range" min="0" max="1" step="0.05"
                  value={selected.opacity ?? 1}
                  onChange={(e) => commit(C.updateItem(comp, selectedTrackId, selected.id,
                    { opacity: Number(e.target.value) }))}
                  style={{ width: 130 }} aria-label="Item opacity" />
                <span className="body-xs" style={{ fontVariantNumeric: 'tabular-nums', minWidth: 42 }}>
                  {Math.round((selected.opacity ?? 1) * 100)}%
                </span>
              </div>
            )}

            {/* Fit mode for clips */}
            {src?.kind === 'clip' && (
              <div className="row center wrap" style={{ gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
                <span className="caption">Fit</span>
                {['cover', 'contain'].map((f) => (
                  <button key={f} type="button" className="btn-chip"
                    style={{
                      fontSize: 'var(--fs-caption)',
                      borderColor: (selected.fit || 'cover') === f ? 'var(--accent)' : undefined,
                      fontWeight: (selected.fit || 'cover') === f ? 700 : undefined,
                    }}
                    onClick={() => commit(C.updateItem(comp, selectedTrackId, selected.id, { fit: f }))}>
                    {f === 'cover' ? 'Fill frame' : 'Letterbox'}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Help text */}
      <div className="body-xs text-subtle" style={{ marginTop: 'var(--s2)' }}>
        {readOnly
          ? 'Read-only: the composition is shown but cannot be changed here.'
          : 'Drag items to move (across tracks too), drag edges to trim, click the ruler to scrub. '
            + 'With an item selected: arrows move (shift for 1s), alt-arrows trim the end, S splits at the playhead, delete removes.'}
      </div>

      <style>{`
        .trim-handle { opacity: 0.7; transition: opacity 100ms ease; }
        .trim-handle:hover { opacity: 1; }
      `}</style>
    </div>
  );
}
