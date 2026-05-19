import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';

const CONNECTOR_TYPES = [
  'ga4','google_search_console','google_ads','google_merchant_center',
  'meta_ads','instagram_insights','shopify','woocommerce',
  'klaviyo','brevo','shopify_email','amazon_seller','dataforseo',
];

const CONNECTOR_LABELS = {
  ga4: 'Google Analytics 4', google_search_console: 'Google Search Console',
  google_ads: 'Google Ads', google_merchant_center: 'Google Merchant Center',
  meta_ads: 'Meta Ads', instagram_insights: 'Instagram Insights',
  shopify: 'Shopify', woocommerce: 'WooCommerce', klaviyo: 'Klaviyo',
  brevo: 'Brevo', shopify_email: 'Shopify Email',
  amazon_seller: 'Amazon Seller', dataforseo: 'DataForSEO',
};

const OAUTH_TYPES = ['ga4','google_search_console','google_ads','google_merchant_center','meta_ads','instagram_insights'];

export default function ClientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [client, setClient] = useState(null);
  const [connectors, setConnectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [parsingSuggestions, setParsingSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [tab, setTab] = useState('details');
  const [credModal, setCredModal] = useState(null);
  const [credValues, setCredValues] = useState({});

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
      alert('Saved.');
    } catch (err) {
      alert(err.message);
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
      alert(err.message);
    } finally {
      setParsingSuggestions(false);
    }
  }

  async function handleCheckConnector(connectorId) {
    try {
      const result = await api.post(`/connectors/${connectorId}/check`);
      setConnectors(prev => prev.map(c => c.id === connectorId ? { ...c, ...result } : c));
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleSaveCredentials(connectorId) {
    try {
      const result = await api.put(`/connectors/${connectorId}/credentials`, { credentials: credValues });
      setConnectors(prev => prev.map(c => c.id === connectorId ? { ...c, ...result } : c));
      setCredModal(null);
      setCredValues({});
    } catch (err) {
      alert(err.message);
    }
  }

  function openOAuth(type, clientId) {
    const provider = type.startsWith('google') || type === 'ga4' ? 'google' : 'meta';
    const url = `/auth/${provider}/start?client_id=${clientId}`;
    const win = window.open(url, 'oauth', 'width=600,height=700');
    window.addEventListener('message', function handler(e) {
      if (e.data.type === 'oauth_success') {
        api.get(`/connectors/client/${id}`).then(setConnectors);
        window.removeEventListener('message', handler);
        win.close();
      }
      if (e.data.type === 'oauth_error') {
        alert(`OAuth error: ${e.data.error}`);
        window.removeEventListener('message', handler);
      }
    });
  }

  if (loading) return <div style={{ color: '#888', padding: 40 }}>Loading…</div>;
  if (!client) return <div style={{ color: '#c62828', padding: 40 }}>Client not found</div>;

  const tabs = ['details', 'connectors', 'recipients', 'schedule'];

  return (
    <div>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4, cursor: 'pointer' }} onClick={() => navigate('/clients')}>← Clients</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{client.name}</h1>
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: client.active ? '#2e7d32' : '#999' }}>
          {client.active ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div style={styles.tabs}>
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
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
        <div style={styles.card}>
          <h3 style={{ margin: '0 0 20px', fontSize: 15 }}>Active Connectors</h3>
          {connectors.length === 0 ? (
            <p style={{ color: '#888', fontSize: 13 }}>No connectors configured yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {connectors.map(conn => (
                <ConnectorRow
                  key={conn.id}
                  connector={conn}
                  clientId={id}
                  onCheck={handleCheckConnector}
                  onOpenOAuth={openOAuth}
                  onEditCredentials={(c) => { setCredModal(c); setCredValues({}); }}
                />
              ))}
            </div>
          )}
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
    </div>
  );
}

function ConnectorRow({ connector, clientId, onCheck, onOpenOAuth, onEditCredentials }) {
  const isOAuth = OAUTH_TYPES.includes(connector.connector_type);
  const statusColor = { active: '#2e7d32', error: '#c62828', expired: '#e65100', disconnected: '#999' };

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', background: '#f9f9f9', borderRadius: 4, border: '1px solid #e8e8e8' }}>
      <div>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{CONNECTOR_LABELS[connector.connector_type] || connector.connector_type}</span>
        {connector.store_label && <span style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>({connector.store_label})</span>}
        <span style={{ marginLeft: 12, fontSize: 11, fontWeight: 600, color: statusColor[connector.status] || '#888' }}>
          {connector.status}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {connector.status !== 'disconnected' && (
          <button onClick={() => onCheck(connector.id)} style={styles.btnSm}>Check</button>
        )}
        {isOAuth ? (
          <button onClick={() => onOpenOAuth(connector.connector_type, clientId)} style={styles.btnSm}>
            {connector.status === 'active' ? 'Reauth' : 'Connect'}
          </button>
        ) : (
          <button onClick={() => onEditCredentials(connector)} style={styles.btnSm}>
            {connector.status === 'active' ? 'Update' : 'Connect'}
          </button>
        )}
      </div>
    </div>
  );
}

function CredentialModal({ connector, values, onChange, onSave, onClose }) {
  const fields = getCredentialFields(connector.connector_type);
  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <h3 style={{ margin: '0 0 16px', fontSize: 15 }}>{CONNECTOR_LABELS[connector.connector_type]} Credentials</h3>
        {connector.store_label && <p style={{ margin: '0 0 16px', color: '#888', fontSize: 13 }}>{connector.store_label}</p>}
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
    dataforseo: [
      { key: 'login', label: 'Login' },
      { key: 'password', label: 'Password', secret: true },
    ],
    amazon_seller: [
      { key: 'seller_id', label: 'Seller ID' },
      { key: 'marketplace', label: 'Marketplace', placeholder: 'uk / us / eu' },
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
