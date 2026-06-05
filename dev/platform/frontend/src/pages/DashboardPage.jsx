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

  if (loading) return <div className="text-subtle" style={{ padding: 40, textAlign: 'center' }}>Loading dashboard…</div>;
  if (error) return <div className="callout callout-danger">{error}</div>;

  const { clients = [], alerts = {}, recent_reports = [] } = data || {};
  const expiredTokens = alerts.expired_meta_tokens || [];

  return (
    <div className="suite-social">
      <header className="hero">
        <h1 className="display">Dashboard</h1>
      </header>

      {expiredTokens.length > 0 && (
        <div className="callout callout-danger">
          <strong>⚠ Meta token expired</strong> — {expiredTokens.map(t => t.client_name).join(', ')}
          {' — '}
          <Link to="/clients" style={{ color: 'inherit', textDecoration: 'underline' }}>Reauthorise</Link>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {clients.map(client => (
          <ClientCard key={client.id} client={client} />
        ))}
      </div>

      {recent_reports.length > 0 && (
        <div style={{ marginTop: 'var(--s8)' }}>
          <h2 className="h2 mb-4">Recent Reports</h2>
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
  const healthClass = errors > 0 ? 'error' : (active === total && total > 0 ? 'ok' : 'warn');

  return (
    <div className="card card-stat">
      <div className="card-stat-head">
        <div>
          <div className="h3">{client.name}</div>
          <div className="body-xs text-subtle mt-2">{client.slug}</div>
        </div>
        <div className={`health-dot ${healthClass}`} title={`${active}/${total} connectors active`} />
      </div>
      <div className="stack stack-sm" style={{ flex: 1 }}>
        <div className="card-stat-row">
          <span>Connectors</span>
          <strong>{active}/{total} active</strong>
        </div>
        {client.last_report && (
          <div className="card-stat-row">
            <span>Last report</span>
            <strong>
              <StatusBadge status={client.last_report.status} /> {formatDate(client.last_report.created_at)}
            </strong>
          </div>
        )}
      </div>
      <Link to={`/clients/${client.id}/sales-traffic`} className="card-stat-link">Manage client →</Link>
    </div>
  );
}

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
