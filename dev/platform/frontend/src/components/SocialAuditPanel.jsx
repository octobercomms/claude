// Social → Performance → AI Audit. Runs Claude over this account's own
// published-post performance (content mix, timing, what's working, competitor
// read) and shows a structured audit with recommendations. Built on the
// engagement data OMI already ingests — no third-party connector.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { roWrite } from '../utils/readOnly';
import { useAuth } from '../context/AuthContext';

function fmt(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ts; }
}

function List({ title, items, accent }) {
  if (!items || !items.length) return null;
  return (
    <div>
      <div className="caption" style={{ marginBottom: 6 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {items.map((x, i) => <li key={i} className="body-sm" style={{ marginBottom: 4, color: accent }}>{x}</li>)}
      </ul>
    </div>
  );
}

export default function SocialAuditPanel({ clientId }) {
  const toast = useToast();
  const { readOnly } = useAuth();
  const [audit, setAudit] = useState(null);
  const [running, setRunning] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    try { const r = await api.get(`/social/clients/${clientId}/audit`); setAudit(r.audit || null); }
    catch (e) { toast(e.message, 'error'); }
    finally { setLoaded(true); }
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [clientId]);

  async function run() {
    setRunning(true);
    try { const r = await api.post(`/social/clients/${clientId}/audit/run`, {}); setAudit(r.audit); toast('Audit complete.', 'success'); }
    catch (e) { toast(e.message, 'error'); }
    finally { setRunning(false); }
  }

  const d = audit?.data || {};

  return (
    <div className="stack-lg">
      <div className="row between center" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="caption">AI Audit</div>
          <div className="h2 mt-2">How this account is actually performing</div>
        </div>
        <button className="btn btn-primary" {...roWrite(readOnly, { onClick: run, disabled: running })}>{running ? 'Auditing…' : (audit ? 'Re-run audit' : 'Run audit')}</button>
      </div>
      <p className="body" style={{ maxWidth: 640 }}>
        Claude reads your own published-post performance — content mix, best posting times, what's working, and how you
        compare to competitors — and gives you a sharp, data-grounded audit. Runs on the engagement OMI already pulls daily.
      </p>

      {!loaded ? <div className="text-subtle">Loading…</div> : !audit ? (
        <div className="text-subtle">No audit yet — run one once a few posts are published and marked published.</div>
      ) : (
        <div className="stack-lg">
          <div className="body-xs text-subtle">Last run {fmt(audit.generated_at)} · {audit.post_count} posts · last {audit.period_days} days</div>
          {d.summary && <div className="card"><p className="body" style={{ margin: 0 }}>{d.summary}</p></div>}
          <div className="audit-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s4) var(--s5)', alignItems: 'start' }}>
            {d.content_mix && (
              <div><div className="caption" style={{ marginBottom: 6 }}>Content mix</div><p className="body-sm" style={{ margin: 0 }}>{d.content_mix}</p></div>
            )}
            {d.best_timing && (
              <div><div className="caption" style={{ marginBottom: 6 }}>Best timing</div><p className="body-sm" style={{ margin: 0 }}>{d.best_timing}</p></div>
            )}
            <List title="What's working" items={d.whats_working} accent="var(--positive, #1a7f37)" />
            <List title="What's not" items={d.whats_not} accent="var(--negative, #b3261e)" />
            {d.competitor_read && d.competitor_read !== '—' && (
              <div><div className="caption" style={{ marginBottom: 6 }}>Competitor read</div><p className="body-sm" style={{ margin: 0 }}>{d.competitor_read}</p></div>
            )}
            <List title="Recommendations" items={d.recommendations} />
          </div>
        </div>
      )}
    </div>
  );
}
