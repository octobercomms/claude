import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/dashboard')
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-subtle text-center p-s8">Loading dashboard…</div>;
  if (error) {
    return (
      <div className="px-s4 py-s3 rounded-sm border border-negative bg-negative-soft text-negative text-[13px] leading-[1.5] mb-s5">
        {error}
      </div>
    );
  }

  const { clients = [], alerts = {}, recent_reports = [], api_spend = null } = data || {};
  const expiredTokens = alerts.expired_meta_tokens || [];

  // Headline figures — all derived from the data the dashboard already
  // loads. No invented metrics or deltas.
  const allConnectors = clients.flatMap(c => c.connectors || []);
  const connTotal = allConnectors.length;
  const connActive = allConnectors.filter(c => c.status === 'active').length;
  const healthPct = connTotal ? Math.round((connActive / connTotal) * 100) : 0;
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div>
      {/* Hero — tracked context kicker, oversized title, thick rule.
          Renders as wrapping inline text (not a rigid flex row) so the
          line reflows cleanly on narrow screens; tighter tracking on
          mobile keeps it readable. */}
      <div className="text-[11px] font-bold tracking-[0.14em] max-md:tracking-[0.08em] uppercase text-subtle leading-[1.7] mb-s3">
        <span className="inline-block w-2 h-2 bg-accent rounded-pill align-middle mr-2" />
        Overview · <b className="text-ink">{clients.length} {clients.length === 1 ? 'client' : 'clients'}</b> ·{' '}
        {expiredTokens.length
          ? `${expiredTokens.length} need${expiredTokens.length === 1 ? 's' : ''} attention`
          : 'all systems healthy'}
      </div>
      <header className="flex justify-between items-end flex-wrap gap-s4 border-b border-ink pb-s5 mb-s7">
        <h1 className="text-[54px] font-extrabold leading-none tracking-[-1.6px] text-ink m-0 max-md:text-[40px]">Dashboard</h1>
        <div className="text-[13px] text-muted font-medium">{today}</div>
      </header>

      {api_spend && <ApiSpendBanner spend={api_spend} />}

      {expiredTokens.length > 0 && (
        <div className="px-s4 py-s3 rounded-sm border border-negative bg-negative-soft text-negative text-[13px] leading-[1.5] mb-s5">
          <strong>⚠ Meta token expired</strong> — {expiredTokens.map(t => t.client_name).join(', ')}
          {' — '}
          <Link to="/clients" className="text-inherit underline">Reauthorise</Link>
        </div>
      )}

      {/* Headline KPI strip */}
      <div className="grid grid-cols-4 gap-s4 mb-s7 max-md:grid-cols-2">
        <Stat feature label="Active clients" value={clients.length} sub="under management" />
        <Stat
          label="Connectors live"
          value={<>{connActive}<span className="text-[20px] text-subtle tracking-normal font-bold">/{connTotal}</span></>}
          sub={connTotal ? `${healthPct}% healthy` : 'none connected'}
        />
        <Stat label="Recent reports" value={recent_reports.length} sub="latest activity" />
        <Stat
          label="Needs attention"
          value={expiredTokens.length}
          sub={expiredTokens.length ? 'token expired' : 'all clear'}
          subTone={expiredTokens.length ? 'warn' : undefined}
        />
      </div>

      {/* Clients */}
      <div className="flex items-baseline justify-between mt-s7 mb-s4">
        <h2 className="text-[24px] font-extrabold tracking-[-0.5px] text-ink m-0">Clients</h2>
        <Link to="/clients" className="btn btn-primary btn-sm">View all →</Link>
      </div>
      <div className="grid gap-s4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
        {clients.map(client => (
          <ClientCard key={client.id} client={client} />
        ))}
      </div>

      {recent_reports.length > 0 && (
        <div style={{ marginTop: 'var(--s8)' }}>
          <h2 className="h2 mb-4">Recent Reports</h2>
          {/* Reports styling left untouched — uses the existing card/table/chip classes. */}
          <div className="card" style={{ padding: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  {['Client', 'Type', 'Period', 'Status', 'Sent'].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent_reports.map(r => (
                  <tr key={r.id}>
                    <td>{r.client_name}</td>
                    <td><span className="chip chip-accent">{r.report_type}</span></td>
                    <td>{formatDate(r.period_start)} – {formatDate(r.period_end)}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td>{r.sent_at ? formatDate(r.sent_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <StrategyOverview />
    </div>
  );
}

// Cross-client strategy roll-up — each client's assigned playbook + progress.
function StrategyOverview() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get('/strategy/overview').then(r => setRows(r.clients || [])).catch(() => setRows([])); }, []);
  if (!rows || !rows.length) return null;
  return (
    <div style={{ marginTop: 'var(--s8)' }}>
      <h2 className="h2 mb-4">Client strategies</h2>
      <div className="card" style={{ padding: 0 }}>
        <table className="table">
          <thead><tr>{['Client', 'Type · Stage', 'Strategy', 'Progress'].map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map(s => (
              <tr key={s.client_id}>
                <td><Link to={`/clients/${s.client_id}`} className="text-accent">{s.client_name}</Link></td>
                <td className="text-subtle" style={{ textTransform: 'capitalize' }}>{[s.business_type, s.lifecycle_stage].filter(Boolean).join(' · ') || '—'}</td>
                <td>{s.template_name || '—'}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, maxWidth: 120, height: 6, background: 'var(--surface-raised)', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ width: `${s.pct}%`, height: '100%', background: s.pct === 100 ? 'var(--positive, #1a7f37)' : 'var(--accent)' }} />
                    </div>
                    <span className="body-xs text-subtle">{s.done}/{s.total}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// KPI block. `feature` inverts it (ink bg, accent number) to anchor the row.
function Stat({ label, value, sub, subTone, feature = false }) {
  return (
    <div className={`border rounded-md p-s5 flex flex-col gap-s3 min-h-[140px] ${feature ? 'bg-ink border-ink' : 'bg-surface border-cardborder'}`}>
      <div className={`text-[11px] font-bold tracking-[0.12em] uppercase ${feature ? 'text-white/60' : 'text-muted'}`}>{label}</div>
      <div className={`text-[46px] font-extrabold leading-[0.9] tracking-[-2px] mt-auto ${feature ? 'text-accent' : 'text-ink'}`}>{value}</div>
      <div className={`text-[12px] flex items-center gap-1.5 ${feature ? 'text-white/60' : subTone === 'warn' ? 'text-warning font-semibold' : 'text-subtle'}`}>{sub}</div>
    </div>
  );
}

function ClientCard({ client }) {
  const connectors = client.connectors || [];
  const total = connectors.length;
  const active = connectors.filter(c => c.status === 'active').length;
  const errors = connectors.filter(c => ['error', 'expired'].includes(c.status)).length;
  const dotColor = errors > 0 ? 'bg-negative' : (active === total && total > 0 ? 'bg-positive' : 'bg-warning');

  return (
    <div className="bg-surface border border-cardborder rounded-md p-s5 max-md:p-s4 text-ink flex flex-col gap-s3">
      <div className="flex justify-between items-start">
        <div>
          <div className="text-[17px] font-extrabold leading-[1.2] tracking-[-0.3px] text-ink m-0">{client.name}</div>
          <div className="text-[12px] leading-[1.4] text-subtle mt-1">{client.slug}</div>
        </div>
        <div className={`w-2.5 h-2.5 rounded-pill mt-1.5 ${dotColor}`} title={`${active}/${total} connectors active`} />
      </div>
      <div className="flex flex-col flex-1 space-y-s2">
        <div className="flex justify-between text-[13px] text-muted">
          <span>Connectors</span>
          <strong className="text-ink font-semibold">{active}/{total} active</strong>
        </div>
        {client.last_report && (
          <div className="flex justify-between text-[13px] text-muted">
            <span>Last report</span>
            <strong className="text-ink font-semibold">
              <StatusBadge status={client.last_report.status} /> {formatDate(client.last_report.created_at)}
            </strong>
          </div>
        )}
      </div>
      <Link
        to={`/clients/${client.id}/sales-traffic`}
        className="flex justify-between items-center text-[12px] font-extrabold text-ink no-underline border-t border-cardborder pt-s3 mt-s2"
      >
        <span>Manage client</span>
        <span className="text-[15px]">→</span>
      </Link>
    </div>
  );
}

// Shared chip primitive — also used in the Reports table, so left on the
// existing .chip classes.
function StatusBadge({ status }) {
  const tone = {
    sent: 'success', generated: 'accent', generating: 'warning',
    pending: 'neutral', failed: 'danger', sending: 'warning',
  }[status] || 'neutral';
  return <span className={`chip chip-${tone}`}>{status}</span>;
}

// Combined API spend this month — single dark bar, just the cost. Sums every
// provider's cost_this_period in USD (most providers report in USD; non-USD
// reads keep their own currency line). The daily figure is month-to-date
// average, not a rolling 7-day window — matches how the AM thinks about the
// monthly bill.
function ApiSpendBanner({ spend }) {
  const entries = Object.entries(spend.totals || {});
  const usdTotal = Number(spend.totals?.USD || 0);
  const hasSpend = entries.length > 0;

  // Month-to-date daily average — total / days elapsed this month. Resets to
  // a tiny denominator on the 1st (intentional: a high early-month rate
  // should look high). Uses the same period_start the server returned so we
  // don't have a clock-skew off-by-one.
  const start = spend.period_start ? new Date(spend.period_start) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const today = new Date();
  const elapsedDays = Math.max(1, Math.ceil((today - start) / 86400000));
  const dailyAvg = usdTotal / elapsedDays;

  // Burn-rate thresholds — month-to-date now, not 7-day. $5/day amber,
  // $15/day red. Same dial as before; just measured against MTD.
  const flag = dailyAvg > 15 ? 'red' : dailyAvg > 5 ? 'amber' : 'green';
  const dotColor = flag === 'red' ? 'bg-red-500' : flag === 'amber' ? 'bg-yellow-400' : 'bg-accent';
  const ring = flag === 'red' ? 'ring-2 ring-red-500/60 bg-red-900/40'
    : flag === 'amber' ? 'ring-2 ring-yellow-400/40 bg-ink'
    : 'bg-ink';

  return (
    <div className={`flex items-center gap-3 flex-wrap ${ring} rounded-md px-s5 py-s3 mb-s5`}>
      <span className={`w-2 h-2 rounded-pill ${dotColor}`} />
      <span className="text-[13px] text-white">
        <strong>API spend this month:</strong>{' '}
        {hasSpend
          ? <span className="text-accent font-bold">{entries.map(([cur, amt]) => fmtMoney(amt, cur)).join(' + ')}</span>
          : <span className="text-white/70">not reported yet</span>}
        {hasSpend && (
          <span className={`ml-3 text-[12px] ${flag === 'red' ? 'text-red-300 font-bold' : flag === 'amber' ? 'text-yellow-200' : 'text-white/55'}`}>
            · ${dailyAvg.toFixed(2)}/day average{flag === 'red' ? ' — burning fast' : ''}
          </span>
        )}
      </span>
      <Link to="/settings" className="ml-auto text-[12px] font-bold text-accent no-underline">Breakdown →</Link>
    </div>
  );
}

function fmtMoney(value, currency) {
  const c = currency || 'USD';
  try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(value || 0); }
  catch { return `${c} ${(value || 0).toFixed(2)}`; }
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
