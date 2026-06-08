import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api';
import PipelineStep from './PipelineStep';
import { FanoutTab, ContentGapsTab } from '../SeoSuite';

const LOCATIONS = [
  { code: 2826, label: '🇬🇧 United Kingdom' },
  { code: 2840, label: '🇺🇸 United States' },
  { code: 2372, label: '🇮🇪 Ireland' },
  { code: 2036, label: '🇦🇺 Australia' },
  { code: 2124, label: '🇨🇦 Canada' },
];

// Pipeline → Find. Three modes for surfacing content to write:
//
//   url        — paste a competitor blog post URL → that page's keyword
//                footprint, scored against the client's ranks. Page-level.
//   query      — type a seed query → Claude's likely Google fan-out, run
//                each against the client to score AI Overview coverage.
//   competitor — pick competitor domains → DFS domain intersection
//                surfaces keywords they rank for that the client doesn't.
//
// All three pre-existed as separate Performance tabs (URL gap as
// FindPanel itself, fan-out as FanoutTab, content gaps as ContentGapsTab).
// They're consolidated here because they're all production inputs for
// the Brief step — they belong with the work they feed, not in the
// measurement view.
const MODES = [
  { key: 'url',        label: 'From URL',             tagline: 'Paste a competitor blog post URL. We pull every keyword that page ranks for and cross-reference against your ranks, so you know exactly which sub-topics to cover to outrank it.' },
  { key: 'query',      label: 'From a query',         tagline: 'Type a seed query. Claude generates the likely Google fan-out (the related queries the AI Overview will pull from), we run each against your domain to score coverage, then identify the sub-intents to cover.' },
  { key: 'competitor', label: 'From competitor domains', tagline: 'Pick up to 5 competitor domains. DFS Domain Intersection returns the keywords they rank for that you don\'t — the highest-volume content gaps in your category.' },
  { key: 'own_site',   label: 'From your own site',   tagline: 'Pull open issues from the Site audit + Quick wins (keywords #11–20) into one list so you can pick a refresh target without leaving Pipeline.' },
];

