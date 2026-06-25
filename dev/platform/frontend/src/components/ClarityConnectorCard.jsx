// Microsoft Clarity is a standalone CRO integration (own /clarity API +
// client_clarity table), not part of the generic connector registry. Connect
// + disconnect live HERE on Setup → Connectors so Clarity behaves like every
// other data source: you wire it up in Setup, and the CRO / Funnel tab simply
// consumes it (runs the scan). The token field deliberately lives only here.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const ROW = { padding: '8px 12px', background: 'var(--surface-raised)', borderRadius: 'var(--r-sm)', border: '1px solid var(--card-border)' };
const DOT = (bg) => ({ width: 10, height: 10, borderRadius: 'var(--r-pill)', flex: '0 0 auto', background: bg });

export default function ClarityConnectorCard({ clientId }) {
  const toast = useToast();
  const [config, setConfig] = useState(null); // null = loading
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get(`/clarity/clients/${clientId}/config`)
      .then(c => { if (alive) setConfig(c || { connected: false }); })
      .catch(() => { if (alive) setConfig({ connected: false }); });
    return () => { alive = false; };
  }, [clientId]);

  async function saveToken() {
    if (!token.trim()) { toast('Paste your Clarity API token.', 'error'); return; }
    setSaving(true);
    try {
      const c = await api.post(`/clarity/clients/${clientId}/config`, { token });
      setConfig(c); setToken('');
      toast('Microsoft Clarity connected.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect Microsoft Clarity for this client?')) return;
    try { await api.delete(`/clarity/clients/${clientId}/config`); setConfig({ connected: false }); }
    catch (e) { toast(e.message, 'error'); }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Behaviour Analytics</h3>
      </div>

      {config === null ? (
        <div className="body-xs text-subtle">Checking…</div>
      ) : config.connected ? (
        <div style={{ ...ROW, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span style={DOT('var(--positive)')} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Microsoft Clarity</div>
              <div className="body-xs text-subtle">Connected · powers the CRO / Funnel scan</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={disconnect}>Disconnect</button>
            <Link to={`/clients/${clientId}/sales-traffic?tab=cro`} className="btn btn-secondary btn-sm">Open CRO scan</Link>
          </div>
        </div>
      ) : (
        <div style={ROW}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={DOT('var(--text-subtle)')} />
            <div style={{ fontSize: 13, fontWeight: 600 }}>Microsoft Clarity</div>
          </div>
          <p className="body-xs text-muted" style={{ margin: '0 0 8px' }}>
            In Clarity, open <strong>Settings → Data Export</strong>, generate an API token, and paste it here.
            Clarity is free; the export API allows 10 pulls/day. (Make sure the Clarity tracking tag is installed
            on the client's site — via Google Tag Manager is easiest.) It powers the CRO / Funnel scan.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" style={{ flex: 1 }} type="password" placeholder="Clarity API token"
              value={token} onChange={e => setToken(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveToken(); }} />
            <button className="btn btn-primary btn-sm" onClick={saveToken} disabled={saving}>{saving ? 'Connecting…' : 'Connect'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
