import React from 'react';

// Launchpad (L2 body) — the Overview hero beneath OverviewChat: a function
// kicker, a headline value, one primary action, then whatever readout the
// section wants (usually a StatStrip). Keeps every Overview tab identical.
export default function Launchpad({ kicker, pipColor, headline, cta, children }) {
  return (
    <div className="ds-launchpad">
      {kicker && (
        <span className="ds-launchpad__kicker">
          {pipColor && <span className="ds-launchpad__pip" style={{ background: pipColor }} />}
          {kicker}
        </span>
      )}
      {headline && <div className="ds-launchpad__headline">{headline}</div>}
      {cta}
      {children}
    </div>
  );
}
