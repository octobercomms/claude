import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api';

// Organic → Performance → Site audit. Crawls up to 30 pages on the
// client's domain, scores common on-page issues (broken links, meta
// gaps, H1 problems, alt text, slow responses, thin content), and
// surfaces each as an actionable row that can be sent into Pipeline.
const CATEGORY_LABEL = {
  broken_link: 'Broken links',
  fetch_failed: 'Pages that failed to load',
  missing_meta_title: 'Missing meta title',
  meta_title_length: 'Meta title length',
  missing_meta_description: 'Missing meta description',
  meta_description_length: 'Meta description length',
  missing_h1: 'Missing H1',
  multiple_h1: 'Multiple H1 tags',
  no_alt_text: 'Images without alt text',
  thin_content: 'Thin content',
  slow_response: 'Slow page response',
  noindex_blocked: 'Noindex-blocked pages',
};

const CATEGORY_HINT = {
  thin_content: 'Best actioned through Pipeline → Draft (refresh mode) — expand to 800+ words with new sub-topics.',
  broken_link: 'Manual fix — update the link target or remove the page.',
  fetch_failed: 'Page likely 404 or server error. Restore or 301 to a relevant page.',
  missing_meta_title: 'Manual fix in CMS — 30–60 char title that includes the target keyword.',
  meta_title_length: 'Manual fix in CMS.',
  missing_meta_description: 'Manual fix in CMS — 70–160 chars.',
  meta_description_length: 'Manual fix in CMS.',
  missing_h1: 'Manual fix in CMS — every page needs exactly one H1.',
  multiple_h1: 'Manual fix in CMS — demote extras to H2.',
  no_alt_text: 'Manual fix in CMS — describe what the image shows.',
  slow_response: 'Flag to dev — likely image weight, render-blocking JS, or slow backend.',
  noindex_blocked: 'Confirm this is intentional. If not, remove the noindex tag.',
};

const SEVERITY_TONE = { high: 'var(--negative)', medium: 'var(--warning)', low: 'var(--text-muted)' };

