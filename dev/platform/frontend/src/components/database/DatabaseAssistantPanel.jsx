import React, { useEffect, useRef } from 'react';
import MediaAssistant from './MediaAssistant';

// The media-desk assistant, over whatever Database screen you are on.
//
// Same move the client analyst made, for the same reason: it was a row you
// had to leave the records to reach, and what it does is propose changes to
// the records. A panel keeps them on screen while you ask.
//
// It reuses `.analyst-panel`, which is the chat-panel shape named for its
// first user rather than a class belonging to the analyst. Two panels, one
// set of rules — no backdrop, no scroll lock, click-outside dismisses — and
// a second copy of those rules is how two panels start behaving differently.
//
// Database only. There is no per-client assistant and the media database is
// workspace-wide, so the bubble appears on /database/* and nowhere else.
export default function DatabaseAssistantPanel({ open, onClose }) {
  const panelRef = useRef(null);

  // Escape closes it, and so does a click anywhere outside it. Copied from
  // AnalystPanel deliberately, including the two things that are easy to get
  // wrong there:
  //
  //   - the listener is on `click` in the CAPTURE phase, not `mousedown`.
  //     Cancelling a mousedown does not stop the click, which is a separate
  //     event, so the dismissing click would also press whatever was under
  //     the cursor. A capture listener runs before the target's own handler,
  //     which is what makes stopPropagation there effective.
  //   - there is NO backdrop element. A div over the page would swallow wheel
  //     events too, and scrolling the list you are asking about is the whole
  //     reason this is a panel rather than a modal.
  //
  // The top bar is NOT excluded, and does not need to be: the panel sits at
  // z-index 60 over the bar's 50 and spans the right 589px of a 1280 window,
  // so the bubble at x=1180 is underneath it while it is open. Measured, not
  // assumed — elementFromPoint on the bubble returns .analyst-panel-head.
  // A click there lands inside the panel and does nothing, which is why the
  // exits are Escape, the ×, and clicking the page. The analyst is arranged
  // the same way. If the bar is ever raised above the panel, the bubble will
  // need excluding here or it will close and reopen on one click.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const outside = (e) => !panelRef.current?.contains(e.target);
    const onClick = (e) => {
      if (!outside(e)) return;
      e.preventDefault();
      // Kept for parity with AnalystPanel, and worth being exact about what
      // is proven: mutating the listener to the bubble phase turns the drive
      // red (the dismissing click navigates to the row it landed on), so the
      // capture phase is load-bearing. Removing this stopPropagation while
      // keeping capture changed nothing the drive could see — preventDefault
      // in the capture phase was already enough. So this line is belt and
      // braces, not the mechanism; do not cite it as the thing that works.
      e.stopPropagation();
      onClose();
    };
    const onDown = (e) => { if (outside(e)) e.preventDefault(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [open, onClose]);

  useEffect(() => { if (open) panelRef.current?.focus(); }, [open]);

  return (
    <aside
      ref={panelRef}
      className={`analyst-panel${open ? ' open' : ''}`}
      aria-label="Media-desk assistant"
      aria-hidden={!open}
      tabIndex={-1}
    >
      <div className="analyst-panel-head">
        <div>
          <div className="analyst-panel-kicker">Assistant</div>
          <div className="analyst-panel-section">Media desk</div>
        </div>
        <div className="analyst-panel-head-actions">
          <button type="button" className="analyst-panel-close" onClick={onClose} aria-label="Close assistant">×</button>
        </div>
      </div>
      <div className="analyst-panel-body">
        {/* Mounted only while open. A half-typed note survives a close only
            if you reopen within the same page, which matches the analyst and
            is the behaviour the chat had as a row. */}
        {open && <MediaAssistant />}
      </div>
    </aside>
  );
}
