// SuiteOverview — a sales-page-style landing rendered as the first
// tab on every section. Each page hands in its own copy + flow
// diagram + capability cards; the layout, type scale, and colour
// (suite accent inherited from the parent page) are all consistent.
//
// Three blocks:
//   1. Hero  — filled accent panel with tagline + description + CTA
//   2. Flow  — left-to-right numbered step diagram of how data moves
//              through the section
//   3. Grid  — capability cards (one bento per feature)

import React from 'react';

export default function SuiteOverview({
  tagline,
  description,
  flow = [],
  capabilities = [],
  ctaLabel,
  onCta,
}) {
  return (
    <div className="stack stack-lg">
      <Hero tagline={tagline} description={description} ctaLabel={ctaLabel} onCta={onCta} />

      {flow.length > 0 && (
        <Flow steps={flow} />
      )}

      {capabilities.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          {capabilities.map((c, i) => (
            <div className="card" key={i}>
              <div className="caption">{c.tag || `0${i + 1}`.slice(-2)}</div>
              <h3 className="h2 mt-2">{c.title}</h3>
              <p className="body-sm mt-3">{c.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Hero({ tagline, description, ctaLabel, onCta }) {
  return (
    <div className="card filled" style={{ padding: 'var(--s9) var(--s7)' }}>
      <h2 className="display">{tagline}</h2>
      {description && (
        <p className="body mt-4" style={{ color: 'inherit', opacity: 0.92, maxWidth: 720 }}>
          {description}
        </p>
      )}
      {ctaLabel && onCta && (
        <button onClick={onCta} className="btn mt-6"
          style={{ background: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--surface)' }}>
          {ctaLabel} →
        </button>
      )}
    </div>
  );
}

function Flow({ steps }) {
  return (
    <div className="flow">
      {steps.map((step, i) => (
        <React.Fragment key={i}>
          <div className="flow-step">
            <div className="flow-step-num">{i + 1}</div>
            <div className="flow-step-label">{step.label}</div>
            {step.detail && <div className="flow-step-detail">{step.detail}</div>}
          </div>
          {i < steps.length - 1 && <div className="flow-arrow">→</div>}
        </React.Fragment>
      ))}
    </div>
  );
}
