import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import AIDraftModal from '../components/AIDraftModal';
import ReportTemplateChat from '../components/ReportTemplateChat';
import FormsTab from '../components/FormsTab';
import ReportPreviewModal from '../components/ReportPreviewModal';
import ClientBrandPage from './ClientBrandPage';

const CONNECTOR_TYPES = [
  'ga4','google_search_console','google_ads','google_merchant_center',
  'meta_ads','instagram_insights','shopify','woocommerce',
  'klaviyo','brevo','shopify_email','amazon_seller',
  'zoho_inventory','cin7','october_forms','linkedin_organic',
];

const CONNECTOR_LABELS = {
  ga4: 'Google Analytics 4', google_search_console: 'Google Search Console',
  google_ads: 'Google Ads', google_merchant_center: 'Google Merchant Center',
  meta_ads: 'Meta Ads', instagram_insights: 'Instagram Insights',
  shopify: 'Shopify', woocommerce: 'WooCommerce', klaviyo: 'Klaviyo',
  brevo: 'Brevo', shopify_email: 'Shopify Email',
  amazon_seller: 'Amazon Seller',
  zoho_inventory: 'Zoho Inventory', cin7: 'Cin7',
  october_forms: 'October Forms',
  linkedin_organic: 'LinkedIn (organic posts)',
};

const CONNECTOR_GROUPS = [
  { label: 'Google', types: ['ga4','google_search_console','google_ads','google_merchant_center'], oauth: 'google' },
  { label: 'Meta', types: ['meta_ads','instagram_insights'], oauth: 'meta' },
  { label: 'LinkedIn', types: ['linkedin_organic'], oauth: 'linkedin' },
  { label: 'E-commerce', types: ['shopify','woocommerce','amazon_seller'] },
  { label: 'Email Marketing', types: ['shopify_email','klaviyo','brevo'] },
  { label: 'Inventory', types: ['zoho_inventory','cin7'] },
  { label: 'Forms', types: ['october_forms'] },
];

const OAUTH_TYPES = ['ga4','google_search_console','google_ads','google_merchant_center','meta_ads','instagram_insights','zoho_inventory','linkedin_organic'];
const SHOPIFY_TYPES = ['shopify','shopify_email'];

