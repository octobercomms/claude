// Clients — the agency's one client list. Replaces the old split between
// /dashboard (summary cards) and /clients (a name/slug/status table): they
// were the same list twice, and the summary linked to the table.
//
// One obvious job on this page: open a client. The cards are that action, and
// nothing else on the page is a table you have to read. The filter row only
// appears once there is something archived to filter.
//
// It used to carry three cross-client roll-ups (recent reports, client
// strategies, PR to backlinks) inherited from the old Dashboard. They answered
// agency questions on a page about opening one client, so they are gone: the
// report figure is a KPI, strategy progress is a line on each card, and the PR
// leaderboard moved to each client's Earned page where it is scoped properly.
//
// The list is fetched twice over, deliberately: /clients is the spine (it is
// the only endpoint that returns archived clients, and carries `active`),
// enriched by id from /dashboard (connectors, last report, spend, alerts),
// which returns active clients only.

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import ClientHomeDashboard from '../components/ClientHomeDashboard';
import Pip from '../components/ui/Pip';
import { mergeClientList, summariseClients, filterClients, autoSlug } from '../utils/clientList';
import { reportStatusLabel, reportStatusTone } from '../utils/reportStatus';

export default function ClientsPage() {
  const { readOnly } = useAuth();
  const [clients, setClients] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [newClient, setNewClient] = useState({ name: '', slug: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  // Filter — default to Active so the day-to-day list stays tidy. Archived
  // clients are historical records kept for the editorial-log / publications
  // history, not for active work.
  const [filter, setFilter] = useState('active'); // 'active' | 'archived' | 'all'

  // A client (read-only) login never sees the all-clients directory — they get
  // their own personalised landing instead.
  useEffect(() => {
    if (readOnly) { setLoading(false); return; }
    Promise.all([
      api.get('/clients'),
      api.get('/dashboard').catch(() => null),
    ])
      .then(([list, dash]) => { setClients(list || []); setSummary(dash); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  async function handleCreate(e) {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      const created = await api.post('/clients', newClient);
      setClients(prev => [...prev, created]);
      setShowNew(false);
      setNewClient({ name: '', slug: '' });
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  }

  if (readOnly) return <ClientHomeDashboard />;

  if (loading) return <div className="text-subtle text-center p-s8">Loading clients…</div>;
  if (error) {
    return (
      <div className="px-s4 py-s3 rounded-sm border border-negative bg-negative-soft text-negative text-[length:var(--fs-body)] leading-[1.5] mb-s5">
        {error}
      </div>
    );
  }

  const { alerts = {}, report_health: health = {}, api_spend: apiSpend = null } = summary || {};
  const sentCount = health.sent || 0;
  const skippedCount = health.skipped_no_recipients || 0;
  const failedCount = health.failed || 0;
  const expiredTokens = alerts.expired_meta_tokens || [];

  // Enrich the spine with the summary's connector / last-report data. The rule
  // (and the trap in it) lives in utils/clientList.js, guarded by tests.
  const rows = mergeClientList(clients, summary?.clients);
  const visible = filterClients(rows, filter);
  const { activeCount, archivedCount, connTotal, connActive, healthPct } = summariseClients(rows);

  // Headline figures — all derived from what is already loaded. No invented
  // metrics or deltas.
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div>
      <div className="text-[length:var(--fs-caption)] font-bold tracking-[0.14em] max-md:tracking-[0.08em] uppercase text-subtle leading-[1.7] mb-s3">
        <span className="inline-block w-2 h-2 bg-accent rounded-pill align-middle mr-2" />
        Client directory · <b className="text-ink">{activeCount} {activeCount === 1 ? 'client' : 'clients'}</b> ·{' '}
        {expiredTokens.length
          ? `${expiredTokens.length} need${expiredTokens.length === 1 ? 's' : ''} attention`
          : 'all systems healthy'}
      </div>
      <header className="flex justify-between items-end flex-wrap gap-s4 border-b border-ink pb-s5 mb-s7">
        <h1 className="text-[length:var(--fs-display)] font-extrabold leading-none tracking-[-1.6px] text-ink m-0">Clients</h1>
        <div className="text-[length:var(--fs-body)] text-muted font-medium">{today}</div>
      </header>

      {apiSpend && <ApiSpendBanner spend={apiSpend} />}

      {expiredTokens.length > 0 && (
        <div className="px-s4 py-s3 rounded-sm border border-negative bg-negative-soft text-negative text-[length:var(--fs-body)] leading-[1.5] mb-s5">
          <strong>⚠ Meta token expired</strong>{' — '}
          {expiredTokens.map((t, i) => (
            <React.Fragment key={t.id}>
              {i > 0 && ', '}
              <Link to={`/clients/${t.client_id}?tab=connectors`} className="text-inherit underline">{t.client_name}</Link>
            </React.Fragment>
          ))}
        </div>
      )}

      <div className="grid grid-cols-4 gap-s4 mb-s7 max-md:grid-cols-2">
        <Stat feature label="Active clients" value={activeCount} sub="under management" />
        <Stat
          label="Connectors live"
          value={<>{connActive}<span className="text-[length:var(--fs-title)] text-subtle tracking-normal font-bold">/{connTotal}</span></>}
          sub={connTotal ? `${healthPct}% healthy` : 'none connected'}
        />
        {/* Reports this week. Always a link: making it conditional on there
            being a problem meant that in a quiet week the tile was inert, and
            Reports is not in the nav, so the tile was its only door.

            The number that matters is not how many ran, it
            is how many reached anyone: a skipped report was generated in full
            (connector pulls, a Claude narrative, a PDF) and then binned for
            having no recipients, at the same cost as a delivered one. */}
        <Stat
          label="Reports this week"
          value={sentCount}
          sub={`${skippedCount || failedCount
            ? [skippedCount && `${skippedCount} not sent, no recipients`, failedCount && `${failedCount} failed`].filter(Boolean).join(' · ')
            : (health.total ? 'all delivered' : 'none scheduled this week')} →`}
          subTone={skippedCount || failedCount ? 'warn' : undefined}
          to={skippedCount || failedCount
            ? '/settings?tab=reports&status=skipped_no_recipients'
            : '/settings?tab=reports'}
        />
        <Stat
          label="Needs attention"
          value={expiredTokens.length}
          sub={expiredTokens.length ? 'token expired' : 'all clear'}
          subTone={expiredTokens.length ? 'warn' : undefined}
        />
      </div>

      {/* Secondary controls. The archive filter only exists once something is
          archived — an option that cannot apply yet is noise. */}
      <div className="flex items-center justify-between flex-wrap gap-s3 mb-s4">
        <div className="flex items-center gap-s2 flex-wrap">
          {archivedCount > 0 && ['active', 'archived', 'all'].map(k => (
            <button key={k} type="button"
              onClick={() => setFilter(k)}
              className={`tab ${filter === k ? 'active' : ''}`}
              style={{ textTransform: 'capitalize' }}>
              {k}
              {k === 'archived' ? ` (${archivedCount})` : ''}
            </button>
          ))}
        </div>
        <button onClick={() => setShowNew(s => !s)} className="btn btn-secondary btn-sm">
          {showNew ? 'Cancel' : '+ New client'}
        </button>
      </div>

      {showNew && (
        <div className="card mb-s5">
          <h3 style={{ margin: '0 0 var(--s4)', fontSize: 'var(--fs-body)' }}>New client</h3>
          <form onSubmit={handleCreate}>
            {createError && <div className="text-negative">{createError}</div>}
            <div className="field">
              <label className="field-label">Client name</label>
              <input
                className="input" value={newClient.name} required
                onChange={e => setNewClient(p => ({ ...p, name: e.target.value, slug: autoSlug(e.target.value) }))}
              />
            </div>
            <div className="field">
              <label className="field-label">Slug</label>
              <input
                className="input" value={newClient.slug} required
                onChange={e => setNewClient(p => ({ ...p, slug: e.target.value }))}
              />
            </div>
            <div style={{ display: 'flex', gap: 'var(--s2)' }}>
              <button type="submit" className="btn btn-primary" disabled={creating}>{creating ? 'Creating…' : 'Create'}</button>
              <button type="button" onClick={() => setShowNew(false)} className="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="grid gap-s4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
        {visible.map(client => <ClientCard key={client.id} client={client} />)}
      </div>
      {!visible.length && (
        <div className="card text-center text-subtle" style={{ padding: 'var(--s6)' }}>
          No {filter === 'archived' ? 'archived' : filter === 'active' ? 'active' : ''} clients.
        </div>
      )}
    </div>
  );
}

// KPI block. `feature` inverts it (ink bg, accent number) to anchor the row.
// `to` makes the whole tile a link, for a figure you would want to act on.
function Stat({ label, value, sub, subTone, feature = false, fn, to }) {
  const Box = to ? Link : 'div';
  const boxProps = to ? { to } : {};
  return (
    <Box
      {...boxProps}
      className={`border rounded-md p-s5 flex flex-col gap-s3 min-h-[140px] no-underline ${feature ? 'bg-ink border-ink' : 'bg-surface border-cardborder'} ${to ? 'hover:border-ink' : ''}`}>
      <div className={`text-[length:var(--fs-caption)] font-bold tracking-[0.12em] uppercase ${feature ? 'text-white/60' : 'text-muted'}`}>{fn && <Pip fn={fn} />}{label}</div>
      <div className={`text-[length:var(--fs-display)] font-extrabold leading-[0.9] tracking-[-2px] mt-auto ${feature ? 'text-white' : 'text-ink'}`}>{value}</div>
      <div className={`text-[length:var(--fs-caption)] flex items-center gap-1.5 ${feature ? 'text-white/60' : subTone === 'warn' ? 'text-warning font-semibold' : 'text-subtle'}`}>{sub}</div>
    </Box>
  );
}

function ClientCard({ client }) {
  const connectors = client.connectors || [];
  const total = connectors.length;
  const active = connectors.filter(c => c.status === 'active').length;
  const errors = connectors.filter(c => ['error', 'expired'].includes(c.status)).length;
  const dotColor = errors > 0 ? 'bg-negative' : (active === total && total > 0 ? 'bg-positive' : 'bg-warning');

  return (
    <div className={`bg-surface border border-cardborder rounded-md p-s5 max-md:p-s4 text-ink flex flex-col gap-s3 ${client.active ? '' : 'opacity-70'}`}>
      <div className="flex justify-between items-start">
        <div>
          <div className="text-[length:var(--fs-title)] font-extrabold leading-[1.2] tracking-[-0.3px] text-ink m-0">{client.name}</div>
          <div className="text-[length:var(--fs-caption)] leading-[1.4] text-subtle mt-1">{client.slug}</div>
        </div>
        {client.active
          ? <div className={`w-2.5 h-2.5 rounded-pill mt-1.5 ${dotColor}`} title={`${active}/${total} connectors active`} />
          : <span className="chip chip-neutral">Archived</span>}
      </div>
      <div className="flex flex-col flex-1 space-y-s2">
        {client.active && (
          <div className="flex justify-between text-[length:var(--fs-body)] text-muted">
            <span>Connectors</span>
            <strong className="text-ink font-semibold">{active}/{total} active</strong>
          </div>
        )}
        {client.last_report && (
          <div className="flex justify-between text-[length:var(--fs-body)] text-muted">
            <span>Last report</span>
            <strong className="text-ink font-semibold">
              <StatusBadge status={client.last_report.status} /> {formatDate(client.last_report.created_at)}
            </strong>
          </div>
        )}
        {client.active && client.strategy && client.strategy.total > 0 && (
          <div className="flex justify-between items-center gap-s2 text-[length:var(--fs-body)] text-muted">
            <span className="truncate" title={client.strategy.template_name || 'Strategy'}>
              {client.strategy.template_name || 'Strategy'}
            </span>
            <span className="flex items-center gap-s2 flex-none">
              <span className="block w-[70px] h-1.5 rounded-pill bg-surface-sunken overflow-hidden">
                <span
                  className={`block h-full ${client.strategy.pct === 100 ? 'bg-positive' : 'bg-accent'}`}
                  style={{ width: `${client.strategy.pct}%` }}
                />
              </span>
              <strong className="text-ink font-semibold">{client.strategy.done}/{client.strategy.total}</strong>
            </span>
          </div>
        )}
      </div>
      <Link
        to={`/clients/${client.id}/sales-traffic`}
        className="flex justify-between items-center text-[length:var(--fs-caption)] font-extrabold text-ink no-underline border-t border-cardborder pt-s3 mt-s2"
      >
        <span>Manage client</span>
        <span className="text-[length:var(--fs-body)]">→</span>
      </Link>
    </div>
  );
}

function StatusBadge({ status }) {
  return <span className={`chip chip-${reportStatusTone(status)}`}>{reportStatusLabel(status)}</span>;
}

// Combined API spend this month — single dark bar, just the cost. Sums every
// provider's cost_this_period in USD (most providers report in USD; non-USD
// reads keep their own currency line). The daily figure is month-to-date
// average, not a rolling 7-day window.
function ApiSpendBanner({ spend }) {
  const entries = Object.entries(spend.totals || {});
  const usdTotal = Number(spend.totals?.USD || 0);
  const hasSpend = entries.length > 0;

  const start = spend.period_start ? new Date(spend.period_start) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const today = new Date();
  const elapsedDays = Math.max(1, Math.ceil((today - start) / 86400000));
  const dailyAvg = usdTotal / elapsedDays;

  // Burn-rate thresholds — month-to-date. $5/day amber, $15/day red.
  const flag = dailyAvg > 15 ? 'red' : dailyAvg > 5 ? 'amber' : 'green';
  const dotColor = flag === 'red' ? 'bg-red-500' : flag === 'amber' ? 'bg-yellow-400' : 'bg-accent';
  const ring = flag === 'red' ? 'ring-2 ring-red-500/60 bg-red-900/40'
    : flag === 'amber' ? 'ring-2 ring-yellow-400/40 bg-ink'
    : 'bg-ink';

  return (
    <div className={`flex items-center gap-3 flex-wrap ${ring} rounded-md px-s5 py-s3 mb-s5`}>
      <span className={`w-2 h-2 rounded-pill ${dotColor}`} />
      <span className="text-[length:var(--fs-body)] text-white">
        <strong>API spend this month:</strong>{' '}
        {hasSpend
          ? <span className="text-accent font-bold">{entries.map(([cur, amt]) => fmtMoney(amt, cur)).join(' + ')}</span>
          : <span className="text-white/70">not reported yet</span>}
        {hasSpend && (
          <span className={`ml-3 text-[length:var(--fs-caption)] ${flag === 'red' ? 'text-red-300 font-bold' : flag === 'amber' ? 'text-yellow-200' : 'text-white/55'}`}>
            · ${dailyAvg.toFixed(2)}/day average{flag === 'red' ? ' — burning fast' : ''}
          </span>
        )}
      </span>
      <Link to="/settings" className="ml-auto text-[length:var(--fs-caption)] font-bold text-white underline">Breakdown →</Link>
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
