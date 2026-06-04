import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../utils/api';

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
    <div className="suite-organic">
      <header className="hero">
        <div className="client-name">{client?.name || ''}</div>
        <h1 className="display mt-2">Sales &amp; <span className="text-accent">Traffic</span></h1>
      </header>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 20 }}>
        {[7, 14, 30, 90].map(d => (
          <button key={d} onClick={() => selectDays(d)}
            style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #ddd', background: activeKey === 'd' + d ? '#1a1a1a' : '#fff', color: activeKey === 'd' + d ? '#fff' : '#333', fontSize: 13, cursor: 'pointer' }}>
            {d}d
          </button>
        ))}
        <select value={['d7', 'd14', 'd30', 'd90'].includes(activeKey) ? '' : activeKey}
          onChange={e => selectPreset(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13, cursor: 'pointer' }}>
          <option value="">Period…</option>
          <option value="mtd">Month to date</option>
          <option value="ytd">Year to date</option>
          <option value="custom">Custom range…</option>
          <optgroup label="Months">
            {months.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </optgroup>
        </select>
        {showCustom && (
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
              style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }} />
            <span style={{ color: '#888', fontSize: 13 }}>to</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13 }} />
            <button onClick={applyCustom}
              style={{ padding: '6px 16px', borderRadius: 999, border: 'none', background: '#E7CD41', color: '#1a1a1a', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Apply</button>
          </span>
        )}
        <span style={{ fontSize: 12, color: '#888' }}>{fmtDay(start)} – {fmtDay(end)}</span>
      </div>

      {loading ? (
        <div style={{ color: '#888', padding: 40 }}>Loading…</div>
      ) : data && data.error ? (
        <div style={{ color: '#c62828', padding: 20 }}>{data.error}</div>
      ) : data ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 16 }}>
            {cards.map(c => (
              <div key={c.label} style={s.card}>
                <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{c.label}</div>
                <div style={{ fontSize: 23, fontWeight: 700, marginTop: 6 }}>{c.value}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div style={s.card}>
              <div style={s.cardTitle}>Revenue &amp; orders</div>
              {data.salesTrend && data.salesTrend.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={data.salesTrend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 10 }} minTickGap={24} />
                    <YAxis yAxisId="r" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="o" orientation="right" tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip labelFormatter={fmtDay} />
                    <Legend />
                    <Line yAxisId="r" type="monotone" dataKey="revenue" name="Revenue" stroke="#1a1a1a" strokeWidth={2} dot={false} />
                    <Line yAxisId="o" type="monotone" dataKey="orders" name="Orders" stroke="#E7CD41" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p style={s.empty}>No sales trend data.</p>}
            </div>
            <div style={s.card}>
              <div style={s.cardTitle}>Traffic</div>
              {data.trafficTrend && data.trafficTrend.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={data.trafficTrend} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 10 }} minTickGap={24} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip labelFormatter={fmtDay} />
                    <Legend />
                    <Line type="monotone" dataKey="sessions" name="Sessions" stroke="#1a1a1a" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="users" name="Users" stroke="#888" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p style={s.empty}>No traffic data.</p>}
            </div>
          </div>

          <div style={s.card}>
            <div style={s.cardTitle}>Traffic sources</div>
            {data.channels && data.channels.length ? (
              <ResponsiveContainer width="100%" height={Math.max(140, data.channels.length * 34)}>
                <BarChart data={data.channels} layout="vertical" margin={{ top: 4, right: 16, left: 24, bottom: 4 }}>
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="channel" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip />
                  <Bar dataKey="sessions" name="Sessions" fill="#1a1a1a" />
                </BarChart>
              </ResponsiveContainer>
            ) : <p style={s.empty}>No channel data.</p>}
          </div>

          {data.notes && data.notes.length > 0 && (
            <p style={{ marginTop: 12, fontSize: 12, color: '#aaa' }}>{data.notes.join(' · ')}</p>
          )}
        </>
      ) : null}
    </div>
  );
}

const s = {
  card: { background: '#fff', border: '2px solid #1a1a1a', borderRadius: 14, padding: 20 },
  cardTitle: { fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12 },
  input: { padding: '10px 12px', fontSize: 13, border: '2px solid #1a1a1a', borderRadius: 8, fontFamily: 'inherit', background: '#fff' },
  empty: { color: '#888', fontSize: 13, padding: '20px 0', margin: 0 },
};
