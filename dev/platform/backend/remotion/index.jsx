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
//
//   storyboardReel — A/C/G frames stitched into one reel (dynamic duration)

import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { StyleA } from './StyleA.jsx';
import { StyleC } from './StyleC.jsx';
import { StyleG } from './StyleG.jsx';
import { StoryboardReel } from './StoryboardReel.jsx';

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
    <Composition
      id="storyboardReel"
      component={StoryboardReel}
      durationInFrames={FPS * 10}
      fps={FPS}
      width={W}
      height={H}
      defaultProps={{ scenes: [] }}
      // Total duration = sum of the scene durations, so the reel is exactly as
      // long as its frames. renderMedia also passes an explicit override.
      calculateMetadata={({ props }) => {
        const total = (props.scenes || []).reduce(
          (n, s) => n + Math.max(1, Math.round(s.durationFrames || 30)), 0,
        );
        return { durationInFrames: Math.max(1, total) };
      }}
    />
  </>
);

registerRoot(Root);
