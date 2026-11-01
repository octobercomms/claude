import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as EDL from '@shared/edl.mjs';
import { roWrite } from '../../utils/readOnly';
import { useFilmstrips, thumbsForBlock, THUMB_HEIGHT } from '../../utils/filmstrip';
import { useWaveforms } from '../../utils/waveform';
import { peaksForBlock, peaksPath } from '../../utils/waveformPeaks';
import * as OV from '@shared/overlays.mjs';

/**
 * The timeline surface: the edit, drawn, and editable by dragging it.
 *
 * This is the part of the Edit page that was missing. The render pipeline has
 * been multi-clip since migration 129 and the processor cuts ranges, but the
 * page showed none of it, which is what "there is only a render button" meant.
 * Everything here reads and writes one `EDL` object (shared/edl.mjs) and does
 * no arithmetic of its own: the model decides what a trim means, the surface
 * decides what a drag means, and `compile()` is the only route to ffmpeg.
 *
 * DOM, not canvas. The spec put the crossover at about fifty blocks, and an
 * edit assembled from uploads does not get near that; canvas costs a session
 * and buys nothing yet. If an edit ever does, the hit testing is already in
 * `laidOut`/`itemAt` rather than in this file, so the swap is local.
 *
 * **One video track**, deliberately. Stacked tracks mean overlay compositing,
 * which the processor cannot do, and drawing a second track that renders to
 * nothing is the page lying about its own output. That is the complaint this
 * work exists to answer.
 *
 * Pointer events throughout, so a trackpad, a mouse and a touchscreen all take
 * the same path; and every drag has a keyboard equivalent, because trimming by
 * drag alone makes the page unusable for anyone who cannot.
 */

const MIN_PPS = 2;          // pixels per second, zoomed right out
const MAX_PPS = 400;        // zoomed right in: 0.4s across a 160px block
const BLOCK_H = 64;
const RULER_H = 22;
const HANDLE_W = 10;        // the grab zone on each edge of a block
const NOMINAL_LEN = 5;      // seconds a block is drawn at before its clip is probed
const WAVE_H = 16;          // the audio strip along the bottom of a block

