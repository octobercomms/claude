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

import React, { useEffect, useRef } from 'react';
import ClientChatPage from '../pages/ClientChatPage';
import { analystContextFor } from '../utils/analystContext';

export default function AnalystPanel({ clientId, open, onClose, pathname }) {
  const panelRef = useRef(null);
  const { persona, label } = analystContextFor(pathname);

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
        <button type="button" className="analyst-panel-close" onClick={onClose} aria-label="Close analyst">×</button>
      </div>
      <div className="analyst-panel-body">
        {/* Mounted only while open, so switching sections starts the right
            conversation rather than re-labelling the previous one, and a closed
            panel costs nothing. */}
        {open && <ClientChatPage embedded clientId={clientId} persona={persona} />}
      </div>
    </aside>
  );
}
