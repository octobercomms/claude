import React, { useEffect } from 'react';

// SideDrawer — the house overlay for things that should stay out of the way
// until asked for. One definition of the pattern, because there are now three
// of them (the Strategist's ask-and-settings, Paid's playbook, Paid's audience
// picker) and three copies of a scrim would drift apart.
//
// The rule this encodes, from the Paid redesign conversation: **a drawer is
// for reading and choosing. Anything you would deep link to, or spend more
// than a minute inside, is a page.** So there is no routing here and no form
// state — a drawer renders, you read or pick, it closes.
//
//   open      — whether it is showing
//   onClose   — called by the scrim, the × and Escape
//   kicker    — small label above the title (usually the section)
//   title     — what this drawer is
//   split     — true for the two-column body, where both columns belong to
//               the same object. Two unrelated columns make a junk drawer;
//               pass the columns as two children and mean it.
//   width     — override the default 1000px for a single-column drawer that
//               does not need the room
export default function SideDrawer({ open, onClose, kicker, title, split = false, width, children }) {
  // Escape closes, matching every other overlay in the platform.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      {open && <div className="side-drawer-scrim" onClick={onClose} />}
      <aside
        className={`side-drawer${open ? ' open' : ''}`}
        aria-hidden={!open}
        style={width ? { width: `min(${width}px, 96vw)` } : undefined}
      >
        <div className="side-drawer-head">
          <div>
            {kicker && <div className="analyst-panel-kicker">{kicker}</div>}
            {title && <div className="analyst-panel-section">{title}</div>}
          </div>
          <button type="button" className="analyst-panel-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {/* Children render whether or not the drawer is open, because the
            drawer slides out rather than vanishing and an emptied panel
            sliding away reads as a glitch. A caller with something expensive
            inside gates it on `open` itself, the way the Strategist mounts
            its chat only while the drawer is showing. */}
        <div className={`side-drawer-body${split ? ' side-drawer-split' : ''}`}>
          {children}
        </div>
      </aside>
    </>
  );
}
