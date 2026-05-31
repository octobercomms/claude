// Style A — Text hook on black, 2-4s. Bold headline that fades + rises
// in over the first 8 frames, holds, then sits steady. Optionally tints
// a key word with the brand colour for visual emphasis.

import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const StyleA = ({ text, brandColour, textColour, background, accentWord }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Soft rise + fade in over ~0.3s
  const opacity = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });
  const translateY = spring({ frame, fps, config: { damping: 18, stiffness: 100 } });
  const y = interpolate(translateY, [0, 1], [40, 0]);

  // Optional accent — render the same string but colour the accentWord
  // with the brand yellow so a key term pops.
  let rendered = text;
  if (accentWord && text?.toLowerCase().includes(accentWord.toLowerCase())) {
    const idx = text.toLowerCase().indexOf(accentWord.toLowerCase());
    const before = text.slice(0, idx);
    const word = text.slice(idx, idx + accentWord.length);
    const after = text.slice(idx + accentWord.length);
    rendered = (
      <>
        {before}
        <span style={{ color: brandColour }}>{word}</span>
        {after}
      </>
    );
  }

  return (
    <AbsoluteFill style={{ background, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80 }}>
      <div style={{
        fontFamily: 'Helvetica, Arial, sans-serif',
        fontWeight: 800,
        color: textColour,
        fontSize: 92,
        lineHeight: 1.15,
        textAlign: 'left',
        maxWidth: 920,
        letterSpacing: -1,
        opacity,
        transform: `translateY(${y}px)`,
      }}>
        {rendered}
      </div>
    </AbsoluteFill>
  );
};
