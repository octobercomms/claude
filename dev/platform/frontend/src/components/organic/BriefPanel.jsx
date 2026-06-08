import React, { useState } from 'react';
import { api } from '../../utils/api';
import PipelineStep from './PipelineStep';
import { PlanningTab } from '../SeoSuite';

// Pipeline → Brief. Two modes:
//   single  — existing PlanningTab; one keyword → one brief.
//   cluster — paste N keywords (one per line); Claude groups them into
//             topic clusters; AM picks one to generate a multi-keyword
//             brief that targets the whole cluster. Useful when you've
//             come out of Find with a Fan-out / Content Gaps run and
//             have a long keyword list to plan against.
const MODES = [
  { key: 'single',  label: 'One keyword',   tagline: "Single-keyword brief. Type a target keyword and Claude proposes the angle, outline, headings, questions to answer, internal links, and meta tags." },
  { key: 'cluster', label: 'From a list',   tagline: "Paste a list of keywords. Claude groups them into 3–8 topic clusters; pick one and get a brief that targets the whole cluster as a single piece of content." },
];

export default function BriefPanel({ clientId, onNext }) {
  const [mode, setMode] = useState('single');
  const activeMode = MODES.find(m => m.key === mode) || MODES[0];
  return (
    <PipelineStep
      num={2} title="Brief" onNext={onNext} nextLabel="Draft the post"
      tagline={activeMode.tagline}
    >
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, flexWrap: 'wrap' }}>
        {MODES.map(m => (
          <button key={m.key} onClick={() => setMode(m.key)} type="button"
            className={`btn btn-sm ${mode === m.key ? 'btn-primary' : 'btn-secondary'}`}>
            {m.label}
          </button>
        ))}
      </div>
      {mode === 'single' && <PlanningTab clientId={clientId} />}
      {mode === 'cluster' && <ClusterMode clientId={clientId} />}
    </PipelineStep>
  );
}