export default function FindPanel({ clientId, onNext }) {
  const [mode, setMode] = useState('url');
  const [runs, setRuns] = useState([]);
  const [activeRun, setActiveRun] = useState(null);
  const [keywords, setKeywords] = useState([]);
  const [url, setUrl] = useState('');
  const [location, setLocation] = useState(2826);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState(null);

  const activeMode = MODES.find(m => m.key === mode) || MODES[0];

  useEffect(() => { refresh(); /* eslint-disable-line */ }, [clientId]);

  async function refresh() {
    setLoading(true);
    try {
      const { runs: r } = await api.get(`/seo/clients/${clientId}/url-gap`);
      setRuns(r);
      if (r.length) await openRun(r[0].id);
      else { setActiveRun(null); setKeywords([]); }
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  async function openRun(runId) {
    try {
      const { run, keywords: k } = await api.get(`/seo/clients/${clientId}/url-gap/${runId}`);
      setActiveRun(run);
      setKeywords(k);
    } catch (e) { setErr(e.message); }
  }

  async function runNew() {
    if (!url.trim()) return;
    setRunning(true);
    setErr(null);
    try {
      const { run, keywords: k } = await api.post(`/seo/clients/${clientId}/url-gap`, {
        competitor_url: url.trim(), location_code: location,
      });
      setRuns(prev => [run, ...prev]);
      setActiveRun(run);
      setKeywords(k.map((kw, i) => ({ ...kw, position_order: i })));
      setUrl('');
    } catch (e) { setErr(e.message); }
    finally { setRunning(false); }
  }

  async function deleteRun(runId) {
    if (!confirm('Delete this URL gap run?')) return;
    try {
      await api.delete(`/seo/clients/${clientId}/url-gap/${runId}`);
      const next = runs.filter(r => r.id !== runId);
      setRuns(next);
      if (activeRun?.id === runId) {
        if (next[0]) openRun(next[0].id);
        else { setActiveRun(null); setKeywords([]); }
      }
    } catch (e) { setErr(e.message); }
  }

  return (
    <PipelineStep
      num={1} title="Find" onNext={onNext} nextLabel="Write a brief"
      tagline={activeMode.tagline}
    >
      {/* Mode selector — three different production inputs share this step */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {MODES.map(m => (
          <button key={m.key} onClick={() => setMode(m.key)} type="button"
            className={`btn btn-sm ${mode === m.key ? 'btn-primary' : 'btn-secondary'}`}>
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'query' && <FanoutTab clientId={clientId} />}
      {mode === 'competitor' && <ContentGapsTab clientId={clientId} />}
      {mode === 'own_site' && <OwnSiteMode clientId={clientId} />}
      {mode === 'url' && (<>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && runNew()}
          placeholder="https://competitor.com/blog/post-to-outrank"
          style={{ flex: 1, minWidth: 320, padding: '8px 12px', fontSize: 13, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}
        />
        <select value={location} onChange={e => setLocation(Number(e.target.value))}
          style={{ padding: '8px 12px', fontSize: 13, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', fontFamily: 'inherit' }}>
          {LOCATIONS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <button onClick={runNew} className="btn btn-primary" disabled={running || !url.trim()}>
          {running ? 'Analysing…' : 'Find gaps'}
        </button>
      </div>

      {err && <div className="callout callout-danger" style={{ marginBottom: 14 }}>{err}</div>}

      {loading && !runs.length ? (
        <div style={{ color: 'var(--text-subtle)', padding: 40 }}>Loading…</div>
      ) : !runs.length ? (
        <div style={{ color: 'var(--text-subtle)', padding: 20, fontSize: 13 }}>
          No URL gap runs yet. Paste a competitor blog URL above — DFS returns up to 200 ranked keywords for the page, we score the top 50 by volume against your ranks, Claude summarises the gaps.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 22 }}>
          <div>
            <div className="caption mb-3">Past runs</div>
            {runs.map(r => (
              <div key={r.id} className="card"
                style={{ padding: 10, marginBottom: 8, cursor: 'pointer',
                  background: r.id === activeRun?.id ? 'var(--accent-soft)' : 'var(--surface)' }}
                onClick={() => openRun(r.id)}>
                <div style={{ fontWeight: 600, fontSize: 12, lineHeight: 1.3, wordBreak: 'break-all' }}>
                  {r.competitor_url.replace(/^https?:\/\//, '').slice(0, 60)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>
                  {new Date(r.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {' · '}<span style={{ color: 'var(--negative)', fontWeight: 700 }}>{r.gap_count}</span> gaps of {r.page_keyword_count}
                </div>
              </div>
            ))}
          </div>

          <div>
            {activeRun && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="caption">Competitor URL</div>
                    <a href={activeRun.competitor_url} target="_blank" rel="noreferrer" className="h3" style={{ marginTop: 4, marginBottom: 6, display: 'block', wordBreak: 'break-all', color: 'var(--text)' }}>
                      {activeRun.competitor_url}
                    </a>
                    <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
                      Ranks for {activeRun.page_keyword_count} keywords in top 100 · <strong style={{ color: 'var(--negative)' }}>{activeRun.gap_count}</strong> are gaps for you
                    </div>
                  </div>
                  <button onClick={() => deleteRun(activeRun.id)} className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: 'var(--text-subtle)' }}>Delete</button>
                </div>

                {activeRun.summary_md && (
                  <div className="card" style={{ marginBottom: 14 }}>
                    <div className="caption mb-2">Briefing</div>
                    <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{activeRun.summary_md}</div>
                  </div>
                )}

                <div className="card" style={{ padding: 0 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="caption" style={{ padding: '8px 10px' }}>Keyword</th>
                        <th className="caption" style={{ padding: '8px 10px', textAlign: 'right' }}>Volume</th>
                        <th className="caption" style={{ padding: '8px 10px', textAlign: 'right' }}>Competitor</th>
                        <th className="caption" style={{ padding: '8px 10px', textAlign: 'right' }}>You</th>
                        <th className="caption" style={{ padding: '8px 10px' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {keywords.map(k => (
                        <tr key={k.id} style={{ borderBottom: '1px solid #f5f5f5', background: k.is_gap ? 'var(--negative-soft)' : 'transparent' }}>
                          <td style={{ padding: '8px 10px', fontSize: 12 }}><strong>{k.keyword}</strong></td>
                          <td style={{ padding: '8px 10px', fontSize: 12, textAlign: 'right' }}>{k.search_volume?.toLocaleString() || '—'}</td>
                          <td style={{ padding: '8px 10px', fontSize: 12, textAlign: 'right' }}>#{k.competitor_position}</td>
                          <td style={{ padding: '8px 10px', fontSize: 12, textAlign: 'right' }}>{k.client_position ? `#${k.client_position}` : '—'}</td>
                          <td style={{ padding: '8px 10px', fontSize: 11, color: k.is_gap ? 'var(--negative)' : 'var(--text-subtle)', fontWeight: k.is_gap ? 700 : 400 }}>
                            {k.is_gap ? 'GAP' : (k.client_position && k.client_position <= 10 ? 'covered' : '—')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      </>)}
    </PipelineStep>
  );
}

// Pipeline → Find → "From your own site" mode. Pulls open Site audit
// issues + Quick wins (rank 11–20) in one list so the AM can pick a
// refresh target without bouncing into Performance. Read-only here —
// the actual rewrite happens in Pipeline → Draft.
function OwnSiteMode({ clientId }) {
  const [issues, setIssues] = useState([]);
  const [wins, setWins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [iss, qw] = await Promise.all([
          fetch('/api/seo/clients/' + clientId + '/site-audits/open-issues', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } }).then(r => r.json()).catch(() => ({ issues: [] })),
          fetch('/api/seo/clients/' + clientId + '/quick-wins',                { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } }).then(r => r.json()).catch(() => ({ wins: [] })),
        ]);
        setIssues(iss.issues || []);
        setWins((qw.wins || []).filter(w => !w.dismissed_at));
      } catch (e) { setErr(e.message); }
      finally { setLoading(false); }
    })();
  }, [clientId]);

  const thinContent = issues.filter(i => i.category === 'thin_content');
  const otherIssues = issues.filter(i => i.category !== 'thin_content');

  if (loading) return <div style={{ color: 'var(--text-subtle)', padding: 20 }}>Loading…</div>;
  if (err) return <div className="callout callout-danger">{err}</div>;
  if (!thinContent.length && !wins.length && !otherIssues.length) {
    return (
      <div style={{ color: 'var(--text-subtle)', padding: 20, fontSize: 13 }}>
        Nothing surfaced. Run a Site audit on Performance, or get keywords ranking in the #11–#20 range before this mode has anything to show.
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 'var(--s5)' }}>
      {!!thinContent.length && (
        <div className="card">
          <div className="caption">Thin content pages · refresh</div>
          <p className="body-xs text-subtle mt-2 mb-3">From the latest Site audit. Each row is a page that came in under 300 words — prime candidates for the Pipeline → Draft refresh flow.</p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {thinContent.map(i => (
              <li key={i.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--card-border)', fontSize: 12 }}>
                <a href={i.page_url} target="_blank" rel="noreferrer" style={{ color: 'var(--text)' }}>{i.page_url.replace(/^https?:\/\//, '')}</a>
                <div style={{ color: 'var(--text-subtle)', marginTop: 2 }}>{i.detail}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!wins.length && (
        <div className="card">
          <div className="caption">Quick wins · keywords #11–20</div>
          <p className="body-xs text-subtle mt-2 mb-3">One refresh away from page 1.</p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {wins.slice(0, 20).map(w => (
              <li key={w.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--card-border)', fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                <span><strong>{w.keyword}</strong>{w.target_url && <span style={{ color: 'var(--text-subtle)', marginLeft: 6 }}>· {w.target_url.replace(/^https?:\/\//, '').slice(0, 50)}</span>}</span>
                <span style={{ color: 'var(--text-muted)' }}>#{w.current_position} · effort {w.effort_score}/10</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!otherIssues.length && (
        <div className="card">
          <div className="caption">Other open audit issues</div>
          <p className="body-xs text-subtle mt-2 mb-3">Most of these are CMS fixes rather than content work — addressing them on the Site audit tab is the cleaner workflow.</p>
          <p className="body-sm text-muted">{otherIssues.length} other issue{otherIssues.length === 1 ? '' : 's'} open across {new Set(otherIssues.map(i => i.page_url)).size} pages.</p>
        </div>
      )}
    </div>
  );
}
