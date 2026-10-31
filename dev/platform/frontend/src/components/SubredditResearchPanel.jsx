// Subreddit deep research → content angles (the "Reddit Claude" play).
// Point it at the subreddit where the client's buyers gather; it pulls the top
// posts, finds the #1 pain point with evidence, and turns that into blog topics,
// reel hooks, a reel script with a comment-keyword CTA (which drops into the DM
// bot's comment-to-DM), and a lead-magnet outline. Runs are saved.
//
// The subreddits come first, because "without knowing the subreddit, it's
// hard to know where to start" is the actual first problem. They were a row
// of chips that filled a text box: gone on reload, and another Claude call to
// see the same list again. Now they are a stored table you configure — a
// focus and a window per row, and Research runs against the row.

import React, { useEffect, useRef, useState } from 'react';
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
  const [rows, setRows] = useState([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [suggesting, setSuggesting] = useState(false);
  const [running, setRunning] = useState(false);
  const [runningId, setRunningId] = useState(null);
  const [adding, setAdding] = useState('');
  // The focus text at the moment the field was focused, so blur writes only
  // when something actually changed. Comparing against the row's own state is
  // useless: onChange already wrote it there.
  const focusAtFocus = useRef('');
  const [runs, setRuns] = useState([]);
  const [active, setActive] = useState(null); // full run { result }

  async function loadRuns() {
    try { const r = await api.get(`/social/clients/${clientId}/subreddit-research`); setRuns(r.runs || []); } catch { /* ignore */ }
  }
  async function loadRows() {
    setLoadingRows(true);
    try { const r = await api.get(`/social/clients/${clientId}/subreddits`); setRows(r.subreddits || []); }
    catch (e) { toast(e.message, 'error'); }
    finally { setLoadingRows(false); }
  }
  useEffect(() => { loadRuns(); loadRows(); /* eslint-disable-line */ }, [clientId]);

  // Reading the stored list costs nothing; `force` is the one press that pays
  // for a second opinion, so it says so and asks first.
  async function suggest({ force = false } = {}) {
    if (force && !window.confirm('Ask Claude for more subreddits? This is a new call on top of the ones already stored.')) return;
    setSuggesting(true);
    try {
      const r = await api.post(`/social/clients/${clientId}/subreddits/suggest${force ? '?force=1' : ''}`, {});
      setRows(r.subreddits || []);
      if (r.from === 'stored') toast('These are the ones already stored.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setSuggesting(false); }
  }

  async function addRow() {
    const name = adding.trim();
    if (!name) return;
    try {
      await api.post(`/social/clients/${clientId}/subreddits`, { name });
      setAdding('');
      loadRows();
    } catch (e) { toast(e.message, 'error'); }
  }

  // Saved on change rather than behind a Save button: there is one field and
  // one select per row, and a row of unsaved edits across eight rows is how
  // research gets run against the wrong window.
  async function patchRow(row, patch) {
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, ...patch } : r));
    try { await api.patch(`/social/clients/${clientId}/subreddits/${row.id}`, patch); }
    catch (e) { toast(e.message, 'error'); loadRows(); }
  }

  async function removeRow(row) {
    if (!window.confirm(`Remove r/${row.name} from the list?`)) return;
    setRows(prev => prev.filter(r => r.id !== row.id));
    try { await api.delete(`/social/clients/${clientId}/subreddits/${row.id}`); }
    catch (e) { toast(e.message, 'error'); loadRows(); }
  }

  // Research a stored row, on its own focus and window.
  async function researchRow(row) {
    setRunningId(row.id);
    try {
      const { run: r } = await api.post(`/social/clients/${clientId}/subreddit-research`,
        { subreddit: row.name, focus: row.focus || null, time: row.time_window });
      setActive(r); loadRuns(); loadRows();
      toast('Research complete.', 'success');
    } catch (e) { toast(`Research failed: ${e.message}`, 'error'); }
    finally { setRunningId(null); }
  }

  async function run() {
    if (!subreddit.trim()) { toast('Enter a subreddit first.', 'error'); return; }
    setRunning(true);
    try {
      const { run: r } = await api.post(`/social/clients/${clientId}/subreddit-research`, { subreddit: subreddit.trim(), focus: focus.trim() || null, time });
      setActive(r); loadRuns(); loadRows();
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
        <p className="body-sm text-muted" style={{ maxWidth: 680, marginTop: 'var(--s1)' }}>
          Point it at the subreddit where this client's buyers actually gather. It reads the top posts, finds the biggest
          repeated pain point with real evidence, and turns it into blog topics, reel hooks, and a reel script with a
          comment-keyword CTA — which drops straight into the DM bot's comment-to-DM.
        </p>
      </div>

      {/* The subreddits, first. Where the buyers are is the thing you need
          before anything else on this screen does any work. */}
      <div>
        <div className="row between center wrap mb-3" style={{ gap: 'var(--s2)' }}>
          <div className="caption">Where this client&apos;s buyers gather</div>
          {!!rows.length && (
            <button className="btn btn-secondary btn-sm"
              {...roWrite(readOnly, { onClick: () => suggest({ force: true }), disabled: suggesting })}>
              {suggesting ? 'Thinking…' : 'Suggest more'}
            </button>
          )}
        </div>

        {loadingRows ? (
          <div className="body-sm text-subtle">Loading…</div>
        ) : !rows.length ? (
          <div className="card">
            <p className="body-sm" style={{ maxWidth: 620 }}>
              Nothing stored yet. Claude can name the subreddits where this client&apos;s
              <strong> customers</strong> gather rather than its competitors, from the brief
              and the monthly focus. They are saved, so looking at them again costs nothing.
            </p>
            <button className="btn btn-primary mt-3"
              {...roWrite(readOnly, { onClick: () => suggest(), disabled: suggesting })}>
              {suggesting ? 'Thinking…' : 'Suggest subreddits'}
            </button>
          </div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th className="caption">Subreddit</th>
                  <th className="caption">Focus</th>
                  <th className="caption" style={{ width: 130 }}>Window</th>
                  <th className="caption" style={{ width: 200 }}>Research</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--card-border)' }}>
                    <td style={{ padding: 'var(--s2) var(--s3)', fontSize: 'var(--fs-body)' }}>
                      <strong>r/{r.name}</strong>
                      {r.why && <div className="body-xs text-subtle" style={{ marginTop: 'var(--s1)', maxWidth: 320 }}>{r.why}</div>}
                    </td>
                    <td style={{ padding: 'var(--s2) var(--s3)' }}>
                      <input className="input" value={r.focus || ''} placeholder="e.g. getting clients, pricing"
                        disabled={readOnly}
                        onFocus={() => { focusAtFocus.current = r.focus || ''; }}
                        onChange={e => setRows(prev => prev.map(x => x.id === r.id ? { ...x, focus: e.target.value } : x))}
                        onBlur={e => { if ((e.target.value || '') !== focusAtFocus.current) patchRow(r, { focus: e.target.value }); }} />
                    </td>
                    <td style={{ padding: 'var(--s2) var(--s3)' }}>
                      <select className="input" value={r.time_window}
                        onChange={e => patchRow(r, { time_window: e.target.value })}>
                        <option value="week">Past week</option>
                        <option value="month">Past month</option>
                        <option value="year">Past year</option>
                        <option value="all">All time</option>
                      </select>
                    </td>
                    <td style={{ padding: 'var(--s2) var(--s3)' }}>
                      <div className="row center" style={{ gap: 'var(--s2)' }}>
                        <button className="btn btn-secondary btn-sm"
                          {...roWrite(readOnly, { onClick: () => researchRow(r), disabled: !!runningId })}>
                          {runningId === r.id ? 'Researching…' : 'Research'}
                        </button>
                        <button className="btn-icon btn-icon-sm danger" title="Remove"
                          {...roWrite(readOnly, { onClick: () => removeRow(r) })}>✕</button>
                      </div>
                      {r.researched_at && (
                        <div className="body-xs text-subtle" style={{ marginTop: 'var(--s1)' }}>
                          last run {new Date(r.researched_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row center wrap" style={{ gap: 'var(--s2)', padding: 'var(--s3)' }}>
              <input className="input" style={{ maxWidth: 220 }} value={adding} placeholder="Add one yourself"
                onChange={e => setAdding(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addRow(); }} />
              <button className="btn btn-secondary btn-sm" {...roWrite(readOnly, { onClick: addRow, disabled: !adding.trim() })}>Add</button>
            </div>
          </div>
        )}
      </div>

      {/* A one-off, for a subreddit you do not want on the list. */}
      <details>
        <summary className="body-sm" style={{ cursor: 'pointer' }}>Research a subreddit without adding it</summary>
        <div className="card stack mt-3" style={{ gap: 'var(--s3)' }}>
          <div className="row" style={{ gap: 'var(--s3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
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
            <button className="btn btn-secondary" {...roWrite(readOnly, { onClick: run, disabled: running })}>{running ? 'Researching…' : 'Research'}</button>
          </div>
          {running && <div className="body-xs text-subtle">Scraping Reddit and analysing — this can take a minute or two.</div>}
        </div>
      </details>

      {/* Result */}
      {res && (
        <div className="stack stack-lg">
          <div className="card accent">
            <div className="caption">Biggest pain point · r/{res.subreddit}</div>
            <div className="h3 mt-2">{res.top_pain || '—'}</div>
            {res.analysis_note && <div className="body-xs text-subtle" style={{ marginTop: 'var(--s2)' }}>{res.analysis_note}</div>}
          </div>

          {res.pain_points?.length > 0 && (
            <div>
              <div className="caption mb-2">Pain points — with evidence from the threads</div>
              <div className="stack stack-sm">
                {res.pain_points.map((p, i) => (
                  <div key={i} className="card" style={{ padding: 'var(--s3) var(--s4)' }}>
                    <div className="row between center"><span className="body-sm" style={{ fontWeight: 700 }}>{p.pain}</span>
                      <span className="chip chip-neutral">{p.severity}</span></div>
                    {p.evidence?.length > 0 && (
                      <ul style={{ margin: 'var(--s2) 0 0', paddingLeft: 'var(--s5)' }}>
                        {p.evidence.map((e, j) => <li key={j} className="body-xs text-muted" style={{ marginBottom: 'var(--s1)' }}>{e}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-2" style={{ gap: 'var(--s4)' }}>
            {res.blog_topics?.length > 0 && (
              <div>
                <div className="caption mb-2">Blog topics</div>
                <div className="stack stack-sm">
                  {res.blog_topics.map((b, i) => (
                    <div key={i} className="card" style={{ padding: 'var(--s2) var(--s3)' }}>
                      <div className="row between center" style={{ gap: 'var(--s2)' }}>
                        <span className="body-sm" style={{ fontWeight: 600 }}>{b.title}</span>
                        {onUseAsBrief && <button className="btn btn-secondary btn-sm" onClick={() => onUseAsBrief(`Blog post: ${b.title}${b.angle ? `\nAngle: ${b.angle}` : ''}`)}>Use as brief</button>}
                      </div>
                      {b.angle && <div className="body-xs text-subtle" style={{ marginTop: 'var(--s1)' }}>{b.angle}</div>}
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
                    <div key={i} className="card" style={{ padding: 'var(--s2) var(--s3)' }}>
                      <div className="row between center" style={{ gap: 'var(--s2)' }}>
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
              <div className="stack stack-sm" style={{ marginTop: 'var(--s2)' }}>
                <div><span className="field-label">Hook</span><div className="body-sm">{res.reel_script.hook}</div></div>
                <div><span className="field-label">Body</span><div className="body-sm" style={{ whiteSpace: 'pre-wrap' }}>{res.reel_script.body}</div></div>
                <div><span className="field-label">CTA</span><div className="body-sm">{res.reel_script.cta}</div></div>
                {res.reel_script.caption && <div><span className="field-label">Caption</span><div className="body-sm" style={{ whiteSpace: 'pre-wrap' }}>{res.reel_script.caption}</div></div>}
              </div>
              {res.reel_script.keyword && (
                <div className="callout" style={{ marginTop: 'var(--s3)', background: 'var(--accent-soft)', padding: 'var(--s3)', borderRadius: 'var(--r-sm)' }}>
                  <div className="body-sm">Comment keyword: <strong style={{ fontSize: 'var(--fs-title)', letterSpacing: 1 }}>{res.reel_script.keyword}</strong></div>
                  <div className="body-xs text-subtle" style={{ marginTop: 'var(--s1)' }}>Set this as a comment trigger keyword under <strong>Engage → DM bot → Live auto-send</strong>, and anyone who comments it gets the lead magnet auto-DM'd.</div>
                </div>
              )}
            </div>
          )}

          {res.lead_magnet && (
            <div className="card">
              <div className="caption">Lead magnet — {res.lead_magnet.format}</div>
              <div className="h3 mt-2">{res.lead_magnet.title}</div>
              {res.lead_magnet.outline?.length > 0 && (
                <ol style={{ margin: 'var(--s2) 0 0', paddingLeft: 'var(--s5)' }}>
                  {res.lead_magnet.outline.map((o, i) => <li key={i} className="body-sm" style={{ marginBottom: 'var(--s1)' }}>{o}</li>)}
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
              <div key={r.id} className="card" style={{ padding: 'var(--s2) var(--s3)' }}>
                <div className="row between center" style={{ gap: 'var(--s2)' }}>
                  <button className="row-trigger body-sm" style={{ fontWeight: 600 }} onClick={() => open(r.id)}>
                    r/{r.subreddit}{r.focus ? ` · ${r.focus}` : ''}
                  </button>
                  <div className="row center" style={{ gap: 'var(--s2)' }}>
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