// mm:ss.cs — centiseconds, not frames. The frame rate of an arbitrary upload is
// not known in the browser, and a readout that says "frame 12" when it is
// guessing 30fps on 24fps footage is worse than one that does not claim to know.
export function stamp(seconds) {
  const t = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.round((t - Math.floor(t)) * 100) % 100;
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// A block's drawn length. An unprobed clip has no length to draw, so it gets a
// nominal width and says so, rather than collapsing to nothing and looking as
// though the upload failed.
function drawLength(item) {
  const d = EDL.itemDuration(item);
  return d > 0 ? d : NOMINAL_LEN;
}

/**
 * Where each block is drawn.
 *
 * Shares `laidOut`'s overlap arithmetic rather than repeating it: a cross-fade
 * pulls a block back over the end of the one before, and if the drawing used
 * its own sum the timeline would show a cut somewhere the render will not put
 * one. The only difference is the nominal width for a clip whose duration has
 * not been probed yet, which has no real length to lay out.
 */
function drawRows(edl) {
  const items = edl?.items || [];
  let at = 0;
  return items.map((item, i) => {
    const length = drawLength(item);
    const overlap = i > 0 ? Math.min(length, EDL.transitionOf(item).dur) : 0;
    const start = Math.max(0, at - overlap);
    at = start + length;
    return { item, start, length, overlap, known: EDL.itemDuration(item) > 0 };
  });
}

// Ruler ticks at a spacing that stays readable at any zoom: roughly one label
// every 80px, snapped to a round number of seconds.
function tickStep(pps) {
  const target = 80 / Math.max(0.0001, pps);
  for (const step of [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]) {
    if (step >= target) return step;
  }
  return 900;
}

export default function Timeline({
  clips = [],
  edl,
  onChange,
  overlays = [],
  onOverlaysChange = null,
  playhead = 0,
  onSeek,
  selectedId = null,
  onSelect,
  readOnly = false,
  height = BLOCK_H,
}) {
  const scrollRef = useRef(null);
  const laneRef = useRef(null);
  const [pps, setPps] = useState(null);          // null = fit to the width
  const [drag, setDrag] = useState(null);
  const [laneWidth, setLaneWidth] = useState(0);

  // Stills along each block, so a cut can be placed by eye instead of by
  // scrubbing to find out where it landed. Extracted in the browser; see
  // utils/filmstrip.js for why not on the server.
  const strips = useFilmstrips(clips);

  // Positioned text, normalised against the edit's real length so a band is
  // never drawn for an overlay the render will not show.
  const [pickedOverlay, setPickedOverlay] = useState(null);
  const liveOverlays = useMemo(
    () => OV.normaliseOverlays(overlays, EDL.duration(edl)), [overlays, edl]);

  // Audio peaks under each block. You cut on speech, so without this a trim
  // lands in the middle of a word and you find out on playback.
  const waves = useWaveforms(clips);

  const rows = useMemo(() => drawRows(edl), [edl]);
  const drawnTotal = useMemo(
    () => rows.reduce((t, r) => t + r.length, 0), [rows]);
  const realTotal = useMemo(() => EDL.duration(edl), [edl]);

  // Fit-to-width until the person zooms, so a 20-minute recording and a
  // 20-second reel both open showing the whole edit.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setLaneWidth(el.clientWidth));
    ro.observe(el);
    setLaneWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Fit-to-width recomputes the scale from the edit's length, so a trim that
  // shortens the edit would stretch it back out to fill the lane while the
  // finger is still down: the edge then chases the pointer and a drag feels
  // slippery and lands short. The scale is held for the duration of a drag,
  // which is what every desktop editor does and why their trims feel direct.
  const frozen = useRef(null);
  const scale = useMemo(() => {
    if (frozen.current != null) return frozen.current;
    if (pps) return pps;
    if (!drawnTotal || !laneWidth) return 40;
    // Fit is not bounded by MAX_PPS. MAX_PPS bounds how far the zoom buttons
    // go; fit's contract is to show the whole edit across the lane, and
    // clamping it leaves a short edit as a stub in the corner looking like a
    // failed upload. A half-second edit at 2000 pixels a second is only
    // pixels, and the person asked to see it.
    return Math.max(MIN_PPS, (laneWidth - 24) / drawnTotal);
  }, [pps, drawnTotal, laneWidth, drag]);

  const xOf = useCallback((seconds) => seconds * scale, [scale]);
  const secondsOf = useCallback((x) => x / scale, [scale]);

  const commit = useCallback((next) => {
    if (readOnly || !onChange || next === edl) return;
    onChange(next);
  }, [readOnly, onChange, edl]);

  // ---- dragging ---------------------------------------------------------

  // The pointer's position in timeline seconds, measured against the lane
  // rather than the window, so a scrolled or zoomed lane still reads true.
  const laneSeconds = useCallback((clientX) => {
    const el = laneRef.current;
    if (!el) return 0;
    const box = el.getBoundingClientRect();
    return Math.max(0, secondsOf(clientX - box.left));
  }, [secondsOf]);

  const startDrag = (e, mode, row) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    onSelect?.(row.item.id);
    frozen.current = scale;
    setDrag({
      mode,
      id: row.item.id,
      pointerId: e.pointerId,
      originX: e.clientX,
      // Snapshot of the edit as the drag began. Every move recomputes from
      // this rather than from the last frame, so a drag is one edit and not a
      // hundred accumulating rounding errors.
      base: edl,
      baseIn: row.item.in,
      baseOut: row.item.out,
      index: rows.findIndex((r) => r.item.id === row.item.id),
      dropIndex: null,
    });
  };

  const onPointerMove = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.originX;
    const dt = secondsOf(dx);

    if (drag.mode === 'trim-in') {
      commit(EDL.trim(drag.base, drag.id, 'in', (drag.baseIn || 0) + dt, clips));
      return;
    }
    if (drag.mode === 'trim-out') {
      const from = drag.baseOut == null ? EDL.clipDuration(clips[0]) : drag.baseOut;
      commit(EDL.trim(drag.base, drag.id, 'out', (from || 0) + dt, clips));
      return;
    }
    if (drag.mode === 'move') {
      // Target index from the pointer against each block's midpoint, which is
      // how a strip reorder reads to the hand: the block lands where its
      // centre is, not where its left edge happens to be.
      const at = laneSeconds(e.clientX);
      const base = drawRows(drag.base);
      let target = base.length - 1;
      for (let i = 0; i < base.length; i++) {
        if (at < base[i].start + base[i].length / 2) { target = i; break; }
      }
      if (target !== drag.dropIndex) setDrag({ ...drag, dropIndex: target });
    }
  };

  const endDrag = (e) => {
    if (!drag || (e && e.pointerId !== drag.pointerId)) return;
    if (drag.mode === 'move' && drag.dropIndex != null && drag.dropIndex !== drag.index) {
      commit(EDL.move(drag.base, drag.id, drag.dropIndex));
    }
    frozen.current = null;
    setDrag(null);
  };

  // A cancelled drag (Escape, the pointer leaving the window, a system gesture)
  // puts the edit back where it started. Half a trim is not an edit.
  const cancelDrag = useCallback(() => {
    if (!drag) return;
    if (drag.mode !== 'move') commit(drag.base);
    frozen.current = null;
    setDrag(null);
  }, [drag, commit]);

  useEffect(() => {
    if (!drag) return undefined;
    const onKey = (ev) => { if (ev.key === 'Escape') cancelDrag(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drag, cancelDrag]);

  // ---- keyboard ---------------------------------------------------------

  const nudge = (id, edge, seconds) => {
    const row = rows.find((r) => r.item.id === id);
    if (!row) return;
    const from = edge === 'in' ? row.item.in : row.item.out;
    if (from == null) return;
    commit(EDL.trim(edl, id, edge, from + seconds, clips));
  };

  const onLaneKeyDown = (e) => {
    const id = selectedId;
    const step = e.shiftKey ? 1 : 0.1;
    const order = rows.findIndex((r) => r.item.id === id);
    const keys = {
      ArrowLeft: () => (e.altKey ? nudge(id, 'out', -step) : nudge(id, 'in', -step)),
      ArrowRight: () => (e.altKey ? nudge(id, 'out', step) : nudge(id, 'in', step)),
      ArrowUp: () => order > 0 && commit(EDL.move(edl, id, order - 1)),
      ArrowDown: () => order >= 0 && order < rows.length - 1 && commit(EDL.move(edl, id, order + 1)),
      Backspace: () => commit(EDL.remove(edl, id)),
      Delete: () => commit(EDL.remove(edl, id)),
      s: () => commit(EDL.split(edl, playhead)),
      S: () => commit(EDL.split(edl, playhead)),
    };
    if (!keys[e.key]) return;
    if (!id && e.key !== 's' && e.key !== 'S') return;
    if (readOnly) return;
    e.preventDefault();
    keys[e.key]();
  };

  // ---- scrubbing --------------------------------------------------------

  const scrub = (e) => {
    if (!onSeek) return;
    const at = laneSeconds(e.clientX);
    onSeek(Math.min(realTotal || at, at));
  };

  const onRulerPointerDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ mode: 'scrub', pointerId: e.pointerId });
    scrub(e);
  };

  const onRulerPointerMove = (e) => {
    if (drag?.mode === 'scrub' && e.pointerId === drag.pointerId) scrub(e);
  };

  // ---- rendering --------------------------------------------------------

  const step = tickStep(scale);
  const ticks = [];
  for (let t = 0; t <= drawnTotal + 0.001; t += step) ticks.push(t);

  const zoomBtn = (label, fn, title) => (
    <button type="button" className="btn-chip" style={{ fontSize: 'var(--fs-caption)' }}
      {...roWrite(false, { onClick: fn, title })}>{label}</button>
  );

  const selected = rows.find((r) => r.item.id === selectedId) || null;

  return (
    <div>
      <div className="row between center wrap" style={{ gap: 'var(--s2)', marginBottom: 'var(--s2)' }}>
        <span className="caption">
          Timeline · {rows.length} {rows.length === 1 ? 'block' : 'blocks'} · {stamp(realTotal)}
        </span>
        <div className="row center" style={{ gap: 'var(--s1)' }}>
          {zoomBtn('Fit', () => setPps(null), 'Show the whole edit')}
          {zoomBtn('−', () => setPps(Math.max(MIN_PPS, scale / 1.6)), 'Zoom out')}
          {zoomBtn('+', () => setPps(Math.max(scale, Math.min(MAX_PPS, scale * 1.6))), 'Zoom in')}
        </div>
      </div>

      <div ref={scrollRef} style={{
        overflowX: 'auto', overflowY: 'hidden',
        border: 'var(--border-w) solid var(--card-border)',
        borderRadius: 'var(--r-sm)',
        background: 'var(--surface-sunken)',
        touchAction: 'pan-y',
      }}>
        <div
          ref={laneRef}
          role="application"
          aria-label="Video edit timeline"
          tabIndex={0}
          onKeyDown={onLaneKeyDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={cancelDrag}
          style={{
            position: 'relative',
            width: Math.max(laneWidth, xOf(drawnTotal) + 12),
            minWidth: '100%',
            height: RULER_H + height + (liveOverlays.length ? 24 : 10),
            outlineOffset: -2,
          }}
        >
          {/* Ruler. Scrubbing lives here rather than on the blocks, so dragging
              a block always means the block and never the playhead. */}
          <div
            onPointerDown={onRulerPointerDown}
            onPointerMove={onRulerPointerMove}
            onPointerUp={endDrag}
            style={{
              position: 'absolute', inset: `0 0 auto 0`, height: RULER_H,
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
              }}>{stamp(t)}</div>
            ))}
          </div>

          {/* Blocks */}
          {rows.map((row, i) => {
            const isSel = row.item.id === selectedId;
            const isDragging = drag?.id === row.item.id && drag.mode === 'move';
            const w = Math.max(HANDLE_W * 2 + 4, xOf(row.length));
            return (
              <div
                key={row.item.id}
                onPointerDown={(e) => startDrag(e, 'move', row)}
                onPointerUp={endDrag}
                title={`Clip ${row.item.clip + 1} · ${stamp(row.item.in)} to ${
                  row.item.out == null ? 'end' : stamp(row.item.out)}`}
                style={{
                  position: 'absolute', top: RULER_H + 5, left: xOf(row.start),
                  width: w, height,
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
                {/* The filmstrip, behind the label. Each still is placed by
                    its own source time, so a trim or a split moves the frames
                    to where they belong without re-extracting anything. */}
                {(() => {
                  const strip = strips[clips[row.item.clip]?.id];
                  const shots = thumbsForBlock(strip, row.item.in, row.item.out);
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
                            height: Math.min(height, THUMB_HEIGHT + 20),
                            // Each still marks the point it was taken from, so
                            // it hangs from that point rather than being
                            // centred on it: a frame drawn either side of its
                            // own timestamp is a frame in the wrong place.
                            transform: 'translateX(0)',
                            objectFit: 'cover',
                          }} />
                      ))}
                    </div>
                  );
                })()}

                <div style={{
                  position: 'relative',
                  padding: '4px 6px', fontSize: 'var(--fs-caption)', lineHeight: 1.3,
                  pointerEvents: 'none', whiteSpace: 'nowrap',
                  // The label has to stay readable over footage of any
                  // brightness, so it carries its own ground rather than
                  // relying on the frames behind it being dark.
                  background: 'linear-gradient(to bottom, var(--surface) 0%, var(--surface) 62%, transparent 100%)',
                }}>
                  <div style={{ fontWeight: 700 }}>
                    {clips[row.item.clip]?.name || `Clip ${row.item.clip + 1}`}
                  </div>
                  <div className="text-subtle">
                    {row.known ? stamp(row.length) : 'length unknown'}
                    {strips[clips[row.item.clip]?.id]?.state === 'working' ? ' · reading frames' : ''}
                  </div>
                </div>

                {/* Trim handles. Only drawn when there is room for them, so a
                    block zoomed down to a sliver is not all handle. */}
                {!readOnly && w > HANDLE_W * 3 && ['in', 'out'].map((edge) => (
                  <div
                    key={edge}
                    onPointerDown={(e) => startDrag(e, `trim-${edge}`, row)}
                    onPointerUp={endDrag}
                    title={edge === 'in' ? 'Drag to trim the start' : 'Drag to trim the end'}
                    style={{
                      position: 'absolute', top: 0, bottom: 0,
                      [edge === 'in' ? 'left' : 'right']: 0,
                      width: HANDLE_W, cursor: 'ew-resize',
                      background: isSel ? 'var(--accent)' : 'var(--card-border)',
                      touchAction: 'none',
                    }}
                  />
                ))}

                {/* The waveform, along the bottom of the block and over the
                    stills, because the two answer different questions about
                    the same moment and you read them together: the frames say
                    what is on screen, the peaks say whether anyone is talking. */}
                {(() => {
                  const wave = waves[clips[row.item.clip]?.id];
                  if (!wave) return null;
                  const px = Math.max(8, Math.round(w));
                  if (wave.state === 'working' || wave.state === 'done') {
                    const cols = peaksForBlock(wave, row.item.in, row.item.out,
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
                  }
                  // Silent, too big to read, or undecodable. Each says which,
                  // because an empty strip could be any of the three and the
                  // difference changes what you do about it.
                  const said = {
                    silent: 'no audio',
                    'too-big': 'clip too large to read audio',
                    unsupported: 'audio not readable here',
                    failed: 'audio could not be read',
                    // The browser would not say whether there is an audio
                    // track, and the decode failed, so both causes are still
                    // open. Naming one of them would be a guess the operator
                    // would act on.
                    unknown: 'no audio, or a format this browser cannot read',
                  }[wave.state];
                  if (!said || w < 90) return null;
                  return (
                    <div className="body-xs text-subtle" style={{
                      position: 'absolute', left: 4, bottom: 1, right: 4,
                      fontSize: 9, lineHeight: `${WAVE_H}px`, pointerEvents: 'none',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      background: 'color-mix(in srgb, var(--surface) 72%, transparent)',
                    }}>{said}</div>
                  );
                })()}

                {/* The cross-fade, drawn over the overlap it actually
                    occupies. A transition shown as a marker between abutting
                    blocks would be a lie about the length of the output; shown
                    as the overlap, the drawing and the render agree. */}
                {row.overlap > 0 && xOf(row.overlap) > 3 && (
                  <div aria-hidden="true" style={{
                    position: 'absolute', top: 0, bottom: 0, left: 0,
                    width: xOf(row.overlap), pointerEvents: 'none',
                    background: 'repeating-linear-gradient(135deg, var(--accent-soft) 0 3px, transparent 3px 6px)',
                    borderRight: '1px solid var(--accent)',
                  }} />
                )}

                {/* Where the next block would land during a reorder drag. */}
                {drag?.mode === 'move' && drag.dropIndex === i && drag.index !== i && (
                  <div style={{
                    position: 'absolute', inset: 0, pointerEvents: 'none',
                    border: '2px dashed var(--accent)', borderRadius: 'var(--r-sm)',
                  }} />
                )}
              </div>
            );
          })}

          {/* Positioned text, as a band under the blocks: a line that
              appears at 00:03 is only placeable if you can see what is on
              screen at 00:03. Times are timeline times, so the band sits
              against the footage it will actually cover. */}
          {liveOverlays.map((o, i) => {
            const left = xOf(o.from);
            const w = Math.max(3, xOf(o.to - o.from));
            return (
              <div key={o.id || i}
                title={`"${o.text}" · ${stamp(o.from)} to ${stamp(o.to)}`}
                onPointerDown={(e) => { e.stopPropagation(); setPickedOverlay(o.id); }}
                style={{
                  position: 'absolute', left, width: w,
                  top: RULER_H + height + 6, height: 12,
                  background: pickedOverlay === o.id ? 'var(--accent)' : 'var(--accent-soft)',
                  border: `1px solid var(--accent)`,
                  borderRadius: 'var(--r-sm)',
                  cursor: readOnly ? 'default' : 'pointer',
                  overflow: 'hidden', whiteSpace: 'nowrap',
                  fontSize: 9, lineHeight: '10px', padding: '0 3px',
                  color: pickedOverlay === o.id ? 'var(--accent-on)' : 'var(--text)',
                }}>{o.text}</div>
            );
          })}

          {/* Playhead, above the blocks and never interactive: it is drawn
              state, and clicking it would steal the drag from the block. */}
          <div style={{
            position: 'absolute', top: 0, bottom: 0, left: xOf(Math.min(playhead, drawnTotal)),
            width: 2, background: 'var(--negative)', pointerEvents: 'none',
          }} />
        </div>
      </div>

      {/* The transition into the selected block. Only offered on a block that
          has one to its left and room for a visible fade, because a control
          that can be pressed and does nothing is worse than no control. */}
      {selected && !readOnly && (() => {
        const idx = rows.findIndex((r) => r.item.id === selected.item.id);
        if (idx <= 0) {
          return (
            <div className="body-xs text-subtle" style={{ marginTop: 'var(--s2)' }}>
              The first block has nothing before it to fade from.
            </div>
          );
        }
        const ceiling = EDL.maxTransitionAt(edl, idx);
        if (!(ceiling >= EDL.MIN_TRANS)) {
          return (
            <div className="body-xs text-subtle" style={{ marginTop: 'var(--s2)' }}>
              These blocks are too short to fade between.
            </div>
          );
        }
        const current = EDL.transitionOf(selected.item);
        return (
          <div className="row center wrap" style={{ gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
            <span className="caption">Into this block</span>
            {['cut', ...EDL.TRANSITIONS.filter((t) => t !== 'cut')].map((t) => (
              <button key={t} type="button" className="btn-chip"
                style={{
                  fontSize: 'var(--fs-caption)',
                  borderColor: current.type === t ? 'var(--accent)' : undefined,
                  fontWeight: current.type === t ? 700 : undefined,
                }}
                onClick={() => commit(EDL.setTransition(edl, selected.item.id, t,
                  current.dur || EDL.DEFAULT_TRANS))}>
                {t === 'cut' ? 'Cut' : t === 'wipeleft' ? 'Wipe' : t === 'fadeblack' ? 'Via black'
                  : t === 'dissolve' ? 'Dissolve' : 'Fade'}
              </button>
            ))}
            {current.type !== 'cut' && (
              <>
                <input type="range" min={EDL.MIN_TRANS} max={ceiling} step="0.05"
                  value={Math.min(ceiling, current.dur)}
                  onChange={(e) => commit(EDL.setTransition(edl, selected.item.id,
                    current.type, Number(e.target.value)))}
                  style={{ width: 110 }}
                  aria-label="Transition length" />
                <span className="body-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {current.dur.toFixed(2)}s
                </span>
                <span className="body-xs text-subtle">
                  takes {current.dur.toFixed(2)}s off the edit
                </span>
              </>
            )}
          </div>
        );
      })()}

      {/* One block's volume.
          
          The model has carried `gain` since the EDL was written, the renderer
          applies it, and nothing ever set it — so a quiet piece to camera
          could be boosted only by hand-editing a saved EDL, and the player's
          "this block is boosted above 100%" line described a state nothing
          could produce.
          
          Per block, not per edit, because the case it is for is one clip
          recorded quieter than the rest. 0 to 200% on the slider: the model
          allows 4 and a boost past 2 on speech is distortion rather than
          volume. */}
      {selected && !readOnly && (() => {
        const g = EDL.gainOf(selected.item);
        return (
          <div className="row center wrap" style={{ gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
            <span className="caption">Volume</span>
            <input type="range" min="0" max="2" step="0.05" value={Math.min(2, g)}
              onChange={(e) => commit(EDL.setGain(edl, selected.item.id, Number(e.target.value)))}
              style={{ width: 130 }} aria-label="Block volume" />
            <span className="body-xs" style={{ fontVariantNumeric: 'tabular-nums', minWidth: 42 }}>
              {g === 0 ? 'Silent' : `${Math.round(g * 100)}%`}
            </span>
            {g !== 1 && (
              <button type="button" className="btn-chip" style={{ fontSize: 'var(--fs-caption)' }}
                onClick={() => commit(EDL.setGain(edl, selected.item.id, 1))}>
                Back to 100%
              </button>
            )}
            {g > 1 && (
              <span className="body-xs text-subtle">
                Louder than the source. Check it against the rest of the edit.
              </span>
            )}
          </div>
        );
      })()}

      {/* The text itself. Times are timeline times, positions are fractions of
          the frame, so the same overlay is in the same place whether the edit
          renders 9:16, 1:1 or 4:5. */}
      {onOverlaysChange && !readOnly && (
        <div style={{ marginTop: 'var(--s3)' }}>
          <div className="row between center wrap" style={{ gap: 'var(--s2)' }}>
            <span className="caption">Text on screen</span>
            <button type="button" className="btn-chip" style={{ fontSize: 'var(--fs-caption)' }}
              onClick={() => {
                const total = EDL.duration(edl) || 5;
                const from = Math.min(playhead, Math.max(0, total - 1));
                onOverlaysChange([...(overlays || []), {
                  id: `o${Date.now().toString(36)}`,
                  text: 'New text',
                  from, to: Math.min(total, from + 2),
                  x: 0.5, y: 0.18, size: OV.DEFAULT_SIZE,
                }]);
              }}>+ Add text at the playhead</button>
          </div>

          {!(overlays || []).length && (
            <div className="body-xs text-subtle" style={{ marginTop: 'var(--s2)' }}>
              Nothing on screen yet. Text added here appears and leaves at the times
              you set, over whatever the edit shows then.
            </div>
          )}

          {(overlays || []).map((o, i) => {
            const total = EDL.duration(edl) || 0;
            const patch = (fields) => onOverlaysChange(
              (overlays || []).map((x, k) => (k === i ? { ...x, ...fields } : x)));
            // What the renderer will make of this row, so the page shows the
            // clamped values rather than the typed ones.
            const asRendered = OV.normaliseOverlays([o], total)[0] || null;
            return (
              <div key={o.id || i} className="row center wrap"
                style={{
                  gap: 'var(--s2)', marginTop: 'var(--s2)', padding: 'var(--s2)',
                  border: `var(--border-w) solid ${pickedOverlay === o.id ? 'var(--accent)' : 'var(--card-border)'}`,
                  borderRadius: 'var(--r-sm)',
                }}
                onPointerDown={() => setPickedOverlay(o.id)}>
                <input type="text" value={o.text || ''} maxLength={OV.MAX_TEXT}
                  onChange={(e) => patch({ text: e.target.value })}
                  placeholder="What it says"
                  aria-label="Overlay text"
                  style={{ flex: '1 1 160px', minWidth: 120 }} />
                <label className="body-xs text-subtle">from
                  <input type="number" min="0" max={total || undefined} step="0.1"
                    value={Number(o.from) || 0}
                    onChange={(e) => patch({ from: Number(e.target.value) })}
                    aria-label="Appears at"
                    style={{ width: 62, marginLeft: 4 }} />
                </label>
                <label className="body-xs text-subtle">to
                  <input type="number" min="0" max={total || undefined} step="0.1"
                    value={Number(o.to) || 0}
                    onChange={(e) => patch({ to: Number(e.target.value) })}
                    aria-label="Leaves at"
                    style={{ width: 62, marginLeft: 4 }} />
                </label>
                <label className="body-xs text-subtle">across
                  <input type="range" min="0" max="1" step="0.05"
                    value={o.x == null ? 0.5 : o.x}
                    onChange={(e) => patch({ x: Number(e.target.value) })}
                    aria-label="Position across the frame"
                    style={{ width: 70, marginLeft: 4 }} />
                </label>
                <label className="body-xs text-subtle">down
                  <input type="range" min="0" max="1" step="0.05"
                    value={o.y == null ? 0.18 : o.y}
                    onChange={(e) => patch({ y: Number(e.target.value) })}
                    aria-label="Position down the frame"
                    style={{ width: 70, marginLeft: 4 }} />
                </label>
                <label className="body-xs text-subtle">size
                  <input type="range" min={OV.MIN_SIZE} max={OV.MAX_SIZE} step="0.005"
                    value={o.size == null ? OV.DEFAULT_SIZE : o.size}
                    onChange={(e) => patch({ size: Number(e.target.value) })}
                    aria-label="Text size"
                    style={{ width: 70, marginLeft: 4 }} />
                </label>
                <button type="button" className="btn-chip"
                  style={{ fontSize: 'var(--fs-caption)', color: 'var(--negative)' }}
                  onClick={() => onOverlaysChange((overlays || []).filter((x, k) => k !== i))}
                  aria-label="Remove this text">Remove</button>
                {/* When the typed window is not what will render, say so rather
                    than silently showing one thing and rendering another. */}
                {!asRendered ? (
                  <span className="body-xs" style={{ color: 'var(--warning)', flexBasis: '100%' }}>
                    This will not appear: it has no text, or its window is past the end of the edit.
                  </span>
                ) : (Math.abs(asRendered.from - (Number(o.from) || 0)) > 0.01
                     || Math.abs(asRendered.to - (Number(o.to) || 0)) > 0.01) ? (
                    <span className="body-xs text-subtle" style={{ flexBasis: '100%' }}>
                      Will render {stamp(asRendered.from)} to {stamp(asRendered.to)}, clamped to the edit.
                    </span>
                  ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div className="row between center wrap" style={{ gap: 'var(--s2)', marginTop: 'var(--s2)' }}>
        <span className="body-xs text-subtle">
          {readOnly
            ? 'Read-only: the edit is shown but cannot be changed here.'
            : 'Drag a block to reorder, drag its edges to trim, click the ruler to move the playhead. '
              + 'With a block selected: arrows trim, alt-arrows trim the end, up and down reorder, '
              + 'S splits at the playhead, delete removes.'}
        </span>
        {selected && (
          <span className="body-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {clips[selected.item.clip]?.name || `Clip ${selected.item.clip + 1}`}
            {' · '}{stamp(selected.item.in)} to {selected.item.out == null ? 'end' : stamp(selected.item.out)}
          </span>
        )}
      </div>
    </div>
  );
}
