import React from 'react';
import SuiteTabs from '../SuiteTabs';

// PageShell (L1) — the frame every section shares, below the dark nav rail
// (which Layout owns). It reproduces the house masthead — the kicker eyebrow
// ("Client • Section" with a pip) and the big display title, plus optional
// top-right actions — then the group pill-tabs, an optional sub-tab row, and
// the content outlet. Centralises what each page used to hand-roll, without
// changing how it looks.
//   title    — the section name (the big display heading)
//   subtitle — the client (rendered into the kicker as "Client • Section")
//   actions  — optional node, top-right of the hero
//   tabs / subTabs — SuiteTabs arrays:
//     [{ key, label, active, onClick | to } | { groupLabel }]
export default function PageShell({ title, subtitle, actions, tabs, subTabs, children }) {
  return (
    <div>
      {(title || actions) && (
        <>
          <div className="kicker">
            <span className="pip" />
            <span>{subtitle ? <><span className="kicker-name">{subtitle}</span> • </> : null}{title}</span>
          </div>
          <header
            className="hero"
            style={actions ? { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 'var(--s3)' } : undefined}
          >
            <div>
              <h1 className="display mt-2">{title}</h1>
            </div>
            {actions && <div className="hero-actions">{actions}</div>}
          </header>
        </>
      )}
      {tabs && <SuiteTabs tabs={tabs} />}
      {subTabs && <SuiteTabs tabs={subTabs} variant="sub" />}
      {children}
    </div>
  );
}
