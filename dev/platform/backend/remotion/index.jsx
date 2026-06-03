// Remotion entry — declares the three compositions the platform renders
// on demand. Each takes props for the text + brand colour and outputs
// the corresponding clip from the Video Style System.
//
//   styleA — text hook on black, 2-4s
//   styleC — word card on black/white, 1-2s
//   styleG — kinetic CTA, 3-5s
//
// Style B / D / E / F are excluded by design — they're filmed by the
// AM or the client. The platform only auto-renders the no-film styles.

import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { StyleA } from './StyleA.jsx';
import { StyleC } from './StyleC.jsx';
import { StyleG } from './StyleG.jsx';

const FPS = 30;
const W = 1080;
const H = 1920;     // 9:16 portrait for IG Reels / TikTok

const Root = () => (
  <>
    <Composition
      id="styleA"
      component={StyleA}
      durationInFrames={FPS * 4}
      fps={FPS}
      width={W}
      height={H}
      defaultProps={{
        text: 'Your contact form is doing one job. It is the wrong one.',
        brandColour: '#E7CD41',
        textColour: '#ffffff',
        background: '#000000',
      }}
    />
    <Composition
      id="styleC"
      component={StyleC}
      durationInFrames={FPS * 2}
      fps={FPS}
      width={W}
      height={H}
      defaultProps={{
        text: 'pipeline.',
        textColour: '#000000',
        background: '#ffffff',
      }}
    />
    <Composition
      id="styleG"
      component={StyleG}
      durationInFrames={FPS * 5}
      fps={FPS}
      width={W}
      height={H}
      defaultProps={{
        cta: 'octobercomms.com',
        secondary: 'Book a call',
        brandColour: '#E7CD41',
        textColour: '#ffffff',
        background: '#000000',
      }}
    />
  </>
);

registerRoot(Root);
