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

export default function ClientSalesTrafficPage() {
  const { id } = useParams();
  const [client, setClient] = useState(null);
  const [data, setData] = useState(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api.get(`/clients/${id}`).then(setClient).catch(() => {}); }, [id]);

  useEffect(() => {
    setLoading(true);
    api.get(`/sales-traffic/${id}?days=${days}`)
      .then(setData)
      .catch(err => setData({ error: err.message }))
      .finally(() => setLoading(false));
  }, [id, days]);

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
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Sales &amp; Traffic — {client?.name || ''}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {[7, 14, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)}
              style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #ddd', background: days === d ? '#1a1a1a' : '#fff', color: days === d ? '#fff' : '#333', fontSize: 13, cursor: 'pointer' }}>
              {d}d
            </button>
          ))}
        </div>
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
  card: { background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8, padding: 16 },
  cardTitle: { fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  input: { padding: '7px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, fontFamily: 'inherit' },
  empty: { color: '#888', fontSize: 13, padding: '20px 0', margin: 0 },
};
