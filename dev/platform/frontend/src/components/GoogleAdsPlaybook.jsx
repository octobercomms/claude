import React from 'react';

// Visual playbook of the four-layer Google Ads account structure used
// across October's eight-figure clients. Rendered on the Paid Overview
// tab as evergreen reference — AMs scan it before reading the weekly
// Strategist brief, and the briefings reference it implicitly.
//
// Drawn as a real funnel: a central column of tapering trapezoid bands,
// widest at the top (Performance Max — broad-reach demand capture) down
// to the narrowest (Branded Search — defensive only). The do / don't
// detail sits permanently either side — Do on the left, Don't on the
// right — instead of behind a hover tooltip.
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
      'Start with a broad-match campaign using keyword-themed ad groups — your search-term discovery engine.',
      'After a few weeks, identify the search terms that converted best and ROAS-positive.',
      'Launch a second campaign using exact-match for those proven winners, same keyword-themed structure.',
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

// Taper: each band insets its sides by `index * STEP`% at the top and
// `(index + 1) * STEP`% at the bottom, so consecutive bands line up into
// one continuous funnel. Darkening shades give it depth top → bottom.
const STEP = 6;
const BAND_BG = ['#EAD24E', '#E2C63D', '#D4B636', '#C2A22E'];

function bandClip(i) {
  const top = i * STEP;
  const bottom = (i + 1) * STEP;
  return `polygon(${top}% 0, ${100 - top}% 0, ${100 - bottom}% 100%, ${bottom}% 100%)`;
}

export default function GoogleAdsPlaybook() {
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 'var(--s5)' }}>
        <div>
          <div className="caption">Reference</div>
          <h3 className="h3" style={{ margin: '4px 0 0' }}>Google Ads playbook — four-layer account structure</h3>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Build top to bottom — broadest reach at the top, most defensive at the base</span>
      </div>

      <div className="ads-funnel">
        <div className="ads-funnel-head caption" style={{ color: 'var(--positive)', textAlign: 'right' }}>Do</div>
        <div className="ads-funnel-head" />
        <div className="ads-funnel-head caption" style={{ color: 'var(--negative)' }}>Don't</div>

        {LAYERS.map((layer, i) => (
          <React.Fragment key={layer.num}>
            <div className="ads-funnel-do">
              <div className="ads-funnel-label" style={{ color: 'var(--positive)' }}>Do</div>
              <ul className="ads-funnel-list">
                {layer.dos.map((d, j) => <li key={j}>{d}</li>)}
              </ul>
            </div>

            <div className="ads-funnel-band" style={{ background: BAND_BG[i], clipPath: bandClip(i) }}>
              <span className="ads-funnel-num">{layer.num}</span>
              <span>
                <span className="ads-funnel-title">{layer.title}</span>
                <span className="ads-funnel-tagline">{layer.tagline}</span>
              </span>
            </div>

            <div className="ads-funnel-dont">
              <div className="ads-funnel-label" style={{ color: 'var(--negative)' }}>Don't</div>
              <ul className="ads-funnel-list">
                {layer.donts.map((d, j) => <li key={j}>{d}</li>)}
              </ul>
            </div>
          </React.Fragment>
        ))}
      </div>

      <p style={{ marginTop: 'var(--s5)', fontSize: 11, color: 'var(--text-subtle)', lineHeight: 1.6, maxWidth: 720 }}>
        Only once layers 1–3 are running cleanly should you dabble with YouTube or Demand Gen. Google is best at capturing demand, not generating it — get the foundation right first.
      </p>
    </div>
  );
}