function ClusterMode({ clientId }) {
  const [keywordText, setKeywordText] = useState('');
  const [clustering, setClustering] = useState(false);
  const [briefing, setBriefing] = useState(null);   // which cluster.label is being briefed
  const [result, setResult] = useState(null);       // { clusters, unclustered }
  const [briefs, setBriefs] = useState({});         // cluster.label → brief
  const [err, setErr] = useState(null);

  const keywordCount = keywordText.split('\n').map(k => k.trim()).filter(Boolean).length;

  async function cluster() {
    if (keywordCount < 2) return;
    setClustering(true); setErr(null); setResult(null); setBriefs({});
    try {
      const r = await api.post(`/seo/clients/${clientId}/keyword-clusters`, { keywords: keywordText });
      setResult(r);
    } catch (e) { setErr(e.message); }
    finally { setClustering(false); }
  }

  async function makeBrief(c) {
    setBriefing(c.label); setErr(null);
    try {
      const { brief } = await api.post(`/seo/clients/${clientId}/keyword-clusters/brief`, { cluster: c });
      setBriefs(prev => ({ ...prev, [c.label]: brief }));
    } catch (e) { setErr(e.message); }
    finally { setBriefing(null); }
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="caption mb-2">Paste keywords — one per line</div>
        <textarea
          value={keywordText}
          onChange={e => setKeywordText(e.target.value)}
          rows={8}
          placeholder="best enamel mug\nenamel mug uk\nare enamel mugs dishwasher safe\nhow to clean enamel mugs\n…"
          style={{ width: '100%', padding: '10px 12px', fontSize: 13, lineHeight: 1.6, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', boxSizing: 'border-box', resize: 'vertical' }}
        />
        <div className="row between center mt-2">
          <span className="body-xs text-subtle">{keywordCount} keyword{keywordCount === 1 ? '' : 's'} · {keywordCount < 2 ? 'need at least 2 to cluster' : keywordCount > 200 ? 'max 200 per run' : 'ready'}</span>
          <button onClick={cluster} className="btn btn-primary" disabled={clustering || keywordCount < 2 || keywordCount > 200}>
            {clustering ? 'Clustering…' : 'Cluster keywords'}
          </button>
        </div>
      </div>

      {err && <div className="callout callout-danger mb-3">{err}</div>}

      {result && (
        <>
          <div className="caption mb-3">Topic clusters · {result.clusters.length}</div>
          <div className="stack" style={{ gap: 'var(--s4)', marginBottom: 'var(--s5)' }}>
            {result.clusters.map((c, i) => {
              const brief = briefs[c.label];
              return (
                <div key={i} className="card">
                  <div className="row between center wrap" style={{ marginBottom: 'var(--s3)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="caption" style={{ color: 'var(--text-subtle)' }}>Cluster · {c.intent}</div>
                      <div className="h3 mt-2">{c.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                        Primary: <strong style={{ color: 'var(--text)' }}>{c.primary}</strong>
                      </div>
                      {c.rationale && <p className="body-sm text-muted mt-2">{c.rationale}</p>}
                    </div>
                    <button onClick={() => makeBrief(c)} className="btn btn-secondary btn-sm" disabled={briefing === c.label || !!brief}>
                      {brief ? '✓ Brief generated' : briefing === c.label ? 'Generating…' : 'Generate brief →'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: brief ? 'var(--s3)' : 0 }}>
                    {c.secondary.map((k, j) => (
                      <span key={j} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--r-pill)', background: 'var(--surface-sunken)', color: 'var(--text-muted)' }}>{k}</span>
                    ))}
                  </div>
                  {brief && <BriefView brief={brief} />}
                </div>
              );
            })}
          </div>

          {!!result.unclustered?.length && (
            <div className="card" style={{ background: 'var(--surface-raised)' }}>
              <div className="caption mb-2">Didn't fit a cluster ({result.unclustered.length})</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {result.unclustered.map((k, i) => (
                  <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--r-pill)', background: 'var(--surface-sunken)', color: 'var(--text-subtle)' }}>{k}</span>
                ))}
              </div>
              <p className="body-xs text-subtle mt-3">These keywords didn't fit naturally with the others. Run them in single-keyword mode or with a different set.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BriefView({ brief }) {
  return (
    <div style={{ borderTop: 'var(--border-w) solid var(--card-border)', paddingTop: 'var(--s4)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s4)' }}>
        <div>
          <div className="caption mb-2">Title</div>
          <div className="h3">{brief.title}</div>
          {brief.summary && <p className="body-sm text-muted mt-2">{brief.summary}</p>}
          <div className="caption mt-3 mb-2">Target length</div>
          <div className="body-sm">{brief.suggested_word_count} words · {brief.target_intent}</div>
        </div>
        <div>
          <div className="caption mb-2">Meta</div>
          <div className="body-sm"><strong>{brief.meta_title}</strong></div>
          <div className="body-sm text-muted mt-2">{brief.meta_description}</div>
        </div>
      </div>

      <div className="caption mt-4 mb-2">Outline</div>
      <ol style={{ margin: 0, padding: '0 0 0 18px', fontSize: 13, lineHeight: 1.6 }}>
        {(brief.outline || []).map((s, i) => (
          <li key={i} style={{ marginBottom: 8 }}>
            <strong>{s.heading}</strong>
            {!!s.points?.length && (
              <ul style={{ margin: '4px 0 0 0', padding: '0 0 0 16px', color: 'var(--text-muted)' }}>
                {s.points.map((p, j) => <li key={j}>{p}</li>)}
              </ul>
            )}
          </li>
        ))}
      </ol>

      {!!brief.secondary_keyword_coverage && Object.keys(brief.secondary_keyword_coverage).length > 0 && (
        <>
          <div className="caption mt-4 mb-2">Secondary keyword coverage</div>
          <ul style={{ margin: 0, padding: '0 0 0 18px', fontSize: 12, lineHeight: 1.6, color: 'var(--text-muted)' }}>
            {Object.entries(brief.secondary_keyword_coverage).map(([kw, sec], i) => (
              <li key={i}><strong style={{ color: 'var(--text)' }}>{kw}</strong> → {sec}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
