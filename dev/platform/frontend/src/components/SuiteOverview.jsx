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
import Pip from './ui/Pip';

export default function SuiteOverview({
  tagline,
  description,
  flow = [],
  capabilities = [],
  map = [],          // optional section-map flowchart — replaces flow + capabilities
  mapLayout = 'ring', // 'ring' (4-stage corner loop) | 'grid' (parallel, no arrows)
  diagram = null,    // optional bespoke flow diagram (React node) — same precedence as map
  ctaLabel,
  onCta,
  status = null,     // optional [{ label, value, ok }] live status strip
  actions = null,    // optional node rendered next to the status pills (toolbar)
  interstitial = null, // optional node between the toolbar and the map
  // Action-grammar mode (redesign brief, Part 2). When `primary` is given,
  // the page renders as: read-outs to consult → the ONE primary path →
  // quiet secondary tools → a calm row of other jobs. Opt-in per suite; the
  // classic hero + map layout above is untouched for suites not yet migrated.
  primary = null,    // { fn, kicker, title, description, ctaLabel, onCta }
  readouts = null,   // [{ fn, name, value, sub }] — consult-first, never button-shaped
  benefits = [],     // [string] — what's possible / what it brings (the sell)
  tools = null,      // (legacy, ignored in the new layout)
  toolsLabel = 'Fix-it tools',
  otherJobs = null,  // (legacy, ignored in the new layout)
  compact = false,   // trim the hero prose — used when the overview sits above the pillar chat
}) {
  if (primary) {
    return (
      <GrammarOverview
        tagline={tagline}
        description={description}
        benefits={benefits}
        primary={primary}
        readouts={readouts || []}
        actions={actions}
        map={map}
        mapLayout={mapLayout}
        diagram={diagram}
        compact={compact}
      />
    );
  }
  const hasCustom = map.length > 0 || !!diagram;
  return (
    <div className="stack stack-lg">
      <Hero tagline={tagline} description={description} ctaLabel={ctaLabel} onCta={onCta} />

      {(status && status.length > 0) || actions
        ? <StatusStrip items={status || []} actions={actions} />
        : null}

      {interstitial}

      {map.length > 0 && <SectionMap stages={map} layout={mapLayout} />}
      {diagram && <div className="smap-bento">{diagram}</div>}

      {!hasCustom && flow.length > 0 && (
        <Flow steps={flow} />
      )}

      {!hasCustom && capabilities.length > 0 && (
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

// Overview layout. A tight command band — the state you consult and the ONE
// action — then the workflow map as the main content (it doubles as the
// navigation to every section, so no separate tool/other-job link rows).
// No repeated heading: the page masthead already names the suite.
function GrammarOverview({ tagline, description, benefits = [], primary, readouts, actions, map = [], mapLayout = 'ring', diagram = null, compact = false }) {
  return (
    <div className={'oview' + (compact ? ' oview--compact' : '')}>
      {/* Hero that sells the section: the value headline, what's possible /
          the benefits, the one primary action — with the live numbers beside
          it. One headline (not three); the page masthead names the suite.
          In compact mode (the overview sits above the pillar chat) we drop the
          descriptive prose + benefits list and keep just the headline, live
          numbers and the primary action, so the bentos stay tight. */}
      <div className="oview-hero">
        <div className="oview-hero-body">
          {tagline && <h2 className="oview-hero-title">{tagline}</h2>}
          {!compact && description && <p className="oview-hero-desc">{description}</p>}
          {!compact && benefits.length > 0 && (
            <ul className="oview-benefits">
              {benefits.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          )}
          <div className="oview-cta-row">
            {primary && primary.onCta && (
              <button type="button" className="btn btn-primary" onClick={primary.onCta}>
                {primary.ctaLabel || primary.title} →
              </button>
            )}
            {actions}
          </div>
        </div>
        {readouts.length > 0 && (
          <div className="oview-hero-stats">
            {readouts.map((r, i) => (
              <div className="oview-stat" key={i}>
                <span className="oview-stat-val">{r.value}</span>
                <span className="oview-stat-name">{r.fn && <Pip fn={r.fn} />}{r.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* The workflow — how the section flows, and the way into every part. */}
      {map.length > 0 && <SectionMap stages={map} layout={mapLayout} />}
      {diagram && <div className="smap-bento">{diagram}</div>}
    </div>
  );
}

// Live, per-client status row — shows what's actually wired up in this
// section (connected sources, counts), so the overview reflects reality
// rather than reading like a brochure. Green dot = healthy/connected.
function StatusStrip({ items, actions }) {
  const strip = (
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
  if (!actions) return strip;
  return <div className="suite-toolbar">{strip}<div className="suite-actions">{actions}</div></div>;
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
function SectionMap({ stages, layout = 'ring' }) {
  // Parallel areas (no flow between them) → a plain grid, no arrows.
  if (layout === 'grid') {
    return (
      <div className="smap-bento">
        <div className="smap-grid">
          {stages.map((s, i) => <SmapStage key={i} stage={s} />)}
        </div>
      </div>
    );
  }

  // Funnel — vertical, each stage narrower than the last, contents centred.
  if (layout === 'funnel') {
    const n = stages.length;
    return (
      <div className="smap-bento">
        <div className="smap-col smap-funnel">
          {stages.map((s, i) => {
            const w = n > 1 ? Math.round(100 - (i * 50) / (n - 1)) : 100;
            return (
              <React.Fragment key={i}>
                <SmapStage stage={s} style={{ '--smap-w': w + '%' }} />
                {i < n - 1 && <SmapArrow dir="down" />}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    );
  }

  // Snake — serpentine 2-column boustrophedon, arrows follow the path.
  if (layout === 'snake') return <SnakeMap stages={stages} />;

  // Vertical flow with down-arrows — sequential pipeline of any length.
  if (layout === 'flow') {
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

  // Ring — 4-stage corner loop (Admin).
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

  // Default: vertical list.
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

// Serpentine layout: rows of two, alternating direction, with down-connectors
// on the side where each row ends. DOM order stays flow order.
function SnakeMap({ stages }) {
  const rows = [];
  for (let i = 0; i < stages.length; i += 2) rows.push(stages.slice(i, i + 2));
  return (
    <div className="smap-bento">
      <div className="snake">
        {rows.map((row, r) => {
          const ltr = r % 2 === 0;
          const [a, b] = row;
          return (
            <React.Fragment key={r}>
              <div className="snake-row">
                {ltr ? <SmapStage stage={a} /> : (b ? <SmapStage stage={b} /> : <div />)}
                <div className="snake-cell">{b ? <SmapArrow dir={ltr ? 'right' : 'left'} bare /> : null}</div>
                {ltr ? (b ? <SmapStage stage={b} /> : <div />) : <SmapStage stage={a} />}
              </div>
              {r < rows.length - 1 && (
                <div className="snake-link">
                  {ltr ? <><div /><div /><div className="snake-down"><SmapArrow dir="down" bare /></div></>
                       : <><div className="snake-down"><SmapArrow dir="down" bare /></div><div /><div /></>}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function SmapStage({ stage, area, style }) {
  return (
    <div className="smap-stage" style={{ ...(area ? { gridArea: area } : null), ...style }}>
      <div className="smap-title">{stage.fn && <Pip fn={stage.fn} />}{stage.title}</div>
      {stage.subtitle && <div className="smap-sub">{stage.subtitle}</div>}
      <div className="smap-nodes">
        {stage.nodes.map((n, j) => {
          const cls = 'smap-node' + (stage.numbered ? ' step' : '');
          const inner = stage.numbered
            ? <><span className="num">{j + 1}</span>{n.label}</>
            : n.label;
          const node = typeof n.onClick === 'function'
            ? <button type="button" className={cls} onClick={n.onClick}>{inner}</button>
            : <span className={cls}>{inner}</span>;
          const sep = n.sep ?? (stage.chained ? '→' : null);
          return (
            <React.Fragment key={j}>
              {node}
              {!stage.numbered && sep && j < stage.nodes.length - 1 && (
                <span className="smap-node-sep" aria-hidden="true">{sep}</span>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function arrowSvg(dir) {
  const horizontal = dir === 'right' || dir === 'left';
  const paths = {
    right: <><path d="M6 13 H 50" stroke="var(--text)" strokeWidth="4" strokeLinecap="round" /><path d="M48 4 L66 13 L48 22 Z" fill="var(--text)" /></>,
    left:  <><path d="M62 13 H 18" stroke="var(--text)" strokeWidth="4" strokeLinecap="round" /><path d="M20 4 L2 13 L20 22 Z" fill="var(--text)" /></>,
    down:  <><path d="M13 8 V 50" stroke="var(--text)" strokeWidth="4" strokeLinecap="round" /><path d="M4 48 L13 66 L22 48 Z" fill="var(--text)" /></>,
  };
  return (
    <svg width={horizontal ? 68 : 26} height={horizontal ? 26 : 68}
      viewBox={horizontal ? '0 0 68 26' : '0 0 26 68'} fill="none" aria-hidden="true">
      {paths[dir]}
    </svg>
  );
}

function SmapArrow({ dir, area, bare }) {
  if (bare) return arrowSvg(dir);
  const horizontal = dir === 'right' || dir === 'left';
  return (
    <div className={'smap-arrow ' + (horizontal ? 'h' : 'v')} style={area ? { gridArea: area } : undefined}>
      {arrowSvg(dir)}
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
