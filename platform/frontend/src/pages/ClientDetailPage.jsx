import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const CONNECTOR_TYPES = [
  'ga4','google_search_console','google_ads','google_merchant_center',
  'meta_ads','instagram_insights','shopify','woocommerce',
  'klaviyo','brevo','shopify_email','amazon_seller',
  'zoho_inventory','cin7',
];

const CONNECTOR_LABELS = {
  ga4: 'Google Analytics 4', google_search_console: 'Google Search Console',
  google_ads: 'Google Ads', google_merchant_center: 'Google Merchant Center',
  meta_ads: 'Meta Ads', instagram_insights: 'Instagram Insights',
  shopify: 'Shopify', woocommerce: 'WooCommerce', klaviyo: 'Klaviyo',
  brevo: 'Brevo', shopify_email: 'Shopify Email',
  amazon_seller: 'Amazon Seller',
  zoho_inventory: 'Zoho Inventory', cin7: 'Cin7',
};

const CONNECTOR_GROUPS = [
  { label: 'Google', types: ['ga4','google_search_console','google_ads','google_merchant_center'], oauth: 'google' },
  { label: 'Meta', types: ['meta_ads','instagram_insights'], oauth: 'meta' },
  { label: 'E-commerce', types: ['shopify','woocommerce','amazon_seller'] },
  { label: 'Email Marketing', types: ['shopify_email','klaviyo','brevo'] },
  { label: 'Inventory', types: ['zoho_inventory','cin7'] },
];

const OAUTH_TYPES = ['ga4','google_search_console','google_ads','google_merchant_center','meta_ads','instagram_insights','zoho_inventory'];
const SHOPIFY_TYPES = ['shopify','shopify_email'];

