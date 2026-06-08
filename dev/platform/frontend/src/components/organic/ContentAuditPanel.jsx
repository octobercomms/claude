import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api';

// Organic → Performance → Content audit. Claude-graded per-page deep
// dive (thin-content score, readability, keyword usage, missing
// sub-topics, suggested additions, prioritised recommendation). Costs
// one Claude call per audit. List of past audits on the left, full
// findings + "Refresh in Pipeline" hand-off on the right.

const GRADE_TONE = { A: 'positive', B: 'positive', C: 'warning', D: 'warning', F: 'negative' };
const PRIORITY_TONE = { high: 'negative', medium: 'warning', low: 'default' };
const USAGE_LABEL = { good: 'Good', under: 'Under-used', over: 'Over-stuffed', absent: 'Missing' };
const USAGE_TONE = { good: 'positive', under: 'warning', over: 'warning', absent: 'negative' };

export default function ContentAuditPanel({ clientId, onRefresh }) {
  const [audits, setAudits] = useState([]);
  const [active, setActive] = useState(null);
  const [url, setUrl] = useState('');
  const [keyword, setKeyword] = useState('');
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => { refresh(); /* eslint-disable-line */ }, [clientId]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [running]); // eslint-disable-line

  async function refresh() {
    setLoading(true);
    try {
      const { audits: a } = await api.get(`/seo/clients/${clientId}/content-audits`);
      setAudits(a);
      // Auto-open the freshest complete audit on first load.
      if (!active) {
        const first = a.find(x => x.status === 'complete');
        if (first) openAudit(first.id);
      }
      setRunning(a.some(x => x.status === 'running'));
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  async function openAudit(id) {
    try {
      const full = await api.get(`/seo/content-audits/${id}`);
      setActive(full);
    } catch (e) { setErr(e.message); }
  }

  async function runNew() {
    if (!url.trim()) return;
    setErr(null);
    setRunning(true);
    try {
      await api.post(`/seo/clients/${clientId}/content-audits`, {
        url: url.trim(),
        target_keyword: keyword.trim() || null,
      });
      setUrl(''); setKeyword('');
      setTimeout(refresh, 1500);
    } catch (e) { setErr(e.message); setRunning(false); }
  }

  async function deleteAudit(id) {
    if (!confirm('Delete this audit?')) return;
    try {
      await api.delete(`/seo/content-audits/${id}`);
      const next = audits.filter(a => a.id !== id);
      setAudits(next);
      if (active?.id === id) {
        const fresh = next.find(x => x.status === 'complete');
        if (fresh) openAudit(fresh.id);
        else setActive(null);
      }
    } catch (e) { setErr(e.message); }
  }

  return (
    <div>
      <div className="mb-5">
        <div className="caption">Content audit</div>
        <h2 className="h2 mt-2">Grade an existing page for refresh</h2>
        <p className="body-sm text-muted mt-2" style={{ maxWidth: 760 }}>
          Paste a URL. Claude grades the page: thin-content score, readability, keyword usage, missing
          sub-topics, sub-headings to add, an opinionated rewrite recommendation. About 30s per page.
          The findings hand off to Pipeline → Draft when you're ready to rewrite.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr auto', gap: 8 }}>
          <input value={url} onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && runNew()}
            placeholder="https://yoursite.com/blog/post-to-audit"
            style={{ padding: '8px 12px', fontSize: 13, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }} />
          <input value={keyword} onChange={e => setKeyword(e.target.value)}
            placeholder="Target keyword (optional)"
            style={{ padding: '8px 12px', fontSize: 13, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }} />
          <button onClick={runNew} className="btn btn-primary" disabled={running || !url.trim()}>
            {running ? 'Auditing…' : 'Run audit'}
          </button>
        </div>
      </div>

      {err && <div className="callout callout-danger mb-3">{err}</div>}

      {loading && !audits.length ? (
        <div style={{ color: 'var(--text-subtle)', padding: 40 }}>Loading…</div>
      ) : !audits.length ? (
        <div style={{ color: 'var(--text-subtle)', padding: 20, fontSize: 13 }}>
          No audits yet. Paste a URL above to grade your first page.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 22 }}>
          <div>
            <div className="caption mb-3">Past audits</div>
            <div className="stack" style={{ gap: 6 }}>
              {audits.map(a => {
                const isActive = a.id === active?.id;
                return (
                  <div key={a.id} className="card"
                    style={{ padding: 10, cursor: 'pointer',
                      background: isActive ? 'var(--accent-soft)' : 'var(--surface)',
                      borderColor: isActive ? 'var(--accent)' : 'var(--card-border)' }}
                    onClick={() => a.status === 'complete' && openAudit(a.id)}>
                    <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                      {new Date(a.started_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      {' · '}<span style={{ fontWeight: 700, color: a.status === 'failed' ? 'var(--negative)' : a.status === 'running' ? 'var(--warning)' : 'var(--positive)' }}>{a.status}</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3, wordBreak: 'break-all' }}>
                      {(a.url || '').replace(/^https?:\/\//, '').slice(0, 60)}
                    </div>
                    {a.status === 'complete' && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <Badge value={a.readability_grade} tone={GRADE_TONE[a.readability_grade] || 'default'} />
                        <Badge value={a.priority} tone={PRIORITY_TONE[a.priority] || 'default'} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            {!active ? (
              <div style={{ color: 'var(--text-subtle)', padding: 20 }}>
                {running ? 'Auditing in progress — this takes ~30s.' : 'Pick an audit on the left, or run a new one above.'}
              </div>
            ) : active.status === 'failed' ? (
              <div className="callout callout-danger">Audit failed: {active.error_message}</div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="caption">Audited</div>
                    <a href={active.url} target="_blank" rel="noreferrer" className="h3" style={{ marginTop: 4, marginBottom: 4, display: 'block', wordBreak: 'break-all', color: 'var(--text)' }}>
                      {active.url}
                    </a>
                    <div className="body-xs text-subtle">
                      {active.title || '(no title)'} · {active.word_count?.toLocaleString() || 0} words
                      {active.target_keyword && <> · target keyword: <strong style={{ color: 'var(--text-muted)' }}>{active.target_keyword}</strong></>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {onRefresh && (
                      <button onClick={() => onRefresh(active)} className="btn btn-primary btn-sm">Refresh in Pipeline →</button>
                    )}
                    <button onClick={() => deleteAudit(active.id)} className="btn btn-ghost btn-sm" style={{ color: 'var(--negative)' }}>Delete</button>
                  </div>
                </div>

                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--s3)', marginBottom: 'var(--s5)' }}>
                  <StatCard label="Depth" value={`${active.thin_content_score}/5`} tone={active.thin_content_score >= 4 ? 'positive' : active.thin_content_score <= 2 ? 'negative' : 'warning'} />
                  <StatCard label="Readability" value={active.readability_grade || '—'} tone={GRADE_TONE[active.readability_grade] || 'default'} />
                  <StatCard label="Keyword usage" value={USAGE_LABEL[active.keyword_usage] || '—'} tone={USAGE_TONE[active.keyword_usage] || 'default'} />
                  <StatCard label="Priority" value={(active.priority || '—').toUpperCase()} tone={PRIORITY_TONE[active.priority] || 'default'} />
                </div>

                {active.detected_primary_keyword && active.detected_primary_keyword !== active.target_keyword && (
                  <div className="callout" style={{ background: 'var(--accent-soft)', padding: 'var(--s3) var(--s4)', borderRadius: 'var(--r-sm)', marginBottom: 14, fontSize: 13 }}>
                    Claude detected the page is actually targeting <strong>"{active.detected_primary_keyword}"</strong>{active.target_keyword && <> — not the supplied target "{active.target_keyword}"</>}.
                  </div>
                )}

                {active.overall_recommendation && (
                  <div className="card" style={{ marginBottom: 14 }}>
                    <div className="caption mb-2">Recommendation</div>
                    <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{active.overall_recommendation}</div>
                  </div>
                )}

                <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 'var(--s4)' }}>
                  <div className="card">
                    <div className="caption mb-3">Missing sub-topics</div>
                    {(active.missing_subtopics_json || []).length === 0 ? (
                      <p className="body-sm text-subtle">None identified — coverage looks complete.</p>
                    ) : (
                      <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 13, lineHeight: 1.7, color: 'var(--text)' }}>
                        {(active.missing_subtopics_json || []).map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    )}
                  </div>
                  <div className="card">
                    <div className="caption mb-3">Sections to add</div>
                    {(active.suggested_additions_json || []).length === 0 ? (
                      <p className="body-sm text-subtle">No additions suggested.</p>
                    ) : (
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
                        {(active.suggested_additions_json || []).map((s, i) => (
                          <li key={i}>
                            <div style={{ fontSize: 13, fontWeight: 700 }}>{s.heading}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 2 }}>{s.rationale}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }) {
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

function Badge({ value, tone }) {
  if (!value) return null;
  const colour = tone === 'positive' ? 'var(--positive)'
              : tone === 'negative' ? 'var(--negative)'
              : tone === 'warning'  ? 'var(--warning)'
              : 'var(--text-muted)';
  const bg = tone === 'positive' ? 'var(--positive-soft)'
           : tone === 'negative' ? 'var(--negative-soft)'
           : tone === 'warning'  ? 'var(--warning-soft)'
           : 'var(--surface-sunken)';
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
                   padding: '2px 6px', borderRadius: 'var(--r-sm)', background: bg, color: colour }}>
      {value}
    </span>
  );
}
