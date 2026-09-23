import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../utils/api';
import SuiteTabs from '../components/SuiteTabs';
import SuiteOverview from '../components/SuiteOverview';
import DataFlowMap from '../components/DataFlowMap';
import ClientChatPage from './ClientChatPage';
import StrategistBriefingPanel from '../components/StrategistBriefingPanel';
import { useCssVar } from '../hooks/useCssVar';
import { useTabParam } from '../hooks/useTabParam';
import { useAuth } from '../context/AuthContext';

const fmtMoney = n => '£' + Math.round(Number(n || 0)).toLocaleString('en-GB');
const fmtNum = n => Number(n || 0).toLocaleString('en-GB');
const fmtDay = d => {
  const dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

const pad = n => String(n).padStart(2, '0');
const isoLocal = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoToday = () => isoLocal(new Date());
const isoDaysAgo = n => isoLocal(new Date(Date.now() - n * 86400000));
function recentMonths(count) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear(), m = d.getMonth();
    out.push({
      key: `${y}-${pad(m + 1)}`,
      label: d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      start: `${y}-${pad(m + 1)}-01`,
      end: `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`,
    });
  }
  return out;
}

export default function ClientSalesTrafficPage() {
  const { id } = useParams();
  // "Analyse" is the agency's private AI chat/analysis history — the secret
  // sauce a client can't use and shouldn't see. Hide the tab for client
  // (read-only) logins, and if one deep-links to ?tab=analyst, fall back to
  // Overview so the panel never renders.
  const { readOnly } = useAuth();
  // Read chart colours from the live suite scope so Recharts strokes
  // pick up the Sales teal (and any future palette tweak) without
  // hardcoding hex.
  const scopeRef = useRef(null);
  const accent = useCssVar('--accent', '#20A39E', scopeRef);
  const text = useCssVar('--text', '#1a1a1a', scopeRef);
  const subtle = useCssVar('--text-subtle', '#888', scopeRef);
  // Chart series colours — from the function-colour palette, each with strong
  // contrast on the white card so two lines never blur into one.
  const cRevenue = useCssVar('--fn-strategy', '#0d9488', scopeRef);   // teal
  const cOrders = useCssVar('--fn-approve', '#db2777', scopeRef);     // pink
  const cSessions = useCssVar('--fn-distribute', '#0284c7', scopeRef); // blue
  const cUsers = useCssVar('--fn-create', '#7c3aed', scopeRef);       // violet
  const [tab, setTab] = useTabParam('overview', ['overview', 'dashboard', 'analyst', 'strategist']);
  const [client, setClient] = useState(null);
  const [data, setData] = useState(null);
  const [start, setStart] = useState(() => isoDaysAgo(29));
  const [end, setEnd] = useState(() => isoToday());
  const [activeKey, setActiveKey] = useState('d30');
  const [showCustom, setShowCustom] = useState(false);
  const [customStart, setCustomStart] = useState(() => isoDaysAgo(29));
  const [customEnd, setCustomEnd] = useState(() => isoToday());
  const [loading, setLoading] = useState(true);

  // A client login must never land on the private Analyse tab, even by
  // deep-link — bounce them to Overview.
  useEffect(() => { if (readOnly && (tab === 'analyst' || tab === 'strategist')) setTab('overview'); }, [readOnly, tab, setTab]);

  useEffect(() => { api.get(`/clients/${id}`).then(setClient).catch(() => {}); }, [id]);

  useEffect(() => {
    setLoading(true);
    api.get(`/sales-traffic/${id}?start=${start}&end=${end}`)
      .then(setData)
      .catch(err => setData({ error: err.message }))
      .finally(() => setLoading(false));
  }, [id, start, end]);

  const months = recentMonths(12);

  function selectDays(n) {
    setStart(isoDaysAgo(n - 1));
    setEnd(isoToday());
    setActiveKey('d' + n);
    setShowCustom(false);
  }

  function selectPreset(value) {
    if (!value) return;
    const now = new Date();
    if (value === 'mtd') {
      setStart(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`);
      setEnd(isoToday()); setActiveKey('mtd'); setShowCustom(false);
    } else if (value === 'ytd') {
      setStart(`${now.getFullYear()}-01-01`);
      setEnd(isoToday()); setActiveKey('ytd'); setShowCustom(false);
    } else if (value === 'custom') {
      setActiveKey('custom'); setShowCustom(true);
    } else {
      const m = months.find(x => x.key === value);
      if (m) { setStart(m.start); setEnd(m.end); setActiveKey(value); setShowCustom(false); }
    }
  }

  function applyCustom() {
    if (!customStart || !customEnd) return;
    const s = customStart <= customEnd ? customStart : customEnd;
    const e = customStart <= customEnd ? customEnd : customStart;
    setStart(s); setEnd(e); setActiveKey('custom');
  }

  const k = (data && data.kpis) || {};
  const cards = [
    { label: 'Revenue', value: fmtMoney(k.revenue) },
    { label: 'Orders', value: fmtNum(k.orders) },
    { label: 'Avg order value', value: fmtMoney(k.aov) },
    { label: 'Sessions', value: fmtNum(k.sessions) },
    { label: 'Users', value: fmtNum(k.users) },
    { label: 'Conversion rate', value: (Number(k.conversionRate) || 0).toFixed(2) + '%' },
  ];

  // Advisory ecom detail from the store connector — refunds, discounts,
  // new-vs-returning and product mix. Present only when a store is connected.
  const ecom = data && data.ecom;
  const hasEcom = ecom && (Number(k.orders) > 0 || Number(ecom.netRevenue) !== 0);
  const ecomCards = hasEcom ? [
    { label: 'Net revenue', value: fmtMoney(ecom.netRevenue), sub: 'after refunds' },
    { label: 'Refund rate', value: (Number(ecom.refundRate) || 0).toFixed(1) + '%', sub: `${fmtMoney(ecom.refunds)} · ${fmtNum(ecom.refundedOrders)} orders` },
    { label: 'On discount', value: (Number(ecom.discountRate) || 0).toFixed(1) + '%', sub: `${fmtMoney(ecom.discounts)} given away` },
    { label: 'Returning', value: (() => {
        const known = Number(ecom.newCustomerOrders) + Number(ecom.returningCustomerOrders);
        return known ? Math.round((Number(ecom.returningCustomerOrders) / known) * 100) + '%' : '—';
      })(), sub: `${fmtNum(ecom.returningCustomerOrders)} returning · ${fmtNum(ecom.newCustomerOrders)} new` },
  ] : [];

  return (
    <div className="suite-sales" ref={scopeRef}>
      <div className="kicker"><span className="pip" /><span>{client?.name && <><span className="kicker-name">{client.name}</span> • </>}Data</span></div>
      <header className="hero">
        <div>
          <h1 className="display mt-2">Data</h1>
        </div>
      </header>

      <SuiteTabs tabs={[
        { key: 'overview',  label: 'Overview',     active: tab === 'overview',  onClick: () => setTab('overview') },
        { key: 'dashboard', label: 'Measure', fn: 'measure', active: tab === 'dashboard', onClick: () => setTab('dashboard') },
        // Strategist (cross-PESO briefing) and Analyse (private AI chat) are agency-only.
        ...(readOnly ? [] : [{ key: 'strategist', label: 'Strategist', fn: 'strategy', active: tab === 'strategist', onClick: () => setTab('strategist') }]),
        ...(readOnly ? [] : [{ key: 'analyst', label: 'Analyse', fn: 'research', active: tab === 'analyst', onClick: () => setTab('analyst') }]),
      ]} />

      {tab === 'strategist' && !readOnly && <StrategistBriefingPanel clientId={id} />}
      {tab === 'analyst' && !readOnly && <ClientChatPage embedded clientId={id} />}

      {tab === 'overview' && (
        <SuiteOverview
          tagline="Stop building reports. Just ask."
          description="Live revenue, orders and traffic the second the page loads — and any question answered in plain English, with the numbers to back it up. The analyst who already knows the account."
          benefits={['Live revenue, orders & traffic', 'Answers in plain English', 'No report-building']}
          readouts={[
            { fn: 'measure', name: 'Revenue · 30d', value: fmtMoney(k.revenue || 0), sub: k.revenue ? 'live' : 'no data' },
            { fn: 'data',    name: 'Shopify', value: k.revenue ? 'Live' : '—', sub: k.revenue ? 'connected' : 'no data' },
            { fn: 'data',    name: 'GA4',     value: k.sessions ? 'Live' : '—', sub: k.sessions ? 'connected' : 'no data' },
          ]}
          primary={readOnly ? {
            fn: 'measure',
            kicker: 'The main job here',
            title: 'See the live numbers',
            description: 'Revenue, orders and traffic the second the page loads — no report-building.',
            ctaLabel: 'Open the dashboard',
            onCta: () => setTab('dashboard'),
          } : {
            fn: 'research',
            kicker: 'The main job here',
            title: 'Ask anything about the account',
            description: 'The analyst already knows the account. Ask in plain English and get the answer with the numbers to back it up.',
            ctaLabel: 'Open the analyst',
            onCta: () => setTab('analyst'),
          }}
          otherJobs={{ label: 'Other jobs in Data', items: readOnly ? [] : [
            { fn: 'measure', label: 'Dashboard — live KPIs', onClick: () => setTab('dashboard') },
          ] }}
          diagram={<DataFlowMap onPerformance={() => setTab('dashboard')} onAnalyst={readOnly ? undefined : () => setTab('analyst')} />}
        />
      )}

      {tab === 'dashboard' && <>
      {showCustom && (
        <div className="row mb-4" style={{ alignItems: 'center', gap: 'var(--s2)' }}>
          <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
            style={{ padding: 'var(--s1) var(--s2)', borderRadius: 'var(--r-sm)', border: 'var(--border-w) solid var(--card-border)', fontSize: 'var(--fs-body)' }} />
          <span style={{ color: 'var(--text-subtle)', fontSize: 'var(--fs-body)' }}>to</span>
          <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
            style={{ padding: 'var(--s1) var(--s2)', borderRadius: 'var(--r-sm)', border: 'var(--border-w) solid var(--card-border)', fontSize: 'var(--fs-body)' }} />
          <button onClick={applyCustom}
            style={{ padding: 'var(--s2) var(--s4)', borderRadius: 'var(--r-pill)', border: 'none', background: 'var(--accent)', color: 'var(--accent-on)', fontSize: 'var(--fs-body)', fontWeight: 700, cursor: 'pointer' }}>Apply</button>
        </div>
      )}
      <div className="row mb-4" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s3)' }}>
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>{fmtDay(start)} – {fmtDay(end)}</span>
        <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
          {[7, 14, 30, 90].map(d => (
            <button key={d} onClick={() => selectDays(d)}
              className={`tab ${activeKey === 'd' + d ? 'active' : ''}`}>
              {d}d
            </button>
          ))}
          <select value={['d7', 'd14', 'd30', 'd90'].includes(activeKey) ? '' : activeKey}
            onChange={e => selectPreset(e.target.value)}
            style={{ padding: 'var(--s2) var(--s3)', borderRadius: 'var(--r-pill)', border: 'var(--border-w) solid var(--card-border)', background: 'var(--surface)', fontSize: 'var(--fs-body)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            <option value="">Period…</option>
            <option value="mtd">Month to date</option>
            <option value="ytd">Year to date</option>
            <option value="custom">Custom range…</option>
            <optgroup label="Months">
              {months.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </optgroup>
          </select>
        </div>
      </div>
      {loading ? (
        <div style={{ color: 'var(--text-subtle)', padding: 'var(--s8)' }}>Loading…</div>
      ) : data && data.error ? (
        <div style={{ color: 'var(--negative)', padding: 'var(--s5)' }}>{data.error}</div>
      ) : data ? (
        <>
          <div className="stat-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', marginBottom: 'var(--s5)' }}>
            {cards.map((c, i) => (
              <div key={c.label} className={'stat' + (i === 0 ? ' feature' : '')}>
                <div className="stat-label">{c.label}</div>
                <div className="stat-value">{c.value}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-2" style={{ marginBottom: 'var(--s4)' }}>
            <div className="card">
              <div className="caption">Revenue &amp; orders</div>
              {data.salesTrend && data.salesTrend.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={data.salesTrend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 'var(--fs-caption)' }} minTickGap={24} />
                    <YAxis yAxisId="r" tick={{ fontSize: 'var(--fs-caption)' }} />
                    <YAxis yAxisId="o" orientation="right" tick={{ fontSize: 'var(--fs-caption)' }} allowDecimals={false} />
                    <Tooltip labelFormatter={fmtDay} />
                    <Legend />
                    <Line yAxisId="r" type="monotone" dataKey="revenue" name="Revenue" stroke={cRevenue} strokeWidth={2.5} dot={false} />
                    <Line yAxisId="o" type="monotone" dataKey="orders" name="Orders" stroke={cOrders} strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p className="body-sm text-subtle" style={{ padding: "var(--s5) 0", margin: 0 }}>No sales trend data.</p>}
            </div>
            <div className="card">
              <div className="caption">Traffic</div>
              {data.trafficTrend && data.trafficTrend.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={data.trafficTrend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 'var(--fs-caption)' }} minTickGap={24} />
                    <YAxis tick={{ fontSize: 'var(--fs-caption)' }} />
                    <Tooltip labelFormatter={fmtDay} />
                    <Legend />
                    <Line type="monotone" dataKey="sessions" name="Sessions" stroke={cSessions} strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="users" name="Users" stroke={cUsers} strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p className="body-sm text-subtle" style={{ padding: "var(--s5) 0", margin: 0 }}>No traffic data.</p>}
            </div>
          </div>

          <div className="card">
            <div className="caption">Traffic sources</div>
            {data.channels && data.channels.length ? (
              <ResponsiveContainer width="100%" height={Math.max(140, data.channels.length * 34)}>
                <BarChart data={data.channels} layout="vertical" margin={{ top: 4, right: 16, left: 24, bottom: 4 }}>
                  <XAxis type="number" tick={{ fontSize: 'var(--fs-caption)' }} />
                  <YAxis type="category" dataKey="channel" tick={{ fontSize: 'var(--fs-caption)' }} width={120} />
                  <Tooltip />
                  <Bar dataKey="sessions" name="Sessions" fill={cSessions} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="body-sm text-subtle" style={{ padding: "var(--s5) 0", margin: 0 }}>No channel data.</p>}
          </div>

          {hasEcom && (
            <div style={{ marginTop: 'var(--s4)' }}>
              <div className="stat-strip" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', marginBottom: 'var(--s5)' }}>
                {ecomCards.map(c => (
                  <div key={c.label} className="stat">
                    <div className="stat-label">{c.label}</div>
                    <div className="stat-value">{c.value}</div>
                    {c.sub && <div className="body-sm text-subtle" style={{ marginTop: 'var(--s1)' }}>{c.sub}</div>}
                  </div>
                ))}
              </div>
              {ecom.topProducts && ecom.topProducts.length > 0 && (
                <div className="card">
                  <div className="caption">Top products by revenue</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-body)' }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--text-subtle)' }}>
                        <th style={{ padding: 'var(--s2) var(--s2)', fontWeight: 600 }}>Product</th>
                        <th style={{ padding: 'var(--s2) var(--s2)', fontWeight: 600, textAlign: 'right' }}>Units</th>
                        <th style={{ padding: 'var(--s2) var(--s2)', fontWeight: 600, textAlign: 'right' }}>Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ecom.topProducts.map((p, i) => (
                        <tr key={i} style={{ borderTop: 'var(--border-w) solid var(--card-border)' }}>
                          <td style={{ padding: 'var(--s2) var(--s2)' }}>{p.title}</td>
                          <td style={{ padding: 'var(--s2) var(--s2)', textAlign: 'right' }}>{fmtNum(p.units)}</td>
                          <td style={{ padding: 'var(--s2) var(--s2)', textAlign: 'right' }}>{fmtMoney(p.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {data.notes && data.notes.length > 0 && (
            <p style={{ marginTop: 'var(--s3)', fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>{data.notes.join(' · ')}</p>
          )}
        </>
      ) : null}
      </>}
    </div>
  );
}

