import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { usePrompt } from '../context/PromptContext';
import { roWrite } from '../utils/readOnly';
import { downloadCsv, csvSlug } from '../utils/csv';

// Earned → Match: who do I send this story to.
//
// This replaces two cards that asked the same question with two boxes to
// paste the same release into. Daniel: "this is kinda the same thing right?
// ... can it provide a combined list though?" Two engines still run — one
// reads the release with Claude and writes a reason, the other ranks the
// whole contact database by what journalists actually publish and is the only
// one holding the addresses — and /pitch-match merges them into one list.
//
// Three ways in, because the story arrives three ways: pick a release already
// in OMI, paste a URL, or type the gist. The picker fills the box rather than
// replacing it, so the wording stays editable.
//
// The list ends in an action. A ranked table you cannot act on is a lookup
// tool: Export takes it out of the building, Add to an audience takes it into
// a pitch, and both work on the selection, because you will not pitch all of
// them.

const COLUMNS = [
  ['Name', r => r.name],
  ['Email', r => r.email],
  ['Email state', r => emailState(r).label],
  ['Outlet', r => r.outlet],
  ['Tier', r => (r.tier ? `T${r.tier}` : '')],
  ['Fit', r => (r.fit == null ? '' : `${r.fit}%`)],
  ['Matched topics', r => (r.matched || []).join('; ')],
  ['Covers', r => (r.topics || []).join('; ')],
  ['Covered before', r => (r.covered_client ? 'yes' : '')],
  ['Why', r => r.reason],
];

// One grammar for the address, reused in the table and the export. A contact
// we hold no usable address for is in the list on purpose: the free matcher
// cannot return them at all, so leaving them out would hide them entirely,
// and at a title that matters the answer is to go and find an address.
function emailState(r) {
  if (!r.has_email) return { key: 'missing', label: 'no email', tone: 'var(--text-subtle)' };
  if (r.verification_status === 'guessed') return { key: 'guessed', label: 'guess', tone: 'var(--negative)' };
  return { key: 'ok', label: '', tone: 'var(--text-subtle)' };
}