export default function SiteAuditPanel({ clientId, onSendToPipeline }) {
  const [audit, setAudit] = useState(null);
  const [issues, setIssues] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState('open');

  useEffect(() => { refresh(); /* eslint-disable-line */ }, [clientId]);
  useEffect(() => {
    // Poll while a crawl is in flight so the UI updates without a refresh.
    if (!running) return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [running]); // eslint-disable-line

  async function refresh() {
    setLoading(true);
    try {
      const [latest, list] = await Promise.all([
        api.get(`/seo/clients/${clientId}/site-audits/latest`),
        api.get(`/seo/clients/${clientId}/site-audits`),
      ]);
      setAudit(latest.audit);
      setIssues(latest.issues);
      setHistory(list.audits);
      const hasRunning = list.audits.some(a => a.status === 'running');
      setRunning(hasRunning);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  async function runNow() {
    setErr(null); setRunning(true);
    try {
      await api.post(`/seo/clients/${clientId}/site-audits/run`, {});
      // First poll happens quickly so the AM sees the running row.
      setTimeout(refresh, 1500);
    } catch (e) { setErr(e.message); setRunning(false); }
  }

  async function setIssueStatus(issue, status) {
    try {
      const updated = await api.put(`/seo/site-audit-issues/${issue.id}`, { status });
      setIssues(prev => prev.map(i => i.id === issue.id ? updated : i));
    } catch (e) { setErr(e.message); }
  }

  const counts = audit?.summary_json || {};
  const filteredIssues = issues.filter(i => filter === 'all' ? true : i.status === filter);
  const grouped = filteredIssues.reduce((acc, i) => {
    if (!acc[i.category]) acc[i.category] = [];
    acc[i.category].push(i);
    return acc;
  }, {});

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--s4)', flexWrap: 'wrap', marginBottom: 'var(--s5)' }}>
        <div>
          <div className="caption">Site audit</div>
          <h2 className="h2 mt-2">Technical health of the live site</h2>
          <p className="body-sm text-muted mt-2" style={{ maxWidth: 720 }}>
            Crawls up to 30 pages on the client's domain (sitemap first, BFS fallback). Scores common on-page issues —
            broken links, meta gaps, missing H1s, missing alt text, slow responses, thin content. Issues here flow
            into Pipeline → Find &apos;From your own site&apos; mode.
          </p>
        </div>
        <button onClick={runNow} className="btn btn-primary" disabled={running}>
          {running ? 'Crawling…' : audit ? 'Re-run audit' : 'Run first audit'}
        </button>
      </div>

      {err && <div className="callout callout-danger mb-3">{err}</div>}

      {loading && !audit && !history.length ? (
        <div style={{ color: 'var(--text-subtle)', padding: 40 }}>Loading…</div>
      ) : !audit ? (
        <div style={{ color: 'var(--text-subtle)', padding: 20, fontSize: 13 }}>
          {running
            ? 'First crawl in progress — this usually takes 60–90 seconds depending on site size.'
            : 'No audit yet. Click Run first audit to start the crawl.'}
        </div>
      ) : (
        <>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--s3)', marginBottom: 'var(--s5)' }}>
            <ScoreCard label="Score" value={audit.score ?? '—'} suffix={audit.score != null ? '/100' : ''} tone={audit.score >= 80 ? 'positive' : audit.score >= 60 ? 'warning' : 'negative'} />
            <ScoreCard label="Pages crawled" value={audit.pages_crawled} />
            <ScoreCard label="Issues" value={issues.length} tone={issues.length === 0 ? 'positive' : 'default'} />
            <ScoreCard label="High severity" value={issues.filter(i => i.severity === 'high').length} tone={issues.filter(i => i.severity === 'high').length ? 'negative' : 'positive'} />
            <ScoreCard label="Open" value={issues.filter(i => i.status === 'open').length} />
            <ScoreCard label="Last run" value={audit.completed_at ? new Date(audit.completed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Running…'} />
          </div>

          {/* Issues list grouped by category */}
          <div className="row" style={{ gap: 6, marginBottom: 'var(--s4)' }}>
            {['open', 'in_progress', 'done', 'dismissed', 'all'].map(s => (
              <button key={s} onClick={() => setFilter(s)} className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-secondary'}`}>
                {s.replace('_', ' ')}
              </button>
            ))}
          </div>

          {!filteredIssues.length ? (
            <div className="card"><p className="body-sm text-subtle">No {filter === 'all' ? '' : filter} issues. {filter === 'open' && '🎉'}</p></div>
          ) : (
            <div className="stack" style={{ gap: 'var(--s4)' }}>
              {Object.entries(grouped).map(([category, rows]) => (
                <div key={category} className="card">
                  <div className="row between center wrap" style={{ marginBottom: 'var(--s3)' }}>
                    <div>
                      <div className="caption">{CATEGORY_LABEL[category] || category} · {rows.length}</div>
                      {CATEGORY_HINT[category] && <p className="body-xs text-subtle mt-2" style={{ maxWidth: 600 }}>{CATEGORY_HINT[category]}</p>}
                    </div>
                    {category === 'thin_content' && onSendToPipeline && (
                      <button onClick={() => onSendToPipeline({ category, urls: rows.map(r => r.page_url) })} className="btn btn-secondary btn-sm">
                        Send all to Pipeline →
                      </button>
                    )}
                  </div>
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="caption" style={{ padding: '6px 10px' }}>URL</th>
                        <th className="caption" style={{ padding: '6px 10px' }}>Detail</th>
                        <th className="caption" style={{ padding: '6px 10px' }}>Severity</th>
                        <th className="caption" style={{ padding: '6px 10px', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(r => (
                        <tr key={r.id} style={{ borderBottom: '1px solid var(--card-border)' }}>
                          <td style={{ padding: '8px 10px', fontSize: 12, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <a href={r.page_url} target="_blank" rel="noreferrer" style={{ color: 'var(--text)' }}>
                              {r.page_url.replace(/^https?:\/\//, '').slice(0, 70)}
                            </a>
                          </td>
                          <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)' }}>{r.detail}</td>
                          <td style={{ padding: '8px 10px', fontSize: 11, color: SEVERITY_TONE[r.severity], fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{r.severity}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                            {r.status === 'open' && (
                              <>
                                {category === 'thin_content' && onSendToPipeline && (
                                  <button onClick={() => onSendToPipeline({ category, urls: [r.page_url], single: true })} className="btn btn-ghost btn-sm" style={{ color: 'var(--accent)', padding: '0 6px' }}>Refresh →</button>
                                )}
                                <button onClick={() => setIssueStatus(r, 'done')} className="btn btn-ghost btn-sm" style={{ color: 'var(--positive)', padding: '0 6px' }}>Done</button>
                                <button onClick={() => setIssueStatus(r, 'dismissed')} className="btn btn-ghost btn-sm" style={{ color: 'var(--text-subtle)', padding: '0 6px' }}>Skip</button>
                              </>
                            )}
                            {r.status !== 'open' && (
                              <button onClick={() => setIssueStatus(r, 'open')} className="btn btn-ghost btn-sm" style={{ color: 'var(--text-subtle)', padding: '0 6px' }}>Reopen</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {history.length > 1 && (
            <div className="mt-6">
              <div className="caption mb-2">Past audits</div>
              <div className="card" style={{ padding: 0 }}>
                <table className="table">
                  <thead><tr><th>Date</th><th className="num">Score</th><th className="num">Pages</th><th>Status</th></tr></thead>
                  <tbody>
                    {history.slice(0, 10).map(h => (
                      <tr key={h.id}>
                        <td>{new Date(h.started_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                        <td className="num">{h.score ?? '—'}</td>
                        <td className="num">{h.pages_crawled}</td>
                        <td style={{ textTransform: 'uppercase', fontSize: 11, color: h.status === 'failed' ? 'var(--negative)' : h.status === 'running' ? 'var(--warning)' : 'var(--text-muted)' }}>{h.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ScoreCard({ label, value, suffix, tone }) {
  const colour = tone === 'positive' ? 'var(--positive)'
              : tone === 'negative' ? 'var(--negative)'
              : tone === 'warning'  ? 'var(--warning)'
              : 'var(--text)';
  return (
    <div className="card">
      <div className="caption">{label}</div>
      <div className="metric" style={{ color: colour, marginTop: 4 }}>{value}{suffix || ''}</div>
    </div>
  );
}
