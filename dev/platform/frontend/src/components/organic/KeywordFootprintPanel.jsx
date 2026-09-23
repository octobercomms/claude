import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api';

// Organic → Performance → Keyword footprint. Per-page noun-phrase
// extraction populated by the site audit crawler. Surfaces what each
// page is ACTUALLY about per its own copy — useful when the AM thinks
// a page targets X but Google reads it as Y.
//
// Two views:
//   Pages — every crawled page with its top phrases. Filter / sort.
//   Phrases — every phrase with the pages it appears on (where does my
//             site cover "enamel mug care"?).
export default function KeywordFootprintPanel({ clientId, onSendToPipeline }) {
  const [audit, setAudit] = useState(null);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [view, setView] = useState('pages');     // pages | phrases
  const [search, setSearch] = useState('');

  useEffect(() => { refresh(); /* eslint-disable-line */ }, [clientId]);

  async function refresh() {
    setLoading(true);
    try {
      const r = await api.get(`/seo/clients/${clientId}/keyword-footprint`);
      setAudit(r.audit);
      setPages(r.pages);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  // Phrase-centric view: roll up pages by phrase.
  const phraseRollup = useMemo(() => {
    const m = new Map();
    for (const p of pages) {
      for (const ph of p.phrases || []) {
        if (!m.has(ph.phrase)) m.set(ph.phrase, { phrase: ph.phrase, pages: [], totalFreq: 0 });
        const entry = m.get(ph.phrase);
        entry.pages.push({ page_url: p.page_url, frequency: ph.frequency, rank: ph.rank });
        entry.totalFreq += ph.frequency;
      }
    }
    return Array.from(m.values()).sort((a, b) => b.totalFreq - a.totalFreq);
  }, [pages]);

  const filteredPages = pages.filter(p =>
    !search.trim() ? true :
    p.page_url.includes(search) || p.phrases.some(ph => ph.phrase.includes(search.toLowerCase()))
  );
  const filteredPhrases = phraseRollup.filter(p =>
    !search.trim() ? true : p.phrase.includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="mb-5">
        <div className="caption">Keyword footprint</div>
        <h2 className="h2 mt-2">What each page is actually about</h2>
        <p className="body-sm text-muted mt-2" style={{ maxWidth: 760 }}>
          Recurring noun phrases pulled from each page's body text during the last Site audit. The phrase a page
          uses most is what Google reads it as targeting — if it doesn't match the keyword you want it to rank
          for, the page needs a refresh.
        </p>
      </div>

      {err && <div className="callout callout-danger mb-3">{err}</div>}

      {loading ? (
        <div style={{ color: 'var(--text-subtle)', padding: 'var(--s8)' }}>Loading…</div>
      ) : !audit ? (
        <div className="card">
          <p className="body-sm text-subtle">
            No completed Site audit yet — the footprint is populated when an audit runs. Open the <strong>Site audit</strong> sub-tab and click <strong>Run first audit</strong>.
          </p>
        </div>
      ) : !pages.length ? (
        <div className="card"><p className="body-sm text-subtle">The last audit completed but no pages had enough text to extract phrases from.</p></div>
      ) : (
        <>
          <div className="row between center mb-3" style={{ gap: 'var(--s3)', flexWrap: 'wrap' }}>
            <div className="row" style={{ gap: 'var(--s2)' }}>
              <button onClick={() => setView('pages')} className={`btn btn-sm ${view === 'pages' ? 'btn-primary' : 'btn-secondary'}`}>Pages ({pages.length})</button>
              <button onClick={() => setView('phrases')} className={`btn btn-sm ${view === 'phrases' ? 'btn-primary' : 'btn-secondary'}`}>Phrases ({phraseRollup.length})</button>
            </div>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              style={{ flex: 1, maxWidth: 280, padding: 'var(--s2) var(--s3)', fontSize: 'var(--fs-body)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }} />
            <span className="body-xs text-subtle">Last audit: {new Date(audit.completed_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          </div>

          {view === 'pages' && (
            <div className="stack" style={{ gap: 'var(--s3)' }}>
              {filteredPages.map(p => (
                <div key={p.page_url} className="card">
                  <div className="row between center wrap" style={{ gap: 'var(--s3)', marginBottom: 'var(--s3)' }}>
                    <a href={p.page_url} target="_blank" rel="noreferrer" style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--text)', wordBreak: 'break-all' }}>
                      {p.page_url.replace(/^https?:\/\//, '')}
                    </a>
                    {onSendToPipeline && (
                      <button onClick={() => onSendToPipeline(p)} className="btn btn-ghost btn-sm" style={{ color: 'var(--text)' }}>Refresh in Pipeline →</button>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s2)' }}>
                    {p.phrases.map(ph => (
                      <span key={ph.phrase} style={{
                        fontSize: 'var(--fs-caption)', padding: 'var(--s1) var(--s3)', borderRadius: 'var(--r-pill)',
                        background: ph.rank === 1 ? 'var(--accent)' : 'var(--surface-sunken)',
                        color: ph.rank === 1 ? 'var(--accent-on)' : 'var(--text-muted)',
                        fontWeight: ph.rank === 1 ? 700 : 500,
                      }}>
                        {ph.phrase} <span style={{ opacity: 0.7 }}>· {ph.frequency}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {!filteredPages.length && <div className="card"><p className="body-sm text-subtle">No pages match the search.</p></div>}
            </div>
          )}

          {view === 'phrases' && (
            <div className="card" style={{ padding: 0 }}>
              <table className="table">
                <thead><tr>
                  <th className="caption" style={{ padding: 'var(--s2) var(--s3)' }}>Phrase</th>
                  <th className="caption" style={{ padding: 'var(--s2) var(--s3)', textAlign: 'right' }}>Total freq</th>
                  <th className="caption" style={{ padding: 'var(--s2) var(--s3)', textAlign: 'right' }}>Pages</th>
                  <th className="caption" style={{ padding: 'var(--s2) var(--s3)' }}>Top page</th>
                </tr></thead>
                <tbody>
                  {filteredPhrases.slice(0, 200).map(p => {
                    const top = p.pages.sort((a, b) => b.frequency - a.frequency)[0];
                    return (
                      <tr key={p.phrase} style={{ borderBottom: '1px solid var(--card-border)' }}>
                        <td style={{ padding: 'var(--s2) var(--s3)', fontSize: 'var(--fs-body)', fontWeight: 600 }}>{p.phrase}</td>
                        <td style={{ padding: 'var(--s2) var(--s3)', fontSize: 'var(--fs-caption)', textAlign: 'right' }}>{p.totalFreq}</td>
                        <td style={{ padding: 'var(--s2) var(--s3)', fontSize: 'var(--fs-caption)', textAlign: 'right' }}>{p.pages.length}</td>
                        <td style={{ padding: 'var(--s2) var(--s3)', fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <a href={top.page_url} target="_blank" rel="noreferrer" style={{ color: 'var(--text-muted)' }}>{top.page_url.replace(/^https?:\/\//, '').slice(0, 60)}</a>
                          <span style={{ marginLeft: 'var(--s2)' }}>({top.frequency}×)</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!filteredPhrases.length && <div style={{ padding: 'var(--s4)' }}><p className="body-sm text-subtle">No phrases match the search.</p></div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
