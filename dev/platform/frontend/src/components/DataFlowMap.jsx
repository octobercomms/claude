// DataFlowMap — the Data section's flow, drawn as a fan-in / fan-out tree:
// four connectors feed one clean data layer (the accent hub), which powers
// both Performance and the AI analyst, which roll up into Reports.
// Rendered inside SuiteOverview's dark-yellow bento. Performance and AI
// analyst are the click targets (jump to their tabs).

import React from 'react';

export default function DataFlowMap({ onPerformance, onAnalyst }) {
  return (
    <svg viewBox="0 0 1000 640" fill="none" xmlns="http://www.w3.org/2000/svg" className="smap-svg"
      role="img" aria-label="Data flow: four sources feed a clean data layer, which splits to Performance and AI analyst, which feed Reports.">

      {/* connectors */}
      <g stroke="var(--text)" strokeWidth="2.5" fill="none" strokeLinejoin="round">
        <path d="M130 110 V165 H300 V206" />
        <path d="M376 110 V165 H430 V206" />
        <path d="M622 110 V165 H570 V206" />
        <path d="M868 110 V165 H700 V206" />
        <path d="M500 284 V330" />
        <path d="M300 330 H700" />
        <path d="M300 330 V376" />
        <path d="M700 330 V376" />
        <path d="M300 452 V490" />
        <path d="M700 452 V490" />
        <path d="M300 490 H700" />
        <path d="M500 490 V526" />
      </g>
      {/* arrowheads */}
      <g fill="var(--text)">
        <path d="M294 201 L306 201 L300 210 Z" />
        <path d="M424 201 L436 201 L430 210 Z" />
        <path d="M564 201 L576 201 L570 210 Z" />
        <path d="M694 201 L706 201 L700 210 Z" />
        <path d="M294 371 L306 371 L300 380 Z" />
        <path d="M694 371 L706 371 L700 380 Z" />
        <path d="M494 521 L506 521 L500 530 Z" />
      </g>

      {/* source nodes */}
      <g>
        <rect x="30" y="40" width="200" height="70" rx="14" fill="var(--surface)" stroke="#00000022" strokeWidth="2" />
        <text x="130" y="74" textAnchor="middle" fontSize="17" fontWeight="800" fill="var(--text)">GA4</text>
        <text x="130" y="94" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--text-muted)">Web analytics</text>

        <rect x="276" y="40" width="200" height="70" rx="14" fill="var(--surface)" stroke="#00000022" strokeWidth="2" />
        <text x="376" y="74" textAnchor="middle" fontSize="17" fontWeight="800" fill="var(--text)">Ecommerce</text>
        <text x="376" y="94" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--text-muted)">Store platforms</text>

        <rect x="522" y="40" width="200" height="70" rx="14" fill="var(--surface)" stroke="#00000022" strokeWidth="2" />
        <text x="622" y="74" textAnchor="middle" fontSize="17" fontWeight="800" fill="var(--text)">Email &amp; SMS</text>
        <text x="622" y="94" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--text-muted)">Shopify, Brevo or Klaviyo</text>

        <rect x="768" y="40" width="200" height="70" rx="14" fill="var(--surface)" stroke="#00000022" strokeWidth="2" />
        <text x="868" y="74" textAnchor="middle" fontSize="17" fontWeight="800" fill="var(--text)">Merchant Center</text>
        <text x="868" y="94" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--text-muted)">Product feed</text>
      </g>

      {/* clean data layer — accent hub */}
      <rect x="240" y="210" width="520" height="74" rx="16" fill="var(--accent)" stroke="var(--text)" strokeWidth="2" />
      <text x="500" y="246" textAnchor="middle" fontSize="19" fontWeight="800" fill="var(--accent-on)">Clean data layer</text>
      <text x="500" y="268" textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--accent-on)" opacity="0.8">Unified across all sources</text>

      {/* Performance — clickable */}
      <g className="smap-svg-node" role="button" tabIndex={0} onClick={onPerformance}
        onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && onPerformance) { e.preventDefault(); onPerformance(); } }}>
        <rect x="140" y="380" width="320" height="72" rx="16" fill="var(--surface)" stroke="#00000022" strokeWidth="2" />
        <text x="300" y="414" textAnchor="middle" fontSize="18" fontWeight="800" fill="var(--text)">Measure</text>
        <text x="300" y="436" textAnchor="middle" fontSize="12.5" fontWeight="600" fill="var(--text-muted)">Revenue, orders, conversion</text>
      </g>

      {/* AI analyst — clickable */}
      <g className="smap-svg-node" role="button" tabIndex={0} onClick={onAnalyst}
        onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && onAnalyst) { e.preventDefault(); onAnalyst(); } }}>
        <rect x="540" y="380" width="320" height="72" rx="16" fill="var(--surface)" stroke="#00000022" strokeWidth="2" />
        <text x="700" y="414" textAnchor="middle" fontSize="18" fontWeight="800" fill="var(--text)">Analyse</text>
        <text x="700" y="436" textAnchor="middle" fontSize="12.5" fontWeight="600" fill="var(--text-muted)">Chat over your live data</text>
      </g>

      {/* reports */}
      <rect x="360" y="530" width="280" height="72" rx="16" fill="var(--surface)" stroke="#00000022" strokeWidth="2" />
      <text x="500" y="564" textAnchor="middle" fontSize="18" fontWeight="800" fill="var(--text)">Reports</text>
      <text x="500" y="586" textAnchor="middle" fontSize="12.5" fontWeight="600" fill="var(--text-muted)">Client-ready PDF output</text>
    </svg>
  );
}
