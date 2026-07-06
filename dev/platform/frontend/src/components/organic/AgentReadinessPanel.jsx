import React, { useState } from 'react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { roWrite } from '../../utils/readOnly';

// Owned › Optimise › Agent readiness. A simpler, in-house take on Google
// Lighthouse's new "Agentic Browsing" report: checks whether an AI agent (and
// AI search) can read and navigate the client's site — accessibility tree,
// layout stability, llms.txt and machine-readable structure — and scores it.

const STATUS_TONE = {
  pass: { bg: 'var(--positive-soft)', fg: 'var(--positive)', label: 'Pass' },
  warn: { bg: 'var(--warning-soft)', fg: 'var(--warning)', label: 'Needs work' },
  fail: { bg: 'var(--negative-soft)', fg: 'var(--negative)', label: 'Fix' },
  info: { bg: 'var(--surface-sunken)', fg: 'var(--text-muted)', label: 'Optional' },
};

function scoreColor(score) {
  if (score >= 90) return 'var(--positive)';
  if (score >= 50) return 'var(--warning)';
  return 'var(--negative)';
}

export default function AgentReadinessPanel({ clientId }) {
  const { readOnly } = useAuth();
  const [report, setReport] = useState(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState({});

  async function run() {
    setRunning(true); setErr(null);
    try {
      const r = await api.post(`/seo/clients/${clientId}/agent-readiness`);
      setReport(r);
      setOpen({});
    } catch (e) { setErr(e.message); }
    finally { setRunning(false); }
  }

  return (
    <div>
      <div className="callout" style={{ marginBottom: 'var(--s5)' }}>
        <strong>Agent readiness.</strong> AI agents and AI search are starting to browse the web for people. This runs Google's{' '}
        <a href="https://goo.gle/lighthouse-agentic-web" target="_blank" rel="noreferrer">Agentic Browsing</a>-style checks on the
        homepage — can an agent read the links, buttons and content, does the layout stay put, and is there an llms.txt — then scores it.
      </div>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 'var(--s5)' }}>
        <div className="body-sm text-subtle">
          {report ? <>Checked <strong>{report.url}</strong> · {new Date(report.checked_at).toLocaleString('en-GB')}</> : 'Checks the homepage of this client’s domain.'}
        </div>
        <button className="btn btn-primary" {...roWrite(readOnly, { onClick: run, disabled: running })}>
          {running ? 'Checking…' : report ? '↻ Re-check' : 'Run agent-readiness check'}
        </button>
      </div>

      {err && <div className="callout callout-warning" style={{ marginBottom: 'var(--s5)' }}>{err}</div>}

      {!report && !running && !err && (
        <p className="body-sm text-subtle">Run the check to see how ready the site is for AI agents and AI search.</p>
      )}

      {report && (
        <>
          {/* Score header */}
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 'var(--s5)', flexWrap: 'wrap' }}>
            <div style={{
              width: 84, height: 84, borderRadius: '50%', flex: '0 0 auto',
              display: 'grid', placeItems: 'center',
              border: `4px solid ${scoreColor(report.score)}`,
            }}>
              <div style={{ textAlign: 'center', lineHeight: 1 }}>
                <div style={{ fontSize: 26, fontWeight: 800, color: scoreColor(report.score) }}>{report.score}</div>
                <div className="body-xs text-subtle" style={{ marginTop: 2 }}>/ 100</div>
              </div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="h3" style={{ marginBottom: 2 }}>Grade {report.grade}</div>
              <div className="body-sm text-muted">
                {report.score >= 90 ? 'Agents can read and navigate this site well.'
                  : report.score >= 50 ? 'Mostly readable to agents, with a few fixes worth making.'
                  : 'Agents will struggle here — the fixes below matter for AI search.'}
              </div>
            </div>
          </div>

          {/* Check cards */}
          <div className="stack" style={{ gap: 12 }}>
            {report.checks.map(c => {
              const tone = STATUS_TONE[c.status] || STATUS_TONE.info;
              const hasItems = Array.isArray(c.items) && c.items.length > 0;
              const isOpen = !!open[c.id];
              return (
                <div key={c.id} className="card" style={{ padding: 'var(--s4)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700 }}>{c.label}</span>
                        <span className="chip" style={{ background: tone.bg, color: tone.fg, fontSize: 10 }}>{tone.label}</span>
                        {c.weight === 0 && <span className="body-xs text-subtle">informational</span>}
                      </div>
                      <div className="body-sm text-muted" style={{ marginTop: 4 }}>{c.summary}</div>
                    </div>
                    {hasItems && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(p => ({ ...p, [c.id]: !p[c.id] }))}>
                        {isOpen ? '▴ Hide' : `▾ ${c.items.length} detail${c.items.length === 1 ? '' : 's'}`}
                      </button>
                    )}
                  </div>

                  {c.status !== 'pass' && c.fix && (
                    <div className="body-xs" style={{ marginTop: 8, padding: '8px 10px', background: 'var(--surface-sunken)', borderRadius: 'var(--r-sm)' }}>
                      <strong>How to fix:</strong> {c.fix}
                    </div>
                  )}

                  {isOpen && hasItems && (
                    <div className="stack" style={{ gap: 6, marginTop: 10 }}>
                      {c.items.map((it, i) => (
                        <div key={i} className="body-xs" style={{ borderTop: 'var(--border-w) solid var(--card-border)', paddingTop: 6 }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                            {it.ok !== undefined && <span style={{ color: it.ok ? 'var(--positive)' : 'var(--negative)' }}>{it.ok ? '✓' : '✕'}</span>}
                            <span style={{ fontWeight: 600 }}>{it.issue}</span>
                            {it.selector && <code className="text-subtle" style={{ fontSize: 11 }}>{it.selector}</code>}
                          </div>
                          {it.snippet && <div className="text-subtle" style={{ marginTop: 2, fontFamily: 'monospace', fontSize: 11, overflowWrap: 'anywhere' }}>{it.snippet}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
