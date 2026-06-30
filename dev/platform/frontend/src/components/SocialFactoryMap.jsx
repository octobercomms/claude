// SocialFactoryMap — the Shared section's flow, drawn as a fan-in / fan-out
// tree (same shape as DataFlowMap): four inputs feed one central hub — the
// factory — which turns them into scheduled, published posts, then fans out to
// the two standing operations, Engage and Measure. Rendered inside
// SuiteOverview's dark-yellow bento. Inputs, the hub and the two outputs are
// click targets that jump to their tabs.

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

export default function SocialFactoryMap({ onFactory, onIdeas, onCompetitors, onEngage, onMeasure }) {
  return (
    <svg viewBox="0 0 1000 470" fill="none" xmlns="http://www.w3.org/2000/svg" className="smap-svg"
      role="img" aria-label="Social factory: brand kit, swipe ideas, competitors and trends feed the factory, which produces and publishes posts, then fans out to Engage and Measure.">

      {/* fan-in + fan-out connectors */}
      <g stroke="var(--text)" strokeWidth="2.5" fill="none" strokeLinejoin="round">
        <path d="M130 110 V165 H300 V206" />
        <path d="M376 110 V165 H430 V206" />
        <path d="M622 110 V165 H570 V206" />
        <path d="M868 110 V165 H700 V206" />
        <path d="M500 284 V330" />
        <path d="M300 330 H700" />
        <path d="M300 330 V376" />
        <path d="M700 330 V376" />
      </g>
      {/* arrowheads */}
      <g fill="var(--text)">
        <path d="M294 201 L306 201 L300 210 Z" />
        <path d="M424 201 L436 201 L430 210 Z" />
        <path d="M564 201 L576 201 L570 210 Z" />
        <path d="M694 201 L706 201 L700 210 Z" />
        <path d="M294 371 L306 371 L300 380 Z" />
        <path d="M694 371 L706 371 L700 380 Z" />
      </g>

      {/* input nodes — what feeds the factory */}
      <g>
        <rect x="30" y="40" width="200" height="70" rx="14" fill="var(--surface)" stroke="#00000022" strokeWidth="2" />
        <text x="130" y="74" textAnchor="middle" fontSize="17" fontWeight="800" fill="var(--text)">Brand kit</text>
        <text x="130" y="94" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--text-muted)">Voice, palette, assets</text>
      </g>

      <NodeG onClick={onIdeas}>
        <rect x="276" y="40" width="200" height="70" rx="14" fill="var(--surface)" stroke="#00000022" strokeWidth="2" />
        <text x="376" y="74" textAnchor="middle" fontSize="17" fontWeight="800" fill="var(--text)">Swipe ideas</text>
        <text x="376" y="94" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--text-muted)">Reels to emulate</text>
      </NodeG>

      <NodeG onClick={onCompetitors}>
        <rect x="522" y="40" width="200" height="70" rx="14" fill="var(--surface)" stroke="#00000022" strokeWidth="2" />
        <text x="622" y="74" textAnchor="middle" fontSize="17" fontWeight="800" fill="var(--text)">Competitors</text>
        <text x="622" y="94" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--text-muted)">What rivals ship</text>
      </NodeG>

      <NodeG onClick={onCompetitors}>
        <rect x="768" y="40" width="200" height="70" rx="14" fill="var(--surface)" stroke="#00000022" strokeWidth="2" />
        <text x="868" y="74" textAnchor="middle" fontSize="17" fontWeight="800" fill="var(--text)">Trends &amp; sounds</text>
        <text x="868" y="94" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--text-muted)">Google Trends + audio</text>
      </NodeG>

      {/* the factory — accent hub (clickable: enter at Ideas) */}
      <NodeG onClick={onFactory}>
        <rect x="240" y="210" width="520" height="74" rx="16" fill="var(--accent)" stroke="var(--text)" strokeWidth="2" />
        <text x="500" y="246" textAnchor="middle" fontSize="19" fontWeight="800" fill="var(--accent-on)">The social factory</text>
        <text x="500" y="268" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--accent-on)" opacity="0.85">Ideas → Brief → Workbench → Plan → Publish</text>
      </NodeG>

      {/* outputs — the two standing operations */}
      <NodeG onClick={onEngage}>
        <rect x="140" y="380" width="320" height="72" rx="16" fill="var(--surface)" stroke="#00000022" strokeWidth="2" />
        <text x="300" y="414" textAnchor="middle" fontSize="18" fontWeight="800" fill="var(--text)">Engage</text>
        <text x="300" y="436" textAnchor="middle" fontSize="12.5" fontWeight="600" fill="var(--text-muted)">DM bot + outreach on what's live</text>
      </NodeG>

      <NodeG onClick={onMeasure}>
        <rect x="540" y="380" width="320" height="72" rx="16" fill="var(--surface)" stroke="#00000022" strokeWidth="2" />
        <text x="700" y="414" textAnchor="middle" fontSize="18" fontWeight="800" fill="var(--text)">Measure</text>
        <text x="700" y="436" textAnchor="middle" fontSize="12.5" fontWeight="600" fill="var(--text-muted)">Insights, winners &amp; rivals</text>
      </NodeG>
    </svg>
  );
}
