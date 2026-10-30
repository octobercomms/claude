import React from 'react';
import SuiteTabs from '../SuiteTabs';
import ScreenHeading from '../ScreenHeading';

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
//   heading  — the screen's own name, under the section title. Derived from
//     the section panel rather than passed in, so no page can forget it and
//     none can disagree with the row that opened it. The tab strips used to
//     say which screen you were on; a panel row is 170px away and easy to
//     lose track of, and Daniel asked for the name back on the page. Pass
//     `heading={false}` to suppress it where the body already says it.
//   tabActions — the section's action row: the drawer openers and the one
//     control that applies across the whole section, whichever row of the
//     panel you are on. It used to be pinned to the right of the group tab
//     strip, which meant it rendered only when `tabs` was passed — so when
//     the strips moved into the section panel, Paid's Playbook and Earned's
//     Share quietly stopped rendering at all. It now stands on its own row.
//     Page-level controls still belong here rather than in `actions`: one in
//     `actions` lands under the client bar's icon cluster and reads as a
//     stray fourth circle that missed its row.
export default function PageShell({ title, subtitle, actions, tabActions, tabs, subTabs, heading, children }) {
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
              {heading !== false && <ScreenHeading title={title} name={heading} />}
            </div>
            {actions && <div className="hero-actions">{actions}</div>}
          </header>
        </>
      )}
      {tabs
        ? (tabActions
          ? (
            <div className="tabs-row">
              <SuiteTabs tabs={tabs} />
              <div className="tabs-row-actions">{tabActions}</div>
            </div>
          )
          : <SuiteTabs tabs={tabs} />)
        : (tabActions && (
          <div className="tabs-row tabs-row--bare">
            <div className="tabs-row-actions">{tabActions}</div>
          </div>
        ))}
      {subTabs && <SuiteTabs tabs={subTabs} variant="sub" />}
      {children}
    </div>
  );
}
