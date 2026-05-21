import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const TOOL_LABELS = {
  get_client_info: 'Client info',
  get_connector_data: 'Connector data',
  get_seo_rankings: 'SEO rankings',
  get_reports: 'Reports',
  detect_anomalies: 'Anomaly check',
  get_context_log: 'Context log',
  add_context_entry: 'Logged entry',
  resolve_context_entry: 'Resolved entry',
};

export default function ClientAdsPage() {
  const { id } = useParams();
  const toast = useToast();
  const [client, setClient] = useState(null);
  const [adsData, setAdsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [adsMargin, setAdsMargin] = useState(0.46);
  const [adsMarginInput, setAdsMarginInput] = useState('46');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const fileInputRef = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    api.get(`/clients/${id}`).then(c => {
      setClient(c);
      if (c?.ads_margin != null) {
        setAdsMargin(parseFloat(c.ads_margin));
        setAdsMarginInput(String(Math.round(parseFloat(c.ads_margin) * 100)));
      }
    }).catch(() => {});
    loadAdsData(30);
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  async function loadAdsData(d) {
    setLoading(true);
    try {
      const result = await api.get(`/connectors/client/${id}/ads-data?days=${d}`);
      setAdsData(result);
    } catch (err) {
      setAdsData({ error: err.message });
    } finally {
      setLoading(false);
    }
  }

  function handlePeriodChange(d) {
    setDays(d);
    loadAdsData(d);
  }

  async function handleSend(e) {
    e.preventDefault();
    const text = input.trim();
    if ((!text && attachedFiles.length === 0) || sending) return;

    const optimistic = {
      id: `tmp-${Date.now()}`, role: 'user',
      content: text + (attachedFiles.length ? ` [${attachedFiles.length} file(s) attached]` : ''),
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    setInput('');
    setSending(true);

    try {
      let imageData = null;
      if (attachedFiles.length > 0) {
        const file = attachedFiles[0];
        imageData = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ base64: reader.result.split(',')[1], mediaType: file.type, name: file.name });
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        setAttachedFiles([]);
      }
      const reply = await api.post(`/chat/${id}`, {
        message: text ? `[Ads Advisor] ${text}` : '[Ads Advisor] Analyse this image.',
        image: imageData,
      });
      setMessages(prev => [...prev, { ...reply, id: reply.id || `r-${Date.now()}` }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`, role: 'assistant',
        content: `Sorry, something went wrong: ${err.message}`,
        created_at: new Date().toISOString(),
        isError: true,
      }]);
    } finally {
      setSending(false);
    }
  }

  function handleFileChange(e) {
    const files = Array.from(e.target.files || []);
    setAttachedFiles(prev => [...prev, ...files].slice(0, 3));
    e.target.value = '';
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  }

  function fmt(n, prefix = '') {
    if (n == null || isNaN(n)) return '—';
    return `${prefix}${Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
  }

  function fmtCurrency(n) {
    if (n == null || isNaN(n)) return '—';
    return `£${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function parseGoogleAds(entry) {
    if (entry.error) return { error: entry.error };
    const raw = entry.data || {};
    const results = raw.results || (Array.isArray(raw) ? raw.flatMap(b => b.results || []) : []);
    let spend = 0, clicks = 0, convs = 0, convValue = 0, imps = 0;
    const campaignMap = {};
    for (const r of results) {
      const s = parseInt(r.metrics?.costMicros || 0) / 1e6;
      const c = parseInt(r.metrics?.clicks || 0);
      const cv = parseFloat(r.metrics?.conversions || 0);
      const cvv = parseFloat(r.metrics?.conversionsValue || 0);
      const imp = parseInt(r.metrics?.impressions || 0);
      spend += s; clicks += c; convs += cv; convValue += cvv; imps += imp;
      const name = r.campaign?.name;
      if (name) {
        if (!campaignMap[name]) campaignMap[name] = { name, spend: 0, clicks: 0, conversions: 0, convValue: 0 };
        campaignMap[name].spend += s;
        campaignMap[name].clicks += c;
        campaignMap[name].conversions += cv;
        campaignMap[name].convValue += cvv;
      }
    }
    const roas = spend > 0 && convValue > 0 ? convValue / spend : null;
    const avgCpc = clicks > 0 ? spend / clicks : null;
    const campaigns = Object.values(campaignMap).sort((a, b) => b.spend - a.spend);
    return { spend, clicks, convs, convValue, imps, roas, avgCpc, campaigns, store_label: entry.store_label };
  }

  function parseMetaAds(entry) {
    if (entry.error) return { error: entry.error };
    const raw = entry.data || {};
    const data = raw.data || [];
    let spend = 0, imps = 0, clicks = 0, purchaseValue = 0;
    const campaignMap = {};
    for (const r of data) {
      const s = parseFloat(r.spend || 0);
      spend += s;
      imps += parseInt(r.impressions || 0);
      clicks += parseInt(r.clicks || 0);
      const actions = r.action_values || [];
      const purchaseAction = actions.find(a => a.action_type === 'purchase');
      purchaseValue += parseFloat(purchaseAction?.value || 0);
      const name = r.campaign_name;
      if (name) {
        if (!campaignMap[name]) campaignMap[name] = { name, spend: 0, clicks: 0, impressions: 0 };
        campaignMap[name].spend += s;
        campaignMap[name].clicks += parseInt(r.clicks || 0);
        campaignMap[name].impressions += parseInt(r.impressions || 0);
      }
    }
    const roas = spend > 0 && purchaseValue > 0 ? purchaseValue / spend : null;
    const ctr = imps > 0 ? (clicks / imps) : null;
    const campaigns = Object.values(campaignMap).sort((a, b) => b.spend - a.spend);
    return { spend, imps, clicks, purchaseValue, roas, ctr, campaigns, store_label: entry.store_label };
  }

  function MetricCard({ label, value, sub }) {
    return (
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, padding: '16px 20px', minWidth: 140 }}>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 24, fontWeight: 700, color: '#1a1a1a' }}>{value ?? '—'}</div>
        {sub && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{sub}</div>}
      </div>
    );
  }

  const googleEntries = (adsData?.google_ads || []).map(parseGoogleAds);
  const metaEntries = (adsData?.meta_ads || []).map(parseMetaAds);
  const hasGoogle = googleEntries.length > 0;
  const hasMeta = metaEntries.length > 0;
  const noConnectors = !loading && !hasGoogle && !hasMeta;

  const SUGGESTIONS = [
    'Why is my ROAS low this month?',
    'Which campaigns should I pause?',
    'How can I reduce my CPC?',
    'Where should I increase budget?',
  ];

  return (
    <div style={{ display: 'flex', gap: 24, height: 'calc(100vh - 64px)', alignItems: 'stretch' }}>

      {/* Main panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Ads Performance — {client?.name}</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#666' }}>Live spend, ROAS, and campaign data from Google Ads and Meta Ads.</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[7, 14, 30, 90].map(d => (
              <button key={d} onClick={() => handlePeriodChange(d)}
                style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #ddd', background: days === d ? '#1a1a1a' : '#fff', color: days === d ? '#fff' : '#333', fontSize: 13, cursor: 'pointer' }}>
                {d}d
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>Loading ads data…</div>
        ) : adsData?.error ? (
          <div style={{ color: '#c62828', padding: 20, fontSize: 14 }}>Error: {adsData.error}</div>
        ) : noConnectors ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#888', fontSize: 14 }}>
            No active Google Ads or Meta Ads connectors found for this client.<br />
            <span style={{ fontSize: 12, color: '#aaa' }}>Connect them on the client's Connectors tab, then return here.</span>
          </div>
        ) : (
          <>
            {/* Google Ads */}
            {hasGoogle && (
              <div style={{ marginBottom: 32 }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
                  <span style={{ background: '#4285f4', color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 12 }}>Google Ads</span>
                </h2>
                {googleEntries.map((g, i) => (
                  <div key={i} style={{ marginBottom: googleEntries.length > 1 ? 20 : 0 }}>
                    {googleEntries.length > 1 && g.store_label && (
                      <div style={{ fontSize: 12, color: '#888', fontWeight: 600, marginBottom: 8 }}>{g.store_label}</div>
                    )}
                    {g.error ? (
                      <div style={{ color: '#c62828', fontSize: 13 }}>{g.error}</div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                          <MetricCard label="Spend" value={fmtCurrency(g.spend)} />
                          <MetricCard label="Revenue" value={g.convValue > 0 ? fmtCurrency(g.convValue) : '—'} />
                          <MetricCard label="ROAS" value={g.roas ? `${g.roas.toFixed(2)}x` : '—'} />
                          <MetricCard label="Clicks" value={fmt(g.clicks)} />
                          <MetricCard label="Conversions" value={fmt(g.convs)} />
                          <MetricCard label="CPC" value={fmtCurrency(g.avgCpc)} sub="avg" />
                        </div>
                        {g.campaigns?.length > 0 && (
                          <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                              <thead>
                                <tr style={{ background: '#f5f5f5' }}>
                                  {['Campaign', 'Spend', 'Revenue', 'ROAS', 'Clicks', 'Conv.'].map(h => (
                                    <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: '#555', borderBottom: '1px solid #e8e8e8' }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {g.campaigns.map((c, j) => {
                                  const roas = c.spend > 0 && c.convValue > 0 ? (c.convValue / c.spend).toFixed(2) : null;
                                  return (
                                    <tr key={j} style={{ borderBottom: '1px solid #f0f0f0' }}>
                                      <td style={{ padding: '8px 12px' }}>{c.name}</td>
                                      <td style={{ padding: '8px 12px' }}>{fmtCurrency(c.spend)}</td>
                                      <td style={{ padding: '8px 12px' }}>{c.convValue > 0 ? fmtCurrency(c.convValue) : '—'}</td>
                                      <td style={{ padding: '8px 12px' }}>{roas ? `${roas}x` : '—'}</td>
                                      <td style={{ padding: '8px 12px' }}>{fmt(c.clicks)}</td>
                                      <td style={{ padding: '8px 12px' }}>{fmt(c.conversions)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Meta Ads */}
            {hasMeta && (
              <div style={{ marginBottom: 32 }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
                  <span style={{ background: '#1877f2', color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 12 }}>Meta Ads</span>
                </h2>
                {metaEntries.map((m, i) => (
                  <div key={i} style={{ marginBottom: metaEntries.length > 1 ? 20 : 0 }}>
                    {metaEntries.length > 1 && m.store_label && (
                      <div style={{ fontSize: 12, color: '#888', fontWeight: 600, marginBottom: 8 }}>{m.store_label}</div>
                    )}
                    {m.error ? (
                      <div style={{ color: '#c62828', fontSize: 13 }}>{m.error}</div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                          <MetricCard label="Spend" value={fmtCurrency(m.spend)} />
                          <MetricCard label="Revenue" value={m.purchaseValue > 0 ? fmtCurrency(m.purchaseValue) : '—'} />
                          <MetricCard label="ROAS" value={m.roas ? `${m.roas.toFixed(2)}x` : '—'} />
                          <MetricCard label="Impressions" value={fmt(m.imps)} />
                          <MetricCard label="Clicks" value={fmt(m.clicks)} />
                          <MetricCard label="CTR" value={m.ctr ? `${(m.ctr * 100).toFixed(2)}%` : '—'} />
                        </div>
                        {m.campaigns?.length > 0 && (
                          <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                              <thead>
                                <tr style={{ background: '#f5f5f5' }}>
                                  {['Campaign', 'Spend', 'Clicks', 'Impressions'].map(h => (
                                    <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: '#555', borderBottom: '1px solid #e8e8e8' }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {m.campaigns.map((c, j) => (
                                  <tr key={j} style={{ borderBottom: '1px solid #f0f0f0' }}>
                                    <td style={{ padding: '8px 12px' }}>{c.name}</td>
                                    <td style={{ padding: '8px 12px' }}>{fmtCurrency(c.spend)}</td>
                                    <td style={{ padding: '8px 12px' }}>{fmt(c.clicks)}</td>
                                    <td style={{ padding: '8px 12px' }}>{fmt(c.impressions)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Ads Advisor chat sidebar — matches Report Chat style */}
      <div style={s.sidebar}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, color: '#1a1a1a' }}>Ads Advisor</div>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 14, lineHeight: 1.4 }}>
          Ask Claude about performance, targeting, budgets, or creative strategy.
        </div>

        <div style={s.thread}>
          {messages.length === 0 && !sending && (
            <div style={{ padding: '16px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>Ask anything about your ads…</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {SUGGESTIONS.map(sg => (
                  <button key={sg} onClick={() => setInput(sg)} style={suggestionStyle}>{sg}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
              {msg.role === 'assistant' && <div style={s.avatarDot} />}
              <div style={{ maxWidth: '90%' }}>
                {msg.role === 'assistant' && msg.tools_used?.length > 0 && (
                  <div style={s.toolsUsed}>
                    {msg.tools_used.map((t, i) => (
                      <span key={i} style={s.toolChip}>{TOOL_LABELS[t] || t}</span>
                    ))}
                  </div>
                )}
                <div style={{
                  ...s.bubble,
                  ...(msg.role === 'user' ? s.bubbleUser : s.bubbleAssistant),
                  ...(msg.isError ? { background: '#fff3f3', borderColor: '#f5c6cb' } : {}),
                }}>
                  {msg.content.split('\n').map((line, i, arr) => (
                    <React.Fragment key={i}>
                      {line}
                      {i < arr.length - 1 && <br />}
                    </React.Fragment>
                  ))}
                  <div style={s.timestamp}>
                    {new Date(msg.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {sending && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div style={s.avatarDot} />
              <div style={{ ...s.bubble, ...s.bubbleAssistant }}>
                <span style={s.typing}><span /><span /><span /></span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={handleSend} style={{ ...s.inputRow, flexDirection: 'column', gap: 8 }}>
          {attachedFiles.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {attachedFiles.map((f, i) => (
                <span key={i} style={{ fontSize: 11, background: '#f5f5f5', border: '1px solid #ddd', borderRadius: 4, padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 4 }}>
                  📎 {f.name}
                  <button type="button" onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', fontSize: 13, padding: 0, lineHeight: 1 }}>×</button>
                </span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about ROAS, budgets, creative…"
              style={{ ...s.textarea, fontSize: 12 }}
              rows={2}
              disabled={sending}
            />
            <input ref={fileInputRef} type="file" accept="image/*,.pdf" multiple onChange={handleFileChange} style={{ display: 'none' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button type="button" onClick={() => fileInputRef.current?.click()} title="Attach image or PDF"
                style={{ ...s.sendBtn, background: '#f5f5f5', color: '#555', fontSize: 16, padding: '0 10px', flex: 1 }}>
                📎
              </button>
              <button type="submit" disabled={sending || (!input.trim() && attachedFiles.length === 0)}
                style={{ ...s.sendBtn, flex: 1, padding: '0 10px', fontSize: 12 }}>
                {sending ? '…' : '→'}
              </button>
            </div>
          </div>
        </form>
      </div>

    </div>
  );
}

const suggestionStyle = {
  padding: '8px 10px', background: 'white', border: '1px solid #e0e0e0',
  borderRadius: 6, cursor: 'pointer', fontSize: 11, color: '#444',
  textAlign: 'left', lineHeight: 1.4,
};

const s = {
  sidebar: { width: 300, flexShrink: 0, borderLeft: '1px solid #e8e8e8', paddingLeft: 20, display: 'flex', flexDirection: 'column' },
  thread: { flex: 1, overflowY: 'auto', padding: '8px 0 16px', display: 'flex', flexDirection: 'column' },
  avatarDot: { width: 22, height: 22, borderRadius: '50%', background: '#1a1a1a', flexShrink: 0, marginRight: 6, marginTop: 2 },
  bubble: { padding: '8px 12px', borderRadius: 10, fontSize: 12, lineHeight: 1.6, border: '1px solid transparent' },
  bubbleUser: { background: '#1a1a1a', color: 'white', borderBottomRightRadius: 3 },
  bubbleAssistant: { background: 'white', color: '#1a1a1a', border: '1px solid #e8e8e8', borderBottomLeftRadius: 3 },
  timestamp: { fontSize: 10, opacity: 0.5, marginTop: 4, textAlign: 'right' },
  toolsUsed: { display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 },
  toolChip: { fontSize: 10, padding: '2px 7px', background: '#f0f4ff', color: '#3355cc', borderRadius: 10, fontWeight: 500 },
  inputRow: { display: 'flex', gap: 6, paddingTop: 12, borderTop: '1px solid #e8e8e8', marginTop: 'auto' },
  textarea: { flex: 1, padding: '8px 10px', border: '1px solid #e0e0e0', borderRadius: 8, resize: 'none', fontFamily: 'inherit', lineHeight: 1.5, outline: 'none' },
  sendBtn: { padding: '8px 14px', background: '#1a1a1a', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  typing: { display: 'inline-flex', gap: 3, alignItems: 'center' },
};