export default function ClientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [client, setClient] = useState(null);
  const [connectors, setConnectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [parsingSuggestions, setParsingSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'details';
  function setTab(t) { setSearchParams({ tab: t }, { replace: true }); }
  const [credModal, setCredModal] = useState(null);
  const [credValues, setCredValues] = useState({});
  const [addAnotherModal, setAddAnotherModal] = useState(null);
  const [shopifyModal, setShopifyModal] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get(`/clients/${id}`),
      api.get(`/connectors/client/${id}`),
    ]).then(([c, conn]) => {
      setClient(c);
      setConnectors(conn);
    }).finally(() => setLoading(false));
  }, [id]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const updated = await api.put(`/clients/${id}`, client);
      setClient(updated);
      toast('Saved');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleParseBriefing() {
    setParsingSuggestions(true);
    try {
      const result = await api.post(`/clients/${id}/parse-briefing`);
      setSuggestions(result);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setParsingSuggestions(false);
    }
  }

  async function handleCheckConnector(connectorId) {
    try {
      const result = await api.post(`/connectors/${connectorId}/check`);
      setConnectors(prev => prev.map(c => c.id === connectorId ? { ...c, ...result } : c));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function handleSaveCredentials(connectorId) {
    try {
      const result = await api.put(`/connectors/${connectorId}/credentials`, { credentials: credValues });
      setConnectors(prev => prev.map(c => c.id === connectorId ? { ...c, ...result } : c));
      setCredModal(null);
      setCredValues({});
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function addConnector(type, label = null) {
    try {
      const conn = await api.post(`/connectors/client/${id}`, { connector_type: type, store_label: label });
      setConnectors(prev => [...prev, conn]);
      if (OAUTH_TYPES.includes(type)) {
        if (conn.status !== 'active') openOAuth(type, id);
      } else if (SHOPIFY_TYPES.includes(type)) {
        setShopifyModal({ connectorId: conn.id });
      } else {
        setCredModal(conn);
        setCredValues({});
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function deleteConnector(connectorId) {
    if (!window.confirm('Remove this connector?')) return;
    await api.delete(`/connectors/${connectorId}`);
    setConnectors(prev => prev.filter(c => c.id !== connectorId));
  }

  async function resetConnector(connectorId) {
    if (!window.confirm('Reset credentials? This will disconnect the connector so you can reconnect fresh.')) return;
    try {
      const updated = await api.post(`/connectors/${connectorId}/reset`);
      setConnectors(prev => prev.map(c => c.id === connectorId ? { ...c, ...updated } : c));
      toast('Connector reset — reconnect to restore access.', 'info');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function handleConfigSave(connectorId, updatedConnector) {
    setConnectors(prev => prev.map(c => c.id === connectorId ? { ...c, ...updatedConnector } : c));
  }

  function handleAddAnother(type) {
    setAddAnotherModal(type);
  }

  function openOAuth(type, clientId) {
    let provider;
    if (type.startsWith('google') || type === 'ga4') provider = 'google';
    else if (type === 'zoho_inventory') provider = 'zoho';
    else provider = 'meta';
    const url = `/auth/${provider}/start?client_id=${clientId}`;
    const win = window.open(url, 'oauth', 'width=600,height=700');
    window.addEventListener('message', function handler(e) {
      if (e.data.type === 'oauth_success') {
        api.get(`/connectors/client/${id}`).then(setConnectors);
        window.removeEventListener('message', handler);
        win.close();
      }
      if (e.data.type === 'oauth_error') {
        toast(`OAuth error: ${e.data.error}`, 'error');
        window.removeEventListener('message', handler);
      }
    });
  }

  function openShopifyOAuth(connectorId, shop) {
    const shopDomain = shop.includes('.') ? shop : `${shop}.myshopify.com`;
    const url = `/auth/shopify/start?client_id=${id}&connector_id=${connectorId}&shop=${encodeURIComponent(shopDomain)}`;
    const win = window.open(url, 'shopify_oauth', 'width=600,height=700');
    window.addEventListener('message', function handler(e) {
      if (e.data.type === 'oauth_success') {
        api.get(`/connectors/client/${id}`).then(setConnectors);
        window.removeEventListener('message', handler);
        win?.close();
        toast('Shopify connected');
      }
      if (e.data.type === 'oauth_error') {
        toast(`Shopify error: ${e.data.error}`, 'error');
        window.removeEventListener('message', handler);
      }
    });
  }

  if (loading) return <div style={{ color: '#888', padding: 40 }}>Loading…</div>;
  if (!client) return <div style={{ color: '#c62828', padding: 40 }}>Client not found</div>;

  return (
    <div>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{client.name}</h1>
        <span style={{ fontSize: 12, fontWeight: 600, color: client.active ? '#2e7d32' : '#999' }}>
          {client.active ? 'Active' : 'Inactive'}
        </span>
      </div>

      {tab === 'details' && (
        <form onSubmit={handleSave} style={styles.card}>
          <div style={styles.grid2}>
            <Field label="Client Name">
              <input style={styles.input} value={client.name} onChange={e => setClient(p => ({ ...p, name: e.target.value }))} />
            </Field>
            <Field label="Slug">
              <input style={styles.input} value={client.slug} onChange={e => setClient(p => ({ ...p, slug: e.target.value }))} />
            </Field>
          </div>
          <Field label="Domain (used for SEO data — e.g. falconenamelware.com)">
            <input style={styles.input} value={client.domain || ''} onChange={e => setClient(p => ({ ...p, domain: e.target.value }))} placeholder="example.com" />
          </Field>
          <Field label="Active">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={client.active} onChange={e => setClient(p => ({ ...p, active: e.target.checked }))} />
              Client is active
            </label>
          </Field>
          <Field label="Briefing Field">
            <textarea
              style={{ ...styles.input, minHeight: 100, resize: 'vertical' }}
              value={client.briefing_field || ''}
              onChange={e => setClient(p => ({ ...p, briefing_field: e.target.value }))}
              placeholder="Describe the client in plain English — platforms, channels, stores..."
            />
            <button type="button" onClick={handleParseBriefing} disabled={parsingSuggestions} style={{ ...styles.btnSm, marginTop: 8 }}>
              {parsingSuggestions ? 'Parsing…' : '✦ Parse with Claude'}
            </button>
          </Field>
          {suggestions && (
            <div style={styles.suggestions}>
              <strong style={{ fontSize: 13 }}>Suggested connectors:</strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: 13 }}>
                {(suggestions.suggested_connectors || []).map((s, i) => (
                  <li key={i}><strong>{CONNECTOR_LABELS[s.type] || s.type}</strong>{s.store_label ? ` — ${s.store_label}` : ''}: {s.reason}</li>
                ))}
              </ul>
              {suggestions.notes && <p style={{ margin: '8px 0 0', fontSize: 12, color: '#666' }}>{suggestions.notes}</p>}
            </div>
          )}
          <Field label="Monthly Focus">
            <textarea
              style={{ ...styles.input, minHeight: 80, resize: 'vertical' }}
              value={client.monthly_focus || ''}
              onChange={e => setClient(p => ({ ...p, monthly_focus: e.target.value }))}
              placeholder="What's the focus this month? Used by Claude to write executive summaries."
            />
          </Field>
          <button type="submit" style={styles.btn} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </form>
      )}

      {tab === 'connectors' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {CONNECTOR_GROUPS.map(group => {
            const groupConnectors = connectors.filter(c => group.types.includes(c.connector_type));
            const unconnected = group.types.filter(t => !connectors.find(c => c.connector_type === t));
            return (
              <div key={group.label} style={styles.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{group.label}</h3>
                  {group.oauth && unconnected.length > 0 && (
                    <button onClick={() => {
                      const firstUnconnected = unconnected[0];
                      addConnector(firstUnconnected);
                    }} style={styles.btnSm}>
                      + Connect {group.label}
                    </button>
                  )}
                </div>
                {groupConnectors.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: unconnected.length ? 12 : 0 }}>
                    {groupConnectors.map(conn => (
                      <ConnectorRow
                        key={conn.id}
                        connector={conn}
                        clientId={id}
                        onCheck={handleCheckConnector}
                        onOpenOAuth={openOAuth}
                        onOpenShopifyOAuth={(connectorId) => setShopifyModal({ connectorId })}
                        onEditCredentials={(c) => { setCredModal(c); setCredValues({}); }}
                        onDelete={deleteConnector}
                        onReset={resetConnector}
                        onConfigSave={handleConfigSave}
                        onAddAnother={handleAddAnother}
                      />
                    ))}
                  </div>
                )}
                {unconnected.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {unconnected.map(type => (
                      <div key={type} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#fafafa', borderRadius: 4, border: '1px dashed #ddd' }}>
                        <span style={{ fontSize: 13, color: '#aaa' }}>{CONNECTOR_LABELS[type]}</span>
                        {!group.oauth && (
                          <button onClick={() => addConnector(type)} style={styles.btnSm}>+ Add</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'recipients' && (
        <form onSubmit={handleSave} style={styles.card}>
          <Field label="Monthly Report Recipients (one per line)">
            <textarea
              style={{ ...styles.input, minHeight: 100, fontFamily: 'monospace', fontSize: 12 }}
              value={(client.report_recipients?.monthly || []).join('\n')}
              onChange={e => setClient(p => ({
                ...p,
                report_recipients: { ...p.report_recipients, monthly: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) }
              }))}
            />
          </Field>
          <Field label="Weekly Report Recipients (one per line)">
            <textarea
              style={{ ...styles.input, minHeight: 100, fontFamily: 'monospace', fontSize: 12 }}
              value={(client.report_recipients?.weekly || []).join('\n')}
              onChange={e => setClient(p => ({
                ...p,
                report_recipients: { ...p.report_recipients, weekly: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) }
              }))}
            />
          </Field>
          <button type="submit" style={styles.btn} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </form>
      )}

      {tab === 'schedule' && (
        <form onSubmit={handleSave} style={styles.card}>
          <div style={styles.grid2}>
            <Field label="Weekly Day">
              <select
                style={styles.input}
                value={client.report_schedule?.weekly_day || 'monday'}
                onChange={e => setClient(p => ({ ...p, report_schedule: { ...p.report_schedule, weekly_day: e.target.value } }))}
              >
                {['monday','tuesday','wednesday','thursday','friday'].map(d => (
                  <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
                ))}
              </select>
            </Field>
            <Field label="Weekly Time">
              <input
                type="time" style={styles.input}
                value={client.report_schedule?.weekly_time || '10:00'}
                onChange={e => setClient(p => ({ ...p, report_schedule: { ...p.report_schedule, weekly_time: e.target.value } }))}
              />
            </Field>
          </div>
          <Field label="Monthly Day of Month">
            <input
              type="number" min="1" max="28" style={{ ...styles.input, maxWidth: 120 }}
              value={client.report_schedule?.monthly_day || 1}
              onChange={e => setClient(p => ({ ...p, report_schedule: { ...p.report_schedule, monthly_day: parseInt(e.target.value) } }))}
            />
          </Field>
          <button type="submit" style={styles.btn} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </form>
      )}

      {credModal && (
        <CredentialModal
          connector={credModal}
          values={credValues}
          onChange={setCredValues}
          onSave={() => handleSaveCredentials(credModal.id)}
          onClose={() => { setCredModal(null); setCredValues({}); }}
        />
      )}

      {addAnotherModal && (
        <AddAnotherModal
          type={addAnotherModal}
          typeName={CONNECTOR_LABELS[addAnotherModal] || addAnotherModal}
          onConfirm={(label) => { addConnector(addAnotherModal, label); setAddAnotherModal(null); }}
          onClose={() => setAddAnotherModal(null)}
        />
      )}

      {shopifyModal && (
        <ShopifyModal
          onConfirm={(shop) => { openShopifyOAuth(shopifyModal.connectorId, shop); setShopifyModal(null); }}
          onClose={() => setShopifyModal(null)}
        />
      )}

    </div>
  );
}

const ACCOUNT_LABEL = {
  ga4: 'Property', google_search_console: 'Site', google_ads: 'Customer ID',
  google_merchant_center: 'Merchant ID', meta_ads: 'Ad Account', instagram_insights: 'Instagram',
  zoho_inventory: 'Organisation',
};

const MANUAL_ENTRY_TYPES = ['google_ads', 'google_merchant_center', 'zoho_inventory'];
const MANUAL_PLACEHOLDER = {
  google_ads: 'e.g. 123-456-7890',
  google_merchant_center: 'e.g. 12345678',
  zoho_inventory: 'Organisation ID — find it in your Zoho Inventory URL',
};

function getCountryFlag(label) {
  if (!label) return '';
  const u = label.toUpperCase();
  if (u.includes('UK') || u.includes('GB') || u.includes('BRITAIN')) return '🇬🇧';
  if (u.includes(' US') || u.includes('USA') || u.includes('UNITED STATES') || u.startsWith('US')) return '🇺🇸';
  if (u.includes('EU') || u.includes('EUROPE')) return '🇪🇺';
  if (u.includes('AU') || u.includes('AUSTRALIA')) return '🇦🇺';
  if (u.includes('CA') || u.includes('CANADA')) return '🇨🇦';
  return '';
}

function getLabelStyle(label) {
  const isB2B = label && label.toUpperCase().includes('B2B');
  return {
    fontSize: 11, fontWeight: 700, padding: '2px 8px',
    borderRadius: 12,
    background: isB2B ? '#1565c0' : '#2e7d32',
    color: '#fff',
    whiteSpace: 'nowrap',
  };
}

function ConnectorRow({ connector, clientId, onCheck, onOpenOAuth, onOpenShopifyOAuth, onEditCredentials, onDelete, onReset, onConfigSave, onAddAnother }) {
  const isOAuth = OAUTH_TYPES.includes(connector.connector_type);
  const isShopify = SHOPIFY_TYPES.includes(connector.connector_type);
  const isActive = connector.status === 'active';
  const [editingLabel, setEditingLabel] = React.useState(false);
  const [labelInput, setLabelInput] = React.useState(connector.store_label || '');
  const [accounts, setAccounts] = React.useState(null); // null = not loaded yet
  const [loadingAccounts, setLoadingAccounts] = React.useState(false);
  const [selectedValue, setSelectedValue] = React.useState(connector.config?.value || '');
  const [manualValue, setManualValue] = React.useState(connector.config?.value || '');
  const [diagnosing, setDiagnosing] = React.useState(false);
  const [diagnoseResult, setDiagnoseResult] = React.useState(null);
  const statusColor = { active: '#2e7d32', error: '#c62828', expired: '#e65100', disconnected: '#999' };

  async function handleDiagnose() {
    setDiagnosing(true);
    setDiagnoseResult(null);
    try {
      const result = await api.get(`/connectors/${connector.id}/diagnose`);
      setDiagnoseResult(result);
    } catch (err) {
      setDiagnoseResult({ error: err.message });
    } finally {
      setDiagnosing(false);
    }
  }

  React.useEffect(() => {
    if (isOAuth && isActive) {
      setLoadingAccounts(true);
      api.get(`/connectors/${connector.id}/accounts`)
        .then(data => setAccounts(data))
        .catch(() => setAccounts([]))
        .finally(() => setLoadingAccounts(false));
    }
  }, [connector.id, isOAuth, isActive]);

  async function handleAccountSelect(e) {
    const value = e.target.value;
    const option = (accounts || []).find(a => a.value === value);
    setSelectedValue(value);
    if (value) {
      const config = { value, label: option?.label || value };
      try {
        const updated = await api.put(`/connectors/${connector.id}/config`, config);
        onConfigSave(connector.id, updated);
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  }

  async function handleManualSave() {
    const value = manualValue.trim();
    if (!value) return;
    const config = { value, label: value };
    try {
      const updated = await api.put(`/connectors/${connector.id}/config`, config);
      onConfigSave(connector.id, updated);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <div style={{ padding: '10px 16px', background: '#f9f9f9', borderRadius: 4, border: '1px solid #e8e8e8' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{CONNECTOR_LABELS[connector.connector_type] || connector.connector_type}</span>
          {editingLabel ? (
            <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                autoFocus
                value={labelInput}
                onChange={e => setLabelInput(e.target.value)}
                onKeyDown={async e => {
                  if (e.key === 'Enter') {
                    const updated = await api.put(`/connectors/${connector.id}/config`, { ...(connector.config || {}), label: labelInput });
                    onConfigSave(connector.id, updated);
                    setEditingLabel(false);
                  } else if (e.key === 'Escape') { setEditingLabel(false); }
                }}
                style={{ fontSize: 12, padding: '1px 6px', borderRadius: 4, border: '1px solid #bbb', width: 120 }}
              />
              <button onClick={async () => {
                const updated = await api.put(`/connectors/${connector.id}/config`, { ...(connector.config || {}), label: labelInput });
                onConfigSave(connector.id, updated);
                setEditingLabel(false);
              }} style={{ ...styles.btnSm, padding: '1px 6px' }}>✓</button>
              <button onClick={() => setEditingLabel(false)} style={{ ...styles.btnSm, padding: '1px 6px' }}>✕</button>
            </span>
          ) : (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {connector.store_label
                ? <span style={getLabelStyle(connector.store_label)}>{getCountryFlag(connector.store_label)} {connector.store_label}</span>
                : <span style={{ fontSize: 11, color: '#aaa', cursor: 'pointer' }} onClick={() => setEditingLabel(true)}>+ add label</span>
              }
              {connector.store_label && <button onClick={() => { setLabelInput(connector.store_label); setEditingLabel(true); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#aaa', padding: 0 }} title="Edit label">✎</button>}
            </span>
          )}
          <span style={{ fontSize: 11, fontWeight: 600, color: isActive ? '#2e7d32' : (statusColor[connector.status] || '#888') }}>
            {isActive ? '✓ Connected' : connector.status}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {isActive && <button onClick={() => onCheck(connector.id)} style={styles.btnSm}>Check</button>}
          {connector.status !== 'disconnected' && (
            <button onClick={handleDiagnose} disabled={diagnosing} style={styles.btnSm}>
              {diagnosing ? 'Diagnosing…' : 'Diagnose'}
            </button>
          )}
          {isActive && (
            <button onClick={() => onAddAnother(connector.connector_type)} style={styles.btnSm}>+ Add another</button>
          )}
          {isOAuth ? (
            <button onClick={() => onOpenOAuth(connector.connector_type, clientId)} style={styles.btnSm}>
              {isActive ? 'Reauth' : 'Connect'}
            </button>
          ) : isShopify ? (
            <button onClick={() => onOpenShopifyOAuth(connector.id)} style={styles.btnSm}>
              {isActive ? 'Reconnect' : 'Connect'}
            </button>
          ) : (
            <button onClick={() => onEditCredentials(connector)} style={styles.btnSm}>
              {isActive ? 'Update' : 'Connect'}
            </button>
          )}
          {(isActive || connector.status === 'error') && <button onClick={() => onReset(connector.id)} style={{ ...styles.btnSm, color: '#e65100' }}>Reset</button>}
          <button onClick={() => onDelete(connector.id)} style={{ ...styles.btnSm, color: '#c62828' }}>Remove</button>
        </div>
      </div>
      {diagnoseResult && (
        <div style={{ marginTop: 10, background: '#f5f5f5', borderRadius: 4, padding: '10px 12px', fontSize: 12, fontFamily: 'monospace' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <strong style={{ fontSize: 11, fontFamily: 'sans-serif', textTransform: 'uppercase', letterSpacing: 0.5 }}>Diagnosis</strong>
            <button onClick={() => setDiagnoseResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 14 }}>×</button>
          </div>
          {/* Credentials stored */}
          {diagnoseResult.credentials && (
            <div style={{ color: diagnoseResult.credentials === 'none stored' ? '#c62828' : '#555', marginBottom: 4 }}>
              Credentials: {diagnoseResult.credentials === 'none stored' ? '✗ none stored — use Connect/Update to save credentials' : `✓ stored (${diagnoseResult.credentials})`}
            </div>
          )}
          {/* Generic check result (non-Google connectors) */}
          {diagnoseResult.check && (
            <div style={{ color: diagnoseResult.check.status === 'ok' ? '#2e7d32' : '#c62828', marginBottom: 4 }}>
              {diagnoseResult.check.status === 'ok' ? '✓' : '✗'} {diagnoseResult.check.detail}
            </div>
          )}
          {/* Google token info */}
          {diagnoseResult.token_info && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ color: diagnoseResult.token_info.error ? '#c62828' : '#2e7d32' }}>
                {diagnoseResult.token_info.error
                  ? `✗ Token error: ${JSON.stringify(diagnoseResult.token_info.error)}`
                  : `✓ Account: ${diagnoseResult.token_info.email || 'unknown'} (expires ${diagnoseResult.token_info.expires_in})`}
              </div>
              {diagnoseResult.token_info.note && (
                <div style={{ color: '#e65100' }}>{diagnoseResult.token_info.note}</div>
              )}
            </div>
          )}
          {/* Live API test (GA4) */}
          {diagnoseResult.live_test && (
            <div style={{ color: diagnoseResult.live_test.status === 'ok' ? '#2e7d32' : '#c62828' }}>
              Live test: {diagnoseResult.live_test.status === 'ok'
                ? `✓ ${diagnoseResult.live_test.detail}`
                : `✗ ${diagnoseResult.live_test.http_status ? `HTTP ${diagnoseResult.live_test.http_status} — ` : ''}${JSON.stringify(diagnoseResult.live_test.error)}`}
            </div>
          )}
          {/* Config summary */}
          {diagnoseResult.config && Object.keys(diagnoseResult.config).length > 0 && (
            <div style={{ color: '#888', marginTop: 4 }}>
              Config: {JSON.stringify(diagnoseResult.config)}
            </div>
          )}
          {diagnoseResult.error && <div style={{ color: '#c62828' }}>Error: {diagnoseResult.error}</div>}
        </div>
      )}
      {isOAuth && isActive && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
            {ACCOUNT_LABEL[connector.connector_type] || 'Account'}
          </span>
          {loadingAccounts ? (
            <span style={{ fontSize: 12, color: '#aaa' }}>Loading…</span>
          ) : accounts && accounts.length === 0 && MANUAL_ENTRY_TYPES.includes(connector.connector_type) ? (
            <div style={{ display: 'flex', gap: 8, flex: 1 }}>
              <input
                style={{ ...styles.input, flex: 1, fontSize: 13, padding: '6px 10px' }}
                value={manualValue}
                onChange={e => setManualValue(e.target.value)}
                placeholder={MANUAL_PLACEHOLDER[connector.connector_type] || 'Enter ID'}
                onKeyDown={e => e.key === 'Enter' && handleManualSave()}
              />
              <button onClick={handleManualSave} style={styles.btnSm}>Save</button>
            </div>
          ) : accounts && accounts.length === 0 ? (
            <span style={{ fontSize: 12, color: '#c62828' }}>No accounts found — check OAuth permissions.</span>
          ) : accounts ? (
            <select style={{ ...styles.input, flex: 1, fontSize: 13, padding: '6px 10px' }} value={selectedValue} onChange={handleAccountSelect}>
              <option value="">— Select —</option>
              {accounts.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          ) : null}
        </div>
      )}
    </div>
  );
}

function CredentialModal({ connector, values, onChange, onSave, onClose }) {
  const fields = getCredentialFields(connector.connector_type);
  const isShopify = connector.connector_type === 'shopify' || connector.connector_type === 'shopify_email';
  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <h3 style={{ margin: '0 0 16px', fontSize: 15 }}>{CONNECTOR_LABELS[connector.connector_type]} Credentials</h3>
        {connector.store_label && <p style={{ margin: '0 0 16px', color: '#888', fontSize: 13 }}>{connector.store_label}</p>}
        {isShopify && (
          <p style={{ margin: '-8px 0 16px', fontSize: 12, color: '#666', background: '#f5f5f5', padding: '10px 12px', borderRadius: 4, lineHeight: 1.5 }}>
            Get the access token from your store admin: <strong>Settings → Apps → Develop apps → Create app → Configure scopes → Install → copy Admin API access token</strong> (starts with shpat_)
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {fields.map(f => (
            <Field key={f.key} label={f.label}>
              <input
                type={f.secret ? 'password' : 'text'}
                style={styles.input}
                value={values[f.key] || ''}
                onChange={e => onChange(prev => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={f.placeholder || ''}
              />
            </Field>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button onClick={onSave} style={styles.btn}>Save & Verify</button>
          <button onClick={onClose} style={styles.btnGhost}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function AddAnotherModal({ type, typeName, onConfirm, onClose }) {
  const [label, setLabel] = useState('');
  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Add another {typeName}</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#666' }}>
          Give this account a short label to tell it apart (e.g. "B2C", "B2B", "UK site").
        </p>
        <Field label="Label">
          <input
            autoFocus
            style={styles.input}
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="e.g. B2C, B2B, UK site"
            onKeyDown={e => e.key === 'Enter' && label.trim() && onConfirm(label.trim())}
          />
        </Field>
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button onClick={() => onConfirm(label.trim() || null)} style={styles.btn}>Add</button>
          <button onClick={onClose} style={styles.btnGhost}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ShopifyModal({ onConfirm, onClose }) {
  const [shop, setShop] = useState('');
  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Connect Shopify Store</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#666' }}>
          Enter the store domain. You'll approve access in a Shopify popup.
        </p>
        <Field label="Store Domain">
          <input
            autoFocus style={styles.input} value={shop}
            onChange={e => setShop(e.target.value)}
            placeholder="falcon-eu.myshopify.com"
            onKeyDown={e => e.key === 'Enter' && shop.trim() && onConfirm(shop.trim())}
          />
        </Field>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={() => shop.trim() && onConfirm(shop.trim())} style={styles.btn} disabled={!shop.trim()}>
            Connect with Shopify
          </button>
          <button onClick={onClose} style={styles.btnGhost}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</label>
      {children}
    </div>
  );
}

function getCredentialFields(type) {
  const fieldMap = {
    shopify: [
      { key: 'shop_domain', label: 'Shop Domain', placeholder: 'mystore.myshopify.com' },
      { key: 'access_token', label: 'Access Token', secret: true },
    ],
    shopify_email: [
      { key: 'shop_domain', label: 'Shop Domain', placeholder: 'mystore.myshopify.com' },
      { key: 'access_token', label: 'Access Token', secret: true },
    ],
    woocommerce: [
      { key: 'store_url', label: 'Store URL', placeholder: 'https://mystore.com' },
      { key: 'consumer_key', label: 'Consumer Key' },
      { key: 'consumer_secret', label: 'Consumer Secret', secret: true },
    ],
    klaviyo: [{ key: 'api_key', label: 'API Key', secret: true }],
    brevo: [{ key: 'api_key', label: 'API Key', secret: true }],
    amazon_seller: [
      { key: 'seller_id', label: 'Seller ID' },
      { key: 'marketplace', label: 'Marketplace', placeholder: 'uk / us / eu' },
    ],
    cin7: [
      { key: 'account_id', label: 'Account ID', placeholder: 'Your Cin7 account ID' },
      { key: 'api_key', label: 'Application Key', secret: true, placeholder: 'Cin7 application key' },
    ],
  };
  return fieldMap[type] || [{ key: 'api_key', label: 'API Key', secret: true }];
}

const styles = {
  card: { background: 'white', border: '1px solid #e8e8e8', borderRadius: 6, padding: 24, display: 'flex', flexDirection: 'column', gap: 20 },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  tabs: { display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #e8e8e8', paddingBottom: 0 },
  tab: { padding: '8px 16px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: '#888', borderBottom: '2px solid transparent', marginBottom: -1 },
  tabActive: { color: '#1a1a1a', fontWeight: 600, borderBottomColor: '#1a1a1a' },
  input: { padding: '9px 12px', border: '1px solid #ddd', borderRadius: 4, fontSize: 14, outline: 'none', width: '100%' },
  btn: { background: '#1a1a1a', color: 'white', border: 'none', borderRadius: 4, padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start' },
  btnGhost: { background: 'transparent', color: '#666', border: '1px solid #ddd', borderRadius: 4, padding: '10px 20px', fontSize: 13, cursor: 'pointer' },
  btnSm: { background: '#f0f0f0', color: '#333', border: 'none', borderRadius: 4, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 500 },
  suggestions: { background: '#f0f7ff', border: '1px solid #90caf9', borderRadius: 4, padding: '12px 16px', fontSize: 13 },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { background: 'white', borderRadius: 8, padding: 28, width: '100%', maxWidth: 480, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' },
};
