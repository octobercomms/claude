import React from 'react';
import PipelineStep from '../organic/PipelineStep';

// Social Pipeline → Plan. Wraps the existing PlansList. Locking + bulk-
// scheduling the brainstormed posts happens here; once a plan has a
// scheduled_at the autopilot picks it up at step 3.
export default function SocialPlanStep({ children, onNext, onBack }) {
  return (
    <PipelineStep
      num={2} title="Plan" onNext={onNext} nextLabel="See the publish queue"
      tagline="Lock the posts you like, drop them on a calendar. Default Mon / Wed / Fri at 10am works for most brands — the autopilot takes over from there."
    >
      {children}
    </PipelineStep>
  );
}