export default function MatchPanel({ clientId, clientName, releases = [], readOnly, onOpenJournalist }) {
  const toast = useToast();
  // Not window.prompt: in some embedded views it shows nothing and returns
  // null, so the save silently does not happen and the button reads as broken.
  // tests/no-window-prompt.test.js holds the line and caught this one.
  const ask = usePrompt();

  const [releaseId, setReleaseId] = useState('');
  const [url, setUrl] = useState('');
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(() => new Set());

  // Media lists: the journalists picked for one story, kept. Named away from
  // the saved searches in Monitor, which are a standing web search on a
  // schedule — one section cannot have two meanings for one phrase.
  const [lists, setLists] = useState([]);
  const [openList, setOpenList] = useState(null);      // { id, name, memberIds:Set }
  const [showLists, setShowLists] = useState(false);

  // Add to an audience, which belongs to a release.
  const [addTo, setAddTo] = useState(null);            // { releaseId, segments, segId }

  // Journalists who are NOT in the contact book. Kept apart from the ranked
  // list on purpose: they have no verified address, no relationship history
  // and no tier, so they are candidates rather than contacts and must not be
  // selectable into an audience. They are queued for review on the way back.
  const [webBusy, setWebBusy] = useState(false);
  const [web, setWeb] = useState(null);

  const loadLists = useCallback(async () => {
    try { setLists((await api.get(`/pr/clients/${clientId}/media-lists`)).items || []); }
    catch { /* the panel still works without them */ }
  }, [clientId]);
  useEffect(() => { loadLists(); }, [loadLists]);

  const items = result?.items || [];
  const canRun = !!(url.trim() || brief.trim());

  // What is new since this list was last saved. Only meaningful with a list
  // open — otherwise every row is "new" and the chip means nothing.
  const isNew = useCallback(
    (id) => !!openList && !openList.memberIds.has(id),
    [openList]
  );
  const newCount = useMemo(
    () => (openList ? items.filter(i => isNew(i.id)).length : 0),
    [openList, items, isNew]
  );

  async function pickRelease(id) {
    setReleaseId(id);
    if (!id) return;
    try {
      const r = await api.get(`/pr/press-releases/${id}`);
      // Into the box, not past it: the wording is the thing being matched on
      // and an operator will want to tighten it.
      const text = `${r.title || ''}\n\n${String(r.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`.trim();
      setBrief(text.slice(0, 20000));
      setUrl('');
    } catch (e) { toast(`Could not load that release: ${e.message}`, 'error'); }
  }

  async function run() {
    if (!canRun) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post(`/pr/clients/${clientId}/pitch-match`, {
        url: url.trim() || undefined,
        brief: brief.trim() || undefined,
      });
      setResult(r);
      setSelected(new Set());
      if (openList) {
        await api.post(`/pr/media-lists/${openList.id}/ran`, { mode: r.mode }).catch(() => {});
      }
    } catch (e) {
      // Inline and persistent. A fetch failure you have to act on must not be
      // a toast that disappears while you are reading it.
      setError(e.message);
      setResult(null);
    } finally { setBusy(false); }
  }

  async function searchWeb() {
    const story = brief.trim() || url.trim();
    if (!story) return;
    setWebBusy(true);
    try {
      const r = await api.post(`/pr/clients/${clientId}/scout-story`, { story });
      setWeb(r);
      if (r.budget_stopped) toast('This month\'s media research budget is spent.', 'info');
      else if (!r.added) toast(r.found ? 'Everyone it found is already on your list.' : 'Nothing new found on the web.', 'info');
    } catch (e) {
      toast(`Web search failed: ${e.message}`, 'error');
    } finally { setWebBusy(false); }
  }

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const allSelected = items.length > 0 && items.every(i => selected.has(i.id));
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map(i => i.id)));
  }
  function selectAgreed() {
    // Where agreement is genuinely useful: a visible suggestion you can
    // override, rather than a hidden term in the ranking.
    const picks = items.filter(i => i.agreed).map(i => i.id);
    setSelected(new Set(picks.length ? picks : items.slice(0, 10).map(i => i.id)));
  }

  const chosen = items.filter(i => selected.has(i.id));
  const exportRows = chosen.length ? chosen : items;

  function exportCsv() {
    const n = downloadCsv(
      `${csvSlug('match', clientName, result?.angle || '')}.csv`,
      COLUMNS,
      exportRows
    );
    toast(`Exported ${n} contact${n === 1 ? '' : 's'}`, 'success');
  }

  async function saveList() {
    const name = await ask({
      title: 'Name this media list',
      detail: `${exportRows.length} contact${exportRows.length === 1 ? '' : 's'}, with the story they were ranked against.`,
      label: 'Name',
      defaultValue: (brief.split('\n')[0] || '').slice(0, 80),
      confirmLabel: 'Save list',
    });
    if (name == null) return;
    try {
      const saved = await api.post(`/pr/clients/${clientId}/media-lists`, {
        name, release_id: releaseId || null, source_url: url.trim(), source_text: brief.trim(),
        mode: result?.mode || null,
        members: exportRows.map(r => ({ contact_id: r.id, fit: r.fit, reason: r.reason })),
      });
      toast(`Saved "${saved.name}" with ${exportRows.length} contacts`, 'success');
      setOpenList({ id: saved.id, name: saved.name, memberIds: new Set(exportRows.map(r => r.id)) });
      loadLists();
    } catch (e) { toast(`Could not save: ${e.message}`, 'error'); }
  }

  async function loadList(id) {
    try {
      const l = await api.get(`/pr/media-lists/${id}`);
      setReleaseId(l.release_id || '');
      setUrl(l.source_url || '');
      setBrief(l.source_text || '');
      setOpenList({ id: l.id, name: l.name, memberIds: new Set((l.members || []).map(m => m.contact_id)) });
      setResult(null);
      setSelected(new Set());
      setShowLists(false);
      toast(`Opened "${l.name}" — run it again to see what has changed`, 'info');
    } catch (e) { toast(`Could not open that list: ${e.message}`, 'error'); }
  }

  async function startAdd() {
    const rid = releaseId || (releases[0] && releases[0].id);
    if (!rid) { toast('No press release to attach an audience to yet.', 'info'); return; }
    try {
      const r = await api.get(`/press/releases/${rid}/segments`);
      setAddTo({ releaseId: rid, segments: r.segments || r.items || [], segId: '' });
    } catch (e) { toast(`Could not load audiences: ${e.message}`, 'error'); }
  }

  async function confirmAdd() {
    if (!addTo?.segId) return;
    const mailable = chosen.filter(c => c.has_email);
    try {
      const r = await api.post(`/press/segments/${addTo.segId}/members`, {
        contact_ids: mailable.map(c => c.id),
      });
      const conflicts = (r.conflicts || []).length;
      toast(
        `Added ${r.added ?? mailable.length} to the audience`
        + (conflicts ? `. ${conflicts} are already in another audience on this release.` : ''),
        'success'
      );
      setAddTo(null);
    } catch (e) { toast(`Could not add: ${e.message}`, 'error'); }
  }

  const unmailable = chosen.filter(c => !c.has_email).length;

  return (
    <div>
      {/* ── the story ─────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 'var(--s4)' }}>
        <div className="row center" style={{ justifyContent: 'space-between', marginBottom: 'var(--s2)' }}>
          <h3 className="h3" style={{ margin: 0 }}>Who should I pitch this to?</h3>
          <div className="row center" style={{ gap: 'var(--s2)' }}>
            {openList && <span className="chip">{openList.name}</span>}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowLists(v => !v)}>
              Media lists{lists.length ? ` (${lists.length})` : ''}
            </button>
          </div>
        </div>
        <p className="body-sm text-muted" style={{ marginTop: 0, marginBottom: 'var(--s3)' }}>
          Ranks every media contact you can see by what they actually write about, and how they have
          covered {clientName || 'this client'} before. Claude reads the story as well and says why each
          one fits.
        </p>

        {showLists && (
          <div className="card" style={{ marginBottom: 'var(--s3)', background: 'var(--surface-sunken)' }}>
            {lists.length === 0 ? (
              <p className="body-sm text-muted" style={{ margin: 0 }}>No saved lists yet. Run a search and save it.</p>
            ) : lists.map(l => (
              <div key={l.id} className="row center" style={{ justifyContent: 'space-between', padding: 'var(--s1) 0' }}>
                <button type="button" className="row-trigger" onClick={() => loadList(l.id)}>{l.name}</button>
                <span className="body-xs text-muted">
                  {l.member_count} contacts
                  {l.last_run_at ? ` · last run ${new Date(l.last_run_at).toLocaleDateString('en-GB')}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}

        {releases.length > 0 && (
          <label className="field" style={{ marginBottom: 'var(--s2)' }}>
            <span className="field-label">Start from a release</span>
            <select className="input" value={releaseId} onChange={e => pickRelease(e.target.value)}>
              <option value="">Pick one, or write the story below…</option>
              {releases.map(r => <option key={r.id} value={r.id}>{r.title || 'Untitled release'}</option>)}
            </select>
          </label>
        )}
        <label className="field" style={{ marginBottom: 'var(--s2)' }}>
          <span className="field-label">Press release URL</span>
          <input className="input" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" />
        </label>
        <label className="field">
          <span className="field-label">…or the story itself</span>
          <textarea className="input" rows={4} value={brief} onChange={e => setBrief(e.target.value)}
            placeholder="Paste the release, or a sentence about the story." />
        </label>

        <div className="row center" style={{ gap: 'var(--s3)', marginTop: 'var(--s3)' }}>
          <button type="button" className="btn btn-primary" {...roWrite(readOnly, { onClick: run, disabled: busy || !canRun })}>
            {busy ? 'Ranking…' : 'Rank contacts'}
          </button>
          {!canRun && <span className="body-xs text-subtle">A sentence is enough.</span>}
        </div>

        {error && (
          <div className="callout callout-danger" style={{ marginTop: 'var(--s3)' }}>
            {error}{/^Couldn/i.test(error) ? ' Paste the text instead.' : ''}
          </div>
        )}
      </div>

      {/* ── the list ──────────────────────────────────────────────────── */}
      {result && (
        <div className="card">
          {(result.degraded || []).map((d, i) => (
            <div key={i} className="callout callout-warning" style={{ marginBottom: 'var(--s3)' }}>
              {d.engine === 'reasoned'
                ? <>The reasons did not come back: {d.message}. The ranking is unaffected.</>
                : <>The whole-database ranking is down: {d.message}. These are Claude's picks only, without fit scores.</>}
            </div>
          ))}

          {result.weak && (
            <div className="callout callout-warning" style={{ marginBottom: 'var(--s3)' }}>
              <strong>Nothing scored above {result.top_fit}%.</strong> The ranking found little to work
              with, so its order is close to noise and Claude's picks are listed first. Usually this
              means the text describes the project around the story rather than the story — a studio
              or a release reads better than a brief about organising something.
              <div style={{ marginTop: 'var(--s2)' }}>
                <button type="button" className="btn btn-secondary btn-sm"
                  {...roWrite(readOnly, { onClick: searchWeb, disabled: webBusy })}>
                  {webBusy ? 'Searching the web…' : 'Search the web instead'}
                </button>
              </div>
            </div>
          )}

          {result.angle && (
            <p className="body-sm" style={{ marginTop: 0, marginBottom: 'var(--s3)' }}><strong>Angle:</strong> {result.angle}</p>
          )}

          <div className="row wrap center" style={{ justifyContent: 'space-between', gap: 'var(--s3)', marginBottom: 'var(--s3)' }}>
            <div className="body-sm">
              <strong>{items.length}</strong> match{items.length === 1 ? '' : 'es'}
              {openList && <> · <strong>{newCount}</strong> new since the list was saved</>}
              {result.mode && (
                <span className="chip" style={{ marginLeft: 'var(--s2)' }}
                  title={result.mode === 'semantic'
                    ? 'Ranked by meaning.'
                    : 'Ranked by shared topics. Fit is relative to the best match here; add an OpenAI key in Settings for meaning-based matching.'}>
                  {result.mode === 'semantic' ? 'Semantic' : 'Keyword'}
                </span>
              )}
              {selected.size > 0 && <> · {selected.size} selected</>}
            </div>
            <div className="row center" style={{ gap: 'var(--s2)' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={selectAgreed}>Select best 10</button>
              <button type="button" className="btn btn-secondary btn-sm"
                {...roWrite(readOnly, { onClick: searchWeb, disabled: webBusy })}
                title="Looks for journalists who fit this story and are not in your contacts yet">
                {webBusy ? 'Searching the web…' : 'Search the web'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={exportCsv}>
                {chosen.length ? `Export ${chosen.length}` : 'Export CSV'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" {...roWrite(readOnly, { onClick: saveList })}>
                Save as list
              </button>
              <button type="button" className="btn btn-primary btn-sm"
                {...roWrite(readOnly, { onClick: startAdd, disabled: !chosen.length })}>
                Add {chosen.filter(c => c.has_email).length || ''} to an audience
              </button>
            </div>
          </div>

          {unmailable > 0 && (
            <p className="body-xs text-muted" style={{ marginTop: 0, marginBottom: 'var(--s2)' }}>
              {unmailable} of the selected have no usable address. They stay in the list and in the export,
              but cannot be added to an audience.
            </p>
          )}

          {addTo && (
            <div className="callout" style={{ marginBottom: 'var(--s3)' }}>
              <div className="row wrap center" style={{ gap: 'var(--s2)' }}>
                <span className="body-sm">Add to</span>
                <select className="input" style={{ maxWidth: 280 }} value={addTo.segId}
                  onChange={e => setAddTo(a => ({ ...a, segId: e.target.value }))}>
                  <option value="">Pick an audience…</option>
                  {addTo.segments.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button type="button" className="btn btn-primary btn-sm" onClick={confirmAdd} disabled={!addTo.segId}>Add</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAddTo(null)}>Cancel</button>
              </div>
              {!addTo.segments.length && (
                <p className="body-xs text-muted" style={{ margin: 'var(--s2) 0 0' }}>
                  That release has no audiences yet. Make one on the release first.
                </p>
              )}
            </div>
          )}

          {items.length === 0 ? (
            <p className="body-sm text-muted" style={{ margin: 0 }}>
              Nothing cleared the relevance floor. Your contact book may be thin on this beat.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ width: 28 }}>
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                    </th>
                    <th>Journalist</th>
                    <th>Outlet</th>
                    <th style={{ width: 58, textAlign: 'right' }}>Fit</th>
                    <th>Why</th>
                    <th style={{ width: 130 }}>History</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(m => {
                    const state = emailState(m);
                    return (
                      <tr key={m.id}>
                        <td><input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} aria-label={`Select ${m.name}`} /></td>
                        <td>
                          <div style={{ fontWeight: 600 }}>
                            {onOpenJournalist
                              ? <button type="button" className="row-trigger" onClick={() => onOpenJournalist(m.id)}>{m.name}</button>
                              : m.name}
                            {openList && isNew(m.id) && <span className="chip" style={{ marginLeft: 'var(--s2)' }}>new</span>}
                          </div>
                          <div style={{ fontSize: 'var(--fs-caption)', color: state.tone }}>
                            {m.email || state.label}{m.email && state.label ? ` · ${state.label}` : ''}
                            {!m.has_email && onOpenJournalist && (
                              <button type="button" onClick={() => onOpenJournalist(m.id)}
                                style={{ border: 'none', background: 'none', padding: 0, marginLeft: 'var(--s2)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 'inherit', textDecoration: 'underline' }}>
                                add one
                              </button>
                            )}
                          </div>
                        </td>
                        <td style={{ fontSize: 'var(--fs-caption)' }}>
                          {m.outlet || '—'}{m.tier ? ` · T${m.tier}` : ''}
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {m.fit == null
                            ? <span title="Picked for this story's angle; not in the scored set">—</span>
                            : `${m.fit}%`}
                        </td>
                        <td style={{ fontSize: 'var(--fs-caption)' }}>
                          {m.reason && <span title={m.reason}>{m.reason}</span>}
                          {!m.reason && (m.matched || []).length > 0 && (m.matched || []).slice(0, 4).map((t, i) => (
                            <span key={i} className="chip" style={{ fontSize: 'var(--fs-caption)', marginRight: 'var(--s1)' }}>{t}</span>
                          ))}
                          {!m.reason && !(m.matched || []).length && (
                            // Nothing matched by name. In semantic mode that is a real
                            // outcome — the match is on meaning — and the honest thing is
                            // to say so and show their beat as their beat, not to print
                            // unrelated topics as though they were the reason.
                            <span className="text-subtle">
                              Matched on meaning
                              {(m.topics || []).length ? <> · covers {(m.topics || []).slice(0, 3).join(', ')}</> : null}
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>
                          {m.covered_client ? 'Covered before' : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {web && (web.candidates || []).length > 0 && (
        <div className="card" style={{ marginTop: 'var(--s4)' }}>
          <div className="row center" style={{ justifyContent: 'space-between', marginBottom: 'var(--s1)' }}>
            <h3 className="h3" style={{ margin: 0 }}>Not in your list yet · {web.candidates.length}</h3>
            {/* Telling someone their candidates are queued somewhere and then
                not taking them there is half a feature. */}
            <Link to={`/clients/${clientId}/pr/find`} className="btn btn-primary btn-sm">
              Review {web.candidates.length} in Find
            </Link>
          </div>
          <p className="body-sm text-muted" style={{ marginTop: 0, marginBottom: 'var(--s3)' }}>
            Found on the open web for this story. These are <strong>candidates, not contacts</strong> —
            no verified address and no history with {clientName || 'this client'} — so they cannot be
            exported or added to an audience from here. Each is queued in{' '}
            <strong>Find</strong> for you to approve. Approving one creates the contact, resolves its
            outlet and carries its beat across, so every future search ranks them — and where only a
            guessed address was found it is stored flagged as a guess, never as verified.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr><th>Journalist</th><th>Outlet</th><th>Why</th><th style={{ width: 90 }}>Source</th></tr>
              </thead>
              <tbody>
                {web.candidates.map(c => (
                  <tr key={c.id || `${c.name}-${c.outlet}`}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{c.name}</div>
                      <div style={{ fontSize: 'var(--fs-caption)', color: c.email ? 'var(--text-subtle)' : 'var(--text-muted)' }}>
                        {c.email || (c.guessed_email ? `${c.guessed_email} · guessed from the outlet's pattern` : 'no address found')}
                      </div>
                    </td>
                    <td style={{ fontSize: 'var(--fs-caption)' }}>
                      {c.outlet || '—'}
                      {c.beat ? <div className="text-muted">{c.beat}</div> : null}
                    </td>
                    <td style={{ fontSize: 'var(--fs-caption)' }}>{c.why}</td>
                    <td style={{ fontSize: 'var(--fs-caption)' }}>
                      {/* Provenance is the point: every one of these has to be
                          a page somebody can open and check. */}
                      {c.source_url
                        ? <a href={c.source_url} target="_blank" rel="noreferrer">the byline</a>
                        : <span className="text-subtle">none given</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
