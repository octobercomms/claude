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

  return (
    <div>
      <header className="mb-s7">
        <h1 className="text-[48px] font-bold leading-[1.05] tracking-[-1.2px] text-ink m-0 max-md:text-[36px] max-md:tracking-[-1px]">
          Dashboard
        </h1>
      </header>

      {expiredTokens.length > 0 && (
        <div className="px-s4 py-s3 rounded-sm border border-negative bg-negative-soft text-negative text-[13px] leading-[1.5] mb-s5">
          <strong>⚠ Meta token expired</strong> — {expiredTokens.map(t => t.client_name).join(', ')}
          {' — '}
          <Link to="/clients" className="text-inherit underline">Reauthorise</Link>
        </div>
      )}

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
          <div className="text-[15px] font-semibold leading-[1.3] text-ink m-0">{client.name}</div>
          <div className="text-[12px] leading-[1.4] text-subtle mt-s2">{client.slug}</div>
        </div>
        <div className={`w-2.5 h-2.5 rounded-pill mt-1 ${dotColor}`} title={`${active}/${total} connectors active`} />
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
        className="text-[12px] text-accent no-underline font-bold border-t border-accent-soft pt-s3 mt-s2"
      >
        Manage client →
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
