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

  const { clients = [], alerts = {}, recent_reports = [] } = data || {};
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
      {/* Hero — tracked context kicker, oversized title, thick rule */}
      <div className="text-[11px] font-bold tracking-[0.18em] uppercase text-subtle flex items-center gap-3.5 mb-s3">
        <span className="w-2 h-2 bg-accent rounded-pill" />
        Overview · <b className="text-ink">{clients.length} {clients.length === 1 ? 'client' : 'clients'}</b> ·{' '}
        {expiredTokens.length
          ? `${expiredTokens.length} need${expiredTokens.length === 1 ? 's' : ''} attention`
          : 'all systems nominal'}
      </div>
      <header className="flex justify-between items-end flex-wrap gap-s4 border-b border-ink pb-s5 mb-s7">
        <h1 className="text-[54px] font-extrabold leading-none tracking-[-1.6px] text-ink m-0 max-md:text-[40px]">Dashboard</h1>
        <div className="text-[13px] text-muted font-medium">{today}</div>
      </header>

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
    </div>
  );
}

// KPI block. `feature` inverts it (ink bg, accent number) to anchor the row.
function Stat({ label, value, sub, subTone, feature = false }) {
  return (
    <div className={`border border-ink rounded-md p-s5 flex flex-col gap-s3 min-h-[140px] ${feature ? 'bg-ink' : ''}`}>
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
    <div className="bg-accent-soft border border-accent rounded-md p-s5 max-md:p-s4 text-ink flex flex-col gap-s3">
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
        className="flex justify-between items-center text-[12px] font-extrabold text-ink no-underline border-t border-accent pt-s3 mt-s2"
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

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
