import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api';

// Organic → Performance → Quick wins. Keywords ranked 11–20 — one good
// content refresh away from page 1. Pulled live from seo_keywords;
// dismissed ones persist. "Refresh page →" hands off to Pipeline so
// the same draft workflow handles the rewrite.
export default function QuickWinsPanel({ clientId, onRefresh }) {
  const [wins, setWins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showDismissed, setShowDismissed] = useState(false);

  useEffect(() => { refresh(); /* eslint-disable-line */ }, [clientId]);

  async function refresh() {
    setLoading(true);
    try {
      const { wins: w } = await api.get(`/seo/clients/${clientId}/quick-wins`);
      setWins(w);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  async function dismiss(kw, reason) {
    try {
      await api.post(`/seo/clients/${clientId}/quick-wins/${kw.id}/dismiss`, { reason });
      setWins(prev => prev.map(w => w.id === kw.id ? { ...w, dismissed_at: new Date().toISOString(), dismiss_reason: reason } : w));
    } catch (e) { setErr(e.message); }
  }

  async function restore(kw) {
    try {
      await api.post(`/seo/clients/${clientId}/quick-wins/${kw.id}/restore`, {});
      setWins(prev => prev.map(w => w.id === kw.id ? { ...w, dismissed_at: null, dismiss_reason: null } : w));
    } catch (e) { setErr(e.message); }
  }

  const active = wins.filter(w => !w.dismissed_at);
  const dismissed = wins.filter(w => w.dismissed_at);
  const totalActive = active.length;
  const trendingUp = active.filter(w => w.trend > 0).length;
  const lowEffort = active.filter(w => w.effort_score <= 3).length;
  const visible = showDismissed ? dismissed : active;

  return (
    <div>
      <div className="mb-5">
        <div className="caption">Quick wins</div>
        <h2 className="h2 mt-2">Keywords on the cusp of page 1</h2>
        <p className="body-sm text-muted mt-2" style={{ maxWidth: 720 }}>
          Keywords ranked between #11 and #20 — one tightened intro, 2–3 added sub-topics, and a couple of internal
          links are usually enough to push them onto page 1, where ~80% of clicks happen. &quot;Refresh page →&quot;
          hands off to Pipeline → Draft with the existing URL pre-filled.
        </p>
      </div>

      {err && <div className="callout callout-danger mb-3">{err}</div>}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--s3)', marginBottom: 'var(--s5)' }}>
        <Stat label="Open wins" value={totalActive} />
        <Stat label="Trending up" value={trendingUp} tone={trendingUp ? 'positive' : 'default'} />
        <Stat label="Low effort (≤3)" value={lowEffort} tone={lowEffort ? 'positive' : 'default'} />
        <Stat label="Dismissed" value={dismissed.length} tone="default" />
      </div>

      <div className="row mb-3" style={{ gap: 6 }}>
        <button onClick={() => setShowDismissed(false)} className={`btn btn-sm ${!showDismissed ? 'btn-primary' : 'btn-secondary'}`}>Open ({totalActive})</button>
        <button onClick={() => setShowDismissed(true)} className={`btn btn-sm ${showDismissed ? 'btn-primary' : 'btn-secondary'}`}>Dismissed ({dismissed.length})</button>
      </div>

      {loading && !wins.length ? (
        <div style={{ color: 'var(--text-subtle)', padding: 40 }}>Loading…</div>
      ) : !visible.length ? (
        <div className="card"><p className="body-sm text-subtle">
          {showDismissed ? 'Nothing dismissed yet.' : 'No keywords ranking #11–#20 right now. Either you\'re winning page 1 already, or there\'s not enough ranking data yet.'}
        </p></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th className="caption" style={{ padding: '8px 10px' }}>Keyword</th>
                <th className="caption" style={{ padding: '8px 10px', textAlign: 'right' }}>Rank</th>
                <th className="caption" style={{ padding: '8px 10px', textAlign: 'right' }}>Trend</th>
                <th className="caption" style={{ padding: '8px 10px', textAlign: 'right' }}>Effort</th>
                <th className="caption" style={{ padding: '8px 10px' }}>Target URL</th>
                <th className="caption" style={{ padding: '8px 10px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(w => (
                <tr key={w.id} style={{ borderBottom: '1px solid var(--card-border)' }}>
                  <td style={{ padding: '8px 10px', fontSize: 13 }}>
                    <strong>{w.keyword}</strong>
                    {w.intent && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 'var(--r-sm)', background: 'var(--accent-soft)', color: 'var(--text-muted)' }}>{String(w.intent).slice(0, 4).toUpperCase()}</span>}
                    {w.aio_present && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 'var(--r-sm)', background: w.aio_brand_cited ? 'var(--positive-soft)' : 'var(--warning-soft)', color: w.aio_brand_cited ? 'var(--positive)' : 'var(--warning)' }}>AIO{w.aio_brand_cited ? '+CITED' : ''}</span>}
                  </td>
                  <td style={{ padding: '8px 10px', fontSize: 13, textAlign: 'right', fontWeight: 700 }}>#{w.current_position}</td>
                  <td style={{ padding: '8px 10px', fontSize: 12, textAlign: 'right', color: w.trend > 0 ? 'var(--positive)' : w.trend < 0 ? 'var(--negative)' : 'var(--text-subtle)', fontWeight: 700 }}>
                    {w.trend === 0 || !w.previous_position ? '—' : (w.trend > 0 ? '↑' : '↓') + ' ' + Math.abs(w.trend)}
                  </td>
                  <td style={{ padding: '8px 10px', fontSize: 12, textAlign: 'right' }}>
                    <span style={{ background: w.effort_score <= 3 ? 'var(--positive-soft)' : w.effort_score <= 6 ? 'var(--warning-soft)' : 'var(--negative-soft)',
                                    color: w.effort_score <= 3 ? 'var(--positive)' : w.effort_score <= 6 ? 'var(--warning)' : 'var(--negative)',
                                    padding: '2px 8px', borderRadius: 'var(--r-pill)', fontWeight: 700 }}>{w.effort_score}/10</span>
                  </td>
                  <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text-subtle)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {w.target_url ? <a href={w.target_url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-muted)' }}>{w.target_url.replace(/^https?:\/\//, '').slice(0, 60)}</a> : <em style={{ color: 'var(--text-subtle)' }}>none mapped</em>}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                    {!w.dismissed_at ? (
                      <>
                        {onRefresh && w.target_url && (
                          <button onClick={() => onRefresh(w)} className="btn btn-ghost btn-sm" style={{ color: 'var(--accent)', padding: '0 6px' }}>Refresh →</button>
                        )}
                        <button onClick={() => dismiss(w, 'actioned')} className="btn btn-ghost btn-sm" style={{ color: 'var(--positive)', padding: '0 6px' }}>Done</button>
                        <button onClick={() => dismiss(w, 'not_relevant')} className="btn btn-ghost btn-sm" style={{ color: 'var(--text-subtle)', padding: '0 6px' }}>Skip</button>
                      </>
                    ) : (
                      <button onClick={() => restore(w)} className="btn btn-ghost btn-sm" style={{ color: 'var(--text-subtle)', padding: '0 6px' }}>Restore</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }) {
  const colour = tone === 'positive' ? 'var(--positive)'
              : tone === 'negative' ? 'var(--negative)'
              : tone === 'warning'  ? 'var(--warning)'
              : 'var(--text)';
  return (
    <div className="card">
      <div className="caption">{label}</div>
      <div className="metric" style={{ color: colour, marginTop: 4 }}>{value}</div>
    </div>
  );
}
