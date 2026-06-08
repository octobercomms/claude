// Shared suite tab strip. Each tab can either:
//   - take an absolute `to` path (route navigation), or
//   - take an `onClick` callback (internal state switch on the same page)
//
// Used wherever a page is conceptually one of several siblings under a
// suite — e.g. Organic = SEO + AI Visibility; Paid = Performance +
// Strategist + Creative + Audiences. The visual is one strip, the
// underlying mechanism can mix routes and state.

import React from 'react';
import { useNavigate } from 'react-router-dom';

// A tab entry can be either a button (key + label, optionally to/onClick)
// or a non-interactive group label (groupLabel — renders as a small
// uppercase separator in the strip, lets the AM scan grouped sub-tabs
// without spawning a 3-tier nav).
export default function SuiteTabs({ tabs, variant }) {
  const navigate = useNavigate();
  return (
    <div className={`tabs${variant === 'sub' ? ' tabs-sub' : ''}`}>
      {tabs.map((t, i) => {
        if (t.groupLabel) {
          return (
            <span key={`g-${i}-${t.groupLabel}`} className="tab-group-label" aria-hidden="true">
              {t.groupLabel}
            </span>
          );
        }
        const handle = () => {
          if (t.to) navigate(t.to);
          else if (t.onClick) t.onClick();
        };
        return (
          <button
            key={t.key || t.label}
            type="button"
            className={`tab ${t.active ? 'active' : ''}`}
            onClick={handle}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
