import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { Card, Label } from '../components/ui';

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

  if (loading) return <div className="text-gray-500 p-10 text-center">Loading dashboard…</div>;
  if (error) return <div className="bg-[#fff0f0] text-danger px-4 py-3 rounded mb-6">{error}</div>;

  const { clients = [], alerts = {}, recent_reports = [] } = data || {};
  const expiredTokens = alerts.expired_meta_tokens || [];

  return (
    <div>
      <h1 className="font-sans font-extrabold text-[34px] leading-none tracking-tightest text-ink mb-6">Dashboard</h1>

      {expiredTokens.length > 0 && (
        <div className="bg-danger text-white px-5 py-3 rounded mb-6 text-sm">
          <strong>⚠ Meta token expired</strong> — {expiredTokens.map(t => t.client_name).join(', ')}
          {' — '}
          <Link to="/clients" className="text-white underline">Reauthorise</Link>
        </div>
      )}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
        {clients.map(client => (
          <ClientCard key={client.id} client={client} />
        ))}
      </div>

      {recent_reports.length > 0 && (
        <div style={{ marginTop: 40 }}>
          <h2 style={styles.sectionTitle}>Recent Reports</h2>
          {/* Reports styling left untouched per request. */}
          <div style={styles.tableWrap}>
            <table style={styles.table}>
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
  const healthColor = errors > 0 ? 'var(--danger)' : active === total && total > 0 ? 'var(--success)' : '#f57c00';

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex justify-between items-start">
        <div>
          <div className="font-sans font-bold text-[15px] text-ink">{client.name}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">{client.slug}</div>
        </div>
        <div
          className="w-2.5 h-2.5 rounded-full mt-1 shrink-0"
          style={{ background: healthColor }}
          title={`${active}/${total} connectors active`}
        />
      </div>
      <div className="flex flex-col gap-2 flex-1">
        <div className="flex justify-between text-[13px]">
          <span className="text-gray-500">Connectors</span>
          <span className="text-ink font-medium">{active}/{total} active</span>
        </div>
        {client.last_report && (
          <div className="flex justify-between text-[13px]">
            <span className="text-gray-500">Last report</span>
            <span className="text-ink font-medium">
              <StatusBadge status={client.last_report.status} /> {formatDate(client.last_report.created_at)}
            </span>
          </div>
        )}
      </div>
      <Link
        to={`/clients/${client.id}/sales-traffic`}
        className="text-xs text-ink no-underline font-semibold border-t border-line pt-3 mt-1 hover:text-yellow-ink transition-colors"
      >
        Manage client →
      </Link>
    </Card>
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

// Retained styles — Recent Reports table only (Reports styling is off-limits).
const styles = {
  sectionTitle: { fontSize: 16, fontWeight: 700, marginBottom: 16, color: '#1a1a1a' },
  tableWrap: { background: 'white', border: '1px solid #e8e8e8', borderRadius: 6, overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { padding: '10px 16px', textAlign: 'left', background: '#f9f9f9', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#666', borderBottom: '1px solid #e8e8e8' },
  td: { padding: '10px 16px', borderBottom: '1px solid #f5f5f5', color: '#333' },
  badge: (type) => ({ background: type === 'monthly' ? '#e3f2fd' : '#e8f5e9', color: type === 'monthly' ? '#1565c0' : '#2e7d32', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }),
};
