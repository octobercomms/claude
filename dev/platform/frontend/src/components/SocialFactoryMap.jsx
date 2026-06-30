// SocialFactoryMap — the Shared section's flow, drawn as a fan-in / fan-out
// tree (same shape as DataFlowMap). Your raw assets — briefs, images, video,
// voice — feed the Workbench, the engine that churns them into finished posts;
// those get planned + published, then fan out to the two standing operations,
// Engage and Measure. Rendered inside SuiteOverview's dark-yellow bento. The
// Workbench, Plan & Publish, Engage and Measure are click targets.

import React from 'react';

// Small helper for a clickable SVG node group (keyboard-accessible).
function NodeG({ onClick, children }) {
  if (!onClick) return <g>{children}</g>;
  return (
    <g className="smap-svg-node" role="button" tabIndex={0} onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}>
      {children}
    </g>
  );
}

export default function SocialFactoryMap({ onWorkbench, onPublish, onEngage, onMeasure }) {
  return (
    <svg viewBox="0 0 1000 620" fill="none" xmlns="http://www.w3.org/2000/svg" className="smap-svg"
      role="img" aria-label="Social factory: briefs, images, video and voice feed the Workbench, which produces finished posts; they're planned and published, then fan out to Engage and Measure.">

      {/* connectors */}
      <g stroke="var(--text)" strokeWidth="2.5" fill="none" strokeLinejoin="round">
        {/* assets → Workbench */}
        <path d="M130 110 V165 H300 V206" />
        <path d="M376 110 V165 H430 V206" />
        <path d="M622 110 V165 H570 V206" />
        <path d="M868 110 V165 H700 V206" />
        {/* Workbench → Plan & Publish */}
        <path d="M500 284 V376" />
        {/* Plan & Publish → Engage + Measure */}
        <path d="M500 452 V490" />
        <path d="M300 490 H700" />
        <path d="M300 490 V526" />
        <path d="M700 490 V526" />
      </g>
      {/* arrowheads */}
      <g fill="var(--text)">
        <path d="M294 201 L306 201 L300 210 Z" />
        <path d="M424 201 L436 201 L430 210 Z" />
        <path d="M564 201 L576 201 L570 210 Z" />
        <path d="M694 201 L706 201 L700 210 Z" />
        <path d="M494 371 L506 371 L500 380 Z" />
        <path d="M294 521 L306 521 L300 530 Z" />
        <path d="M694 521 L706 521 L700 530 Z" />
      </g>

      {/* input nodes — your raw assets */}
      <g>
        <rect x="30" y="40" width="200" height="70" rx="14" fill="var(--surface)" stroke="#00000022" strokeWidth="2" />
        <text x="130" y="74" textAnchor="middle" fontSize="17" fontWeight="800" fill="var(--text)">Briefs</text>
        <text x="130" y="94" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--text-muted)">What to make</text>
      </g>
      <g>
        <rect x="276" y="40" width="200" height="70" rx="14" fill="var(--surface)" stroke="#00000022" strokeWidth="2" />
        <text x="376" y="74" textAnchor="middle" fontSize="17" fontWeight="800" fill="var(--text)">Images</text>
        <text x="376" y="94" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--text-muted)">Props &amp; stills</text>
      </g>
      <g>
        <rect x="522" y="40" width="200" height="70" rx="14" fill="var(--surface)" stroke="#00000022" strokeWidth="2" />
        <text x="622" y="74" textAnchor="middle" fontSize="17" fontWeight="800" fill="var(--text)">Video &amp; clips</text>
        <text x="622" y="94" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--text-muted)">B-roll &amp; footage</text>
      </g>
      <g>
        <rect x="768" y="40" width="200" height="70" rx="14" fill="var(--surface)" stroke="#00000022" strokeWidth="2" />
        <text x="868" y="74" textAnchor="middle" fontSize="17" fontWeight="800" fill="var(--text)">Voice</text>
        <text x="868" y="94" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--text-muted)">Avatars &amp; voiceover</text>
      </g>

      {/* the Workbench — accent hub (the engine) */}
      <NodeG onClick={onWorkbench}>
        <rect x="240" y="210" width="520" height="74" rx="16" fill="var(--accent)" stroke="var(--text)" strokeWidth="2" />
        <text x="500" y="246" textAnchor="middle" fontSize="19" fontWeight="800" fill="var(--accent-on)">The Workbench</text>
        <text x="500" y="268" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--accent-on)" opacity="0.85">Churns your assets into finished posts</text>
      </NodeG>

      {/* Plan & Publish — the produced content ships */}
      <NodeG onClick={onPublish}>
        <rect x="360" y="380" width="280" height="72" rx="16" fill="var(--surface)" stroke="#00000022" strokeWidth="2" />
        <text x="500" y="414" textAnchor="middle" fontSize="18" fontWeight="800" fill="var(--text)">Plan &amp; Publish</text>
        <text x="500" y="436" textAnchor="middle" fontSize="12.5" fontWeight="600" fill="var(--text-muted)">Scheduled to every channel</text>
      </NodeG>

      {/* outputs — the two standing operations */}
      <NodeG onClick={onEngage}>
        <rect x="140" y="530" width="320" height="72" rx="16" fill="var(--surface)" stroke="#00000022" strokeWidth="2" />
        <text x="300" y="564" textAnchor="middle" fontSize="18" fontWeight="800" fill="var(--text)">Engage</text>
        <text x="300" y="586" textAnchor="middle" fontSize="12.5" fontWeight="600" fill="var(--text-muted)">DM bot + outreach on what's live</text>
      </NodeG>
      <NodeG onClick={onMeasure}>
        <rect x="540" y="530" width="320" height="72" rx="16" fill="var(--surface)" stroke="#00000022" strokeWidth="2" />
        <text x="700" y="564" textAnchor="middle" fontSize="18" fontWeight="800" fill="var(--text)">Measure</text>
        <text x="700" y="586" textAnchor="middle" fontSize="12.5" fontWeight="600" fill="var(--text-muted)">Insights, winners &amp; rivals</text>
      </NodeG>
    </svg>
  );
}
