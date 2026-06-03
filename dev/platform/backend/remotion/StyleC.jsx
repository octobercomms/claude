// Style C — Word card. One word or a 3-word phrase. Hard cut in and
// out by design (no animation between B and C in the final edit) so we
// keep this clip dead simple — a static slate the AM drops between
// talking head sections.

import React from 'react';
import { AbsoluteFill } from 'remotion';

export const StyleC = ({ text, textColour, background }) => {
  return (
    <AbsoluteFill style={{ background, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60 }}>
      <div style={{
        fontFamily: 'Helvetica, Arial, sans-serif',
        fontWeight: 900,
        color: textColour,
        fontSize: 180,
        lineHeight: 1.05,
        textAlign: 'center',
        letterSpacing: -3,
      }}>
        {text}
      </div>
    </AbsoluteFill>
  );
};
