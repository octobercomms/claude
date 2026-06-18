import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api';

// Local SEO toolkit — one panel, five tools (selected by the `tool` prop from
// the SEO suite's sub-tabs). Each tool is a paste-input → Claude → structured
// result flow with a per-tool history rail. The backend persists every run, so
// the rail re-opens any past result without a re-run.

const TOOL_META = {
  competition_gap: {
    title: 'Competition Gap Killer',
    blurb: 'Paste up to 3 competitor URLs. Claude reads the pages and returns the content gaps, the topics to create to outrank them, and the trust signals you\'re missing.',
    run: 'Find gaps',
    fields: [{ key: 'competitorUrls', kind: 'urls', label: 'Competitor URLs (one per line, up to 3)', placeholder: 'competitor1.com\ncompetitor2.com/services' }],
  },
  schema_audit: {
    title: 'Full Schema Audit',
    blurb: 'Paste a page URL. Claude extracts every schema type on the page, grades each (useful / weak / broken), flags what\'s missing — especially LocalBusiness — and generates clean JSON-LD for the high-priority fixes.',
    run: 'Audit schema',
    fields: [{ key: 'url', kind: 'url', label: 'Page URL', placeholder: 'https://example.com/services' }],
  },
  buyer_intent: {
    title: 'Buyer-Intent Keyword Sniper',
    blurb: '20 high-intent local keywords for a service in a city — "near me", "emergency", "same day" and long-tail variations, each tagged with intent and why it converts.',
    run: 'List keywords',
    fields: [
      { key: 'service', kind: 'text', label: 'Service', placeholder: 'emergency plumber' },
      { key: 'city', kind: 'text', label: 'City', placeholder: 'Leeds' },
    ],
  },
  competitor_xray: {
    title: 'Business vs Competitor X-Ray',
    blurb: 'Your site against up to 3 competitors. Claude extracts services, locations, USPs and trust signals for each, builds a side-by-side comparison, and names the advantages you can exploit.',
    run: 'Run X-ray',
    fields: [
      { key: 'myUrl', kind: 'url', label: 'Your website URL (blank = client domain)', placeholder: 'https://yourbusiness.com' },
      { key: 'competitorUrls', kind: 'urls', label: 'Competitor URLs (one per line, up to 3)', placeholder: 'competitor1.com\ncompetitor2.com' },
    ],
  },
  gbp_posts: {
    title: 'Google Business Profile Posts',
    blurb: 'Analyse a competitor\'s presence and generate 10 high-converting GBP posts — local keyword + landmark + urgency CTA — for a service in a city.',
    run: 'Generate posts',
    fields: [
      { key: 'service', kind: 'text', label: 'Service', placeholder: 'roofing' },
      { key: 'city', kind: 'text', label: 'City', placeholder: 'Bristol' },
      { key: 'competitorUrl', kind: 'url', label: 'Competitor URL (optional)', placeholder: 'https://competitor.com' },
    ],
  },
  ranking_playbook: {
    title: 'GBP Ranking Playbook',
    blurb: 'Reverse-engineer the local map pack for a service + city: the ranking levers Google rewards (with competitor evidence), a review strategy, and a photo strategy — one execution playbook.',
    run: 'Build playbook',
    fields: [
      { key: 'service', kind: 'text', label: 'Service', placeholder: 'dentist' },
      { key: 'city', kind: 'text', label: 'City', placeholder: 'Manchester' },
      { key: 'competitorUrls', kind: 'urls', label: 'Competitor URLs (optional, up to 3)', placeholder: 'competitor1.com\ncompetitor2.com' },
    ],
  },
};

const LEVEL_CHIP = { low: 'chip-success', medium: 'chip-warning', high: 'chip-danger' };
const PRIORITY_CHIP = { high: 'chip-danger', medium: 'chip-warning', low: 'chip-neutral' };
const VERDICT_CHIP = { useful: 'chip-success', weak: 'chip-warning', broken: 'chip-danger' };
const INTENT_CHIP = { transactional: 'chip-success', commercial: 'chip-warning', informational: 'chip-neutral' };

function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn btn-secondary btn-sm" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch {}
    }}>{done ? 'Copied' : label}</button>
  );
}

function parseLines(s) {
  return String(s || '').split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
}

