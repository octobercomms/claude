// Microsoft Clarity is a standalone CRO integration (own /clarity API +
// client_clarity table), not part of the generic connector registry. Connect
// + disconnect live HERE on Setup → Connectors so Clarity behaves like every
// other data source: you wire it up in Setup, and the CRO / Funnel tab consumes
// it. A client can connect SEVERAL sites (e.g. Falcon Enamelware DTC / Trade),
// each with its own label + flag — mirroring the Shopify multi-store rows.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { getCountryFlag, getLabelStyle } from '../utils/connectorLabels';

const ROW = { padding: '10px 12px', background: 'var(--surface-raised)', borderRadius: 'var(--r-sm)', border: '1px solid var(--card-border)' };

export default function ClarityConnectorCard({ clientId }) {
  const toast = useToast();
  const [sites, setSites] = useState(null); // null = loading
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    try { const r = await api.get(`/clarity/clients/${clientId}/sites`); setSites(r.sites || []); }
    catch { setSites([]); }
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [clientId]);

  async function addSite() {
    if (!token.trim()) { toast('Paste your Clarity API token.', 'error'); return; }
    setSaving(true);
    try {
      await api.post(`/clarity/clients/${clientId}/sites`, { label: label.trim(), token: token.trim() });
      setLabel(''); setToken(''); setAdding(false);
      await load();
      toast('Microsoft Clarity site connected.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  }

  async function rename(site) {
    const next = window.prompt('Site label (e.g. DTC, Trade, UK):', site.label);
    if (next == null) return;
    const lbl = next.trim();
    if (!lbl || lbl === site.label) return;
    try { await api.patch(`/clarity/clients/${clientId}/sites/${site.id}`, { label: lbl }); await load(); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function remove(site) {
    if (!window.confirm(`Disconnect Microsoft Clarity site "${site.label}"?`)) return;
    try { await api.delete(`/clarity/clients/${clientId}/sites/${site.id}`); await load(); }
    catch (e) { toast(e.message, 'error'); }
  }

  const showForm = adding || (sites && sites.length === 0);

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Behaviour Analytics</h3>
      </div>

      {sites === null ? (
        <div className="body-xs text-subtle">Checking…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sites.map(s => {
            const flag = getCountryFlag(s.label);
            return (
              <div key={s.id} style={{ ...ROW, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 999, flex: '0 0 auto', background: 'var(--positive)' }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Microsoft Clarity</span>
                      <span style={getLabelStyle(s.label)}>{flag ? `${flag} ` : ''}{s.label}</span>
                    </div>
                    <div className="body-xs text-subtle" style={{ marginTop: 2 }}>Connected · powers the CRO / Funnel scan</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => rename(s)}>Rename</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => remove(s)}>Disconnect</button>
                  <Link to={`/clients/${clientId}/sales-traffic?tab=cro`} className="btn btn-secondary btn-sm">Open CRO scan</Link>
                </div>
              </div>
            );
          })}

          {showForm ? (
            <div style={ROW}>
              <div className="body-xs text-muted" style={{ marginBottom: 8 }}>
                In Clarity, open <strong>Settings → Data Export</strong>, generate an API token, and paste it here. One Clarity project = one site.
                Give each a short label (e.g. <em>DTC</em>, <em>Trade</em>, <em>UK</em>) so it's clear which site each scan is for.
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input className="input" style={{ flex: '0 0 160px' }} placeholder="Label (e.g. DTC)"
                  value={label} onChange={e => setLabel(e.target.value)} />
                <input className="input" style={{ flex: 1, minWidth: 180 }} type="password" placeholder="Clarity API token"
                  value={token} onChange={e => setToken(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addSite(); }} />
                <button className="btn btn-primary btn-sm" onClick={addSite} disabled={saving}>{saving ? 'Connecting…' : 'Connect'}</button>
                {sites.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => { setAdding(false); setLabel(''); setToken(''); }}>Cancel</button>}
              </div>
            </div>
          ) : (
            <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}>+ Add another site</button>
          )}
        </div>
      )}
    </div>
  );
}
