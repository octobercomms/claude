import React, { useState } from 'react';

// Visual playbook of the four-layer Google Ads account structure used
// across October's eight-figure clients. Lives on the Paid Strategist
// tab — AMs can scan it before reading the weekly brief, and the
// briefings reference it implicitly. Each layer expands on click for
// the do / don't detail.
const LAYERS = [
  {
    num: 1,
    title: 'Performance Max',
    tagline: 'Broad-reach new customer engine — feed only.',
    dos: [
      'Feed-only — no headlines, descriptions, or images. Shopping placements are where the return lives.',
      'Run multiple PMax campaigns when product margins vary significantly, so each can have its own tROAS target.',
      'Exclude brand at the account or campaign level — PMax will otherwise burn budget on traffic you\'d have converted for free.',
    ],
    donts: [
      'Don\'t let PMax bid on your brand. It will, given the chance — those are the cheapest conversions to claim.',
      'Don\'t lump high- and low-margin products into one campaign with one tROAS — you\'ll buy sales that aren\'t profitable.',
    ],
  },
  {
    num: 2,
    title: 'Standard Shopping',
    tagline: 'Priority-tiered keyword funnel — the control PMax can\'t give you.',
    dos: [
      'High priority + aggressive (low) tROAS for high-intent search terms. Exclude brand + generics.',
      'Medium priority for generics. Exclude brand. Use a higher tROAS so it doesn\'t overspend on lower-converting traffic.',
      'Low priority for branded shopping — defensive, light spend, just to keep competitors out of the shopping carousel.',
    ],
    donts: [
      'Don\'t skip this layer thinking PMax is enough. PMax has no priority setting — without standard shopping you can\'t funnel traffic by intent.',
      'Don\'t bid aggressively on branded shopping — you\'re paying for sales you already had.',
    ],
  },
  {
    num: 3,
    title: 'Standard Search',
    tagline: 'Discovery first, then graduate the winners to exact match.',
    dos: [
      'Start with a broad-match campaign using keyword-themed ad groups — this is your search-term discovery engine.',
      'After a few weeks, identify the search terms that converted best and ROAS-positive.',
      'Launch a second campaign using exact-match for those proven winners, same keyword-themed ad-group structure.',
      'Exact match + tight ad groups → highest quality score → best rankings for the lowest CPC.',
      'Exclude brand on both — these are new-customer campaigns.',
    ],
    donts: [
      'Don\'t go straight to exact match — you\'ll miss search terms you didn\'t know were converting.',
      'Don\'t mix unrelated keywords in one ad group — quality score will tank.',
    ],
  },
  {
    num: 4,
    title: 'Branded Search',
    tagline: 'Defensive only. Most brands probably don\'t need this.',
    dos: [
      'Run it when competitors are aggressively bidding on your brand terms (common at scale).',
      'Run it when your organic SEO is weak and you don\'t reliably show up #1 for your own brand.',
    ],
    donts: [
      'Don\'t run this just because the spreadsheet says branded search has 8x ROAS — those are sales you would\'ve had anyway.',
      'Don\'t spend on YouTube or Demand Gen until layers 1–3 are dialled in. Google is best at capturing demand, not generating it.',
    ],
  },
];

export default function GoogleAdsPlaybook() {
  const [openLayer, setOpenLayer] = useState(null);

  return (
    <div className="card" style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <div className="caption">Reference</div>
          <h3 className="h3" style={{ margin: '4px 0 0' }}>Google Ads playbook — four-layer account structure</h3>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Build in this order — click each layer for detail</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {LAYERS.map(layer => {
          const isOpen = openLayer === layer.num;
          return (
            <div
              key={layer.num}
              onClick={() => setOpenLayer(isOpen ? null : layer.num)}
              style={{
                border: 'var(--border-w) solid var(--card-border)',
                borderRadius: 'var(--r-sm)',
                background: isOpen ? 'var(--accent-soft)' : 'var(--surface)',
                cursor: 'pointer',
                transition: 'background 120ms ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px' }}>
                <div
                  style={{
                    flex: '0 0 auto',
                    width: 36, height: 36,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    color: 'var(--accent-on)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 16, fontWeight: 800,
                  }}
                >
                  {layer.num}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>{layer.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{layer.tagline}</div>
                </div>
                <div style={{ fontSize: 18, color: 'var(--text-subtle)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 120ms ease' }}>⌄</div>
              </div>

              {isOpen && (
                <div style={{ borderTop: 'var(--border-w) solid var(--card-border)', padding: '14px 16px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                  <div>
                    <div className="caption" style={{ marginBottom: 6, color: 'var(--positive)' }}>Do</div>
                    <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 13, lineHeight: 1.55, color: 'var(--text)' }}>
                      {layer.dos.map((d, i) => <li key={i} style={{ marginBottom: 4 }}>{d}</li>)}
                    </ul>
                  </div>
                  <div>
                    <div className="caption" style={{ marginBottom: 6, color: 'var(--negative)' }}>Don't</div>
                    <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 13, lineHeight: 1.55, color: 'var(--text)' }}>
                      {layer.donts.map((d, i) => <li key={i} style={{ marginBottom: 4 }}>{d}</li>)}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p style={{ marginTop: 14, fontSize: 11, color: 'var(--text-subtle)', lineHeight: 1.6 }}>
        Only once layers 1–3 are running cleanly should you dabble with YouTube or Demand Gen. Google is best at capturing demand, not generating it — get the foundation right first.
      </p>
    </div>
  );
}
