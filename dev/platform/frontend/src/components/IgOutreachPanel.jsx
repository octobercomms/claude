// Social → Discover. A compliant Instagram outreach cockpit. A client keeps
// several named SEARCHES (e.g. "Residential architects · Atlanta", "Commercial
// architects"), each with its own daily autopilot. A discovery engine finds
// public IG profiles via web search; the AM works each search's queue BY HAND —
// Open-DM deep link + AI-personalised copy-paste draft. Optional email
// enrichment + CSV export feed considered (not bulk) mailing-list outreach.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const STATUS = {
  new:      { label: 'New',      cls: 'chip-neutral' },
  queued:   { label: 'Queued',   cls: 'chip-outline' },
  messaged: { label: 'Messaged', cls: 'chip-accent' },
  replied:  { label: 'Replied',  cls: 'chip-success' },
  skipped:  { label: 'Skipped',  cls: 'chip-neutral' },
};

function exportCsv(prospects, searchName) {
  const cols = ['username', 'display_name', 'email', 'status', 'profile_url', 'bio', 'found_at', 'messaged_at', 'replied_at'];
  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [cols.join(',')];
  for (const p of prospects) {
    lines.push([p.username, p.display_name, p.email, p.status, p.profile_url || `https://instagram.com/${p.username}/`, (p.bio || '').replace(/\s+/g, ' '), p.found_at, p.messaged_at, p.replied_at].map(esc).join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ig-prospects-${String(searchName || 'export').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function IgOutreachPanel({ clientId }) {
  const toast = useToast();
  const [searches, setSearches] = useState([]);
  const [unassigned, setUnassigned] = useState(0);
  const [selected, setSelected] = useState(null);
  const [prospects, setProspects] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(null);
  const [draftingAll, setDraftingAll] = useState(false);
  const [enriching, setEnriching] = useState(null);
  const [expanded, setExpanded] = useState({}); // ids the AM manually re-opened after collapse
  const [queueTab, setQueueTab] = useState('todo'); // 'todo' = still to work · 'done' = messaged/replied/skipped
  // New-search form
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [icp, setIcp] = useState('');
  const [location, setLocation] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [goal, setGoal] = useState('');

  async function loadSearches(selId) {
    const r = await api.get(`/ig-outreach/clients/${clientId}/searches`);
    const list = r.searches || [];
    setSearches(list);
    setUnassigned(r.unassigned || 0);
    const sel = selId || (list.find(s => s.id === selected)?.id) || list[0]?.id || null;
    setSelected(sel);
    if (sel) await loadProspects(sel); else setProspects([]);
  }
  async function loadProspects(searchId) {
    const r = await api.get(`/ig-outreach/clients/${clientId}/prospects?searchId=${searchId}`);
    setProspects(r.prospects || []);
  }
  useEffect(() => {
    (async () => { try { await loadSearches(); } catch (e) { toast(e.message, 'error'); } finally { setLoaded(true); } })();
    /* eslint-disable-line */
  }, [clientId]);

  async function selectSearch(id) { setSelected(id); try { await loadProspects(id); } catch (e) { toast(e.message, 'error'); } }

  async function createAndRun() {
    if (!icp.trim() && !hashtags.trim()) { toast('Enter roles (e.g. "architects, interior designers") or hashtags.', 'error'); return; }
    setBusy(true);
    try {
      const s = await api.post(`/ig-outreach/clients/${clientId}/searches`, { name: name.trim(), icp: icp.trim(), location: location.trim(), hashtags, outreach_goal: goal.trim() });
      const r = await api.post(`/ig-outreach/clients/${clientId}/searches/${s.id}/run`, {});
      setName(''); setIcp(''); setLocation(''); setHashtags(''); setGoal(''); setAdding(false);
      await loadSearches(s.id);
      toast(`Search created — found ${r.added} new.`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }

  async function editGoal(s) {
    const next = window.prompt('What are you DMing these people about? (used to draft messages)', s.outreach_goal || '');
    if (next == null) return;
    try { await api.patch(`/ig-outreach/clients/${clientId}/searches/${s.id}`, { outreach_goal: next.trim() }); await loadSearches(s.id); toast('Outreach goal saved — redraft to use it.', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function draftAll(searchId) {
    setDraftingAll(true);
    try { const r = await api.post(`/ig-outreach/clients/${clientId}/searches/${searchId}/draft-all`, {}); setProspects(r.prospects || []); toast(`Drafted ${r.drafted} message${r.drafted === 1 ? '' : 's'}.`, 'success'); }
    catch (e) { toast(e.message, 'error'); }
    finally { setDraftingAll(false); }
  }

  async function runSearch(id) {
    setBusy(true);
    try {
      const r = await api.post(`/ig-outreach/clients/${clientId}/searches/${id}/run`, {});
      await loadSearches(id);
      toast(r.added ? `Found ${r.added} new.` : 'No new profiles this run.', r.added ? 'success' : 'info');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  }
  async function toggleAutopilot(s) {
    try { await api.patch(`/ig-outreach/clients/${clientId}/searches/${s.id}`, { enabled: !s.enabled }); await loadSearches(s.id); toast(!s.enabled ? 'Daily autopilot on — new finds emailed each morning.' : 'Autopilot off.', 'info'); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function removeSearch(s) {
    if (!window.confirm(`Delete the "${s.name}" search? Its profiles become unassigned — you can reclaim them into another search afterwards.`)) return;
    try { await api.delete(`/ig-outreach/clients/${clientId}/searches/${s.id}`); setSelected(null); await loadSearches(); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function reclaim(searchId) {
    try { const r = await api.post(`/ig-outreach/clients/${clientId}/searches/${searchId}/reclaim`, {}); await loadSearches(searchId); toast(`Reclaimed ${r.reclaimed} earlier prospect${r.reclaimed === 1 ? '' : 's'}.`, 'success'); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function setStatus(id, status) {
    // Messaged / replied / skipped collapse the card, so drop any manual
    // re-open for this prospect; re-activating (new) re-opens it.
    setExpanded(prev => { const next = { ...prev }; if (['messaged', 'replied', 'skipped'].includes(status)) delete next[id]; else next[id] = true; return next; });
    try { const r = await api.patch(`/ig-outreach/clients/${clientId}/prospects/${id}`, { status }); setProspects(prev => prev.map(p => p.id === id ? r : p)); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function draft(id) {
    setDrafting(id);
    try { const r = await api.post(`/ig-outreach/clients/${clientId}/prospects/${id}/draft`, {}); setProspects(prev => prev.map(p => p.id === id ? r : p)); }
    catch (e) { toast(e.message, 'error'); }
    finally { setDrafting(null); }
  }
  async function enrich(id) {
    setEnriching(id);
    try { const r = await api.post(`/ig-outreach/clients/${clientId}/prospects/${id}/enrich`, {}); setProspects(prev => prev.map(p => p.id === id ? r : p)); toast('Email found.', 'success'); }
    catch (e) { toast(e.message, 'info'); }
    finally { setEnriching(null); }
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied — paste it in the DM.', 'success'); }
    catch { toast('Copy failed — select and copy manually.', 'error'); }
  }

  if (!loaded) return <div className="text-subtle" style={{ padding: 20 }}>Loading…</div>;
  const sel = searches.find(s => s.id === selected);
  const counts = prospects.reduce((a, p) => { a[p.status] = (a[p.status] || 0) + 1; return a; }, {});

  return (
    <div>
      <div className="callout" style={{ marginBottom: 'var(--s5)' }}>
        <strong>Discovery, not automation.</strong> This finds public profiles to approach — <em>you</em> send the DMs by hand. Keep it to a few personalised messages a day. Emails are for considered outreach with a clear opt-out, not bulk lists.
      </div>

      {/* Saved searches */}
      <div className="section-head">
        <div className="caption">Saved searches</div>
        {!adding && <button className="btn btn-secondary btn-sm" onClick={() => setAdding(true)}>+ New search</button>}
      </div>

      {adding && (
        <div className="card" style={{ marginBottom: 'var(--s4)' }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: '1 1 150px' }} placeholder="Name (optional)" value={name} onChange={e => setName(e.target.value)} />
            <input className="input" style={{ flex: '2 1 240px' }} placeholder="Roles, e.g. architects, interior designers" value={icp} onChange={e => setIcp(e.target.value)} />
            <input className="input" style={{ flex: '1 1 130px' }} placeholder="Location, e.g. Atlanta" value={location} onChange={e => setLocation(e.target.value)} />
            <input className="input" style={{ flex: '1 1 130px' }} placeholder="Hashtags (optional)" value={hashtags} onChange={e => setHashtags(e.target.value)} />
            <button className="btn btn-primary" onClick={createAndRun} disabled={busy}>{busy ? 'Searching…' : 'Create & run'}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Cancel</button>
          </div>
          <input className="input" style={{ marginTop: 8 }} placeholder="What are you DMing them about? e.g. inviting them to exhibit at Atlanta Design Festival (Sept 26–Oct 4)"
            value={goal} onChange={e => setGoal(e.target.value)} />
          <div className="body-xs text-subtle" style={{ marginTop: 8 }}>Several roles at once is fine. The outreach goal drives the drafted messages — and drafts won't invent specifics they can't see.</div>
        </div>
      )}

      {!searches.length && !adding ? (
        <p className="body-sm text-subtle" style={{ marginBottom: 'var(--s5)' }}>No searches yet — create one to start finding prospects.</p>
      ) : (
        <div className="stack stack-sm" style={{ marginBottom: 'var(--s6)' }}>
          {searches.map(s => (
            <div key={s.id} className="card" style={{ padding: '10px 14px', borderColor: s.id === selected ? 'var(--text)' : 'var(--card-border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <button onClick={() => selectSearch(s.id)} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                <div className="body-sm" style={{ fontWeight: 700 }}>{s.name}</div>
                <div className="body-xs text-subtle">{[s.icp, s.location].filter(Boolean).join(' · ')} · {s.prospect_count} found{s.last_run_at ? ` · last run ${new Date(s.last_run_at).toLocaleDateString('en-GB')}` : ''}</div>
              </button>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} title="Daily autopilot">
                <input type="checkbox" checked={!!s.enabled} onChange={() => toggleAutopilot(s)} style={{ accentColor: 'var(--accent)' }} />
                <span className="body-xs">Autopilot</span>
              </label>
              <button className="btn btn-secondary btn-sm" onClick={() => runSearch(s.id)} disabled={busy}>Run</button>
              <button className="btn btn-ghost btn-sm" onClick={() => removeSearch(s)} title="Delete search">✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Queue for the selected search */}
      {sel && (
        <>
          <div className="section-head">
            <div className="caption">{sel.name} — queue</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="body-xs text-subtle" style={{ marginRight: 4 }}>{prospects.length} · {counts.new || 0} new · {counts.messaged || 0} messaged · {counts.replied || 0} replied</span>
              <button className="btn btn-secondary btn-sm" onClick={() => draftAll(sel.id)} disabled={draftingAll || !prospects.length}>{draftingAll ? 'Drafting…' : '✦ Draft all'}</button>
              <button className="btn btn-secondary btn-sm" onClick={() => exportCsv(prospects, sel.name)} disabled={!prospects.length}>Export CSV</button>
            </div>
          </div>
          <div className="body-xs" style={{ marginBottom: 'var(--s4)', color: sel.outreach_goal ? 'var(--text-muted)' : 'var(--text-subtle)' }}>
            <strong>Outreach goal:</strong> {sel.outreach_goal || 'not set — drafts will be a generic intro.'}{' '}
            <button onClick={() => editGoal(sel)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontWeight: 700, padding: 0 }}>{sel.outreach_goal ? 'edit' : 'set goal'}</button>
          </div>

          {unassigned > 0 && (
            <div className="callout callout-warning" style={{ marginBottom: 'var(--s4)' }}>
              {unassigned} earlier prospect{unassigned === 1 ? '' : 's'} {unassigned === 1 ? "isn't" : "aren't"} attached to any search (from before saved searches, or a deleted one).{' '}
              <button onClick={() => reclaim(sel.id)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontWeight: 700, padding: 0 }}>Add {unassigned === 1 ? 'it' : 'them'} to “{sel.name}”</button>
            </div>
          )}

          {(() => {
            // Split the queue into "To work" (still to contact) and "Done"
            // (messaged / replied / skipped) tabs, so finished prospects live in
            // their own place instead of cluttering — or hiding at the bottom of
            // — the active list. Nothing is ever removed; it just moves tab.
            const DONE = ['messaged', 'replied', 'skipped'];
            const todoList = prospects.filter(p => !DONE.includes(p.status));
            const doneList = prospects.filter(p => DONE.includes(p.status));
            const list = queueTab === 'done' ? doneList : todoList;
            return (
              <>
                <div style={{ display: 'flex', gap: 6, marginBottom: 'var(--s4)' }}>
                  {[['todo', 'To work', todoList.length], ['done', 'Done', doneList.length]].map(([key, label, n]) => (
                    <button key={key} type="button" onClick={() => setQueueTab(key)}
                      className={`btn btn-sm ${queueTab === key ? 'btn-primary' : 'btn-secondary'}`}>
                      {label} ({n})
                    </button>
                  ))}
                </div>

                {!list.length ? (
                  <p className="body-sm text-subtle">
                    {queueTab === 'done'
                      ? 'Nothing worked yet — messaged, replied and skipped prospects collect here.'
                      : (prospects.length ? 'All caught up — every prospect has been worked. 🎉 See the Done tab.' : 'No prospects yet — hit Run on this search.')}
                  </p>
                ) : (
                  <div className="stack stack-sm">
                    {list.map(p => {
                      const st = STATUS[p.status] || STATUS.new;
                      const done = p.status === 'messaged' || p.status === 'replied';
                      const isSkipped = p.status === 'skipped';
                      // In the Done tab rows start collapsed to a slim green/grey
                      // line; click to re-open (copy / redraft / restore).
                      const collapsed = queueTab === 'done' && !expanded[p.id];

                      if (collapsed) {
                        return (
                          <div
                            key={p.id}
                            onClick={() => setExpanded(prev => ({ ...prev, [p.id]: true }))}
                            title="Click to re-open"
                            style={{
                              display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                              padding: '8px 14px', borderRadius: 'var(--r-sm)',
                              border: `1px solid ${done ? 'var(--positive)' : 'var(--card-border)'}`,
                              borderLeft: `4px solid ${done ? 'var(--positive)' : 'var(--card-border)'}`,
                              background: done ? 'var(--positive-soft)' : 'var(--surface-raised)',
                              opacity: isSkipped ? 0.6 : 1,
                            }}
                          >
                            <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>@{p.username}</span>
                            {p.display_name && p.display_name !== p.username && <span className="text-subtle" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {p.display_name}</span>}
                            <span className={`chip ${st.cls}`} style={{ fontSize: 10, flex: '0 0 auto', marginLeft: 'auto' }}>{done ? '✓ ' : ''}{st.label}</span>
                            <span className="body-xs text-subtle" style={{ flex: '0 0 auto' }}>▸</span>
                          </div>
                        );
                      }
                      return (
                        <div key={p.id} className="card" style={{ padding: 'var(--s4)', opacity: isSkipped ? 0.55 : 1, borderLeft: done ? '4px solid var(--positive)' : undefined, background: done ? 'var(--positive-soft)' : undefined }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
                            <div style={{ minWidth: 0 }}>
                              <a href={p.profile_url || `https://www.instagram.com/${p.username}/`} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>@{p.username}</a>
                              {p.display_name && p.display_name !== p.username && <span className="text-subtle"> · {p.display_name}</span>}
                              {p.email && <span className="chip chip-success" style={{ fontSize: 10, marginLeft: 8 }}>✉ {p.email}</span>}
                              {p.bio && <div className="body-xs text-subtle" style={{ marginTop: 2 }}>{p.bio}</div>}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
                              <span className={`chip ${st.cls}`} style={{ fontSize: 10 }}>{st.label}</span>
                              {queueTab === 'done' && <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(prev => { const n = { ...prev }; delete n[p.id]; return n; })} title="Collapse">▴</button>}
                            </div>
                          </div>

                          {p.draft && (
                            <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--surface-sunken)', borderRadius: 'var(--r-sm)' }}>
                              <div className="body-sm">{p.draft}</div>
                              <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => copy(p.draft)}>Copy message</button>
                            </div>
                          )}

                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                            <a href={`https://ig.me/m/${p.username}`} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">Open DM ↗</a>
                            <button className="btn btn-secondary btn-sm" onClick={() => draft(p.id)} disabled={drafting === p.id}>{drafting === p.id ? 'Drafting…' : (p.draft ? '↻ Redraft' : '✦ Draft message')}</button>
                            {!p.email && <button className="btn btn-secondary btn-sm" onClick={() => enrich(p.id)} disabled={enriching === p.id}>{enriching === p.id ? 'Finding…' : 'Find email'}</button>}
                            {p.status !== 'messaged' && p.status !== 'replied' && <button className="btn btn-secondary btn-sm" onClick={() => setStatus(p.id, 'messaged')}>Mark messaged</button>}
                            {p.status === 'messaged' && <button className="btn btn-secondary btn-sm" onClick={() => setStatus(p.id, 'replied')}>Mark replied</button>}
                            {p.status === 'skipped' ? (
                              <button className="btn btn-ghost btn-sm" onClick={() => setStatus(p.id, 'new')}>↩ Restore to queue</button>
                            ) : (
                              <button className="btn btn-ghost btn-sm" onClick={() => setStatus(p.id, 'skipped')}>Skip</button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}
