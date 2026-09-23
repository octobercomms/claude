import React from 'react';
import SuiteTabs from '../SuiteTabs';

// PageShell (L1) — the frame every section shares, below the dark nav rail
// (which Layout owns). An optional header (title / subtitle / actions), the
// group pill-tab strip, an optional sub-tab row, then the content outlet with
// consistent spacing. `tabs` / `subTabs` are SuiteTabs arrays:
//   [{ key, label, active, onClick | to } | { groupLabel }]
export default function PageShell({ title, subtitle, actions, tabs, subTabs, children }) {
  return (
    <div>
      {(title || actions) && (
        <div className="ds-shell__head">
          {title && (
            <div>
              <div className="ds-shell__title">{title}</div>
              {subtitle && <div className="ds-shell__sub">{subtitle}</div>}
            </div>
          )}
          {actions && <div className="ds-shell__spacer">{actions}</div>}
        </div>
      )}
      {tabs && <SuiteTabs tabs={tabs} />}
      {subTabs && <SuiteTabs tabs={subTabs} variant="sub" />}
      <div className="ds-shell__body">{children}</div>
    </div>
  );
}
