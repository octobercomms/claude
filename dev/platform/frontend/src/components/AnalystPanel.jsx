// The analyst, on every page.
//
// It used to be a tab inside Data, which meant deciding to leave whatever you
// were looking at in order to ask about it. Now it slides over the right-hand
// side of whatever page you are on and the page stays put behind it — a panel,
// not a modal, because a modal would cover the thing you are asking about.
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
  const clearRef = useRef(null);
  // A closed panel is unmounted below, so reset the button to its empty state
  // rather than flash the previous conversation's "Clear history" on reopen.
  useEffect(() => { if (!open) setChat({ hasMessages: false, clearing: false }); }, [open]);

  // Escape closes it. Deliberately no click-outside and no scroll lock: the
  // page behind stays usable, which is the whole reason this is a panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
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
              className="btn-icon btn-icon-sm"
              onClick={() => clearRef.current?.()}
              disabled={chat.clearing}
              title={chat.clearing ? 'Clearing…' : 'Clear history'}
              aria-label="Clear history"
            >
              <TrashIcon />
            </button>
          )}
          <button type="button" className="analyst-panel-close" onClick={onClose} aria-label="Close analyst">×</button>
        </div>
      </div>
      <div className="analyst-panel-body">
        {/* Mounted only while open, so switching sections starts the right
            conversation rather than re-labelling the previous one, and a closed
            panel costs nothing. */}
        {open && <ClientChatPage embedded clientId={clientId} persona={persona} onChatState={setChat} clearRef={clearRef} />}
      </div>
    </aside>
  );
}

// Same style as the client bar's icons (24x24, stroked, round caps), so the
// header's two buttons read as a pair.
function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
    </svg>
  );
}
