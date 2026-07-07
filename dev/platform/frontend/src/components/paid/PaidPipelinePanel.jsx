import React from 'react';
import { usePaidPipeline } from '../../hooks/usePaidPipeline';
import PaidBriefStep from './PaidBriefStep';
import PaidConceptsStep from './PaidConceptsStep';
import PaidRenderStep from './PaidRenderStep';
import PaidApproveStep from './PaidApproveStep';
import PaidLaunchStep from './PaidLaunchStep';

// Paid → Pipeline. Mirrors the Organic pipeline structure: 5 sub-tabs,
// each its own step panel. State (active batch, creatives, brief
// modal, approval link) is hoisted into usePaidPipeline so navigation
// between steps is instantaneous — the active batch persists across
// every step.
//
// The parent (ClientAdsPage) drives which step is rendered via the
// `step` prop, mapped from the URL sub-tab. Cross-step navigation is
// done by setting the URL sub-tab (passed in as onNavigate).
export default function PaidPipelinePanel({ clientId, clientName, step, onNavigate }) {
  const pipeline = usePaidPipeline({ clientId, clientName });

  const go = (s) => onNavigate?.(s);

  switch (step) {
    case 'concepts':
      return <PaidConceptsStep pipeline={pipeline} clientId={clientId} clientName={clientName}
        onNext={() => go('render')} onBack={() => go('brief')} />;
    case 'render':
      return <PaidRenderStep pipeline={pipeline}
        onNext={() => go('approve')} onBack={() => go('brief')} />;
    case 'approve':
      return <PaidApproveStep pipeline={pipeline}
        onNext={() => go('launch')} onBack={() => go('brief')} />;
    case 'launch':
      return <PaidLaunchStep pipeline={pipeline} onBack={() => go('brief')} />;
    case 'brief':
    default:
      return <PaidBriefStep pipeline={pipeline} clientId={clientId} clientName={clientName} onNext={() => go('concepts')} />;
  }
}
