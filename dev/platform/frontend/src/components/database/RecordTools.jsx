import React, { createContext, useContext, useEffect, useState } from 'react';
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
// Where the kebab goes.
//
// "the drawer button on database needs to sit in the header? it is in the
// wrong place." Right, and it is the same rule as the writing standard on
// Earned: a control that acts on the whole screen belongs in the page
// header, not inside the first card on it.
//
// The tools themselves are defined by the list that owns them, which is
// several components down, so the list publishes them and the header renders
// them. A slot rather than a prop drilled through three layers.
const Slot = createContext(null);

export function DatabaseToolsSlot({ children }) {
  const [tools, setTools] = useState(null);
  return (
    <Slot.Provider value={setTools}>
      {typeof children === 'function' ? children(tools) : children}
    </Slot.Provider>
  );
}

// Rendered by the page header. Null until a list publishes something, so a
// screen with no tools shows no kebab rather than an empty drawer.
export function DatabaseToolsTrigger({ tools }) {
  const [open, setOpen] = useState(false);
  if (!tools) return null;
  return (
    <>
      {/* A kebab, not a cog: a cog promises settings and these are extra
          functions. Same shape as the one on the Strategist briefing. */}
      <button type="button" className="icon-circle" onClick={() => setOpen(true)}
        aria-label={`More ${tools.label} tools`} title={`Import, export and tidy ${tools.label}`}>
        ⋮
      </button>
      <SideDrawer open={open} onClose={() => setOpen(false)} kicker="Database"
        title={`${tools.label} tools`} width={520}>
        <div style={{ display: 'grid', gap: 'var(--s4)' }} onClick={() => setOpen(false)}>
          {tools.children}
        </div>
      </SideDrawer>
    </>
  );
}

export default function RecordTools({ label, primary, children }) {
  const publish = useContext(Slot);
  useEffect(() => {
    if (!publish) return undefined;
    publish({ label, children });
    // Cleared on unmount, or switching from Publications to Journalists would
    // leave the previous list's tools in the header.
    return () => publish(null);
  }, [publish, label, children]);

  // `primary` stays on the row: it is the one thing you came to this screen
  // to do, and it belongs beside the list it acts on.
  return primary || null;
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
