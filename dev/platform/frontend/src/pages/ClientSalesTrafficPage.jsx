import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../utils/api';
import SuiteTabs from '../components/SuiteTabs';
import SuiteOverview from '../components/SuiteOverview';
import ClientChatPage from './ClientChatPage';
import { useCssVar } from '../hooks/useCssVar';
import { useTabParam } from '../hooks/useTabParam';

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
  // Read chart colours from the live suite scope so Recharts strokes
  // pick up the Sales teal (and any future palette tweak) without
  // hardcoding hex.
  const scopeRef = useRef(null);
  const accent = useCssVar('--accent', '#20A39E', scopeRef);
  const text = useCssVar('--text', '#1a1a1a', scopeRef);
  const subtle = useCssVar('--text-subtle', '#888', scopeRef);
  const [tab, setTab] = useTabParam('overview', ['overview', 'dashboard', 'analyst']);
  const [client, setClient] = useState(null);
  const [data, setData] = useState(null);
  const [start, setStart] = useState(() => isoDaysAgo(29));
  const [end, setEnd] = useState(() => isoToday());
  const [activeKey, setActiveKey] = useState('d30');
  const [showCustom, setShowCustom] = useState(false);
  const [customStart, setCustomStart] = useState(() => isoDaysAgo(29));
  const [customEnd, setCustomEnd] = useState(() => isoToday());
  const [loading, setLoading] = useState(true);

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
        { key: 'dashboard', label: 'Performance',  active: tab === 'dashboard', onClick: () => setTab('dashboard') },
        { key: 'analyst',   label: 'AI Analyst',   active: tab === 'analyst',   onClick: () => setTab('analyst') },
      ]} />

      {tab === 'analyst' && <ClientChatPage embedded clientId={id} />}

      {tab === 'overview' && (
        <SuiteOverview
          tagline="Stop building reports. Just ask."
          description="Live revenue, orders and traffic the second the page loads — and any question answered in plain English, with the numbers to back it up. The analyst who already knows the account."
          ctaLabel="View live KPIs"
          onCta={() => setTab('dashboard')}
          status={[
            { label: 'Shopify', value: k.revenue ? 'Live' : 'No data', ok: !!k.revenue },
            { label: 'GA4', value: k.sessions ? 'Live' : 'No data', ok: !!k.sessions },
            { label: 'Revenue · 30d', value: fmtMoney(k.revenue || 0), ok: !!k.revenue },
          ]}
          flow={[
            { label: 'Shopify + GA4', detail: 'Live connector data' },
            { label: 'Live KPIs',     detail: 'Six headline metrics' },
            { label: 'Trends',        detail: '30-day charts' },
            { label: 'Channels',      detail: 'Where revenue comes from' },
          ]}
          capabilities={[
            { tag: 'Live KPIs',       title: 'Six metrics at a glance', cta: 'View KPIs', onClick: () => setTab('dashboard'), body: 'Revenue, orders, average order value, sessions, users and conversion rate — fresh on every page load.' },
            { tag: 'Trend chart',     title: 'Spot the spikes & dips',  cta: 'View trends', onClick: () => setTab('dashboard'), body: 'Sales and orders overlaid on one 30-day chart so movement is obvious at a glance.' },
            { tag: 'Channel split',   title: 'Know where revenue comes from', cta: 'View channels', onClick: () => setTab('dashboard'), body: 'Revenue and traffic broken down by acquisition channel — search, paid, social, direct.' },
            { tag: 'Date flexibility', title: 'Compare any window',     cta: 'Open dashboard', onClick: () => setTab('dashboard'), body: '7 / 14 / 30 / 90 days, month-to-date, year-to-date, per-month, or a custom range.' },
          ]}
        />
      )}

      {tab === 'dashboard' && <>
      {showCustom && (
        <div className="row mb-4" style={{ alignItems: 'center', gap: 6 }}>
          <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
            style={{ padding: '5px 8px', borderRadius: 'var(--r-sm)', border: 'var(--border-w) solid var(--card-border)', fontSize: 13 }} />
          <span style={{ color: 'var(--text-subtle)', fontSize: 13 }}>to</span>
          <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
            style={{ padding: '5px 8px', borderRadius: 'var(--r-sm)', border: 'var(--border-w) solid var(--card-border)', fontSize: 13 }} />
          <button onClick={applyCustom}
            style={{ padding: '6px 16px', borderRadius: 'var(--r-pill)', border: 'none', background: 'var(--accent)', color: 'var(--accent-on)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Apply</button>
        </div>
      )}
      <div className="row mb-4" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{fmtDay(start)} – {fmtDay(end)}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {[7, 14, 30, 90].map(d => (
            <button key={d} onClick={() => selectDays(d)}
              style={{ padding: '6px 14px', borderRadius: 'var(--r-pill)', border: 'var(--border-w) solid ' + (activeKey === 'd' + d ? 'var(--text)' : 'var(--card-border)'), background: activeKey === 'd' + d ? 'var(--text)' : 'var(--surface)', color: activeKey === 'd' + d ? '#fff' : 'var(--text)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {d}d
            </button>
          ))}
          <select value={['d7', 'd14', 'd30', 'd90'].includes(activeKey) ? '' : activeKey}
            onChange={e => selectPreset(e.target.value)}
            style={{ padding: '6px 12px', borderRadius: 'var(--r-pill)', border: 'var(--border-w) solid var(--card-border)', background: 'var(--surface)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
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
        <div style={{ color: 'var(--text-subtle)', padding: 40 }}>Loading…</div>
      ) : data && data.error ? (
        <div style={{ color: 'var(--negative)', padding: 20 }}>{data.error}</div>
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

          <div className="grid grid-2" style={{ marginBottom: 16 }}>
            <div className="card">
              <div className="caption">Revenue &amp; orders</div>
              {data.salesTrend && data.salesTrend.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={data.salesTrend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 10 }} minTickGap={24} />
                    <YAxis yAxisId="r" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="o" orientation="right" tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip labelFormatter={fmtDay} />
                    <Legend />
                    <Line yAxisId="r" type="monotone" dataKey="revenue" name="Revenue" stroke={text} strokeWidth={2} dot={false} />
                    <Line yAxisId="o" type="monotone" dataKey="orders" name="Orders" stroke={subtle} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p className="body-sm text-subtle" style={{ padding: "20px 0", margin: 0 }}>No sales trend data.</p>}
            </div>
            <div className="card">
              <div className="caption">Traffic</div>
              {data.trafficTrend && data.trafficTrend.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={data.trafficTrend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 10 }} minTickGap={24} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip labelFormatter={fmtDay} />
                    <Legend />
                    <Line type="monotone" dataKey="sessions" name="Sessions" stroke={text} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="users" name="Users" stroke={subtle} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p className="body-sm text-subtle" style={{ padding: "20px 0", margin: 0 }}>No traffic data.</p>}
            </div>
          </div>

          <div className="card">
            <div className="caption">Traffic sources</div>
            {data.channels && data.channels.length ? (
              <ResponsiveContainer width="100%" height={Math.max(140, data.channels.length * 34)}>
                <BarChart data={data.channels} layout="vertical" margin={{ top: 4, right: 16, left: 24, bottom: 4 }}>
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="channel" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip />
                  <Bar dataKey="sessions" name="Sessions" fill={text} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="body-sm text-subtle" style={{ padding: "20px 0", margin: 0 }}>No channel data.</p>}
          </div>

          {data.notes && data.notes.length > 0 && (
            <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-subtle)' }}>{data.notes.join(' · ')}</p>
          )}
        </>
      ) : null}
      </>}
    </div>
  );
}

