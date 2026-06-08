import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api';
import PipelineStep from './PipelineStep';
import { PlanningTab } from '../SeoSuite';
import RefineChat from '../RefineChat';

// Pipeline → Brief. Two modes:
//   single  — existing PlanningTab; one keyword → one brief.
//   cluster — paste N keywords (one per line); Claude groups them into
//             topic clusters; AM picks one to generate a multi-keyword
//             brief that targets the whole cluster. Useful when you've
//             come out of Find with a Fan-out / Content Gaps run and
//             have a long keyword list to plan against.
const MODES = [
  { key: 'single',       label: 'One keyword',     tagline: "Single-keyword brief. Type a target keyword and Claude proposes the angle, outline, headings, questions to answer, internal links, and meta tags." },
  { key: 'cluster',      label: 'From a list',     tagline: "Paste a list of keywords. Claude groups them into 3–8 topic clusters; pick one and get a brief that targets the whole cluster as a single piece of content." },
  { key: 'programmatic', label: 'From a spreadsheet', tagline: "Upload a CSV (service, location, etc) and a template prompt. Claude generates one brief per row — service-area pages, product / competitor variants, industry pages, anything templated at scale." },
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
      {mode === 'programmatic' && <ProgrammaticMode clientId={clientId} />}
    </PipelineStep>
  );
}

function ClusterMode({ clientId }) {
  const [keywordText, setKeywordText] = useState('');
  const [clustering, setClustering] = useState(false);
  const [briefing, setBriefing] = useState(null);   // which cluster.label is being briefed
  const [result, setResult] = useState(null);       // { clusters, unclustered }
  const [briefs, setBriefs] = useState({});         // cluster.label → brief
  const [refineOpen, setRefineOpen] = useState({}); // cluster.label → bool
  const [err, setErr] = useState(null);

  // Try to JSON.parse a revision returned by the refine chat. Strip
  // any code fences first because Claude often wraps JSON in them
  // even inside <revision> tags despite the prompt asking it not to.
  function tryParseBriefJson(s) {
    const cleaned = String(s || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(cleaned); } catch { return null; }
  }

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
              const isRefining = !!refineOpen[c.label];
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
                    <div style={{ display: 'flex', gap: 8 }}>
                      {brief && (
                        <button
                          onClick={() => setRefineOpen(prev => ({ ...prev, [c.label]: !prev[c.label] }))}
                          className={`btn ${isRefining ? 'btn-primary' : 'btn-secondary'} btn-sm`}>
                          {isRefining ? 'Hide Claude' : '✦ Refine with Claude'}
                        </button>
                      )}
                      <button onClick={() => makeBrief(c)} className="btn btn-secondary btn-sm" disabled={briefing === c.label || !!brief}>
                        {brief ? '✓ Brief generated' : briefing === c.label ? 'Generating…' : 'Generate brief →'}
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: brief ? 'var(--s3)' : 0 }}>
                    {c.secondary.map((k, j) => (
                      <span key={j} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--r-pill)', background: 'var(--surface-sunken)', color: 'var(--text-muted)' }}>{k}</span>
                    ))}
                  </div>
                  {brief && (
                    <div style={{ display: isRefining ? 'grid' : 'block', gridTemplateColumns: isRefining ? 'minmax(0, 1fr) 380px' : undefined, gap: isRefining ? 'var(--s4)' : 0 }}>
                      <div><BriefView brief={brief} /></div>
                      {isRefining && (
                        <RefineChat
                          clientId={clientId}
                          kind="brief_json"
                          artifact={brief}
                          artifactMeta={`cluster: ${c.label} · primary: ${c.primary}`}
                          onApplyRevision={(content) => {
                            const parsed = tryParseBriefJson(content);
                            if (parsed) {
                              setBriefs(prev => ({ ...prev, [c.label]: parsed }));
                            } else {
                              setErr('Could not parse revised brief as JSON. Ask Claude to return raw JSON only.');
                            }
                          }}
                          onClose={() => setRefineOpen(prev => ({ ...prev, [c.label]: false }))}
                          compact
                        />
                      )}
                    </div>
                  )}
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

