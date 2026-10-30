import React from 'react';
import SuiteTabs from '../SuiteTabs';
import ScreenHeading from '../ScreenHeading';
import { PageActionsProvider, PageActionsSlot } from '../PageActions';

// PageShell (L1) — the frame every section shares, below the dark nav rail
// (which Layout owns). It reproduces the house masthead — the kicker eyebrow
// ("Client • Section" with a pip) and the big display title, with the screen's
// own controls on the same line — then the content outlet.
//   title    — the section name (the big display heading)
//   subtitle — the client (rendered into the kicker as "Client • Section")
//   heading  — the screen's own name, under the section title. Derived from
//     the section panel rather than passed in, so no page can forget it and
//     none can disagree with the row that opened it. Pass `heading={false}`
//     to suppress it where the body already says it.
//   actions / tabActions — controls for this screen: drawer openers and the
//     one or two things that apply across the section. Both now render on the
//     title line.
//
//     They used to be two different places. `actions` sat top-right of the
//     hero; `tabActions` was pinned to the right of the group tab strip, so
//     when the strips moved into the section panel it rendered only when
//     `tabs` was passed and Paid's Playbook and Earned's Share quietly stopped
//     appearing at all. The fix then was to give it its own row under the
//     rule. Daniel's read on seeing it: with single-purpose screens there is
//     nothing competing for the title line, and a control one row below its
//     own heading looks like the first item of the content rather than an
//     action on the page. So both slots land in the same place and the extra
//     row is gone. The two names stay because callers use both and they carry
//     no difference worth a rename.
//
//     A control that lives inside a panel, several components down, uses
//     <PageActions> instead — same line, no prop threading. See PageActions.
//   tabs / subTabs — SuiteTabs arrays, for the two pages that still have
//     an in-page strip of their own.
export default function PageShell({ title, subtitle, actions, tabActions, tabs, subTabs, heading, children }) {
  const hasHeroActions = !!(actions || tabActions);
  return (
    <PageActionsProvider>
      <div>
        {(title || hasHeroActions) && (
          <>
            <div className="kicker">
              <span className="pip" />
              <span>{subtitle ? <><span className="kicker-name">{subtitle}</span> • </> : null}{title}</span>
            </div>
            <header
              className="hero"
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 'var(--s3)' }}
            >
              <div>
                <h1 className="display mt-2">{title}</h1>
                {heading !== false && <ScreenHeading title={title} name={heading} />}
              </div>
              <div className="hero-actions">
                {actions}
                {tabActions}
                {/* Whatever the body puts there. Empty until something does. */}
                <PageActionsSlot />
              </div>
            </header>
          </>
        )}
        {tabs && <SuiteTabs tabs={tabs} />}
        {subTabs && <SuiteTabs tabs={subTabs} variant="sub" />}
        {children}
      </div>
    </PageActionsProvider>
  );
}
