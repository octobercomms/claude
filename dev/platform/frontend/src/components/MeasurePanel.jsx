// Measure — the client's live numbers: revenue, orders, traffic, channels and
// the store detail, over a range you pick.
//
// It was the "Measure" tab inside Data, where you had to decide to go and look
// at data as a thing in itself. It is now the first tab of the client
// Dashboard, because it is the question you actually arrive with. The panel is
// self-contained — its own range state, its own fetch, its own chart colours
// read from whatever suite scope it is rendered inside — so it can be mounted
// anywhere without the host page knowing anything about sales-traffic.
//
// The same self-containment is what lets Measure later appear inside each PESO
// page against that page's own frame, which is the agreed next step. Nothing
// here assumes it is the only copy on screen.

import React, { useEffect, useRef, useState } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../utils/api';
import StatStrip from './shells/StatStrip';
import { useCssVar } from '../hooks/useCssVar';

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

export default function MeasurePanel({ clientId }) {
  const scopeRef = useRef(null);
  // Chart series colours from the function palette, each with strong contrast
  // on white so two lines never blur into one. Read from the live scope so a
  // palette change carries without touching hex here.
  const cRevenue = useCssVar('--fn-strategy', '#0d9488', scopeRef);
  const cOrders = useCssVar('--fn-approve', '#db2777', scopeRef);
  const cSessions = useCssVar('--fn-distribute', '#0284c7', scopeRef);
  const cUsers = useCssVar('--fn-create', '#7c3aed', scopeRef);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [start, setStart] = useState(() => isoDaysAgo(29));
  const [end, setEnd] = useState(() => isoToday());
  const [activeKey, setActiveKey] = useState('d30');
  const [showCustom, setShowCustom] = useState(false);
  const [customStart, setCustomStart] = useState(() => isoDaysAgo(29));
  const [customEnd, setCustomEnd] = useState(() => isoToday());

  useEffect(() => {
    if (!clientId) return;
    setLoading(true);
    api.get(`/sales-traffic/${clientId}?start=${start}&end=${end}`)
      .then(setData)
      .catch(err => setData({ error: err.message }))
      .finally(() => setLoading(false));
  }, [clientId, start, end]);

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

  // Advisory store detail — refunds, discounts, new-vs-returning, product mix.
  // Present only when a store connector is live.
  const ecom = data && data.ecom;
  const hasEcom = ecom && (Number(k.orders) > 0 || Number(ecom.netRevenue) !== 0);
  const ecomCards = hasEcom ? [
    { label: 'Net revenue', value: fmtMoney(ecom.netRevenue), sub: 'after refunds' },
    { label: 'Refund rate', value: (Number(ecom.refundRate) || 0).toFixed(1) + '%', sub: `${fmtMoney(ecom.refunds)} · ${fmtNum(ecom.refundedOrders)} orders` },
    { label: 'On discount', value: (Number(ecom.discountRate) || 0).toFixed(1) + '%', sub: `${fmtMoney(ecom.discounts)} given away` },
    {
      label: 'Returning', value: (() => {
        const known = Number(ecom.newCustomerOrders) + Number(ecom.returningCustomerOrders);
        return known ? Math.round((Number(ecom.returningCustomerOrders) / known) * 100) + '%' : '—';
      })(), sub: `${fmtNum(ecom.returningCustomerOrders)} returning · ${fmtNum(ecom.newCustomerOrders)} new`
    },
  ] : [];

  return (
    <div ref={scopeRef}>
      {showCustom && (
        <div className="row mb-4" style={{ alignItems: 'center', gap: 'var(--s2)' }}>
          <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
            className="input" style={{ width: 'auto' }} />
          <span style={{ color: 'var(--text-subtle)', fontSize: 'var(--fs-body)' }}>to</span>
          <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
            className="input" style={{ width: 'auto' }} />
          <button onClick={applyCustom} className="btn btn-primary">Apply</button>
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
            className="select" style={{ width: 'auto' }}>
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
          <div style={{ marginBottom: 'var(--s5)' }}>
            <StatStrip items={cards.map((c, i) => ({ ...c, feature: i === 0 }))} />
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
              ) : <p className="body-sm text-subtle" style={{ padding: 'var(--s5) 0', margin: 0 }}>No sales trend data.</p>}
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
              ) : <p className="body-sm text-subtle" style={{ padding: 'var(--s5) 0', margin: 0 }}>No traffic data.</p>}
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
            ) : <p className="body-sm text-subtle" style={{ padding: 'var(--s5) 0', margin: 0 }}>No channel data.</p>}
          </div>

          {hasEcom && (
            <div style={{ marginTop: 'var(--s4)' }}>
              <div style={{ marginBottom: 'var(--s5)' }}>
                <StatStrip items={ecomCards} />
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
    </div>
  );
}
