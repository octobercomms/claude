import React, { useCallback, useMemo, useRef, useState } from 'react';

/**
 * TimelineMinimap — a compact full-duration overview of the composition
 * timeline. Shows all tracks as thin horizontal lanes with coloured
 * rectangles for items, a viewport indicator, and a playhead line.
 *
 * Click anywhere to centre the main timeline on that position; drag the
 * viewport rectangle to scroll proportionally.
 */

const MINIMAP_H = 40;
const LANE_PAD = 2;
const MIN_VIEWPORT_W = 6;

/** Colour per source kind — muted, non-attention-grabbing. */
const KIND_COLOURS = {
  clip:     'var(--fn-distribute)',  // blue
  audio:    'var(--fn-strategy)',    // teal
  design:   'var(--fn-create)',      // violet
  captions: 'var(--fn-measure)',     // slate
};

function kindColour(sources, sourceId) {
  const kind = sources?.[sourceId]?.kind;
  return KIND_COLOURS[kind] || 'var(--text-subtle)';
}

function TimelineMinimap({
  composition,
  duration,
  zoom,
  scrollLeft,
  viewportWidth,
  onNavigate,
  playhead = 0,
}) {
  const containerRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const tracks = composition?.tracks || [];
  const sources = composition?.sources || {};

  // How many pixels wide the minimap's content area is (excluding border).
  // We measure on first render and stay reactive via CSS (100% width).
  // For SVG viewBox calculations we use a nominal width and let SVG scale.
  const NOMINAL_W = 1000;

  const safeDuration = Math.max(duration || 0, 0.01);

  // Compute lane height — divide the available vertical space evenly,
  // with a small gap between lanes.
  const trackCount = Math.max(tracks.length, 1);
  const laneGap = 1;
  const totalGapH = (trackCount - 1) * laneGap;
  const laneH = Math.max(2, (MINIMAP_H - LANE_PAD * 2 - totalGapH) / trackCount);

  // Pre-compute item rectangles for the SVG.
  const items = useMemo(() => {
    const rects = [];
    tracks.forEach((track, ti) => {
      const y = LANE_PAD + ti * (laneH + laneGap);
      track.items.forEach((item) => {
        const x = (item.at / safeDuration) * NOMINAL_W;
        const w = Math.max(1, (item.len / safeDuration) * NOMINAL_W);
        rects.push({
          key: item.id,
          x,
          y,
          w,
          h: laneH,
          fill: kindColour(sources, item.source),
        });
      });
    });
    return rects;
  }, [tracks, sources, safeDuration, laneH, laneGap]);

  // Viewport rectangle in minimap coordinates.
  const viewport = useMemo(() => {
    if (!zoom || !viewportWidth) return null;
    const visibleSeconds = viewportWidth / zoom;
    const scrollSeconds = (scrollLeft || 0) / zoom;
    const x = (scrollSeconds / safeDuration) * NOMINAL_W;
    const w = Math.max(MIN_VIEWPORT_W, (visibleSeconds / safeDuration) * NOMINAL_W);
    return { x, w };
  }, [zoom, viewportWidth, scrollLeft, safeDuration]);

  // Playhead line in minimap coordinates.
  const playheadX = (Math.min(playhead, safeDuration) / safeDuration) * NOMINAL_W;

  // -- Interaction helpers --

  const secondsFromEvent = useCallback((e) => {
    const el = containerRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return ratio * safeDuration;
  }, [safeDuration]);

  const navigateToSeconds = useCallback((secs) => {
    if (!onNavigate || !zoom) return;
    const visibleSeconds = (viewportWidth || 0) / zoom;
    // Centre the viewport on the clicked position.
    const targetSeconds = secs - visibleSeconds / 2;
    const maxScroll = Math.max(0, safeDuration * zoom - (viewportWidth || 0));
    const newScrollLeft = Math.max(0, Math.min(maxScroll, targetSeconds * zoom));
    onNavigate(newScrollLeft);
  }, [onNavigate, zoom, viewportWidth, safeDuration]);

  const onPointerDown = useCallback((e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
    navigateToSeconds(secondsFromEvent(e));
  }, [navigateToSeconds, secondsFromEvent]);

  const onPointerMove = useCallback((e) => {
    if (!dragging) return;
    navigateToSeconds(secondsFromEvent(e));
  }, [dragging, navigateToSeconds, secondsFromEvent]);

  const onPointerUp = useCallback((e) => {
    if (dragging) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      setDragging(false);
    }
  }, [dragging]);

  if (!composition || !tracks.length) return null;

  return (
    <div
      ref={containerRef}
      data-testid="timeline-minimap"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        position: 'relative',
        width: '100%',
        height: MINIMAP_H,
        background: 'var(--surface-sunken)',
        border: 'var(--border-w) solid var(--card-border)',
        borderRadius: 'var(--r-sm)',
        cursor: dragging ? 'grabbing' : 'pointer',
        userSelect: 'none',
        touchAction: 'none',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <svg
        width="100%"
        height={MINIMAP_H}
        viewBox={`0 0 ${NOMINAL_W} ${MINIMAP_H}`}
        preserveAspectRatio="none"
        style={{ display: 'block' }}
      >
        {/* Track lane backgrounds */}
        {tracks.map((track, ti) => {
          const y = LANE_PAD + ti * (laneH + laneGap);
          return (
            <rect
              key={`lane-${track.id}`}
              x={0}
              y={y}
              width={NOMINAL_W}
              height={laneH}
              fill="var(--surface)"
              opacity={0.4}
              rx={1}
            />
          );
        })}

        {/* Item rectangles */}
        {items.map((r) => (
          <rect
            key={r.key}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            fill={r.fill}
            opacity={0.7}
            rx={0.5}
          />
        ))}

        {/* Viewport indicator */}
        {viewport && (
          <rect
            x={viewport.x}
            y={0}
            width={viewport.w}
            height={MINIMAP_H}
            fill="var(--accent)"
            opacity={0.15}
            stroke="var(--accent)"
            strokeWidth={1.5}
            strokeOpacity={0.6}
            rx={1}
          />
        )}

        {/* Playhead */}
        <line
          x1={playheadX}
          y1={0}
          x2={playheadX}
          y2={MINIMAP_H}
          stroke="var(--negative)"
          strokeWidth={1.5}
        />
      </svg>
    </div>
  );
}

export default React.memo(TimelineMinimap);
