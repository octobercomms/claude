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
  map = [],        // optional section-map flowchart — replaces flow + capabilities
  ctaLabel,
  onCta,
  status = null,   // optional [{ label, value, ok }] live status strip
}) {
  return (
    <div className="stack stack-lg">
      <Hero tagline={tagline} description={description} ctaLabel={ctaLabel} onCta={onCta} />

      {status && status.length > 0 && <StatusStrip items={status} />}

      {map.length > 0 && <SectionMap stages={map} />}

      {map.length === 0 && flow.length > 0 && (
        <Flow steps={flow} />
      )}

      {map.length === 0 && capabilities.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          {capabilities.map((c, i) => {
            const clickable = typeof c.onClick === 'function';
            const inner = (
              <>
                <div className="caption">{c.tag || `0${i + 1}`.slice(-2)}</div>
                <h3 className="h2 mt-2">{c.title}</h3>
                <p className="body-sm mt-3">{c.body}</p>
                {clickable && <div className="suite-cap-go">{c.cta || 'Open'} →</div>}
              </>
            );
            return clickable
              ? <button type="button" className="card suite-cap" key={i} onClick={c.onClick}>{inner}</button>
              : <div className="card" key={i}>{inner}</div>;
          })}
        </div>
      )}
    </div>
  );
}

// Live, per-client status row — shows what's actually wired up in this
// section (connected sources, counts), so the overview reflects reality
// rather than reading like a brochure. Green dot = healthy/connected.
function StatusStrip({ items }) {
  return (
    <div className="suite-status">
      {items.map((s, i) => (
        <div className="suite-status-item" key={i}>
          <span className={'suite-status-dot' + (s.ok ? ' ok' : '')} />
          <span className="suite-status-label">{s.label}</span>
          <span className="suite-status-value">{s.value}</span>
        </div>
      ))}
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

// SectionMap — the section's tabs drawn as a flow inside a dark-yellow bento.
// Each stage is a white card listing its tools as clickable pill nodes; bold
// solid arrows connect them. Exactly four stages lays out as a 2×2 corner grid
// (Setup TL → Connectors TR → Strategy BR → Reports BL); other counts fall back
// to a vertical list. DOM order is always flow order, so the narrow-screen
// stack reads correctly.
function SectionMap({ stages }) {
  if (stages.length === 4) {
    return (
      <div className="smap-bento">
        <div className="smap-ring">
          <SmapStage stage={stages[0]} area="setup" />
          <SmapArrow dir="right" area="arR" />
          <SmapStage stage={stages[1]} area="conn" />
          <SmapArrow dir="down" area="arD" />
          <SmapStage stage={stages[2]} area="strat" />
          <SmapArrow dir="left" area="arL" />
          <SmapStage stage={stages[3]} area="reports" />
        </div>
      </div>
    );
  }
  return (
    <div className="smap-bento">
      <div className="smap-col">
        {stages.map((s, i) => (
          <React.Fragment key={i}>
            <SmapStage stage={s} />
            {i < stages.length - 1 && <SmapArrow dir="down" />}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function SmapStage({ stage, area }) {
  return (
    <div className="smap-stage" style={area ? { gridArea: area } : undefined}>
      <div className="smap-title">{stage.title}</div>
      {stage.subtitle && <div className="smap-sub">{stage.subtitle}</div>}
      <div className="smap-nodes">
        {stage.nodes.map((n, j) => (
          <React.Fragment key={j}>
            {typeof n.onClick === 'function'
              ? <button type="button" className="smap-node" onClick={n.onClick}>{n.label}</button>
              : <span className="smap-node">{n.label}</span>}
            {stage.chained && j < stage.nodes.length - 1 && (
              <span className="smap-node-sep" aria-hidden="true">→</span>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function SmapArrow({ dir, area }) {
  const horizontal = dir === 'right' || dir === 'left';
  const paths = {
    right: <><path d="M6 13 H 50" stroke="var(--text)" strokeWidth="4" strokeLinecap="round" /><path d="M48 4 L66 13 L48 22 Z" fill="var(--text)" /></>,
    left:  <><path d="M62 13 H 18" stroke="var(--text)" strokeWidth="4" strokeLinecap="round" /><path d="M20 4 L2 13 L20 22 Z" fill="var(--text)" /></>,
    down:  <><path d="M13 8 V 50" stroke="var(--text)" strokeWidth="4" strokeLinecap="round" /><path d="M4 48 L13 66 L22 48 Z" fill="var(--text)" /></>,
  };
  return (
    <div className={'smap-arrow ' + (horizontal ? 'h' : 'v')} style={area ? { gridArea: area } : undefined}>
      <svg width={horizontal ? 68 : 26} height={horizontal ? 26 : 68}
        viewBox={horizontal ? '0 0 68 26' : '0 0 26 68'} fill="none" aria-hidden="true">
        {paths[dir]}
      </svg>
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
