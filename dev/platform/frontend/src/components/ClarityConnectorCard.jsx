// Microsoft Clarity is connected on Sales & Traffic → CRO / Funnel — it's a
// standalone CRO integration (own /clarity API + client_clarity table), not
// part of the generic connector registry, so it never appears in the rows
// rendered from /connectors. This card surfaces its status here on
// Setup → Connectors so it's discoverable alongside the other data sources,
// and deep-links to the panel where the token is actually pasted.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';

export default function ClarityConnectorCard({ clientId }) {
  const [connected, setConnected] = useState(null); // null = loading

  useEffect(() => {
    let alive = true;
    api.get(`/clarity/clients/${clientId}/config`)
      .then(c => { if (alive) setConnected(!!c?.connected); })
      .catch(() => { if (alive) setConnected(false); });
    return () => { alive = false; };
  }, [clientId]);

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Behaviour Analytics</h3>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'var(--surface-raised)', borderRadius: 'var(--r-sm)', border: '1px solid var(--card-border)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ width: 10, height: 10, borderRadius: 'var(--r-pill)', flex: '0 0 auto', background: connected ? 'var(--positive)' : 'var(--text-subtle)' }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Microsoft Clarity</div>
            <div className="body-xs text-subtle">
              {connected === null
                ? 'Checking…'
                : connected
                  ? 'Connected · powers the CRO / Funnel scan'
                  : 'Not connected · paste the token on the CRO / Funnel tab'}
            </div>
          </div>
        </div>
        <Link to={`/clients/${clientId}/sales-traffic?tab=cro`} className="btn btn-secondary btn-sm">
          {connected ? 'Manage' : 'Connect'}
        </Link>
      </div>
    </div>
  );
}
