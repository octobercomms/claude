import React from 'react';

// Performance launchpad — the "Overview-style" treatment that lives at
// the entry point of a suite's Performance tab. Shows a black hero with
// the suite's tagline, status pills (e.g. "Keywords 12 tracked · Ranking
// 4"), a numbered flow of how the suite works, and a bento grid of
// per-data-area cards with "Open X →" CTAs.
//
// Used by all three data-heavy suites (Organic, Paid, Social) so the
// landing feel is consistent — one shape across the platform.
//
// Config-driven so the same component renders very different suites:
//   <SuitePerformanceHub
//     headline="Win on Google — and in the AI answers."
//     description="Daily rank tracking and Search Console, plus..."
//     primaryCta={{ label: 'View keyword ranks →', onClick: () => setTab('keywords') }}
//     status={[ { label: 'Keywords', value: '12 tracked', tone: 'positive' }, ... ]}
//     flow={[ { label: 'Crawl + APIs', detail: 'DataForSEO, GSC, LLMs' }, ... ]}
//     cards={[ { label: 'Keywords', title: 'See where you rank', body: '...', onClick: () => setTab('keywords') }, ... ]}
//   />
export default function SuitePerformanceHub({
  headline, description, primaryCta, status = [], flow = [], cards = [],
}) {
  return (
    <div>
      {/* Hero — black band, big white headline, optional CTA */}
      <div
        style={{
          background: 'var(--text)',
          color: 'var(--surface)',
          padding: 'var(--s8) var(--s7)',
          borderRadius: 'var(--r-lg)',
          marginBottom: 'var(--s6)',
        }}
      >
        <h1 className="display" style={{ color: 'var(--surface)', maxWidth: 920, marginBottom: 'var(--s4)' }}>
          {headline}
        </h1>
        {description && (
          <p className="body" style={{ color: 'rgba(255,255,255,0.78)', maxWidth: 760, marginBottom: primaryCta ? 'var(--s6)' : 0 }}>
            {description}
          </p>
        )}
        {primaryCta && (
          <button
            onClick={primaryCta.onClick}
            style={{
              padding: '12px 24px', fontSize: 15, fontWeight: 700,
              background: 'var(--surface)', color: 'var(--text)',
              border: 'none', borderRadius: 'var(--r-pill)', cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {primaryCta.label}
          </button>
        )}
      </div>

      {/* Status pills — KPI snapshot row */}
      {status.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s3)', marginBottom: 'var(--s6)' }}>
          {status.map((s, i) => (
            <span key={i}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', fontSize: 13, fontWeight: 600,
                borderRadius: 'var(--r-pill)',
                background: 'var(--surface)',
                border: 'var(--border-w) solid var(--card-border)',
              }}>
              <span
                style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: s.tone === 'positive' ? 'var(--positive)'
                            : s.tone === 'warning'  ? 'var(--warning)'
                            : s.tone === 'negative' ? 'var(--negative)'
                            : 'var(--text-subtle)',
                }}
              />
              <strong style={{ fontWeight: 700 }}>{s.label}</strong>
              <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{s.value}</span>
            </span>
          ))}
        </div>
      )}

      {/* Numbered flow — explains how the suite works, with arrow connectors */}
      {flow.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${flow.length}, 1fr)`,
            gap: 0, marginBottom: 'var(--s6)',
            alignItems: 'stretch',
          }}>
          {flow.map((step, i) => (
            <React.Fragment key={i}>
              <div className="card" style={{ textAlign: 'center', padding: 'var(--s5)' }}>
                <div
                  style={{
                    width: 44, height: 44, borderRadius: '50%',
                    background: 'var(--accent)', color: 'var(--accent-on)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 18, fontWeight: 800, marginBottom: 'var(--s3)',
                  }}>
                  {i + 1}
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{step.label}</div>
                {step.detail && <div className="body-xs text-muted mt-2">{step.detail}</div>}
              </div>
              {i < flow.length - 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontSize: 22, fontWeight: 700, marginTop: -8 }}>→</div>
              )}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Bento grid — per-area cards with CTAs */}
      {cards.length > 0 && (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--s4)' }}>
          {cards.map((c, i) => (
            <div key={i} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
              <div className="caption">{c.label}</div>
              <h3 className="h3">{c.title}</h3>
              {c.body && <p className="body-sm text-muted" style={{ flex: 1 }}>{c.body}</p>}
              {c.onClick && (
                <button
                  onClick={c.onClick}
                  style={{
                    background: 'none', border: 'none', padding: 0, marginTop: 'var(--s2)',
                    color: 'var(--accent)', fontWeight: 700, fontSize: 13,
                    textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  Open {c.label} →
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
