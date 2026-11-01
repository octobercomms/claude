// The client bar: setup, connector health, and which client you are in.
//
// Setup and Connectors used to be tabs inside Admin, which meant a broken
// connector was invisible unless you happened to open the one tab that showed
// it. They are configuration you touch once and then forget, so they do not
// belong in a tab strip beside the three things you use daily — but the state
// of the connectors matters everywhere, because every number on every page is
// downstream of them.
//
// So: icons that follow you around. The cog opens Setup. The plug shows
// connector health as a colour and opens Connectors. Red means something is
// broken and the data you are reading is stale or missing. The magnifier opens
// the search palette, which Layout owns so ⌘K also works where this bar does
// not render.
//
// Agency-only. A client login has no setup to do and no connectors to fix.

import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../utils/api';
import ClientSwitcher from './ClientSwitcher';
import { SearchIcon } from './GlobalSearch';

// What each health state means, and how loudly to say it.
const HEALTH = {
  error: { tone: 'negative', label: 'connector error' },
  expired: { tone: 'negative', label: 'connector authorisation expired' },
  partial: { tone: 'warning', label: 'some connectors inactive' },
  none: { tone: 'subtle', label: 'no connectors yet' },
  ok: { tone: 'positive', label: 'all connectors live' },
};

export default function ClientTopBar({ clientId, analystOpen, onToggleAnalyst, onOpenSearch }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [health, setHealth] = useState(null);

  // Re-read on navigation as well as on a client change: fixing a connector
  // happens on the Connectors tab, and leaving it should clear the red.
  useEffect(() => {
    if (!clientId) return;
    let live = true;
    api.get(`/connectors/client/${clientId}/health`)
      .then(h => { if (live) setHealth(h); })
      .catch(() => { if (live) setHealth(null); });
    return () => { live = false; };
  }, [clientId, location.pathname, location.search]);

  const state = health ? (HEALTH[health.worst] || HEALTH.none) : null;
  // The cog opens the setup itself — the client brief — not a page describing
  // where setup lives. The brand kit used to be its own route and lit the cog
  // too; it now renders inside Setup, so that clause went with the route.
  const tabNow = new URLSearchParams(location.search).get('tab');
  const onSetup = location.pathname === `/clients/${clientId}` && ['details', 'setup_overview'].includes(tabNow);
  const onConnectors = location.pathname === `/clients/${clientId}` && tabNow === 'connectors';

  const plugTitle = state
    ? `Connectors — ${state.label}${health.total ? ` (${health.active}/${health.total} active)` : ''}`
    : 'Connectors';

  // The bar stays put when the analyst opens over it, and is covered by it.
  // Clicking anywhere outside the panel dismisses it, so the bar does not need
  // to stay reachable to give you a way out.
  return (
    <div className="client-topbar">
      {/* Search leads the row. It is the only one of the four that answers
          "where is that thing", which is the question you have before you have
          a page in mind — the other three act on the page you are already on.
          ⌘K does the same from anywhere; the icon is here because an unlabelled
          shortcut is a feature only the person who built it knows about. */}
      <button
        type="button"
        className="client-topbar-icon"
        onClick={onOpenSearch}
        title="Search (⌘K)"
        aria-label="Search"
      >
        <SearchIcon />
      </button>

      <button
        type="button"
        className={`client-topbar-icon${onSetup ? ' active' : ''}`}
        onClick={() => navigate(`/clients/${clientId}/dashboard/setup`)}
        title="Setup"
        aria-label="Setup"
        aria-current={onSetup ? 'page' : undefined}
      >
        <CogIcon />
      </button>

      <button
        type="button"
        className={`client-topbar-icon${onConnectors ? ' active' : ''}${state ? ` tone-${state.tone}` : ''}`}
        onClick={() => navigate(`/clients/${clientId}/dashboard/connectors`)}
        title={plugTitle}
        aria-label={plugTitle}
        aria-current={onConnectors ? 'page' : undefined}
      >
        <PlugIcon />
        {/* Colour alone never carries the warning: a dot appears only when
            something is actually wrong, so it reads on a mono screen and to
            anyone who cannot separate the red from the green. */}
        {state && (state.tone === 'negative' || state.tone === 'warning') && (
          <span className="client-topbar-dot" aria-hidden="true" />
        )}
      </button>

      {/* The analyst. Accented rather than another grey circle, because it is
          the one here you use constantly and because it does something
          different from its neighbours: the cog and the plug navigate, this
          opens a panel over the page you are already on. */}
      <button
        type="button"
        className={`client-topbar-icon analyst${analystOpen ? ' active' : ''}`}
        onClick={onToggleAnalyst}
        title="Ask the analyst"
        aria-label="Ask the analyst"
        aria-expanded={!!analystOpen}
      >
        <ChatIcon />
      </button>

      <ClientSwitcher clientId={clientId} inBar />
    </div>
  );
}

function CogIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// Exported: the Database assistant's bubble uses the same glyph, so the two
// chat panels in OMI are opened by the same mark rather than by two drawings
// of a speech bubble that drift apart.
export function ChatIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

function PlugIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 2v6" />
      <path d="M15 2v6" />
      <path d="M6 8h12v3a6 6 0 0 1-12 0z" />
      <path d="M12 17v5" />
    </svg>
  );
}
