import React, { useState } from 'react';
import SideDrawer from '../ui/SideDrawer';

// The secondary actions on a Database list, behind one kebab.
//
// Journalists carried four equal-weight buttons on its header row (Cleanup
// Centre, Export CSV, Import CSV, Add journalist) and Publications carried
// three of its own, so neither page said what its main action was. The house
// rule is one primary per screen.
//
// The account lead asked whether the Cleanup Centre should be "in the
// drawer". The Centre itself should not: SideDrawer's own rule is that
// anything deep-linkable, or longer than a minute's work, is a page, and
// merging duplicates is both. What goes in the drawer is the way in, with the
// rest of the housekeeping beside it.
//
// `children` are the drawer's contents, so each list passes its own tools and
// its own words. `primary` stays on the row, because the one thing you came to
// do should not be behind a menu.
export default function RecordTools({ label, primary, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
      {primary}
      {/* A kebab, not a cog: a cog promises settings and these are extra
          functions. Same shape as the one on the Strategist briefing. */}
      <button type="button" className="icon-circle" onClick={() => setOpen(true)}
        aria-label={`More ${label} tools`} title={`Import, export and tidy ${label}`}>
        ⋮
      </button>
      <SideDrawer open={open} onClose={() => setOpen(false)} kicker="Database" title={`${label} tools`} width={520}>
        <div style={{ display: 'grid', gap: 'var(--s4)' }} onClick={() => setOpen(false)}>
          {children}
        </div>
      </SideDrawer>
    </div>
  );
}

// One row in the drawer: what it does, and why you would.
//
// The explanations were tooltips, which is where an explanation goes to die —
// the account lead asked what "find websites and feeds" does and whether it
// needed a selection, and the answer was in a title attribute nobody hovers.
export function ToolRow({ children, note }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--s2)' }}>
      <div>{children}</div>
      {note && <p className="body-xs text-subtle" style={{ margin: 0, lineHeight: 1.5 }}>{note}</p>}
    </div>
  );
}
