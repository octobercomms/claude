// Social → Performance → AI Audit. Runs Claude over this account's own
// published-post performance (content mix, timing, what's working, competitor
// read) and shows a structured audit with recommendations. Built on the
// engagement data OMI already ingests — no third-party connector.

import React, { useEffect, useRef, useState } from 'react';
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
    try { const r = await api.post(`/social/clients/${clientId}/audit/run`, {}); setAudit(r.audit); toast('Recommendations refreshed.', 'success'); }
    catch (e) { toast(e.message, 'error'); }
    finally { setRunning(false); }
  }

  // Keep it fresh without a per-visit AI spend: if an audit already exists but
  // is over a week old, refresh it once when the tab is opened. First-time runs
  // stay manual — they need a few published posts to be worth anything.
  const autoRan = useRef(false);
  useEffect(() => {
    if (!loaded || running || autoRan.current || !audit?.generated_at) return;
    const ageDays = (Date.now() - new Date(audit.generated_at).getTime()) / 86400000;
    if (ageDays > 7) { autoRan.current = true; run(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, audit]);

  const d = audit?.data || {};

  return (
    <div className="stack-lg">
      <div className="row between center" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="caption">Improve</div>
          <div className="h2 mt-2">What to change next</div>
        </div>
        <button className="btn btn-primary" {...roWrite(readOnly, { onClick: run, disabled: running })}>{running ? 'Working…' : (audit ? '↻ Refresh' : 'Get recommendations')}</button>
      </div>
      <p className="body" style={{ maxWidth: 640 }}>
        Claude reads your own published-post performance — content mix, best posting times, what's working, and how you
        compare to competitors — and tells you what to change next. Runs on the engagement OMI already pulls daily, and
        refreshes itself weekly once you've run it the first time.
      </p>

      {!loaded ? <div className="text-subtle">Loading…</div> : !audit ? (
        <div className="text-subtle">No recommendations yet — hit <strong>Get recommendations</strong> once a few posts are published.</div>
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
