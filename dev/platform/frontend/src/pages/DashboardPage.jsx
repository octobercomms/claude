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

  if (loading) return <div style={styles.loading}>Loading dashboard…</div>;
  if (error) return <div style={styles.errorBanner}>{error}</div>;

  const { clients = [], alerts = {}, recent_reports = [] } = data || {};
  const expiredTokens = alerts.expired_meta_tokens || [];

  return (
    <div className="suite-social">
      <header className="hero">
        <h1 className="display">Dashboard</h1>
      </header>

      {expiredTokens.length > 0 && (
        <div style={styles.alertBanner}>
          <strong>⚠ Meta token expired</strong> — {expiredTokens.map(t => t.client_name).join(', ')}
          {' — '}
          <Link to="/clients" style={{ color: '#fff', textDecoration: 'underline' }}>Reauthorise</Link>
        </div>
      )}

      <div style={styles.grid}>
        {clients.map(client => (
          <ClientCard key={client.id} client={client} />
        ))}
      </div>

      {recent_reports.length > 0 && (
        <div style={{ marginTop: 40 }}>
          <h2 className="h2">Recent Reports</h2>
          <div className="card">
            <table className="table">
              <thead>
                <tr>
                  {['Client', 'Type', 'Period', 'Status', 'Sent'].map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent_reports.map(r => (
                  <tr key={r.id}>
                    <td style={styles.td}>{r.client_name}</td>
                    <td style={styles.td}><span style={styles.badge(r.report_type)}>{r.report_type}</span></td>
                    <td style={styles.td}>{formatDate(r.period_start)} – {formatDate(r.period_end)}</td>
                    <td style={styles.td}><StatusBadge status={r.status} /></td>
                    <td style={styles.td}>{r.sent_at ? formatDate(r.sent_at) : '—'}</td>
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
  const healthColor = errors > 0 ? '#c62828' : active === total && total > 0 ? '#2e7d32' : '#f57c00';

  return (
    <div className="card">
      <div style={styles.cardHeader}>
        <div>
          <div style={styles.clientName}>{client.name}</div>
          <div style={styles.clientSlug}>{client.slug}</div>
        </div>
        <div style={{ ...styles.healthDot, background: healthColor }} title={`${active}/${total} connectors active`} />
      </div>
      <div style={styles.cardBody}>
        <div style={styles.statRow}>
          <span style={styles.statLabel}>Connectors</span>
          <span style={styles.statValue}>{active}/{total} active</span>
        </div>
        {client.last_report && (
          <div style={styles.statRow}>
            <span style={styles.statLabel}>Last report</span>
            <span style={styles.statValue}>
              <StatusBadge status={client.last_report.status} /> {formatDate(client.last_report.created_at)}
            </span>
          </div>
        )}
      </div>
      <Link to={`/clients/${client.id}/sales-traffic`} style={styles.cardLink}>Manage client →</Link>
    </div>
  );
}

function StatusBadge({ status }) {
  const colors = {
    sent: '#2e7d32', generated: '#1565c0', generating: '#f57c00',
    pending: '#888', failed: '#c62828', sending: '#f57c00',
  };
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: colors[status] || '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {status}
    </span>
  );
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const styles = {
  pageTitle: { fontSize: 32, fontWeight: 700, marginBottom: 24, color: '#1a1a1a', letterSpacing: -0.6 },
  loading: { color: '#888', padding: 40, textAlign: 'center' },
  errorBanner: { background: '#fff0f0', color: '#c62828', padding: '12px 16px', borderRadius: 8, marginBottom: 24, border: '2px solid #c62828' },
  alertBanner: { background: '#c62828', color: 'white', padding: '12px 20px', borderRadius: 8, marginBottom: 24, fontSize: 14, border: '2px solid #c62828' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 },
  card: { background: 'var(--accent-soft)', borderRadius: 14, padding: 20, border: '2px solid var(--accent)', display: 'flex', flexDirection: 'column', gap: 12 },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  clientName: { fontSize: 16, fontWeight: 700, color: '#1a1a1a' },
  clientSlug: { fontSize: 11, color: '#888', marginTop: 2 },
  healthDot: { width: 10, height: 10, borderRadius: '50%', marginTop: 4 },
  cardBody: { display: 'flex', flexDirection: 'column', gap: 8, flex: 1 },
  statRow: { display: 'flex', justifyContent: 'space-between', fontSize: 13 },
  statLabel: { color: '#888' },
  statValue: { color: '#1a1a1a', fontWeight: 600 },
  cardLink: { fontSize: 12, color: 'var(--accent)', textDecoration: 'none', fontWeight: 700, borderTop: '2px solid #f3f3f3', paddingTop: 12, marginTop: 4 },
  sectionTitle: { fontSize: 22, fontWeight: 700, marginBottom: 16, color: '#1a1a1a', letterSpacing: -0.3 },
  tableWrap: { background: 'var(--accent-soft)', border: '2px solid var(--accent)', borderRadius: 14, overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { padding: '12px 16px', textAlign: 'left', background: '#fafafa', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2, color: '#888', borderBottom: '2px solid #1a1a1a' },
  td: { padding: '12px 16px', borderBottom: '2px solid #f3f3f3', color: '#333' },
  badge: (type) => ({ background: type === 'monthly' ? 'rgba(231,205,65,0.15)' : 'rgba(124,129,45,0.15)', color: type === 'monthly' ? '#7a6500' : '#5d6020', padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, border: '1px solid currentColor' }),
};
