import React from 'react';
import PipelineStep from './PipelineStep';
import { PlanningTab } from '../SeoSuite';

// Pipeline → Brief. Reuses the existing PlanningTab — Claude generates
// a content brief (title, outline, headings, questions to answer,
// internal links, meta tags) for a target keyword. Step 3 (Draft) turns
// that brief into a full post.
export default function BriefPanel({ clientId, onNext }) {
  return (
    <PipelineStep
      num={2} title="Brief" onNext={onNext} nextLabel="Draft the post"
      tagline="Claude proposes the angle, outline, target intent, headings, questions to answer, and meta tags for a target keyword. Edit it, then move to the Draft step to write the full post."
    >
      <PlanningTab clientId={clientId} />
    </PipelineStep>
  );
}