export default function ClientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [client, setClient] = useState(null);
  const [connectors, setConnectors] = useState([]);
  const [reports, setReports] = useState([]);
  const [previewType, setPreviewType] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'details';
  function setTab(t) { setSearchParams({ tab: t }, { replace: true }); }
  const [templateChatType, setTemplateChatType] = useState(null);  // 'weekly' | 'monthly' | null
  const [templateSummary, setTemplateSummary] = useState({ weekly: null, monthly: null });

  useEffect(() => {
    if (!id || tab !== 'reports') return;
    Promise.all(['weekly', 'monthly'].map(rt =>
      api.get(`/clients/${id}/report-template/${rt}`).then(r => [rt, r.template]).catch(() => [rt, null])
    )).then(pairs => setTemplateSummary(Object.fromEntries(pairs)));
  }, [id, tab, templateChatType]);

  useEffect(() => {
    api.get(`/reports?client_id=${id}`).then(setReports).catch(() => {});
  }, [id]);

  async function handleGenerateReport(type) {
    try {
      await api.post('/reports/trigger', { client_id: id, report_type: type });
      toast(`${type === 'weekly' ? 'Weekly' : 'Monthly'} report generation started.`, 'success');
      setTimeout(() => { api.get(`/reports?client_id=${id}`).then(setReports).catch(() => {}); }, 4000);
    } catch (err) { toast(err.message, 'error'); }
  }
  async function handleDeleteReport(reportId) {
    if (!window.confirm('Delete this report? This cannot be undone.')) return;
    try {
      await api.delete(`/reports/${reportId}`);
      setReports(prev => prev.filter(r => r.id !== reportId));
    } catch (err) { toast(err.message, 'error'); }
  }
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

  // Replaces the old "Parse with Claude" connector-suggestion flow.
  // Reads the client's domain, asks Claude (with web search) to draft an
  // "About this client" paragraph, then shows it in a modal for review.
  const [briefingDraft, setBriefingDraft] = useState(null);
  const [focusDraft, setFocusDraft] = useState(null);
  const [loadingBriefing, setLoadingBriefing] = useState(false);
  const [loadingFocus, setLoadingFocus] = useState(false);

  async function handleCompleteBriefing() {
    if (!client?.domain) { toast('Set the client domain first — Claude needs something to research.', 'error'); return; }
    setLoadingBriefing(true);
    try {
      const { briefing } = await api.post(`/clients/${id}/complete-briefing`);
      setBriefingDraft(briefing || '');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoadingBriefing(false);
    }
  }
  async function handleAcceptBriefing(text) {
    try {
      const updated = await api.put(`/clients/${id}`, { ...client, briefing_field: text });
      setClient(updated);
      toast('About this client saved.', 'success');
      setBriefingDraft(null);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function handleSuggestFocus() {
    setLoadingFocus(true);
    try {
      const { focus } = await api.post(`/clients/${id}/suggest-monthly-focus`);
      setFocusDraft(focus || '');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoadingFocus(false);
    }
  }
  async function handleAcceptFocus(text) {
    try {
      const updated = await api.put(`/clients/${id}`, { ...client, monthly_focus: text });
      setClient(updated);
      toast('Monthly focus saved.', 'success');
      setFocusDraft(null);
    } catch (err) { toast(err.message, 'error'); }
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
    else if (type === 'amazon_seller') provider = 'amazon';
    else if (type === 'linkedin_organic') provider = 'linkedin';
    else provider = 'meta';
    // Open the popup synchronously so the browser still treats it as
    // a user gesture (post-await opens get blocked). Then fetch the
    // signed OAuth URL via the authed API and navigate the popup to
    // it. We used to window.open the legacy /<provider>/start endpoint
    // directly, but that's a top-level navigation with no
    // Authorization header so the auth middleware 401s.
    const win = window.open('about:blank', 'oauth', 'width=600,height=700');
    if (!win) {
      toast('Popup blocked — allow popups for this site and try again.', 'error');
      return;
    }
    api.get(`/auth/oauth/start-url?provider=${provider}&client_id=${clientId}`)
      .then(r => { win.location.href = r.url; })
      .catch(err => { win.close(); toast(err.message, 'error'); });
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

  async function openShopifyOAuth(connectorId, shop, shopifyClientId, shopifyClientSecret) {
    if (shopifyClientId && shopifyClientSecret) {
      try {
        await api.put(`/connectors/${connectorId}/shopify-app`, {
          shopify_client_id: shopifyClientId,
          shopify_client_secret: shopifyClientSecret,
        });
      } catch (err) {
        toast(`Could not save app credentials: ${err.message}`, 'error');
        return;
      }
    }
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

  // Pick the suite scope from the active tab so each tab takes its
  // own section accent. Forms gets the Forms purple; Reports gets the
  // Reports blue; everything else (Brief / Brand / Connectors) is the
  // Setup teal.
  const scopeClass = tab === 'forms' ? 'suite-forms' : tab === 'reports' ? 'suite-reports' : 'suite-setup';

  return (
    <div className={scopeClass}>
      <div className="row between center" style={{ marginBottom: 'var(--s6)' }}>
        <h1 className="h2">{client.name}</h1>
        <span className={client.active ? 'text-positive' : 'text-subtle'} style={{ fontSize: 12 }}>
          {client.active ? 'Active' : 'Inactive'}
        </span>
      </div>

      {['details', 'brand', 'connectors'].includes(tab) && (
        <div>
          <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700, marginBottom: 6 }}>Setup</div>
          <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e8e8e8', marginBottom: 18 }}>
            {[['details', 'Brief'], ['brand', 'Brand'], ['connectors', 'Connectors']].map(([key, label]) => (
              <button key={key} onClick={() => setSearchParams({ tab: key })} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '10px 20px', fontSize: 14,
                fontWeight: tab === key ? 700 : 400, color: tab === key ? '#1a1a1a' : '#888',
                borderBottom: tab === key ? '2px solid #1a1a1a' : '2px solid transparent', marginBottom: -2,
              }}>{label}</button>
            ))}
          </div>
        </div>
      )}

      {tab === 'brand' && (
        <ClientBrandPage />
      )}

      {tab === 'details' && (
        <form onSubmit={handleSave} className="card">
          <div className="grid grid-2">
            <Field label="Client Name">
              <input className="input" value={client.name} onChange={e => setClient(p => ({ ...p, name: e.target.value }))} />
            </Field>
            <Field label="Slug">
              <input className="input" value={client.slug} onChange={e => setClient(p => ({ ...p, slug: e.target.value }))} />
            </Field>
          </div>
          <Field label="Domain (used for SEO data — e.g. falconenamelware.com)">
            <input className="input" value={client.domain || ''} onChange={e => setClient(p => ({ ...p, domain: e.target.value }))} placeholder="example.com" />
          </Field>
          <Field label="Active">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={client.active} onChange={e => setClient(p => ({ ...p, active: e.target.checked }))} />
              Client is active
            </label>
          </Field>
          <Field label="About this client">
            <p className="body-xs text-muted">One paragraph describing what the business sells, to whom, where they operate. Used by Claude to give the AI Data Analyst context and to set the tone of report copy. Set once — update only if the business changes.</p>
            <textarea
              className="input" style={{ minHeight: 110, resize: 'vertical' }}
              value={client.briefing_field || ''}
              onChange={e => setClient(p => ({ ...p, briefing_field: e.target.value }))}
              placeholder="e.g. Premium kitchenware brand selling enamel cookware in the UK, US and EU; D2C via Shopify and trade via separate B2B Shopify stores; also sells on Amazon UK/US/EU."
            />
            <button type="button" onClick={handleCompleteBriefing} disabled={loadingBriefing || !client.domain} className="btn btn-secondary btn-sm" style={{ marginTop: 8 }}>
              {loadingBriefing ? 'Researching…' : '✦ Complete with Claude'}
            </button>
            {!client.domain && <span style={{ marginLeft: 8, fontSize: 11, color: '#888' }}>Set the domain above first</span>}
          </Field>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
        </form>
      )}

      {tab === 'connectors' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {CONNECTOR_GROUPS.map(group => {
            const groupConnectors = connectors.filter(c => group.types.includes(c.connector_type));
            const unconnected = group.types.filter(t => !connectors.find(c => c.connector_type === t));
            return (
              <div key={group.label} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{group.label}</h3>
                  {group.oauth && unconnected.length > 0 && (
                    <button onClick={() => {
                      const firstUnconnected = unconnected[0];
                      addConnector(firstUnconnected);
                    }} className="btn btn-secondary btn-sm">
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
                        onConnectorUpdated={(connectorId, patch) =>
                          setConnectors(prev => prev.map(c => c.id === connectorId ? { ...c, ...patch } : c))
                        }
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
                          <button onClick={() => addConnector(type)} className="btn btn-secondary btn-sm">+ Add</button>
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

      {tab === 'forms' && (
        <FormsTab clientId={id} connectors={connectors} />
      )}

      {tab === 'reports' && (
        <>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>Generated Reports</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setPreviewType('weekly')} className="btn btn-secondary btn-sm">Preview weekly</button>
              <button type="button" onClick={() => setPreviewType('monthly')} className="btn btn-secondary btn-sm">Preview monthly</button>
              <button type="button" onClick={() => handleGenerateReport('weekly')} className="btn btn-secondary btn-sm">Generate weekly</button>
              <button type="button" onClick={() => handleGenerateReport('monthly')} className="btn btn-secondary btn-sm">Generate monthly</button>
            </div>
          </div>
          {reports.length === 0 ? (
            <p style={{ fontSize: 13, color: '#888', margin: '12px 0 0' }}>No reports generated yet — use the buttons above, or wait for the schedule.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 12 }}>
              <thead>
                <tr>
                  {['Type', 'Period start', 'Status', 'Generated', ''].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '4px 12px 8px 0', fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reports.map(r => (
                  <React.Fragment key={r.id}>
                    <tr>
                      <td style={{ padding: '7px 12px 7px 0', borderTop: '1px solid #f5f5f5', textTransform: 'capitalize' }}>{r.report_type}</td>
                      <td style={{ padding: '7px 12px 7px 0', borderTop: '1px solid #f5f5f5' }}>{r.period_start ? new Date(r.period_start).toLocaleDateString('en-GB') : '—'}</td>
                      <td style={{ padding: '7px 12px 7px 0', borderTop: '1px solid #f5f5f5' }}>
                        <span style={{ color: r.status === 'sent' || r.status === 'generated' ? '#2e7d32' : r.status === 'failed' ? '#c62828' : '#888' }}>{r.status}</span>
                      </td>
                      <td style={{ padding: '7px 12px 7px 0', borderTop: '1px solid #f5f5f5', color: '#888' }}>{r.generated_at ? new Date(r.generated_at).toLocaleDateString('en-GB') : '—'}</td>
                      <td style={{ padding: '7px 0', borderTop: '1px solid #f5f5f5', textAlign: 'right' }}>
                        <button type="button" onClick={() => handleDeleteReport(r.id)} className="btn btn-secondary btn-sm" style={{ color: '#c62828' }}>Delete</button>
                      </td>
                    </tr>
                    {r.status === 'failed' && r.error_log && (
                      <tr>
                        <td colSpan={5} style={{ padding: '0 12px 8px 0', color: '#c62828', fontSize: 12, fontFamily: 'monospace', lineHeight: 1.5 }}>
                          ⚠ {r.error_log}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <form onSubmit={handleSave} className="card" style={{ marginTop: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Schedule</div>
          <div className="grid grid-2">
            <Field label="Weekly Day">
              <select
                className="input"
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
                type="time" className="input"
                value={client.report_schedule?.weekly_time || '10:00'}
                onChange={e => setClient(p => ({ ...p, report_schedule: { ...p.report_schedule, weekly_time: e.target.value } }))}
              />
            </Field>
          </div>
          <Field label="Monthly Day of Month">
            <input
              type="number" min="1" max="28" className="input" style={{ maxWidth: 120 }}
              value={client.report_schedule?.monthly_day || 1}
              onChange={e => setClient(p => ({ ...p, report_schedule: { ...p.report_schedule, monthly_day: parseInt(e.target.value) } }))}
            />
          </Field>

          <div style={{ borderTop: '1px solid #eee', margin: '8px 0 0', paddingTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>Recipients</div>
            <Field label="Monthly Report Recipients (one per line)">
              <textarea
                className="input" style={{ minHeight: 90, fontFamily: 'monospace', fontSize: 12 }}
                value={(client.report_recipients?.monthly || []).join('\n')}
                onChange={e => setClient(p => ({
                  ...p,
                  report_recipients: { ...p.report_recipients, monthly: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) }
                }))}
              />
            </Field>
            <Field label="Weekly Report Recipients (one per line)">
              <textarea
                className="input" style={{ minHeight: 90, fontFamily: 'monospace', fontSize: 12 }}
                value={(client.report_recipients?.weekly || []).join('\n')}
                onChange={e => setClient(p => ({
                  ...p,
                  report_recipients: { ...p.report_recipients, weekly: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) }
                }))}
              />
            </Field>
          </div>

          <div style={{ borderTop: '1px solid #eee', margin: '8px 0 0', paddingTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>This month's focus</div>
            <p className="body-xs text-muted">Sets the priority for the next report. Drives Claude's executive summary and recommendations. Update before each monthly report runs.</p>
            <textarea
              className="input" style={{ minHeight: 80, resize: 'vertical', marginTop: 8 }}
              value={client.monthly_focus || ''}
              onChange={e => setClient(p => ({ ...p, monthly_focus: e.target.value }))}
              placeholder="e.g. Investigate the US Shopify refund spike; quantify the impact of the new B2B trade pricing on EU revenue."
            />
            <button type="button" onClick={handleSuggestFocus} disabled={loadingFocus} className="btn btn-secondary btn-sm" style={{ marginTop: 8 }}>
              {loadingFocus ? 'Drafting…' : '✦ Suggest with Claude'}
            </button>
          </div>

          <div style={{ borderTop: '1px solid #eee', margin: '8px 0 0', paddingTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>Report Templates</div>
            <p className="body-xs text-muted">
              Each report has a template — an ordered set of sections, layouts and per-section prompts. Design it conversationally with Claude
              ("B2C summary across all stores, then B2B, then Google Ads ROAS") and lock it once it looks right. Locked templates drive every
              report run for this client.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
              {['weekly', 'monthly'].map(rt => {
                const tpl = templateSummary[rt];
                const sections = tpl?.sections || [];
                return (
                  <div key={rt} style={{ flex: 1, minWidth: 280, padding: 12, border: '2px solid var(--accent)', borderRadius: 14, background: '#fafafa' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, textTransform: 'capitalize' }}>{rt} template</div>
                      <button type="button" onClick={() => setTemplateChatType(rt)} className="btn btn-secondary btn-sm" style={{ padding: '4px 10px' }}>
                        ✦ {tpl ? 'Edit with Claude' : 'Design with Claude'}
                      </button>
                    </div>
                    {sections.length ? (
                      <ol style={{ fontSize: 12, color: '#444', paddingLeft: 18, margin: '4px 0 0' }}>
                        {sections.map(s => (
                          <li key={s.id} style={{ marginBottom: 2 }}>
                            <strong>{s.title}</strong> <span style={{ color: '#888', fontFamily: 'monospace', fontSize: 10 }}>{s.type}</span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <div style={{ fontSize: 12, color: '#888', fontStyle: 'italic' }}>Not set up yet — using auto-generated default from connectors.</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </form>
        </>
      )}

      {briefingDraft !== null && (
        <AIDraftModal
          title="About this client — Claude's draft"
          hint="Claude has researched the client's domain and drafted this paragraph. Edit it before saving."
          draft={briefingDraft}
          onAccept={handleAcceptBriefing}
          onClose={() => setBriefingDraft(null)}
        />
      )}
      {focusDraft !== null && (
        <AIDraftModal
          title="This month's focus — Claude's suggestion"
          hint="Drafted from the previous focus, the AI Data Analyst's open investigations, and the latest connector status. Edit to suit, then accept."
          draft={focusDraft}
          onAccept={handleAcceptFocus}
          onClose={() => setFocusDraft(null)}
        />
      )}

      {templateChatType && (
        <ReportTemplateChat
          clientId={id}
          clientName={client?.name || ''}
          reportType={templateChatType}
          onClose={() => setTemplateChatType(null)}
          onSaved={() => setTemplateChatType(null)}
        />
      )}

      {previewType && (
        <ReportPreviewModal
          clientId={id}
          clientName={client?.name || ''}
          reportType={previewType}
          onSwitchType={t => setPreviewType(t)}
          onClose={() => setPreviewType(null)}
        />
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
          onConfirm={({ shop, clientId, clientSecret }) => {
            openShopifyOAuth(shopifyModal.connectorId, shop, clientId, clientSecret);
            setShopifyModal(null);
          }}
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
  linkedin_organic: 'LinkedIn account',
};

const MANUAL_ENTRY_TYPES = ['google_ads', 'google_merchant_center', 'zoho_inventory'];
const MANUAL_PLACEHOLDER = {
  google_ads: 'e.g. 123-456-7890',
  google_merchant_center: 'e.g. 12345678',
  zoho_inventory: 'Organisation ID — find it in your Zoho Inventory URL',
};

// 2-letter country codes must match as standalone words — substring matching
// produced false positives like "NO" inside "ANOTHER" → Norway flag.
// Longer keywords (e.g. NORWAY, AUSTRALIA) keep substring matching since they
// can't collide with other words.
const COUNTRY_CODES = {
  UK: '🇬🇧', GB: '🇬🇧', US: '🇺🇸', USA: '🇺🇸', EU: '🇪🇺',
  AU: '🇦🇺', CA: '🇨🇦', DE: '🇩🇪', FR: '🇫🇷', IT: '🇮🇹',
  ES: '🇪🇸', NL: '🇳🇱', SE: '🇸🇪', PL: '🇵🇱', BE: '🇧🇪',
  IE: '🇮🇪', JP: '🇯🇵', MX: '🇲🇽', BR: '🇧🇷', IN: '🇮🇳',
  SG: '🇸🇬', AE: '🇦🇪', UAE: '🇦🇪', NZ: '🇳🇿', ZA: '🇿🇦',
  NO: '🇳🇴', DK: '🇩🇰', FI: '🇫🇮', CH: '🇨🇭', AT: '🇦🇹', PT: '🇵🇹',
};
const COUNTRY_KEYWORDS = [
  ['BRITAIN', '🇬🇧'],
  ['UNITED STATES', '🇺🇸'],
  ['EUROPE', '🇪🇺'],
  ['AUSTRALIA', '🇦🇺'],
  ['CANADA', '🇨🇦'],
  ['GERMANY', '🇩🇪'], ['DEUTSCH', '🇩🇪'],
  ['FRANCE', '🇫🇷'], ['FRENCH', '🇫🇷'],
  ['ITALY', '🇮🇹'], ['ITALIAN', '🇮🇹'],
  ['SPAIN', '🇪🇸'], ['SPANISH', '🇪🇸'],
  ['NETHERLAND', '🇳🇱'], ['DUTCH', '🇳🇱'],
  ['SWEDEN', '🇸🇪'], ['SWEDISH', '🇸🇪'],
  ['POLAND', '🇵🇱'], ['POLISH', '🇵🇱'],
  ['BELGIUM', '🇧🇪'], ['BELGIAN', '🇧🇪'],
  ['IRELAND', '🇮🇪'], ['IRISH', '🇮🇪'],
  ['JAPAN', '🇯🇵'], ['JAPANESE', '🇯🇵'],
  ['MEXICO', '🇲🇽'], ['MEXICAN', '🇲🇽'],
  ['BRAZIL', '🇧🇷'], ['BRAZILIAN', '🇧🇷'],
  ['INDIA', '🇮🇳'], ['INDIAN', '🇮🇳'],
  ['SINGAPORE', '🇸🇬'],
  ['EMIRATES', '🇦🇪'],
  ['NEW ZEALAND', '🇳🇿'],
  ['SOUTH AFRICA', '🇿🇦'],
  ['NORWAY', '🇳🇴'], ['NORWEGIAN', '🇳🇴'],
  ['DENMARK', '🇩🇰'], ['DANISH', '🇩🇰'],
  ['FINLAND', '🇫🇮'], ['FINNISH', '🇫🇮'],
  ['SWITZERLAND', '🇨🇭'], ['SWISS', '🇨🇭'],
  ['AUSTRIA', '🇦🇹'], ['AUSTRIAN', '🇦🇹'],
  ['PORTUGAL', '🇵🇹'], ['PORTUGUESE', '🇵🇹'],
];

function getCountryFlag(label) {
  if (!label) return '';
  const u = label.toUpperCase();
  const tokens = u.split(/[^A-Z]+/).filter(Boolean);
  for (const t of tokens) {
    if (COUNTRY_CODES[t]) return COUNTRY_CODES[t];
  }
  for (const [keyword, flag] of COUNTRY_KEYWORDS) {
    if (u.includes(keyword)) return flag;
  }
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

// Per-client Brevo scoping — select a contact list, and optionally record
// an automation ID/name (Brevo's API can't enumerate automations).
function BrevoConfig({ connector, onConfigSave }) {
  const toast = useToast();
  const cfg = connector.config || {};
  const [lists, setLists] = React.useState(null);
  const [listsError, setListsError] = React.useState(null);
  const [listId, setListId] = React.useState(cfg.list_id ? String(cfg.list_id) : '');
  const [automation, setAutomation] = React.useState(cfg.automation || '');
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    api.get(`/connectors/${connector.id}/accounts`)
      .then(data => {
        if (data && data.fetchError) { setListsError(data.fetchError); setLists([]); }
        else setLists(Array.isArray(data) ? data : []);
      })
      .catch(err => { setListsError(err.message || 'Failed to load lists'); setLists([]); });
  }, [connector.id]);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const selected = (lists || []).find(l => String(l.value) === String(listId));
      const config = {
        ...(connector.config || {}),
        list_id: listId || null,
        list_name: selected ? selected.label : null,
        automation: automation.trim() || null,
      };
      const updated = await api.put(`/connectors/${connector.id}/config`, config);
      onConfigSave(connector.id, updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>List</span>
      {lists === null ? (
        <span style={{ fontSize: 12, color: '#aaa' }}>Loading…</span>
      ) : (
        <select value={listId} onChange={e => setListId(e.target.value)}
          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, border: '1px solid #bbb' }}>
          <option value="">All lists</option>
          {lists.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      )}
      <span style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>Automation</span>
      <input value={automation} onChange={e => setAutomation(e.target.value)}
        placeholder="All automations (optional ID/name)"
        style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, border: '1px solid #bbb', width: 220 }} />
      <button type="button" onClick={save} disabled={saving} className="btn btn-secondary btn-sm">{saving ? 'Saving…' : 'Save'}</button>
      {saved && <span style={{ fontSize: 12, color: '#2e7d32', fontWeight: 600 }}>✓ Saved</span>}
      {listsError && <span style={{ fontSize: 11, color: '#c62828' }}>Lists: {listsError}</span>}
    </div>
  );
}

// Per-client October Forms scoping — pick which form on the WP install
// belongs to this client. The API key authenticates against the whole
// site; this picker just records the form_id (stored in connector.config.value).
function OctoberFormsConfig({ connector, onConfigSave }) {
  const toast = useToast();
  const cfg = connector.config || {};
  const [forms, setForms] = React.useState(null);
  const [formsError, setFormsError] = React.useState(null);
  const [formId, setFormId] = React.useState(cfg.value ? String(cfg.value) : '');
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    // Fetch credentials from backend, then list forms directly from the browser
    // (server IP is blocked by the WordPress host, so we bypass the proxy).
    api.get(`/october-forms/connectors/${connector.id}/credentials`)
      .then(creds => {
        const base = creds.site_url.trim().replace(/\/$/, '');
        const url = `${base}/wp-json/ocf/v1/api/forms?api_key=${encodeURIComponent(creds.api_key)}`;
        return fetch(url, { headers: { Accept: 'application/json' } });
      })
      .then(res => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json();
      })
      .then(data => {
        const list = Array.isArray(data) ? data : (data?.forms || data?.data || []);
        setForms(list.map(f => ({ value: String(f.id), label: f.title || `Form ${f.id}`, status: f.status })));
      })
      .catch(err => { setFormsError(err.message || 'Failed to load forms'); setForms([]); });
  }, [connector.id]);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const selected = (forms || []).find(f => String(f.value) === String(formId));
      const config = {
        ...(connector.config || {}),
        value: formId || null,
        label: selected ? selected.label : null,
      };
      const updated = await api.put(`/connectors/${connector.id}/config`, config);
      onConfigSave(connector.id, updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>Form</span>
      {forms === null ? (
        <span style={{ fontSize: 12, color: '#aaa' }}>Loading…</span>
      ) : (
        <select value={formId} onChange={e => setFormId(e.target.value)}
          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 4, border: '1px solid #bbb', minWidth: 240 }}>
          <option value="">— Select a form —</option>
          {forms.map(f => <option key={f.value} value={f.value}>{f.label}{f.status && f.status !== 'publish' ? ` (${f.status})` : ''}</option>)}
        </select>
      )}
      <button type="button" onClick={save} disabled={saving || !formId} className="btn btn-secondary btn-sm">{saving ? 'Saving…' : 'Save'}</button>
      {saved && <span style={{ fontSize: 12, color: '#2e7d32', fontWeight: 600 }}>✓ Saved</span>}
      {formsError && <span style={{ fontSize: 11, color: '#c62828' }}>Forms: {formsError}</span>}
    </div>
  );
}

function ConnectorRow({ connector, clientId, onCheck, onOpenOAuth, onOpenShopifyOAuth, onEditCredentials, onDelete, onReset, onConfigSave, onAddAnother, onConnectorUpdated }) {
  const isOAuth = OAUTH_TYPES.includes(connector.connector_type);
  const isShopify = SHOPIFY_TYPES.includes(connector.connector_type);
  const isActive = connector.status === 'active';
  const [editingLabel, setEditingLabel] = React.useState(false);
  const [labelInput, setLabelInput] = React.useState(connector.store_label || '');
  const [accounts, setAccounts] = React.useState(null); // null = not loaded yet
  const [accountsError, setAccountsError] = React.useState(null);
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
      // The diagnose endpoint also writes the latest status to the DB.
      // Push it up so the badge next to the connector title (which reads
      // from the parent's connectors array) reflects the fresh state
      // without requiring a page reload.
      if (result?.status && onConnectorUpdated) {
        onConnectorUpdated(connector.id, {
          status: result.status,
          last_checked: result.last_checked,
          error_message: result.check?.status === 'error' ? result.check.detail : null,
        });
      }
    } catch (err) {
      setDiagnoseResult({ error: err.message });
    } finally {
      setDiagnosing(false);
    }
  }

  React.useEffect(() => {
    if (isOAuth && isActive) {
      setLoadingAccounts(true);
      setAccountsError(null);
      api.get(`/connectors/${connector.id}/accounts`)
        .then(data => {
          if (data && data.fetchError) { setAccountsError(data.fetchError); setAccounts([]); }
          else setAccounts(data);
        })
        .catch(err => { setAccountsError(err.message || 'Failed to load accounts'); setAccounts([]); })
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
    <div style={{ padding: '10px 16px', background: '#f9f9f9', borderRadius: 4, border: '2px solid var(--accent)' }}>
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
              }} className="btn btn-secondary btn-sm" style={{ padding: '1px 6px' }}>✓</button>
              <button onClick={() => setEditingLabel(false)} className="btn btn-secondary btn-sm" style={{ padding: '1px 6px' }}>✕</button>
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
          {isActive && <button onClick={() => onCheck(connector.id)} className="btn btn-secondary btn-sm">Check</button>}
          {connector.status !== 'disconnected' && (
            <button onClick={handleDiagnose} disabled={diagnosing} className="btn btn-secondary btn-sm">
              {diagnosing ? 'Diagnosing…' : 'Diagnose'}
            </button>
          )}
          {isActive && (
            <button onClick={() => onAddAnother(connector.connector_type)} className="btn btn-secondary btn-sm">+ Add another</button>
          )}
          {isOAuth ? (
            <button onClick={() => onOpenOAuth(connector.connector_type, clientId)} className="btn btn-secondary btn-sm">
              {isActive ? 'Reauth' : 'Connect'}
            </button>
          ) : isShopify ? (
            <button onClick={() => onOpenShopifyOAuth(connector.id)} className="btn btn-secondary btn-sm">
              {isActive ? 'Reconnect' : 'Connect'}
            </button>
          ) : (
            <button onClick={() => onEditCredentials(connector)} className="btn btn-secondary btn-sm">
              {isActive ? 'Update' : 'Connect'}
            </button>
          )}
          {(isActive || connector.status === 'error') && <button onClick={() => onReset(connector.id)} className="btn btn-secondary btn-sm" style={{ color: '#e65100' }}>Reset</button>}
          <button onClick={() => onDelete(connector.id)} className="btn btn-secondary btn-sm" style={{ color: '#c62828' }}>Remove</button>
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
                <div style={{ color: diagnoseResult.token_info.note_kind === 'error' ? '#c62828' : '#888', fontSize: 11, marginTop: 4 }}>
                  {diagnoseResult.token_info.note}
                </div>
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
          {/* Access report — scopes / permissions and what it can't see */}
          {diagnoseResult.access && (
            <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid #e3e3e3' }}>
              {diagnoseResult.access.error ? (
                <div style={{ color: '#c62828' }}>Access check failed: {diagnoseResult.access.error}</div>
              ) : (
                <>
                  {diagnoseResult.access.account && (
                    <div style={{ color: '#555' }}>Account: {diagnoseResult.access.account}</div>
                  )}
                  {diagnoseResult.access.granted?.length > 0 && (
                    <div style={{ color: '#2e7d32' }}>✓ Can access: {diagnoseResult.access.granted.join(', ')}</div>
                  )}
                  {diagnoseResult.access.missing?.length > 0 && (
                    <div style={{ color: '#c62828', marginTop: 2 }}>✗ Cannot access: {diagnoseResult.access.missing.join(', ')}</div>
                  )}
                  {(diagnoseResult.access.limitations || []).map((l, i) => (
                    <div key={i} style={{ color: '#e65100', marginTop: 3, fontFamily: 'sans-serif', lineHeight: 1.4 }}>⚠ {l}</div>
                  ))}
                </>
              )}
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
      {connector.connector_type === 'brevo' && isActive && (
        <BrevoConfig connector={connector} onConfigSave={onConfigSave} />
      )}
      {connector.connector_type === 'october_forms' && (isActive || connector.status === 'error') && (
        <OctoberFormsConfig connector={connector} onConfigSave={onConfigSave} />
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
                className="input" style={{ flex: 1, fontSize: 13, padding: '6px 10px' }}
                value={manualValue}
                onChange={e => setManualValue(e.target.value)}
                placeholder={MANUAL_PLACEHOLDER[connector.connector_type] || 'Enter ID'}
                onKeyDown={e => e.key === 'Enter' && handleManualSave()}
              />
              <button onClick={handleManualSave} className="btn btn-secondary btn-sm">Save</button>
            </div>
          ) : accountsError ? (
            <span style={{ fontSize: 12, color: '#c62828' }} title={accountsError}>Error loading accounts — {accountsError.length > 80 ? accountsError.slice(0, 80) + '…' : accountsError}</span>
          ) : accounts && accounts.length === 0 ? (
            <span style={{ fontSize: 12, color: '#c62828' }}>No accounts found — check OAuth permissions.</span>
          ) : accounts ? (
            <select className="input" style={{ flex: 1, fontSize: 13, padding: '6px 10px' }} value={selectedValue} onChange={handleAccountSelect}>
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
    <div className="modal-backdrop">
      <div className="modal">
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
                className="input"
                value={values[f.key] || ''}
                onChange={e => onChange(prev => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={f.placeholder || ''}
              />
            </Field>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button onClick={onSave} className="btn btn-primary">Save & Verify</button>
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function AddAnotherModal({ type, typeName, onConfirm, onClose }) {
  const [label, setLabel] = useState('');
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Add another {typeName}</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#666' }}>
          Give this account a short label to tell it apart (e.g. "B2C", "B2B", "UK site").
        </p>
        <Field label="Label">
          <input
            autoFocus
            className="input"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="e.g. B2C, B2B, UK site"
            onKeyDown={e => e.key === 'Enter' && label.trim() && onConfirm(label.trim())}
          />
        </Field>
        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button onClick={() => onConfirm(label.trim() || null)} className="btn btn-primary">Add</button>
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ShopifyModal({ onConfirm, onClose }) {
  const [shop, setShop] = useState('');
  const [useOwnApp, setUseOwnApp] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const canConfirm = shop.trim() && (!useOwnApp || (clientId.trim() && clientSecret.trim()));
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Connect Shopify Store</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#666' }}>
          Enter the store domain. You'll approve access in a Shopify popup.
        </p>
        <Field label="Store Domain">
          <input
            autoFocus className="input" value={shop}
            onChange={e => setShop(e.target.value)}
            placeholder="goldfinger.myshopify.com"
          />
        </Field>
        <div style={{ margin: '14px 0 0' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#444' }}>
            <input type="checkbox" checked={useOwnApp} onChange={e => setUseOwnApp(e.target.checked)} />
            This client has their own Shopify app (different API Key)
          </label>
        </div>
        {useOwnApp && (
          <div style={{ marginTop: 12, padding: '12px 14px', background: '#f9f9f9', border: '2px solid var(--accent)', borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ margin: '0 0 4px', fontSize: 12, color: '#666', lineHeight: 1.5 }}>
              Create an app in <strong>Shopify Partners → Apps</strong> for this client's store. Paste the credentials below — they're encrypted and stored per-connector.
            </p>
            <Field label="API Key (Client ID)">
              <input className="input" value={clientId} onChange={e => setClientId(e.target.value)} placeholder="a1b2c3d4e5f6…" />
            </Field>
            <Field label="API Secret (Client Secret)">
              <input type="password" className="input" value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder="shpss_…" />
            </Field>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button
            onClick={() => canConfirm && onConfirm({ shop: shop.trim(), clientId: useOwnApp ? clientId.trim() : null, clientSecret: useOwnApp ? clientSecret.trim() : null })}
            className="btn btn-primary" disabled={!canConfirm}
          >
            Connect with Shopify
          </button>
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
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
      { key: 'refresh_token', label: 'Refresh Token', secret: true, placeholder: 'Atzr|...' },
      { key: 'marketplace', label: 'Marketplace', placeholder: 'uk / us / de / fr / us' },
      { key: 'seller_id', label: 'Seller ID (optional)', placeholder: 'A1B2C3...' },
    ],
    cin7: [
      { key: 'account_id', label: 'Account ID', placeholder: 'Your Cin7 account ID' },
      { key: 'api_key', label: 'Application Key', secret: true, placeholder: 'Cin7 application key' },
    ],
    october_forms: [
      { key: 'site_url', label: 'WordPress Site URL', placeholder: 'https://yoursite.com' },
      { key: 'api_key', label: 'OCF API Key', secret: true, placeholder: 'October Forms API key' },
    ],
  };
  return fieldMap[type] || [{ key: 'api_key', label: 'API Key', secret: true }];
}

