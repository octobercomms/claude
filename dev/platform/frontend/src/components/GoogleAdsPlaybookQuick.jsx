import React, { useState } from 'react';
import { LAYERS } from './GoogleAdsPlaybook';

// The playbook as quick reference, for the drawer.
//
// The full version is a three-column funnel diagram: do on the left, the
// tapering bands down the middle, don't on the right. That is a thing you
// study, and it keeps its home in Guide. What the account lead wants mid-task
// is one line — "what should PMax exclude?" — and a diagram makes you read
// four layers to find it.
//
// So: the four layers as rows, open one at a time, do and don't inside. Same
// content, same order, three seconds instead of a page.
export default function GoogleAdsPlaybookQuick({ onOpenFull }) {
  const [open, setOpen] = useState(LAYERS[0]?.num ?? null);

  return (
    <div>
      <p className="body-sm" style={{ color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 0, marginBottom: 'var(--s4)' }}>
        The four-layer account structure, broadest reach at the top and most
        defensive at the base. Build them in order.
      </p>

      <div className="stack">
        {LAYERS.map(layer => {
          const isOpen = open === layer.num;
          return (
            <div key={layer.num} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <button
                type="button"
                className="pb-row"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : layer.num)}
              >
                <span className="pb-num">{layer.num}</span>
                <span className="pb-row-text">
                  <span className="pb-row-title">{layer.title}</span>
                  <span className="pb-row-tagline">{layer.tagline}</span>
                </span>
                <span className="pb-chev" aria-hidden="true">{isOpen ? '−' : '+'}</span>
              </button>

              {isOpen && (
                <div className="pb-detail">
                  <div className="pb-detail-col">
                    <div className="pb-detail-head" style={{ color: 'var(--positive)' }}>Do</div>
                    <ul className="ads-list">{layer.dos.map((d, i) => <li key={i}>{d}</li>)}</ul>
                  </div>
                  <div className="pb-detail-col">
                    <div className="pb-detail-head" style={{ color: 'var(--negative)' }}>Don&apos;t</div>
                    <ul className="ads-list">{layer.donts.map((d, i) => <li key={i}>{d}</li>)}</ul>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="body-xs text-subtle" style={{ marginTop: 'var(--s4)', lineHeight: 1.6 }}>
        Only once layers 1 to 3 run cleanly should you reach for YouTube or
        Demand Gen. Google captures demand better than it generates it.
      </p>

      {onOpenFull && (
        <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--s3)' }} onClick={onOpenFull}>
          See the full diagram in Guide →
        </button>
      )}
    </div>
  );
}
