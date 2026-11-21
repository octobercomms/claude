import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { roWrite } from '../../utils/readOnly';

// Owned › Fix › Citation structure.
//
// Agent readiness scans the homepage and asks whether an agent can navigate
// the site. This asks a different question of a content page: is it shaped so
// an answer engine can lift something out of it rather than having to
// paraphrase a wall of prose.
//
// The four features come from AirOps' AI Search Playbook, which is the
// vendor's own research on SaaS and fintech pages. The panel says so, because
// an AM showing this to a client should know the provenance of the number
// they are reading out.

const STATUS_TONE = {
  pass: { bg: 'var(--positive-soft)', fg: 'var(--positive)', label: 'Good' },
  warn: { bg: 'var(--warning-soft)', fg: 'var(--warning)', label: 'Needs work' },
  fail: { bg: 'var(--negative-soft)', fg: 'var(--negative)', label: 'Missing' },
};

function scoreColor(score) {
  if (score >= 75) return 'var(--positive)';
  if (score >= 50) return 'var(--warning)';
  return 'var(--negative)';
}

function shortUrl(u) {
  try { const p = new URL(u); return p.pathname === '/' ? p.hostname : p.pathname; }
  catch { return u; }
}

export default function CitationStructurePanel({ clientId }) {
  const { readOnly } = useAuth();
  const [rows, setRows] = useState([]);
  const [report, setReport] = useState(null);
  const [url, setUrl] = useState('');
  const [running, setRunning] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [sweep, setSweep] = useState(null);
  const [err, setErr] = useState(null);
  const [loaded, setLoaded] = useState(false);

  function load() {
    return api.get(`/seo/clients/${clientId}/citation-structure`)
      .then(r => setRows(Array.isArray(r) ? r : []))
      .catch(() => {});
  }

  useEffect(() => {
    let alive = true;
    api.get(`/seo/clients/${clientId}/citation-structure`)
      .then(r => { if (alive) setRows(Array.isArray(r) ? r : []); })
      .catch(() => {})
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [clientId]);

  async function scoreOne() {
    if (!url.trim()) return;
    setRunning(true); setErr(null); setSweep(null);
    try {
      const r = await api.post(`/seo/clients/${clientId}/citation-structure`, { url: url.trim() });
      setReport(r);
      await load();
    } catch (e) { setErr(e.message); }
    finally { setRunning(false); }
  }

  async function scoreAll() {
    setSweeping(true); setErr(null); setReport(null);
    try {
      const r = await api.post(`/seo/clients/${clientId}/citation-structure`, {});
      setSweep(r);
      await load();
    } catch (e) { setErr(e.message); }
    finally { setSweeping(false); }
  }

  const busy = running || sweeping;

  return (
    <div>
      <div className="callout" style={{ marginBottom: 'var(--s5)' }}>
        <strong>Citation structure.</strong> Answer engines quote pages they can lift an answer out of.
        This scores four things on a content page: whether it answers real questions, whether the heading
        hierarchy holds, whether enumerations are lists and comparisons are tables, and how many schema
        types it declares. It parses the page directly, so it costs nothing to run and nothing to re-run.
      </div>

      <div className="card" style={{ padding: 'var(--s4)', marginBottom: 'var(--s5)' }}>
        <div className="row" style={{ gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ flex: '1 1 320px', minWidth: 0 }}
            placeholder="https://example.com/journal/an-article"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !busy) scoreOne(); }}
          />
          <button className="btn btn-primary" {...roWrite(readOnly, { onClick: scoreOne, disabled: busy || !url.trim() })}>
            {running ? 'Scoring…' : 'Score this page'}
          </button>
          <button className="btn" {...roWrite(readOnly, { onClick: scoreAll, disabled: busy })}>
            {sweeping ? 'Scoring published pages…' : 'Score every published page'}
          </button>
        </div>
        <div className="body-xs text-subtle" style={{ marginTop: 'var(--s2)' }}>
          The sweep covers pages OMI has published for this client, one at a time so the site isn’t hit with
          concurrent requests. Paste any URL above to score a page OMI didn’t publish.
        </div>
      </div>

      {err && <div className="callout callout-warning" style={{ marginBottom: 'var(--s5)' }}>{err}</div>}

      {sweep && (
        <div className="callout" style={{ marginBottom: 'var(--s5)' }}>
          Scored <strong>{sweep.scored}</strong> of {sweep.checked} published page{sweep.checked === 1 ? '' : 's'}
          {sweep.average !== null && <> · average <strong>{sweep.average}</strong>/100</>}
          {sweep.failed > 0 && <> · {sweep.failed} couldn’t be fetched</>}.
        </div>
      )}

      {report && (
        <>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s5)', marginBottom: 'var(--s5)', flexWrap: 'wrap' }}>
            <div style={{
              width: 84, height: 84, borderRadius: '50%', flex: '0 0 auto',
              display: 'grid', placeItems: 'center', border: `4px solid ${scoreColor(report.score)}`,
            }}>
              <div style={{ textAlign: 'center', lineHeight: 1 }}>
                <div style={{ fontSize: 'var(--fs-section)', fontWeight: 800, color: scoreColor(report.score) }}>{report.score}</div>
                <div className="body-xs text-subtle" style={{ marginTop: 'var(--s1)' }}>/ 100</div>
              </div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="h3" style={{ marginBottom: 'var(--s1)' }}>Grade {report.grade}</div>
              <div className="body-sm text-muted" style={{ overflowWrap: 'anywhere' }}>{report.url}</div>
              <div className="body-xs text-subtle" style={{ marginTop: 'var(--s1)' }}>
                {report.features.words} words · {report.features.lists} list{report.features.lists === 1 ? '' : 's'} ·{' '}
                {report.features.tables} table{report.features.tables === 1 ? '' : 's'} ·{' '}
                {report.features.schema_type_count} schema type{report.features.schema_type_count === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          <div className="stack" style={{ gap: 'var(--s3)', marginBottom: 'var(--s5)' }}>
            {report.checks.map(c => {
              const tone = STATUS_TONE[c.status] || STATUS_TONE.warn;
              return (
                <div key={c.id} className="card" style={{ padding: 'var(--s4)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700 }}>{c.label}</span>
                    <span className="chip" style={{ background: tone.bg, color: tone.fg, fontSize: 'var(--fs-caption)' }}>{tone.label}</span>
                    <span className="body-xs text-subtle">{Math.round(c.weight * 100)}% of the score</span>
                  </div>
                  <div className="body-sm text-muted" style={{ marginTop: 'var(--s1)' }}>{c.summary}</div>
                  {c.status !== 'pass' && c.fix && (
                    <div className="body-xs" style={{ marginTop: 'var(--s2)', padding: 'var(--s2) var(--s3)', background: 'var(--surface-sunken)', borderRadius: 'var(--r-sm)' }}>
                      <strong>How to fix:</strong> {c.fix}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {rows.length > 0 && (
        <>
          <div className="h4" style={{ marginBottom: 'var(--s3)' }}>Pages scored</div>
          <table className="table">
            <thead>
              <tr>
                <th>Page</th><th className="num">Score</th><th>FAQ</th>
                <th className="num">Schema</th><th className="num">Lists</th>
                <th className="num">Tables</th><th className="num">Words</th><th>Scanned</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.url}>
                  <td style={{ maxWidth: 320, overflowWrap: 'anywhere' }}>
                    <a href={r.url} target="_blank" rel="noreferrer">{shortUrl(r.url)}</a>
                  </td>
                  <td className="num" style={{ color: scoreColor(r.score), fontWeight: 700 }}>{r.score}</td>
                  <td>{r.features?.faq_via_schema ? 'Schema' : r.features?.faq_present ? 'Inferred' : '—'}</td>
                  <td className="num">{r.features?.schema_type_count ?? '—'}</td>
                  <td className="num">{r.features?.lists ?? '—'}</td>
                  <td className="num">{r.features?.tables ?? '—'}</td>
                  <td className="num">{r.features?.words ?? '—'}</td>
                  <td className="body-xs text-subtle">{new Date(r.created_at).toLocaleDateString('en-GB')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {!report && !sweep && rows.length === 0 && !busy && (
        <p className="body-sm text-subtle">
          {loaded ? 'Score a page to see how quotable it is to an answer engine.' : 'Loading…'}
        </p>
      )}

      <div className="body-xs text-subtle" style={{ marginTop: 'var(--s5)', paddingTop: 'var(--s3)', borderTop: 'var(--border-w) solid var(--card-border)' }}>
        The four features come from AirOps’ <em>Complete AI Search Playbook</em> (March 2026), their own
        research on roughly 12,000 mostly SaaS and fintech pages. Whether the same holds for architecture and
        design sites is untested, which is why every scan stores its raw features: once there is enough of our
        own data, the scores can be checked against which pages actually get cited.
      </div>
    </div>
  );
}
