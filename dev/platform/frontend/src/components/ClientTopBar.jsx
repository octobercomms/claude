// The client bar: setup, connector health, and which client you are in.
//
// Setup and Connectors used to be tabs inside Admin, which meant a broken
// connector was invisible unless you happened to open the one tab that showed
// it. They are configuration you touch once and then forget, so they do not
// belong in a tab strip beside the three things you use daily — but the state
// of the connectors matters everywhere, because every number on every page is
// downstream of them.
//
// So: two icons that follow you around. The cog opens Setup. The plug shows
// connector health as a colour and opens Connectors. Red means something is
// broken and the data you are reading is stale or missing.
//
// Agency-only. A client login has no setup to do and no connectors to fix.

import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '../utils/api';
import ClientSwitcher from './ClientSwitcher';

// What each health state means, and how loudly to say it.
const HEALTH = {
  error: { tone: 'negative', label: 'connector error' },
  expired: { tone: 'negative', label: 'connector authorisation expired' },
  partial: { tone: 'warning', label: 'some connectors inactive' },
  none: { tone: 'subtle', label: 'no connectors yet' },
  ok: { tone: 'positive', label: 'all connectors live' },
};

export default function ClientTopBar({ clientId }) {
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
  // where setup lives. Brand kit is its own route and lights the cog too.
  const tabNow = new URLSearchParams(location.search).get('tab');
  const onSetup = (location.pathname === `/clients/${clientId}` && ['details', 'setup_overview'].includes(tabNow))
    || location.pathname === `/clients/${clientId}/brand`;
  const onConnectors = location.pathname === `/clients/${clientId}` && tabNow === 'connectors';

  const plugTitle = state
    ? `Connectors — ${state.label}${health.total ? ` (${health.active}/${health.total} active)` : ''}`
    : 'Connectors';

  return (
    <div className="client-topbar">
      <button
        type="button"
        className={`client-topbar-icon${onSetup ? ' active' : ''}`}
        onClick={() => navigate(`/clients/${clientId}?tab=details`)}
        title="Setup"
        aria-label="Setup"
        aria-current={onSetup ? 'page' : undefined}
      >
        <CogIcon />
      </button>

      <button
        type="button"
        className={`client-topbar-icon${onConnectors ? ' active' : ''}${state ? ` tone-${state.tone}` : ''}`}
        onClick={() => navigate(`/clients/${clientId}?tab=connectors`)}
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
