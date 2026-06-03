// Style G — Kinetic CTA close. The brand-consistency lever; ALWAYS the
// final clip. URL + secondary line on black with the brand colour as
// the accent bar. The animation is a single coordinated motion: bar
// extends in, text fades up under it, then everything settles. Same
// for every video — the AM doesn't tweak this, it just runs.

import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const StyleG = ({ cta, secondary, brandColour, textColour, background }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();

  const bar = spring({ frame, fps, config: { damping: 22, stiffness: 90 } });
  const barWidth = interpolate(bar, [0, 1], [0, width * 0.7]);

  const textOpacity = interpolate(frame, [10, 22], [0, 1], { extrapolateRight: 'clamp' });
  const ctaY = interpolate(frame, [10, 22], [30, 0], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 40, padding: 80 }}>
        <div style={{
          width: barWidth, height: 8, background: brandColour, borderRadius: 4,
        }} />
        <div style={{
          fontFamily: 'Helvetica, Arial, sans-serif',
          fontWeight: 800,
          color: textColour,
          fontSize: 84,
          letterSpacing: -1.5,
          opacity: textOpacity,
          transform: `translateY(${ctaY}px)`,
        }}>
          {cta}
        </div>
        {secondary ? (
          <div style={{
            fontFamily: 'Helvetica, Arial, sans-serif',
            fontWeight: 500,
            color: textColour,
            opacity: textOpacity * 0.75,
            fontSize: 42,
            letterSpacing: 0.5,
            transform: `translateY(${ctaY}px)`,
          }}>
            {secondary}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
