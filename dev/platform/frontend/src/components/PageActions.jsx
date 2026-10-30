import React, { createContext, useContext, useState } from 'react';
import { createPortal } from 'react-dom';

// Controls that belong to the screen, rendered on the line with its title.
//
// They used to sit on their own row under the rule: PageShell had a
// `tabActions` slot left over from when they were pinned to the right of a tab
// strip, and anything a panel body wanted up there had no way to get there at
// all — StrategistBriefingPanel's "Generate briefing" rendered wherever the
// panel happened to start. With single-purpose screens there is nothing else
// competing for the title line, and a control one row below its heading reads
// as the first item of the content rather than as an action on the page.
//
// The problem is that the control usually lives several components deep, in a
// panel the page knows nothing about. Threading a prop up through every panel
// would mean every page knowing about every panel's buttons. So the hero
// publishes a slot and the body fills it by portal:
//
//   <PageActionsProvider>        — wraps the hero and the body together
//     <header>… <PageActionsSlot /></header>
//     …
//       <PageActions><button>Generate briefing</button></PageActions>
//   </PageActionsProvider>
//
// PageShell does the first two for every page that uses it. A page drawing its
// own hero (ClientDetailPage, SettingsPage, ClientVideoTab) wires the same two
// pieces by hand.
//
// Nesting note: the slot renders nothing until a body claims it, so a screen
// with no actions leaves no empty box on the title line.

const Ctx = createContext(null);

export function PageActionsProvider({ children }) {
  // The DOM node of the slot, once it mounts. A plain useState callback ref
  // rather than useRef, because the body has to re-render when the node
  // appears — a ref would not tell it.
  const [node, setNode] = useState(null);
  return <Ctx.Provider value={{ node, setNode }}>{children}</Ctx.Provider>;
}

// Rendered inside the hero, on the title line.
//
// `display: contents` by default, so the slot itself is not a box: its
// children become direct flex items of the actions row and an unclaimed slot
// adds no gap. Pass a className to make it a box of its own where it is the
// only thing on the line.
export function PageActionsSlot({ className, style }) {
  const ctx = useContext(Ctx);
  if (!ctx) return null;
  return (
    <div
      className={className}
      style={style || (className ? undefined : { display: 'contents' })}
      ref={ctx.setNode}
    />
  );
}

// Rendered anywhere in the body. Its children appear in the slot.
//
// Returns null when there is no provider or the slot has not mounted yet,
// which is the first render and any page that forgot the slot. Deliberate:
// a missing slot should drop the button rather than render it in the middle
// of the content, because a stray button there reads as part of the screen
// and is the thing this replaces.
export function PageActions({ children }) {
  const ctx = useContext(Ctx);
  if (!ctx || !ctx.node) return null;
  return createPortal(children, ctx.node);
}

export default PageActions;
