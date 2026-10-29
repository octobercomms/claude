// The analyst, on every page.
//
// It used to be a tab inside Data, which meant deciding to leave whatever you
// were looking at in order to ask about it. Now it slides over the right-hand
// side of whatever page you are on and the page stays visible behind it — a
// panel, not a modal, because a modal would hide the thing you are asking
// about. Clicking that page dismisses the panel rather than acting on it, so
// the whole window is the close target; the page still scrolls underneath.
//
// It knows where you are. The backend has carried four PESO pillar personas
// since they were built — owned, shared, paid, earned — each with its own
// history thread and its own action tool, and nothing in the frontend had ever
// asked for one. The panel picks the persona from the section you are standing
// in, so on Paid you are talking to the paid analyst about paid, and on Owned
// to the one that can draft a piece of content. Everywhere else it is the
// general analyst, which is the conversation Data used to hold.
//
// Agency-only. Layout does not render it for a client login.

import React, { useEffect, useRef, useState } from 'react';
import ClientChatPage from '../pages/ClientChatPage';
import { analystContextFor } from '../utils/analystContext';

export default function AnalystPanel({ clientId, open, onClose, pathname }) {
  const panelRef = useRef(null);
  const { persona, label } = analystContextFor(pathname);
  // Clear-history lives up here, beside the close button — but the action and
  // the "is there anything to clear?" state belong to the chat. The chat
  // reports them up through onChatState and exposes the handler on clearRef.
  const [chat, setChat] = useState({ hasMessages: false, clearing: false });
  // One view again. The Strategist's queue lived here as a second tab, and the
  // account lead could not say what it was: the same list existed on the
  // Strategist tab, and seeing a strategist's output inside the analyst's
  // chrome made it unnameable. Two homes for one list is not redundancy, it is
  // two half-identities. The queue is on the Strategist, where it is the point
  // of the page rather than a tab inside a different tool.
  const clearRef = useRef(null);
  // A closed panel is unmounted below, so reset the button to its empty state
  // rather than flash the previous conversation's "Clear history" on reopen.
  useEffect(() => { if (!open) setChat({ hasMessages: false, clearing: false }); }, [open]);

  // Escape closes it, and so does a click anywhere outside it. The click that
  // dismisses is swallowed rather than passed through, so dismissing never
  // also fires whatever happened to be under the cursor.
  //
  // No backdrop element does this, deliberately: a div over the page would
  // eat wheel events too, and scrolling the page to read more of what you are
  // asking about is the reason this is a panel rather than a modal. A
  // capture-phase mousedown listener closes and cancels the click while
  // leaving scrolling alone.
  //
  // The top bar is excluded so the bubble stays a toggle rather than closing
  // and reopening on one click.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    // The panel covers the client bar at every width (the bar sits top-right,
    // inside the panel's own column), so there is no second element to exclude
    // here. If the bar is ever raised above the panel again, clicks on the
    // bubble will need excluding or it will close and reopen on one click.
    const outside = (e) => !panelRef.current?.contains(e.target);
    // Capture phase, and on `click` rather than `mousedown`: a capture listener
    // runs before the target's own handler, so stopping it here is what keeps
    // the dismissing click from also pressing the button under the cursor.
    // Cancelling the mousedown is not enough — `click` is a separate event and
    // fires regardless.
    const onClick = (e) => {
      if (!outside(e)) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    // The matching mousedown is cancelled too, so the page behind does not take
    // focus or start a text selection on the way out.
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

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!clientId) return null;

  return (
    <aside
      ref={panelRef}
      className={`analyst-panel${open ? ' open' : ''}`}
      aria-label="Analyst"
      aria-hidden={!open}
      tabIndex={-1}
    >
      <div className="analyst-panel-head">
        <div>
          <div className="analyst-panel-kicker">Analyst</div>
          {label && <div className="analyst-panel-section">{label}</div>}
        </div>
        <div className="analyst-panel-head-actions">
          {chat.hasMessages && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ fontSize: 'var(--fs-caption)', padding: '4px 10px' }}
              onClick={() => clearRef.current?.()}
              disabled={chat.clearing}
              title="Clear this conversation's history"
            >
              {chat.clearing ? 'Clearing…' : 'Clear history'}
            </button>
          )}
          <button type="button" className="analyst-panel-close" onClick={onClose} aria-label="Close analyst">×</button>
        </div>
      </div>
      <div className="analyst-panel-body">
        {/* Mounted only while open, so switching sections starts the right
            conversation rather than re-labelling the previous one, and a closed
            panel costs nothing. */}
        {open && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <ClientChatPage embedded clientId={clientId} persona={persona} onChatState={setChat} clearRef={clearRef} />
          </div>
        )}
      </div>
    </aside>
  );
}
