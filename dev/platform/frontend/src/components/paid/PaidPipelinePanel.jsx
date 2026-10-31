import React from 'react';
import { useLocation } from 'react-router-dom';
import { usePaidPipeline } from '../../hooks/usePaidPipeline';
import StepRail from '../shells/StepRail';
import PaidBriefStep from './PaidBriefStep';
import PaidConceptsStep from './PaidConceptsStep';
import PaidRenderStep from './PaidRenderStep';
import PaidLaunchStep from './PaidLaunchStep';

// Paid → Build → Make a batch. Five steps over one shared state, so the
// active batch persists as you move between them.
//
// The rail lives here rather than in the page because its statuses are read
// off this state. It used to sit upstairs and colour a step "done" purely
// because it was to the left of the one you were on, which is a progress bar
// pretending to be a record: open step four directly and steps one to three
// turned green having produced nothing. Done now means that step produced
// something.
export default function PaidPipelinePanel({ clientId, clientName, step, steps, meta, onNavigate }) {
  const pipeline = usePaidPipeline({ clientId, clientName });
  const location = useLocation();
  // Competitors hands a brief over through navigation state. Read here and
  // passed down, so the Brief step does not need to know where it came from.
  const briefSeed = location.state?.briefSeed || null;

  const go = (s) => onNavigate?.(s);

  const hasBatch = !!pipeline.activeBatchId;
  const hasConcepts = (pipeline.creatives || []).length > 0;
  const hasRenders = (pipeline.creatives || []).some(c => (c.images || []).length > 0);
  const doneFor = {
    brief: hasBatch,
    concepts: hasConcepts,
    render: hasRenders,
    // Launch leaves no mark on this state: it is an export, and claiming it
    // done because someone opened the step would be the positional lie again
    // in a different costume. (Approve used to sit here for the same reason.
    // It is no longer a step at all.)
    launch: false,
  };

  const panel = (() => {
    switch (step) {
      case 'concepts':
        return <PaidConceptsStep pipeline={pipeline} clientId={clientId} clientName={clientName}
          onBack={() => go('brief')} />;
      case 'render':
        return <PaidRenderStep pipeline={pipeline} onBack={() => go('brief')} />;
      case 'launch':
        return <PaidLaunchStep pipeline={pipeline} onBack={() => go('brief')} />;
      case 'brief':
      default:
        return <PaidBriefStep pipeline={pipeline} clientId={clientId} clientName={clientName}
          briefSeed={briefSeed} />;
    }
  })();

  return (
    <>
      {steps && meta && (
        <div className="stepper-block">
          <StepRail
            numbered
            activeKey={step}
            onStep={onNavigate}
            steps={meta.map((m, i) => ({
              key: steps[i],
              label: m.title,
              sub: m.sub,
              status: doneFor[steps[i]] ? 'done' : 'todo',
            }))}
          />
        </div>
      )}
      {panel}
    </>
  );
}
