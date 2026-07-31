// Accordion — the one new primitive for the Health dashboard. Stacks read-out
// panels on a single scrollable page; each opens/closes independently.
//
// Accessibility patterns borrowed (re-implemented, not imported) from
// @astryxdesign/core's accordion: each header is a <button aria-expanded> that
// controls its region; arrow keys / Home / End move focus between headers
// (roving), Escape collapses the focused open section and keeps focus on it,
// and focus-visible is left to the browser default ring. Bodies render lazily
// (only when open) so a heavy panel doesn't mount until you look at it —
// matching the old one-tab-at-a-time behaviour.
//
// Styling lives in index.css (.accordion*), built from OMI's own tokens — no
// new colour, two-tone + accent-as-action preserved.

import React, { createContext, useContext, useRef } from 'react';

const AccordionCtx = createContext(null);

export function Accordion({ open, onToggle, children }) {
  const rootRef = useRef(null);

  // Roving focus across the header buttons, in DOM order.
  const onHeaderKeyDown = (e, id) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (e.key === 'Escape') {
      if (open.has(id)) { onToggle(id); } // collapse; focus stays on the header
      return;
    }
    if (!keys.includes(e.key)) return;
    const headers = Array.from(rootRef.current?.querySelectorAll('.accordion-trigger') || []);
    if (!headers.length) return;
    const i = headers.indexOf(e.currentTarget);
    let next;
    if (e.key === 'ArrowDown') next = headers[(i + 1) % headers.length];
    else if (e.key === 'ArrowUp') next = headers[(i - 1 + headers.length) % headers.length];
    else if (e.key === 'Home') next = headers[0];
    else if (e.key === 'End') next = headers[headers.length - 1];
    if (next) { e.preventDefault(); next.focus(); }
  };

  return (
    <AccordionCtx.Provider value={{ open, onToggle, onHeaderKeyDown }}>
      <div className="accordion" ref={rootRef}>{children}</div>
    </AccordionCtx.Provider>
  );
}

export function AccordionItem({ id, title, subtitle, badge, children }) {
  const ctx = useContext(AccordionCtx);
  if (!ctx) throw new Error('AccordionItem must be used inside an Accordion');
  const isOpen = ctx.open.has(id);
  const headerId = `acc-h-${id}`;
  const panelId = `acc-p-${id}`;
  return (
    <div className={`accordion-item${isOpen ? ' open' : ''}`}>
      <h3 className="accordion-h">
        <button
          type="button"
          id={headerId}
          className="accordion-trigger"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => ctx.onToggle(id)}
          onKeyDown={(e) => ctx.onHeaderKeyDown(e, id)}
        >
          <span className="accordion-caret" aria-hidden="true">▸</span>
          <span className="accordion-title">{title}</span>
          {subtitle && <span className="accordion-sub">{subtitle}</span>}
          {badge != null && <span className="accordion-badge">{badge}</span>}
        </button>
      </h3>
      {isOpen && (
        <div id={panelId} role="region" aria-labelledby={headerId} className="accordion-panel">
          {typeof children === 'function' ? children() : children}
        </div>
      )}
    </div>
  );
}
