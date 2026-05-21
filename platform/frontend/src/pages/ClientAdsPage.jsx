import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';

export default function ClientAdsPage() {
  const { id } = useParams();
  const [client, setClient] = useState(null);
  const [adsData, setAdsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    api.get(`/clients/${id}`).then(setClient).catch(() => {});
    fetchAdsData(days);
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  async function fetchAdsData(d) {
    setLoading(true);
    try {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - d);
      const fmt = dt => dt.toISOString().split('T')[0];

      const [googleRes, metaRes] = await Promise.allSettled([
        api.post(`/chat/${id}`, { message: `Fetch Google Ads data for the last ${d} days. Return raw summary only, no narrative.`, _internal: true }),
        api.post(`/chat/${id}`, { message: `Fetch Meta Ads data for the last ${d} days. Return raw summary only, no narrative.`, _internal: true }),
      ]);

      setAdsData({
        google: googleRes.status === 'fulfilled' ? googleRes.value : null,
        meta: metaRes.status === 'fulfilled' ? metaRes.value : null,
        period: { start: fmt(start), end: fmt(end), days: d },
      });
    } catch (err) {
      setAdsData({ error: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleSend(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setMessages(prev => [...prev, { role: 'user', content: text, id: Date.now() }]);
    setInput('');
    setSending(true);
    try {
      const reply = await api.post(`/chat/${id}`, {
        message: `[Ads Chat] ${text}`,
        systemHint: 'Focus on Google Ads and Meta Ads performance. Suggest specific, actionable improvements. Do not make changes — recommend what the user should do.',
      });
      setMessages(prev => [...prev, { role: 'assistant', content: reply.content, id: Date.now() + 1 }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}`, id: Date.now() + 1, isError: true }]);
    } finally {
      setSending(false);
    }
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

  function parseContent(content) {
    if (!content) return {};
    if (typeof content === 'object') return content;
    try { return JSON.parse(content); } catch { return { text: content }; }
  }

  function fmt(n, prefix = '') {
    if (n == null || isNaN(n)) return '—';
    return `${prefix}${Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`;
  }

  function fmtCurrency(n) {
    if (n == null || isNaN(n)) return '—';
    return `£${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  const google = parseContent(adsData?.google?.content);
  const meta = parseContent(adsData?.meta?.content);

  return (
    <div style={{ padding: 32, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Ads Performance</h1>
          {client && <div style={{ color: '#888', fontSize: 13, marginTop: 2 }}>{client.name}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[7, 14, 30, 90].map(d => (
            <button key={d} onClick={() => { setDays(d); fetchAdsData(d); }}
              style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #ddd', background: days === d ? '#1a1a1a' : '#fff', color: days === d ? '#fff' : '#333', fontSize: 13, cursor: 'pointer' }}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>Loading ads data…</div>
      ) : (
        <>
          {/* Google Ads */}
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ background: '#4285f4', color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 12 }}>Google Ads</span>
            </h2>
            {google?.error || google?.fetch_errors ? (
              <div style={{ color: '#c62828', fontSize: 13 }}>{google.error || JSON.stringify(google.fetch_errors)}</div>
            ) : (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <MetricCard label="Spend" value={fmtCurrency(google?.spend || google?.total_spend)} />
                <MetricCard label="Revenue" value={fmtCurrency(google?.revenue || google?.total_revenue)} />
                <MetricCard label="ROAS" value={google?.roas ? `${Number(google.roas).toFixed(2)}x` : '—'} />
                <MetricCard label="Clicks" value={fmt(google?.clicks || google?.total_clicks)} />
                <MetricCard label="Conversions" value={fmt(google?.conversions || google?.total_conversions)} />
                <MetricCard label="CPC" value={fmtCurrency(google?.avg_cpc || google?.cpc)} sub="avg" />
              </div>
            )}
            {google?.campaigns?.length > 0 && (
              <div style={{ marginTop: 16, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f5f5f5' }}>
                      {['Campaign', 'Spend', 'Revenue', 'ROAS', 'Clicks', 'Conv.'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 600, color: '#555', borderBottom: '1px solid #e8e8e8' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {google.campaigns.map((c, i) => {
                      const spend = c.cost_micros ? c.cost_micros / 1e6 : c.spend;
                      const rev = c.conversions_value || c.revenue;
                      const roas = spend && rev ? (rev / spend).toFixed(2) : '—';
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '8px 12px' }}>{c.campaign?.name || c.name}</td>
                          <td style={{ padding: '8px 12px' }}>{fmtCurrency(spend)}</td>
                          <td style={{ padding: '8px 12px' }}>{fmtCurrency(rev)}</td>
                          <td style={{ padding: '8px 12px' }}>{roas !== '—' ? `${roas}x` : '—'}</td>
                          <td style={{ padding: '8px 12px' }}>{fmt(c.metrics?.clicks || c.clicks)}</td>
                          <td style={{ padding: '8px 12px' }}>{fmt(c.metrics?.conversions || c.conversions)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Meta Ads */}
          <div style={{ marginBottom: 32 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
              <span style={{ background: '#1877f2', color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 12 }}>Meta Ads</span>
            </h2>
            {meta?.error ? (
              <div style={{ color: '#c62828', fontSize: 13 }}>{meta.error}</div>
            ) : (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <MetricCard label="Spend" value={fmtCurrency(meta?.spend || meta?.total_spend)} />
                <MetricCard label="Revenue" value={fmtCurrency(meta?.revenue || meta?.purchase_value)} />
                <MetricCard label="ROAS" value={meta?.roas ? `${Number(meta.roas).toFixed(2)}x` : '—'} />
                <MetricCard label="Impressions" value={fmt(meta?.impressions || meta?.total_impressions)} />
                <MetricCard label="Clicks" value={fmt(meta?.clicks || meta?.total_clicks)} />
                <MetricCard label="CTR" value={meta?.ctr ? `${(meta.ctr * 100).toFixed(2)}%` : '—'} />
              </div>
            )}
          </div>
        </>
      )}

      {/* Ads Chat */}
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Ads Advisor</span>
          <span style={{ fontSize: 12, color: '#888' }}>Ask for ideas to improve performance — Claude will recommend, not make changes automatically</span>
        </div>
        <div style={{ height: 320, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.length === 0 && (
            <div style={{ color: '#aaa', fontSize: 13, textAlign: 'center', marginTop: 60 }}>
              Ask about your ads performance, targeting, budgets, or creative ideas…
            </div>
          )}
          {messages.map(m => (
            <div key={m.id} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '80%', padding: '10px 14px', borderRadius: 12, fontSize: 13, lineHeight: 1.5,
                background: m.role === 'user' ? '#1a1a1a' : (m.isError ? '#ffebee' : '#f5f5f5'),
                color: m.role === 'user' ? '#fff' : (m.isError ? '#c62828' : '#1a1a1a'),
                whiteSpace: 'pre-wrap',
              }}>
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <div style={{ display: 'flex' }}>
              <div style={{ background: '#f5f5f5', borderRadius: 12, padding: '10px 14px', fontSize: 13, color: '#888' }}>Thinking…</div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <form onSubmit={handleSend} style={{ borderTop: '1px solid #f0f0f0', padding: 12, display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); } }}
            placeholder="e.g. Why is my ROAS low? How can I reduce CPC? Which campaigns should I pause?"
            style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid #ddd', fontSize: 13, outline: 'none' }}
          />
          <button type="submit" disabled={!input.trim() || sending}
            style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#1a1a1a', color: '#fff', fontSize: 13, cursor: 'pointer', opacity: (!input.trim() || sending) ? 0.5 : 1 }}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
