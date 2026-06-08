import React from 'react';
import PipelineStep from '../organic/PipelineStep';

// Social Pipeline → Brainstorm. Wraps the existing BrainstormTab so the
// numbered step header is consistent with Organic Pipeline steps. The
// underlying BrainstormTab (defined inline in ClientSocialPage) does
// the heavy lifting — generating 9 posts at a time, batch sidebar,
// edit/delete/render media.
export default function SocialBrainstormStep({ children, onNext }) {
  return (
    <PipelineStep
      num={1} title="Brainstorm" onNext={onNext} nextLabel="Lock + schedule"
      tagline="Claude proposes 9 posts at a time — hook, caption, hashtags, visual concept, frame-by-frame storyboard. Grounded in your brand, Google Trends, and what your competitors shipped this week."
    >
      {children}
    </PipelineStep>
  );
}