// Programmatic page builder — CSV-driven bulk brief generation. AM
// uploads a CSV + template prompt with {placeholders}; backend generates
// one brief per row using the brand voice profile + brief skeleton.
function ProgrammaticMode({ clientId }) {
  const [runs, setRuns] = useState([]);
  const [active, setActive] = useState(null);
  const [activeBriefs, setActiveBriefs] = useState([]);
  const [name, setName] = useState('');
  const [templatePrompt, setTemplatePrompt] = useState('');
  const [primaryKeywordTemplate, setPrimaryKeywordTemplate] = useState('');
  const [csvText, setCsvText] = useState('');
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
      const { runs: r } = await api.get(`/seo/clients/${clientId}/programmatic-runs`);
      setRuns(r);
      if (!active && r.length) openRun(r[0].id);
      else if (active) openRun(active);
      setRunning(r.some(x => x.status === 'running'));
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  async function openRun(id) {
    try {
      const r = await api.get(`/seo/programmatic-runs/${id}`);
      setActive(r.run.id);
      setActiveBriefs(r.briefs || []);
    } catch (e) { setErr(e.message); }
  }

  async function start() {
    if (!templatePrompt.trim() || !primaryKeywordTemplate.trim() || !csvText.trim()) return;
    setErr(null); setRunning(true);
    try {
      await api.post(`/seo/clients/${clientId}/programmatic-runs`, {
        name: name.trim() || 'Programmatic batch',
        template_prompt: templatePrompt.trim(),
        primary_keyword_template: primaryKeywordTemplate.trim(),
        csv_text: csvText,
      });
      setName(''); setTemplatePrompt(''); setPrimaryKeywordTemplate(''); setCsvText('');
      setTimeout(refresh, 1500);
    } catch (e) { setErr(e.message); setRunning(false); }
  }

  async function promote(brief) {
    try {
      const draft = await api.post(`/seo/programmatic-briefs/${brief.id}/promote`, {});
      setActiveBriefs(prev => prev.map(b => b.id === brief.id ? { ...b, content_draft_id: draft.id } : b));
    } catch (e) { setErr(e.message); }
  }

  async function deleteRun(id) {
    if (!confirm('Delete this run and all its briefs?')) return;
    try {
      await api.delete(`/seo/programmatic-runs/${id}`);
      const next = runs.filter(r => r.id !== id);
      setRuns(next);
      if (active === id) { setActive(null); setActiveBriefs([]); }
    } catch (e) { setErr(e.message); }
  }

  const csvRowCount = csvText.split('\n').filter(l => l.trim()).length - 1;
  const estCost = csvRowCount > 0 ? (csvRowCount * 0.015).toFixed(2) : '0.00';

  return (
    <div>
      <div className="card mb-5">
        <div className="caption mb-2">New programmatic batch</div>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Batch name (e.g. UK service-area pages Q3)"
          style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', marginBottom: 8, boxSizing: 'border-box' }} />
        <input value={templatePrompt} onChange={e => setTemplatePrompt(e.target.value)}
          placeholder="Template — describe the page type. Use {column} placeholders. e.g. 'Local services landing page for {service} in {location}'"
          style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', marginBottom: 8, boxSizing: 'border-box' }} />
        <input value={primaryKeywordTemplate} onChange={e => setPrimaryKeywordTemplate(e.target.value)}
          placeholder="Primary keyword template, e.g. '{service} in {location}'"
          style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', marginBottom: 8, boxSizing: 'border-box' }} />
        <textarea value={csvText} onChange={e => setCsvText(e.target.value)} rows={8}
          placeholder={"CSV with header row. Example:\nservice,location\nplumber,London\nplumber,Manchester\nelectrician,London"}
          style={{ width: '100%', padding: '10px 12px', fontSize: 13, lineHeight: 1.5, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', boxSizing: 'border-box', resize: 'vertical' }} />
        <div className="row between center mt-2">
          <span className="body-xs text-subtle">
            {csvRowCount > 0 ? `${csvRowCount} data row${csvRowCount === 1 ? '' : 's'} · est cost ~\$${estCost}` : 'paste a CSV with a header + at least one row'}
          </span>
          <button onClick={start} className="btn btn-primary" disabled={running || !templatePrompt.trim() || !primaryKeywordTemplate.trim() || csvRowCount < 1}>
            {running ? 'Generating…' : `Generate ${csvRowCount || 0} briefs`}
          </button>
        </div>
      </div>

      {err && <div className="callout callout-danger mb-3">{err}</div>}

      {loading && !runs.length ? (
        <div style={{ color: 'var(--text-subtle)', padding: 40 }}>Loading…</div>
      ) : !runs.length ? (
        <div style={{ color: 'var(--text-subtle)', padding: 20, fontSize: 13 }}>
          No programmatic runs yet. Fill in the form above to generate your first batch.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 22 }}>
          <div>
            <div className="caption mb-3">Past runs</div>
            <div className="stack" style={{ gap: 6 }}>
              {runs.map(r => {
                const isActive = r.id === active;
                return (
                  <div key={r.id} className="card"
                    style={{ padding: 10, cursor: 'pointer',
                      background: isActive ? 'var(--accent-soft)' : 'var(--surface)',
                      borderColor: isActive ? 'var(--accent)' : 'var(--card-border)' }}
                    onClick={() => openRun(r.id)}>
                    <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>
                      {new Date(r.started_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      {' · '}
                      <span style={{ fontWeight: 700, color: r.status === 'failed' ? 'var(--negative)' : r.status === 'running' ? 'var(--warning)' : 'var(--positive)' }}>
                        {r.completed_rows}/{r.total_rows}{r.failed_rows ? ` (${r.failed_rows} failed)` : ''} · {r.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            {!active ? (
              <div style={{ color: 'var(--text-subtle)', padding: 20 }}>Pick a run on the left.</div>
            ) : (
              <>
                <div className="row between center mb-3" style={{ gap: 12 }}>
                  <div className="caption">{activeBriefs.length} brief{activeBriefs.length === 1 ? '' : 's'} in this run</div>
                  <button onClick={() => deleteRun(active)} className="btn btn-ghost btn-sm" style={{ color: 'var(--negative)' }}>Delete run</button>
                </div>
                <div className="card" style={{ padding: 0 }}>
                  <table className="table">
                    <thead><tr>
                      <th className="caption" style={{ padding: '8px 10px' }}>#</th>
                      <th className="caption" style={{ padding: '8px 10px' }}>Row data</th>
                      <th className="caption" style={{ padding: '8px 10px' }}>Generated title</th>
                      <th className="caption" style={{ padding: '8px 10px' }}>Status</th>
                      <th className="caption" style={{ padding: '8px 10px', textAlign: 'right' }}>Actions</th>
                    </tr></thead>
                    <tbody>
                      {activeBriefs.map(b => (
                        <tr key={b.id} style={{ borderBottom: '1px solid var(--card-border)' }}>
                          <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-subtle)' }}>{b.row_index + 1}</td>
                          <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text-muted)' }}>
                            {Object.entries(b.row_data || {}).map(([k, v]) => `${k}: ${v}`).join(' · ').slice(0, 120)}
                          </td>
                          <td style={{ padding: '8px 10px', fontSize: 12 }}>
                            {b.title ? <strong>{b.title}</strong> : <em style={{ color: 'var(--text-subtle)' }}>—</em>}
                            {b.slug && <div style={{ fontSize: 10, color: 'var(--text-subtle)' }}>/{b.slug}</div>}
                          </td>
                          <td style={{ padding: '8px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
                            color: b.status === 'failed' ? 'var(--negative)' : b.status === 'complete' ? 'var(--positive)' : 'var(--warning)' }}>
                            {b.status}{b.error_message ? ` · ${b.error_message.slice(0, 60)}` : ''}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                            {b.status === 'complete' && (
                              b.content_draft_id
                                ? <span style={{ fontSize: 11, color: 'var(--positive)', fontWeight: 700 }}>✓ in Pipeline</span>
                                : <button onClick={() => promote(b)} className="btn btn-ghost btn-sm" style={{ color: 'var(--accent)' }}>Send to Pipeline →</button>
                            )}
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
    </div>
  );
}