function fmtWhen(d) {
  return new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function LocalSeoPanel({ clientId, tool }) {
  const meta = TOOL_META[tool];
  const [runs, setRuns] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [form, setForm] = useState({});
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // Reset form + reload history whenever the tool changes.
  useEffect(() => {
    setForm({});
    setErr(null);
    setActiveId(null);
    setLoading(true);
    api.get(`/seo/clients/${clientId}/local-seo/${tool}`)
      .then(({ runs: r }) => { setRuns(r); if (r.length) setActiveId(r[0].id); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [clientId, tool]);

  const activeRun = useMemo(() => runs.find(r => r.id === activeId) || null, [runs, activeId]);

  async function runNow() {
    setRunning(true);
    setErr(null);
    const body = {};
    for (const f of meta.fields) {
      body[f.key] = f.kind === 'urls' ? parseLines(form[f.key]) : (form[f.key] || '').trim();
    }
    try {
      const { run } = await api.post(`/seo/clients/${clientId}/local-seo/${tool}`, body);
      setRuns(prev => [run, ...prev]);
      setActiveId(run.id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setRunning(false);
    }
  }

  async function deleteRun(id) {
    if (!window.confirm('Delete this run?')) return;
    try {
      await api.delete(`/seo/clients/${clientId}/local-seo/${tool}/${id}`);
      const next = runs.filter(r => r.id !== id);
      setRuns(next);
      if (activeId === id) setActiveId(next[0]?.id || null);
    } catch (e) { setErr(e.message); }
  }

  const canRun = meta.fields.every(f => {
    if (f.label.includes('optional') || f.label.includes('blank')) return true;
    const v = form[f.key];
    return f.kind === 'urls' ? parseLines(v).length > 0 : !!(v && v.trim());
  });

  return (
    <div>
      <h2 className="h2">{meta.title}</h2>
      <p style={{ fontSize: 12, color: 'var(--text-subtle)', margin: '0 0 16px', maxWidth: 780 }}>{meta.blurb}</p>

      {/* Input */}
      <div className="card" style={{ marginBottom: 18, maxWidth: 780 }}>
        <div style={{ display: 'grid', gap: 12 }}>
          {meta.fields.map(f => (
            <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="field-label">{f.label}</span>
              {f.kind === 'urls'
                ? <textarea className="input" style={{ minHeight: 70, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
                    value={form[f.key] || ''} onChange={e => setForm(s => ({ ...s, [f.key]: e.target.value }))} placeholder={f.placeholder} />
                : <input className="input" value={form[f.key] || ''} onChange={e => setForm(s => ({ ...s, [f.key]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter' && f.kind !== 'urls' && canRun && !running) runNow(); }} placeholder={f.placeholder} />}
            </label>
          ))}
        </div>
        <div style={{ marginTop: 14 }}>
          <button className="btn btn-primary" onClick={runNow} disabled={running || !canRun}>
            {running ? 'Running…' : meta.run}
          </button>
        </div>
      </div>

      {err && <div className="callout callout-danger" style={{ marginBottom: 14 }}>{err}</div>}

      {loading ? (
        <div style={{ color: 'var(--text-subtle)', padding: 20 }}>Loading…</div>
      ) : !runs.length ? (
        <div style={{ color: 'var(--text-subtle)', padding: 20, fontSize: 13 }}>No runs yet — fill in the form above and run it.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 22 }}>
          <div>
            <div className="h3" style={{ marginBottom: 8 }}>History</div>
            {runs.map(r => (
              <div key={r.id} className="card" style={{ padding: 10, marginBottom: 8, cursor: 'pointer', background: r.id === activeId ? 'var(--accent-soft)' : 'var(--surface)' }}
                onClick={() => setActiveId(r.id)}>
                <div style={{ fontWeight: 600, fontSize: 12, lineHeight: 1.3, wordBreak: 'break-word' }}>{r.title || '(run)'}</div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>{fmtWhen(r.created_at)}</div>
              </div>
            ))}
          </div>
          <div>
            {activeRun && (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                  <button className="btn btn-ghost btn-sm" style={{ color: 'var(--text-subtle)' }} onClick={() => deleteRun(activeRun.id)}>Delete</button>
                </div>
                <ToolResult tool={tool} output={activeRun.output_json || {}} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Summary({ text }) {
  if (!text) return null;
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="caption mb-2">Briefing</div>
      <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{text}</div>
    </div>
  );
}

function Chips({ items }) {
  if (!items?.length) return null;
  return (
    <ul style={{ margin: '0 0 0 18px', padding: 0, fontSize: 13, lineHeight: 1.7, color: 'var(--text-muted)' }}>
      {items.map((x, i) => <li key={i}>{x}</li>)}
    </ul>
  );
}

function ToolResult({ tool, output }) {
  if (tool === 'competition_gap') {
    return (
      <>
        <Summary text={output.summary} />
        <h3 className="h3">Content gaps</h3>
        {(output.content_gaps || []).map((g, i) => (
          <div key={i} className="card" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <strong style={{ fontSize: 14 }}>{g.title}</strong>
              {g.competition_level && <span className={`chip ${LEVEL_CHIP[g.competition_level] || 'chip-neutral'}`} style={{ flex: '0 0 auto' }}>{g.competition_level} comp.</span>}
            </div>
            {g.description && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{g.description}</div>}
            {g.why_they_rank && <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}><em>Why they rank:</em> {g.why_they_rank}</div>}
          </div>
        ))}
        <h3 className="h3" style={{ marginTop: 18 }}>Topics to create</h3>
        {(output.topics_to_create || []).map((t, i) => (
          <div key={i} className="card" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <strong style={{ fontSize: 14 }}>{t.title}</strong>
              {t.target_intent && <span className={`chip ${INTENT_CHIP[t.target_intent] || 'chip-neutral'}`} style={{ flex: '0 0 auto' }}>{t.target_intent}</span>}
            </div>
            {t.angle && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{t.angle}</div>}
            {t.why_it_will_rank && <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}><em>Why it ranks:</em> {t.why_it_will_rank}</div>}
          </div>
        ))}
        {output.trust_gaps?.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <h3 className="h3">Trust gaps</h3>
            <Chips items={output.trust_gaps} />
          </div>
        )}
      </>
    );
  }

  if (tool === 'schema_audit') {
    return (
      <>
        <div className="card" style={{ marginBottom: 14, borderLeft: `3px solid ${output.localbusiness_present ? 'var(--positive)' : 'var(--negative)'}` }}>
          <strong>{output.localbusiness_present ? '✓ LocalBusiness schema present' : '✗ No LocalBusiness schema'}</strong>
          {output.summary && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.6 }}>{output.summary}</div>}
        </div>
        {output.existing?.length > 0 && (<>
          <h3 className="h3">Existing schema</h3>
          <div className="card" style={{ padding: 0, marginBottom: 14 }}>
            <table className="table">
              <thead><tr><th>Type</th><th>Verdict</th><th>Note</th></tr></thead>
              <tbody>
                {output.existing.map((e, i) => (
                  <tr key={i}>
                    <td><strong>{e.type}</strong></td>
                    <td><span className={`chip ${VERDICT_CHIP[e.verdict] || 'chip-neutral'}`}>{e.verdict}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{e.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}
        {output.missing?.length > 0 && (<>
          <h3 className="h3">Missing / under-utilised</h3>
          <div className="card" style={{ padding: 0, marginBottom: 14 }}>
            <table className="table">
              <thead><tr><th>Type</th><th>Priority</th><th>Why</th></tr></thead>
              <tbody>
                {output.missing.map((m, i) => (
                  <tr key={i}>
                    <td><strong>{m.type}</strong></td>
                    <td><span className={`chip ${PRIORITY_CHIP[m.priority] || 'chip-neutral'}`}>{m.priority}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}
        {output.generated?.length > 0 && (<>
          <h3 className="h3">Generated JSON-LD</h3>
          {output.generated.map((g, i) => (
            <div key={i} className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong>{g.type}</strong>
                <CopyButton text={g.jsonld} />
              </div>
              <pre style={{ margin: 0, padding: 12, background: 'var(--surface-sunken)', borderRadius: 'var(--r-sm)', overflowX: 'auto', fontSize: 11, lineHeight: 1.5 }}>{g.jsonld}</pre>
            </div>
          ))}
        </>)}
      </>
    );
  }

  if (tool === 'buyer_intent') {
    return (
      <>
        <Summary text={output.summary} />
        <div className="card" style={{ padding: 0 }}>
          <table className="table">
            <thead><tr><th>Keyword</th><th>Intent</th><th>Long-tail</th><th>Why it converts</th></tr></thead>
            <tbody>
              {(output.keywords || []).map((k, i) => (
                <tr key={i}>
                  <td><strong>{k.keyword}</strong></td>
                  <td><span className={`chip ${INTENT_CHIP[k.intent_type] || 'chip-neutral'}`}>{k.intent_type}</span></td>
                  <td>{k.long_tail ? '✓' : '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{k.why_converts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  if (tool === 'competitor_xray') {
    const me = output.me || {};
    return (
      <>
        <Summary text={output.summary} />
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="caption mb-2">You — {me.name || ''}</div>
          <XRayRow label="Services" items={me.services} />
          <XRayRow label="Locations" items={me.locations} />
          <XRayRow label="USPs" items={me.usps} />
        </div>
        {(output.competitors || []).map((c, i) => (
          <div key={i} className="card" style={{ marginBottom: 10 }}>
            <div className="caption mb-2">{c.name || c.domain}</div>
            <XRayRow label="Services" items={c.services} />
            <XRayRow label="Locations" items={c.locations} />
            <XRayRow label="Strengths" items={c.strengths} />
            <XRayRow label="Trust signals" items={c.trust_signals} />
          </div>
        ))}
        {output.comparison?.length > 0 && (<>
          <h3 className="h3" style={{ marginTop: 18 }}>Side-by-side</h3>
          <div className="card" style={{ padding: 0, marginBottom: 14 }}>
            <table className="table">
              <thead><tr><th>Dimension</th><th>You</th><th>Competitors</th></tr></thead>
              <tbody>
                {output.comparison.map((c, i) => (
                  <tr key={i}><td><strong>{c.dimension}</strong></td><td style={{ fontSize: 12 }}>{c.you}</td><td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.competitors}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}
        {output.advantages?.length > 0 && (<>
          <h3 className="h3">Advantages to exploit</h3>
          {output.advantages.map((a, i) => (
            <div key={i} className="card" style={{ marginBottom: 10 }}>
              <strong style={{ fontSize: 14 }}>{a.advantage}</strong>
              {a.how_to_exploit && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>→ {a.how_to_exploit}</div>}
            </div>
          ))}
        </>)}
      </>
    );
  }

  if (tool === 'gbp_posts') {
    return (
      <>
        <Summary text={output.summary} />
        {output.gaps?.length > 0 && (
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="caption mb-2">Gaps competitors aren't covering</div>
            <Chips items={output.gaps} />
          </div>
        )}
        {(output.posts || []).map((p, i) => (
          <div key={i} className="card" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {p.local_keyword && <span className="chip chip-neutral">{p.local_keyword}</span>}
                {p.landmark && <span className="chip chip-neutral">📍 {p.landmark}</span>}
              </div>
              <CopyButton text={p.body} label="Copy post" />
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{p.body}</div>
            {p.cta && <div style={{ fontSize: 12, fontWeight: 700, marginTop: 6, color: 'var(--accent)' }}>{p.cta}</div>}
          </div>
        ))}
      </>
    );
  }

  if (tool === 'ranking_playbook') {
    const rs = output.review_strategy || {};
    const ps = output.photo_strategy || {};
    return (
      <>
        <Summary text={output.summary} />
        {(output.ranking_levers || []).length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div className="caption mb-2">Ranking levers (highest impact first)</div>
            <table className="table">
              <thead><tr>{['Impact', 'Lever', 'Evidence / why it ranks'].map(h => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {output.ranking_levers.map((l, i) => (
                  <tr key={i}>
                    <td><span className={`chip ${LEVEL_CHIP[l.impact] || 'chip-neutral'}`}>{l.impact || '—'}</span></td>
                    <td style={{ fontWeight: 600 }}>{l.lever}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{l.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="caption mb-2">Review strategy</div>
          {rs.keyword_themes?.length > 0 && <div style={{ marginBottom: 6 }}><Chips items={rs.keyword_themes} /></div>}
          {rs.pacing && <div style={{ fontSize: 13, marginBottom: 3 }}><strong>Pacing:</strong> {rs.pacing}</div>}
          {rs.rating_target && <div style={{ fontSize: 13, marginBottom: 3 }}><strong>Rating target:</strong> {rs.rating_target}</div>}
          {rs.reply_approach && <div style={{ fontSize: 13 }}><strong>Replies:</strong> {rs.reply_approach}</div>}
        </div>
        <div className="card">
          <div className="caption mb-2">Photo strategy</div>
          {ps.priority_types?.length > 0 && <div style={{ marginBottom: 6 }}><Chips items={ps.priority_types} /></div>}
          {ps.cadence && <div style={{ fontSize: 13, marginBottom: 3 }}><strong>Cadence:</strong> {ps.cadence}</div>}
          {ps.notes && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{ps.notes}</div>}
        </div>
      </>
    );
  }

  return <div style={{ color: 'var(--text-subtle)' }}>Unknown tool.</div>;
}

function XRayRow({ label, items }) {
  if (!items?.length) return null;
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 4, fontSize: 13 }}>
      <span style={{ flex: '0 0 110px', color: 'var(--text-subtle)' }}>{label}</span>
      <span style={{ color: 'var(--text-muted)' }}>{items.join(', ')}</span>
    </div>
  );
}
