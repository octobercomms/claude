// Subreddit deep research → content angles (the "Reddit Claude" play).
// Point it at the subreddit where the client's buyers gather; it pulls the top
// posts, finds the #1 pain point with evidence, and turns that into blog topics,
// reel hooks, a reel script with a comment-keyword CTA (which drops into the DM
// bot's comment-to-DM), and a lead-magnet outline. Runs are saved.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { roWrite } from '../utils/readOnly';

function CopyBtn({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn btn-secondary btn-sm" onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}>
      {done ? 'Copied' : label}
    </button>
  );
}

export default function SubredditResearchPanel({ clientId, onUseAsBrief }) {
  const toast = useToast();
  const { readOnly } = useAuth();
  const [subreddit, setSubreddit] = useState('');
  const [focus, setFocus] = useState('');
  const [time, setTime] = useState('month');
  const [suggested, setSuggested] = useState([]);
  const [suggesting, setSuggesting] = useState(false);
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState([]);
  const [active, setActive] = useState(null); // full run { result }

  async function loadRuns() {
    try { const r = await api.get(`/social/clients/${clientId}/subreddit-research`); setRuns(r.runs || []); } catch { /* ignore */ }
  }
  useEffect(() => { loadRuns(); /* eslint-disable-line */ }, [clientId]);

  async function suggest() {
    setSuggesting(true);
    try { const r = await api.post(`/social/clients/${clientId}/subreddit-research/suggest`, {}); setSuggested(r.subreddits || []); }
    catch (e) { toast(e.message, 'error'); }
    finally { setSuggesting(false); }
  }

  async function run() {
    if (!subreddit.trim()) { toast('Enter a subreddit first.', 'error'); return; }
    setRunning(true);
    try {
      const { run: r } = await api.post(`/social/clients/${clientId}/subreddit-research`, { subreddit: subreddit.trim(), focus: focus.trim() || null, time });
      setActive(r); loadRuns();
      toast('Research complete.', 'success');
    } catch (e) { toast(`Research failed: ${e.message}`, 'error'); }
    finally { setRunning(false); }
  }

  async function open(id) {
    try { const { run: r } = await api.get(`/social/clients/${clientId}/subreddit-research/${id}`); setActive(r); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function remove(id) {
    if (!confirm('Delete this research?')) return;
    try { await api.delete(`/social/clients/${clientId}/subreddit-research/${id}`); setRuns(prev => prev.filter(r => r.id !== id)); if (active?.id === id) setActive(null); }
    catch (e) { toast(e.message, 'error'); }
  }

  const res = active?.result || null;

  return (
    <div className="stack stack-lg">
      <div>
        <div className="h2 mt-2">Subreddit research</div>
        <p className="body-sm text-muted" style={{ maxWidth: 680, marginTop: 4 }}>
          Point it at the subreddit where this client's buyers actually gather. It reads the top posts, finds the biggest
          repeated pain point with real evidence, and turns it into blog topics, reel hooks, and a reel script with a
          comment-keyword CTA — which drops straight into the DM bot's comment-to-DM.
        </p>
      </div>

      {/* Run form */}
      <div className="card stack" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label className="field-label">Subreddit</label>
            <input className="input" value={subreddit} onChange={e => setSubreddit(e.target.value)} placeholder="Architects" onKeyDown={e => { if (e.key === 'Enter') run(); }} />
          </div>
          <div style={{ flex: '2 1 240px' }}>
            <label className="field-label">Focus <span className="text-subtle">(optional)</span></label>
            <input className="input" value={focus} onChange={e => setFocus(e.target.value)} placeholder="e.g. getting clients, pricing" onKeyDown={e => { if (e.key === 'Enter') run(); }} />
          </div>
          <div style={{ width: 120 }}>
            <label className="field-label">Window</label>
            <select className="input" value={time} onChange={e => setTime(e.target.value)}>
              <option value="week">Past week</option>
              <option value="month">Past month</option>
              <option value="year">Past year</option>
              <option value="all">All time</option>
            </select>
          </div>
          <button className="btn btn-primary" {...roWrite(readOnly, { onClick: run, disabled: running })}>{running ? 'Researching…' : 'Research'}</button>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" {...roWrite(readOnly, { onClick: suggest, disabled: suggesting })}>{suggesting ? 'Thinking…' : '✨ Suggest subreddits'}</button>
          {suggested.map(s => (
            <button key={s.name} className="chip chip-neutral" title={s.why || ''} style={{ cursor: 'pointer' }} onClick={() => setSubreddit(s.name)}>r/{s.name}</button>
          ))}
        </div>
        {running && <div className="body-xs text-subtle">Scraping Reddit and analysing — this can take a minute or two.</div>}
      </div>

      {/* Result */}
      {res && (
        <div className="stack stack-lg">
          <div className="card accent">
            <div className="caption">Biggest pain point · r/{res.subreddit}</div>
            <div className="h3 mt-2">{res.top_pain || '—'}</div>
            {res.analysis_note && <div className="body-xs text-subtle" style={{ marginTop: 6 }}>{res.analysis_note}</div>}
          </div>

          {res.pain_points?.length > 0 && (
            <div>
              <div className="caption mb-2">Pain points — with evidence from the threads</div>
              <div className="stack stack-sm">
                {res.pain_points.map((p, i) => (
                  <div key={i} className="card" style={{ padding: '10px 14px' }}>
                    <div className="row between center"><span className="body-sm" style={{ fontWeight: 700 }}>{p.pain}</span>
                      <span className="chip chip-neutral">{p.severity}</span></div>
                    {p.evidence?.length > 0 && (
                      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                        {p.evidence.map((e, j) => <li key={j} className="body-xs text-muted" style={{ marginBottom: 2 }}>{e}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-2" style={{ gap: 16 }}>
            {res.blog_topics?.length > 0 && (
              <div>
                <div className="caption mb-2">Blog topics</div>
                <div className="stack stack-sm">
                  {res.blog_topics.map((b, i) => (
                    <div key={i} className="card" style={{ padding: '8px 12px' }}>
                      <div className="row between center" style={{ gap: 8 }}>
                        <span className="body-sm" style={{ fontWeight: 600 }}>{b.title}</span>
                        {onUseAsBrief && <button className="btn btn-secondary btn-sm" onClick={() => onUseAsBrief(`Blog post: ${b.title}${b.angle ? `\nAngle: ${b.angle}` : ''}`)}>Use as brief</button>}
                      </div>
                      {b.angle && <div className="body-xs text-subtle" style={{ marginTop: 2 }}>{b.angle}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {res.reel_hooks?.length > 0 && (
              <div>
                <div className="caption mb-2">Reel hooks</div>
                <div className="stack stack-sm">
                  {res.reel_hooks.map((h, i) => (
                    <div key={i} className="card" style={{ padding: '8px 12px' }}>
                      <div className="row between center" style={{ gap: 8 }}>
                        <span className="body-sm" style={{ fontWeight: 600 }}>{h.hook}</span>
                        {onUseAsBrief && <button className="btn btn-secondary btn-sm" onClick={() => onUseAsBrief(`Reel hook: ${h.hook}${h.angle ? `\nAngle: ${h.angle}` : ''}`)}>Use as brief</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {res.reel_script && (
            <div className="card">
              <div className="row between center"><div className="caption">Reel script</div><CopyBtn text={`${res.reel_script.hook}\n\n${res.reel_script.body}\n\n${res.reel_script.cta}\n\n${res.reel_script.caption}`} label="Copy script" /></div>
              <div className="stack stack-sm" style={{ marginTop: 8 }}>
                <div><span className="field-label">Hook</span><div className="body-sm">{res.reel_script.hook}</div></div>
                <div><span className="field-label">Body</span><div className="body-sm" style={{ whiteSpace: 'pre-wrap' }}>{res.reel_script.body}</div></div>
                <div><span className="field-label">CTA</span><div className="body-sm">{res.reel_script.cta}</div></div>
                {res.reel_script.caption && <div><span className="field-label">Caption</span><div className="body-sm" style={{ whiteSpace: 'pre-wrap' }}>{res.reel_script.caption}</div></div>}
              </div>
              {res.reel_script.keyword && (
                <div className="callout" style={{ marginTop: 10, background: 'var(--accent-soft)', padding: 12, borderRadius: 'var(--r-sm)' }}>
                  <div className="body-sm">Comment keyword: <strong style={{ fontSize: 16, letterSpacing: 1 }}>{res.reel_script.keyword}</strong></div>
                  <div className="body-xs text-subtle" style={{ marginTop: 4 }}>Set this as a comment trigger keyword under <strong>Engage → DM bot → Live auto-send</strong>, and anyone who comments it gets the lead magnet auto-DM'd.</div>
                </div>
              )}
            </div>
          )}

          {res.lead_magnet && (
            <div className="card">
              <div className="caption">Lead magnet — {res.lead_magnet.format}</div>
              <div className="h3 mt-2">{res.lead_magnet.title}</div>
              {res.lead_magnet.outline?.length > 0 && (
                <ol style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                  {res.lead_magnet.outline.map((o, i) => <li key={i} className="body-sm" style={{ marginBottom: 3 }}>{o}</li>)}
                </ol>
              )}
            </div>
          )}
        </div>
      )}

      {/* History */}
      {runs.length > 0 && (
        <div>
          <div className="caption mb-2">Past research</div>
          <div className="stack stack-sm">
            {runs.map(r => (
              <div key={r.id} className="card" style={{ padding: '8px 12px' }}>
                <div className="row between center" style={{ gap: 8 }}>
                  <button className="body-sm" style={{ fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }} onClick={() => open(r.id)}>
                    r/{r.subreddit}{r.focus ? ` · ${r.focus}` : ''}
                  </button>
                  <div className="row center" style={{ gap: 8 }}>
                    <span className="body-xs text-subtle">{new Date(r.created_at).toLocaleDateString('en-GB')}</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => remove(r.id)}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
