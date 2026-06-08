import React from 'react';
import PipelineStrip from '../PipelineStrip';
import AdCreativePanel from '../AdCreativePanel';

// Paid → Pipeline. The existing AdCreativePanel covers Brief → Concepts
// → Render in one workflow; we wrap it with a visible step strip so the
// AM sees the full production pipeline (Brief → Concepts → Render →
// Approve → Launch) as they work. Step 5 (Launch) is currently a hand-
// off to Meta Ads Manager; we surface it as a step so the AM knows the
// flow doesn't end at "render" — it ends at a live campaign.
const STEPS = [
  { label: 'Brief',    detail: 'Your campaign instructions' },
  { label: 'Concepts', detail: 'Claude-generated, brand-aware' },
  { label: 'Render',   detail: 'Images + video per aspect ratio' },
  { label: 'Approve',  detail: 'Share for client sign-off' },
  { label: 'Launch',   detail: 'Push to Meta / hand to Google' },
];

export default function PaidPipelinePanel({ clientId, clientName }) {
  return (
    <div>
      <PipelineStrip steps={STEPS} />
      <AdCreativePanel clientId={clientId} clientName={clientName} />
    </div>
  );
}
