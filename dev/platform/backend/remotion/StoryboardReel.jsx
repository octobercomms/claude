// StoryboardReel — stitches a post's no-film storyboard frames (styles A / C /
// G) into ONE finished vertical reel. Each frame becomes a Series.Sequence of
// the matching style component, played back-to-back for its own duration. This
// is what turns "5 separate clips" into a single downloadable Reel.
//
// Frame resolution (style → props → durationFrames) happens on the Node side in
// remotionRender.js; this component just plays whatever scenes it's handed, so
// the grammar lives in one place.

import React from 'react';
import { AbsoluteFill, Series } from 'remotion';
import { StyleA } from './StyleA.jsx';
import { StyleC } from './StyleC.jsx';
import { StyleG } from './StyleG.jsx';

const COMPONENTS = { A: StyleA, C: StyleC, G: StyleG };

export const StoryboardReel = ({ scenes }) => {
  const list = Array.isArray(scenes) ? scenes : [];
  if (!list.length) return <AbsoluteFill style={{ background: '#000000' }} />;
  return (
    <Series>
      {list.map((s, i) => {
        const Comp = COMPONENTS[s.style] || StyleA;
        return (
          <Series.Sequence key={i} durationInFrames={Math.max(1, Math.round(s.durationFrames || 30))}>
            <Comp {...(s.props || {})} />
          </Series.Sequence>
        );
      })}
    </Series>
  );
};
