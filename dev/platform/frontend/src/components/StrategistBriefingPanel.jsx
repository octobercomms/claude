import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import StrategistChat from './StrategistChat';

// The Strategist: a weekly decision queue, not a document.
//
// Three redesigns in, the account lead still could not say what this page was
// for, and the reason was never the layout. The page was a reader for a long
// prose briefing, and nobody reads a long prose briefing. The generator now
// writes three lines of "what changed" and a queue (see the SYSTEM prompt in
// services/strategist/briefing.js, which used to ask for depth while the
// prompts under it asked for brevity).
//
// So the page is two things: what changed, and what is now yours to do. Each
// queue item carries its own pillar and folds open to the reason it exists —
// its rationale plus that pillar's analysis. That killed three controls at
// once:
//
//   - the pillar filter, which looked like navigation and silently shortened
//     a list instead (every row carries its own pillar chip now)
//   - the "Evidence" section, which sat apart from the items it justified
//     under a one-word label with no object
//   - the four "no data this period" boxes, which were a finding the queue
//     already carries as an item
//
// Everything that configures the briefing — the Monday email, the period,
// recipients, downloads, the steer note and the archive — is behind the cog,
// in a drawer that slides over the page. Configuration is not reading, and it
// had been occupying the room where the reading happens.
//
// Agency-only. See services/strategist/briefing.js.

const PILLAR_LABEL = { paid: 'Paid', earned: 'Earned', shared: 'Shared', owned: 'Owned', cross: 'Account-wide' };

export default function StrategistBriefingPanel({ clientId }) {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [days, setDays] = useState(30);
  const [active, setActive] = useState(true);
  const [recipients, setRecipients] = useState('');
  const [recipientsDirty, setRecipientsDirty] = useState(false);
  // The drawer. Shut on arrival and on every client change, because it holds
  // settings and an archive, and neither is why you opened the page.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [downloading, setDownloading] = useState(null);
  const [steer, setSteer] = useState([]);
  const [steerText, setSteerText] = useState('');

  // `pick` forces the newest briefing to be selected, which a client change
  // must do. Without it the guard below keeps whatever was already selected.
  //
  // The functional updater matters: on a client change this runs in the same
  // tick as the reset below, so a `selectedId` read from the closure would
  // still be the previous client's and the guard would hold.
  const loadList = (pick = false) => api.get(`/strategist/clients/${clientId}/briefings`)
    .then(r => {
      setList(r);
      setSelectedId(cur => (pick || !cur) ? (r[0] ? r[0].id : null) : cur);
    })
    .catch(e => toast(e.message, 'error'));

  // Switching client clears the briefing before fetching the new one.
  //
  // It did not, and that is how Architourian's Strategist came to show
  // Falcon's queue word for word, down to "porcelain enamel cookware". The
  // selected briefing id survived the client change, `loadList` would not
  // replace it because one was already set, and the effect below never re-ran
  // because the id had not changed — so the page kept rendering a briefing
  // belonging to someone else.
  //
  // Nothing leaked: `/strategist/briefings/:id` calls `assertClientAccess`, so
  // a viewer scoped to one client gets a 403. An admin can see both, so the
  // API answered honestly and the frontend put the answer under the wrong
  // name. Still the worst kind of wrong, because the page gives you no reason
  // to doubt it.
  useEffect(() => {
    setList(null);
    setSelected(null);
    setSelectedId(null);
    setSettingsOpen(false);
    loadList(true);
    /* eslint-disable-line */
  }, [clientId]);
  // Escape shuts the drawer, the same contract the analyst panel has, so the
  // two slide-ins behave alike.
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = e => { if (e.key === 'Escape') setSettingsOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [settingsOpen]);
  useEffect(() => {
    api.get(`/clients/${clientId}`).then(c => {
      setRecipients(c.strategist_recipients || '');
      setActive(c.strategist_active !== false);
      setRecipientsDirty(false);
    }).catch(() => {});
  }, [clientId]);

  const loadSteer = () => api.get(`/strategist/clients/${clientId}/steer`).then(setSteer).catch(() => {});
  // Reload the steer notes whenever the drawer opens: the chat beside them can
  // promote an answer into one, and the list would otherwise be a snapshot
  // from whenever the page loaded.
  useEffect(() => { if (settingsOpen) loadSteer(); /* eslint-disable-line */ }, [clientId, settingsOpen]);

  async function addSteer() {
    const text = steerText.trim();
    if (!text) return;
    try {
      const n = await api.post(`/strategist/clients/${clientId}/steer`, { text, source: 'note' });
      setSteer(s => [n, ...s]); setSteerText('');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function removeSteer(id) {
    try { await api.delete(`/strategist/steer/${id}`); setSteer(s => s.filter(n => n.id !== id)); }
    catch (e) { toast(e.message, 'error'); }
  }

  useEffect(() => {
    if (!selectedId) { setSelected(null); return; }
    api.get(`/strategist/briefings/${selectedId}`).then(setSelected).catch(e => toast(e.message, 'error'));
  }, [selectedId, toast]);

  useEffect(() => {
    if (selected && selected.status === 'completed' && !selected.read_at) {
      api.post(`/strategist/briefings/${selected.id}/read`, {}).catch(() => {});
    }
  }, [selected]);

  async function generate() {
    setGenerating(true);
    try {
      const fresh = await api.post(`/strategist/clients/${clientId}/briefing/generate`, { days });
      await loadList();
      setSelectedId(fresh.id);
      // Poll if it came back still generating (long runs).
      if (fresh.status !== 'completed') {
        const poll = setInterval(async () => {
          try {
            const r = await api.get(`/strategist/briefings/${fresh.id}`);
            if (r.status !== 'generating') { clearInterval(poll); setSelected(r); loadList(); }
          } catch { clearInterval(poll); }
        }, 5000);
      }
    } catch (e) { toast(e.message, 'error'); }
    finally { setGenerating(false); }
  }

  async function toggleAction(a) {
    const next = !a.done;
    setSelected(s => ({ ...s, recommendations: s.recommendations.map(r => r.id === a.id ? { ...r, done: next } : r) }));
    try { await api.patch(`/strategist/briefing-actions/${a.id}`, { done: next }); }
    catch (e) { toast(e.message, 'error'); setSelected(s => ({ ...s, recommendations: s.recommendations.map(r => r.id === a.id ? { ...r, done: a.done } : r) })); }
  }

  async function toggleActive() {
    const next = !active;
    setActive(next);
    try { await api.put(`/strategist/clients/${clientId}/active`, { active: next }); toast(next ? 'Weekly briefing on' : 'Weekly briefing paused'); }
    catch (e) { setActive(!next); toast(e.message, 'error'); }
  }

  async function saveRecipients() {
    try { await api.put(`/clients/${clientId}`, { strategist_recipients: recipients }); setRecipientsDirty(false); toast('Recipients saved'); }
    catch (e) { toast(e.message, 'error'); }
  }

  // Delete a briefing from the archive.
  //
  // This function survived the rebuild with no caller: the only delete control
  // was in the left rail, and the rail went. A route and a confirm dialog with
  // nothing to press is worse than neither, because the capability reads as
  // missing. It lives in the drawer's archive now, beside the briefing it
  // removes.
  //
  // The reload-then-reselect matters: deleting the briefing on screen leaves
  // the page rendering something that no longer exists, so the selection moves
  // to whatever is newest, or to nothing when the last one goes.
  async function destroy(id, e) {
    e.stopPropagation();
    if (!confirm('Delete this briefing? The queue items on it go with it.')) return;
    try {
      await api.delete(`/strategist/briefings/${id}`);
      const l = await api.get(`/strategist/clients/${clientId}/briefings`);
      setList(l);
      if (selectedId === id) setSelectedId(l[0]?.id || null);
      toast('Briefing deleted');
    } catch (e2) { toast(e2.message, 'error'); }
  }


  // Download the briefing as a branded document. audience=internal is the
  // verbatim briefing + data appendix (PDF); audience=client is a Claude
  // reframe as a client-facing progress report (Word, editable). The client
  // reframe is generated on first download (~20s) then cached.
  async function downloadReport(audience, format) {
    const key = `${audience}.${format}`;
    setDownloading(key);
    try {
      const res = await api.raw(`/strategist/briefings/${selected.id}/export.${format}?audience=${audience}`);
      if (!res.ok) { const err = await res.json().catch(() => ({ error: res.statusText })); throw new Error(err.error || `HTTP ${res.status}`); }
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const m = cd.match(/filename="([^"]+)"/);
      const filename = m ? m[1] : `strategist.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { toast(`Download failed: ${e.message}`, 'error'); }
    finally { setDownloading(null); }
  }

  // The floor under the reset above. A briefing is only ever rendered on the
  // client it belongs to, so the same class of bug cannot show a stale one
  // again however the state gets out of step. The payload carries client_id;
  // an older one without it is trusted, since the alternative is showing
  // nothing on a briefing that is probably fine.
  const mine = !selected || !selected.client_id || selected.client_id === clientId;
  const completed = mine && selected && selected.status === 'completed';
  const sections = (completed && Array.isArray(selected.sections)) ? selected.sections : [];
  const recs = (completed && Array.isArray(selected.recommendations)) ? selected.recommendations : [];
  // Each pillar's analysis, keyed so a queue item opens its own. 'cross' items
  // are account-wide and have no single pillar behind them, so they open with
  // their rationale alone rather than borrowing another pillar's paragraph.
  const evidenceByPillar = {};
  for (const sec of sections) if (sec.ok && sec.markdown) evidenceByPillar[sec.pillar] = sec.markdown;
  const silentPillars = sections.filter(x => !x.ok).map(x => PILLAR_LABEL[x.pillar] || x.pillar);
  // The synthesis is "What changed" then "The queue". The queue renders below
  // as tickable rows, so showing its markdown here too would print every item
  // twice. Cut at the queue heading and keep the prose; if the model skipped
  // the heading, show the lot rather than nothing.
  const whatChanged = (() => {
    const md = selected && selected.synthesis;
    if (!md) return '';
    const m = md.match(/\n#{2,4}\s*The queue\b/i);
    return m ? md.slice(0, m.index).trim() : md;
  })();
  const crucial = recs.filter(r => r.priority === 'crucial');
  const nice = recs.filter(r => r.priority !== 'crucial');

  return (
    <div className="strategist">
      {/* No heading. The tab already says Strategist, and a page that repeats
          its own tab spends its first line telling you where you are. The
          blurb went with it: what the page is for should be legible from what
          is on it. */}
      {/* The Briefing/Ask sub-tabs are gone with the rest of the chrome. The
          page shows the latest briefing; asking about it is one of the extra
          functions behind the menu, beside the settings for it.
          
          Generate stays HERE rather than joining them, and deliberately: it is
          the one action that produces the thing this page exists to show, and
          on a client with no briefing yet the empty state would otherwise read
          "click Generate briefing" with no button anywhere on screen. */}
      <div className="modal-head" style={{ alignItems: 'center', justifyContent: 'flex-end' }}>
        <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={generate} disabled={generating}>
            {generating ? 'Generating…' : `+ Generate briefing · ${days} days`}
          </button>
          {/* Not a cog. A cog promises settings, and this holds the chat, the
              downloads and the archive as well — extra functions, which is
              what a kebab means. Sized to the house icon button so it matches
              the cog and plug in the client bar above it. */}
          <button type="button" className="icon-circle" onClick={() => setSettingsOpen(true)}
            aria-label="More: ask about this briefing, settings, downloads and past briefings"
            title="Ask about this briefing, settings, downloads and past briefings">
            ⋮
          </button>
        </div>
      </div>

      {renderBriefingView()}
      {renderSettingsDrawer()}
    </div>
  );

  function renderBriefingView() {
    return (
      <>

      {!list && <div style={{ color: 'var(--text-subtle)', padding: 'var(--s5)' }}>Loading…</div>}
      {list && list.length === 0 && !generating && (
        <div className="empty">No briefings yet. Click <strong>Generate briefing</strong> — Claude reviews the last {days} days across every pillar and writes your strategist's take. Takes a minute or two.</div>
      )}

      {list && list.length > 0 && (
        /* One column. The briefings list was a left rail taking a third of the
           width to show a thing you pick once a week; it is a row in the
           settings strip at the foot now. */
        <div className="strategist-main one-col">
          <div>
            {(!selected || !mine) && <div className="card" style={{ color: 'var(--text-subtle)' }}>Loading this client's briefing…</div>}
            {mine && selected && selected.status === 'generating' && <div className="card" style={{ color: 'var(--text-subtle)' }}>Generating… five expert passes, usually a minute or two.</div>}
            {mine && selected && selected.status === 'failed' && (
              <div className="card" style={{ color: 'var(--negative)', fontSize: 'var(--fs-body)' }}>Generation failed: {selected.error_message || 'unknown error'}</div>
            )}
            {completed && (<>
              {/* What changed leads. The synthesis is now two short sections —
                  what changed, then the queue — so it renders whole rather than
                  being split: the queue below is the same items as rows you can
                  tick, and this is the prose around them. */}
              <div className="card body-sm" style={{ marginBottom: 'var(--s4)' }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{whatChanged || selected.synthesis || ''}</ReactMarkdown>
              </div>

              {/* The queue is the page. Crucial first, then nice-to-have,
                  each row carrying its own pillar and folding open to the
                  reason it is there. */}
              {recs.length > 0 ? (
                <div className="card body-sm" style={{ marginBottom: 'var(--s4)' }}>
                  <div style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 'var(--s2)' }}>
                    The queue — {recs.filter(r => r.done).length} of {recs.length} done
                  </div>
                  {crucial.length > 0 && <div className="caption" style={{ margin: 'var(--s1) 0 var(--s1)' }}>Crucial</div>}
                  {crucial.map(r => <RecRow key={r.id} r={r} onToggle={toggleAction} evidence={evidenceByPillar[r.pillar]} />)}
                  {nice.length > 0 && <div className="caption" style={{ margin: 'var(--s3) 0 var(--s1)' }}>Nice to have</div>}
                  {nice.map(r => <RecRow key={r.id} r={r} onToggle={toggleAction} evidence={evidenceByPillar[r.pillar]} />)}
                </div>
              ) : (
                <div className="card body-sm" style={{ marginBottom: 'var(--s4)', color: 'var(--text-subtle)' }}>
                  <strong>Nothing on the queue from this briefing.</strong> That means the strategist
                  found nothing worth doing in the next 30 days, which on an active account is worth
                  a second look: generate again, and if it comes back empty twice the connectors are
                  the first place to check.
                </div>
              )}

              {/* Which pillars went quiet is worth one line, because a silent
                  pillar is usually a broken connector rather than a calm week.
                  It used to be a box inside a section you had to open. */}
              {silentPillars.length > 0 && (
                <p className="body-xs text-subtle" style={{ marginBottom: 'var(--s4)' }}>
                  No data this period from {silentPillars.join(', ')}.
                </p>
              )}
            </>)}
          </div>
        </div>
      )}
      </>
    );
  }

  // Everything that configures the briefing, in a drawer over the page.
  //
  // These were a strip at the foot an hour ago and the top third of the page
  // before that, and both were wrong in the same way: they are settings for a
  // thing you read once a week, sharing a column with the thing you read. A
  // drawer is the honest shape — present on every briefing, in the way of
  // none of them.
  function renderSettingsDrawer() {
    return (
      <>
        {settingsOpen && <div className="side-drawer-scrim" onClick={() => setSettingsOpen(false)} />}
        <aside className={`side-drawer${settingsOpen ? ' open' : ''}`} aria-hidden={!settingsOpen}>
          <div className="side-drawer-head">
            <div>
              <div className="analyst-panel-kicker">Strategist</div>
              <div className="analyst-panel-section">Ask &amp; settings</div>
            </div>
            <button type="button" className="analyst-panel-close" onClick={() => setSettingsOpen(false)} aria-label="Close">×</button>
          </div>
          <div className="side-drawer-body side-drawer-split">
            {/* Asking about the briefing on one side, configuring it on the
                other. It was a sub-tab on the page, which meant the briefing
                vanished the moment you asked a question about it — the one
                thing you need in front of you while asking. Here the page
                keeps it, behind the drawer, and the two columns stack on a
                narrow screen rather than squeezing the thread. */}
            <div className="side-drawer-col">
              <div className="drawer-group drawer-chat">
                <div className="caption drawer-group-head">Ask about this briefing</div>
                {/* No blurb here. StrategistChat prints its own, and mine
                    contradicted it: I wrote "for live numbers use the analyst"
                    above a line saying this chat pulls live data itself. Its
                    line is the true one. */}
                {/* Mounted only while the drawer is open: a closed drawer
                    should not be holding a conversation, and reopening on the
                    same client resumes the stored thread anyway. */}
                {settingsOpen && <StrategistChat clientId={clientId} />}
              </div>
            </div>

            <div className="side-drawer-col">
            <div className="drawer-group">
              <div className="caption drawer-group-head">The Monday email</div>
              <label className="strategist-setting" title="Include this client in the Monday email">
                <input type="checkbox" checked={active} onChange={toggleActive} />
                <span>Send this client's briefing every Monday</span>
              </label>
              <label className="field" style={{ marginTop: 'var(--s3)' }}>
                <span className="field-label">Recipients</span>
                <input type="text" value={recipients} onChange={e => { setRecipients(e.target.value); setRecipientsDirty(true); }}
                  placeholder="you@octobercomms.com" className="input" style={{ width: '100%' }} />
              </label>
              {recipientsDirty && <button onClick={saveRecipients} className="btn btn-secondary btn-sm" style={{ marginTop: 'var(--s2)' }}>Save recipients</button>}
            </div>

            <div className="drawer-group">
              <div className="caption drawer-group-head">How far back to look</div>
              <select value={days} onChange={e => setDays(parseInt(e.target.value, 10))} className="input" style={{ width: '100%' }}>
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
              </select>
              <p className="body-xs text-subtle" style={{ marginTop: 'var(--s2)' }}>
                Applies the next time you generate.
              </p>
            </div>

            {/* The third of three inputs that looked alike. Generate runs now,
                Ask answers now and changes nothing, and this lands next time —
                so it says when it lands, which is the only thing that told
                them apart. */}
            <div className="drawer-group">
              <div className="caption drawer-group-head">Steer the next briefing</div>
              <p className="body-xs text-subtle" style={{ marginBottom: 'var(--s2)' }}>
                Notes here are read by the strategist when it next generates. They do not change the briefing in front of you.
              </p>
              <textarea value={steerText} onChange={e => setSteerText(e.target.value)} rows={2}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addSteer(); } }}
                placeholder="e.g. We're pushing the autumn collection — lean into SEO and social, ease off paid until stock lands."
                className="textarea" style={{ width: '100%' }} />
              <button className="btn btn-secondary btn-sm" disabled={!steerText.trim()} onClick={addSteer} style={{ marginTop: 'var(--s2)' }}>Add note</button>
              {steer.length > 0 && (
                <div style={{ marginTop: 'var(--s3)', display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
                  {steer.map(n => (
                    <div key={n.id} style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'flex-start', fontSize: 'var(--fs-body)', lineHeight: 1.45 }}>
                      <span style={{ flex: 1 }}>
                        {n.source === 'chat' && <span className="caption" style={{ color: 'var(--text-subtle)', marginRight: 'var(--s2)' }}>from chat</span>}
                        {n.text}
                      </span>
                      <button onClick={() => removeSteer(n.id)} title="Remove" className="btn-icon btn-icon-sm">×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {completed && (
              <div className="drawer-group">
                <div className="caption drawer-group-head">Download</div>
                <button className="btn btn-secondary btn-sm" disabled={!!downloading} onClick={() => downloadReport('internal', 'pdf')}
                  style={{ width: '100%', marginBottom: 'var(--s2)' }}
                  title="The full briefing — what changed, the queue, every pillar analysis and the data behind it.">
                  {downloading === 'internal.pdf' ? 'Preparing…' : '↓ Briefing (PDF)'}
                </button>
                <button className="btn btn-secondary btn-sm" disabled={!!downloading} onClick={() => downloadReport('client', 'docx')}
                  style={{ width: '100%' }}
                  title="A client-ready progress report you can edit in Word before sending. First download takes ~20s while Claude writes it.">
                  {downloading === 'client.docx' ? 'Writing client draft…' : '↓ Client draft (Word)'}
                </button>
                <p className="body-xs text-subtle" style={{ marginTop: 'var(--s2)' }}>
                  The client draft is reframed for the client. Edit it before sending.
                </p>
              </div>
            )}

            {/* Every briefing, not just the older ones. `length > 1` hid the
                archive on a client with one briefing, which is also the only
                place its delete could live — so a first briefing could never
                be removed. */}
            {list && list.length > 0 && (
              <div className="drawer-group">
                <div className="caption drawer-group-head">Past briefings</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
                  {list.map(r => (
                    <div key={r.id} className="drawer-archive-row">
                      <button onClick={() => { setSelectedId(r.id); setSettingsOpen(false); }}
                        className={`strategist-past${selectedId === r.id ? ' active' : ''}`}
                        style={{ textAlign: 'left', flex: 1 }}>
                        {fmtDate(r.period_start)} – {fmtDate(r.period_end)}
                        {!r.read_at && r.status === 'completed' && <span className="briefing-dot" />}
                      </button>
                      <button type="button" className="btn-icon btn-icon-sm" onClick={e => destroy(r.id, e)}
                        title="Delete this briefing" aria-label={`Delete the briefing for ${fmtDate(r.period_start)} to ${fmtDate(r.period_end)}`}>
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            </div>
          </div>
        </aside>
      </>
    );
  }
}

// One queue item: what to do, how long it has been waiting, and the reasoning
// folded away behind it. The age is the part that was missing — an item open
// for three weeks used to look identical to one raised this morning, which is
// why a stale failure could sit there being re-described every Monday.
function RecRow({ r, onToggle, evidence }) {
  const [open, setOpen] = useState(false);
  const days = ageInDays(r.first_raised_at);
  // Only say the age once it means something. "Open 1 day" on a fresh item is
  // noise; the point of the badge is discomfort, and nothing is uncomfortable
  // on its first morning.
  const stale = days != null && days >= 7;
  return (
    <div data-queue-row style={{ padding: 'var(--s2) 0', borderBottom: '1px solid var(--card-border)' }}>
      <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'flex-start' }}>
        <input type="checkbox" checked={r.done} onChange={() => onToggle(r)} style={{ marginTop: 'var(--s1)', cursor: 'pointer' }} />
        <div style={{ flex: 1, fontSize: 'var(--fs-body)', lineHeight: 1.45, color: r.done ? 'var(--text-subtle)' : 'var(--text)', textDecoration: r.done ? 'line-through' : 'none' }}>
          {/* Always, now. The pillar used to be hidden whenever the filter
              was on a pillar, which is backwards: the chip is what made the
              filter unnecessary. */}
          {r.pillar && (
            <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-subtle)', marginRight: 'var(--s2)' }}>
              {PILLAR_LABEL[r.pillar] || r.pillar}
            </span>
          )}
          {r.text}
          {!r.done && stale && (
            <span className="queue-age" title={`First raised ${new Date(r.first_raised_at).toLocaleDateString('en-GB')}`}>
              {days} days open
            </span>
          )}
        </div>
        {(r.rationale || evidence) && (
          <button type="button" onClick={() => setOpen(o => !o)} className="btn-icon btn-icon-sm"
            aria-expanded={open} aria-label={open ? 'Hide why' : 'Why this matters'} title={open ? 'Hide why' : 'Why this matters'}>
            {open ? '\u2212' : '?'}
          </button>
        )}
      </div>
      {/* The reason, where the reason belongs. The rationale is the one-line
          "why", and under it sits the pillar analysis that produced the item —
          which used to live in a separate "Evidence" section, apart from
          everything it was evidence for. An account-wide item has no single
          pillar behind it, so it opens with its rationale alone. */}
      {open && (
        <div className="queue-why">
          {r.rationale && <div>{r.rationale}</div>}
          {evidence && (
            <div className="queue-evidence">
              <div className="caption" style={{ color: 'var(--text-subtle)', marginBottom: 'var(--s2)' }}>
                {PILLAR_LABEL[r.pillar] || r.pillar} analysis
              </div>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{evidence}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Mirrors ageInDays in services/strategist/queue.js. A bad timestamp reads as
// unknown, never as a wrong number of days.
function ageInDays(since) {
  if (!since) return null;
  const t = Date.parse(since);
  if (!Number.isFinite(t)) return null;
  const ms = Date.now() - t;
  return ms < 0 ? 0 : Math.floor(ms / 86400000);
}

function fmtDate(d) { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
function fmtRelative(d) {
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (days < 1) return 'today'; if (days < 2) return 'yesterday'; if (days < 14) return `${days} days ago`;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const mdComponents = {
  h1: ({ node, ...p }) => <h1 style={{ fontSize: 'var(--fs-title)', fontWeight: 700, margin: 'var(--s5) 0 var(--s3)' }} {...p} />,
  h2: ({ node, ...p }) => <h2 style={{ fontSize: 'var(--fs-title)', fontWeight: 700, margin: 'var(--s5) 0 var(--s3)', paddingBottom: 'var(--s2)', borderBottom: '1px solid var(--card-border)' }} {...p} />,
  h3: ({ node, ...p }) => <h3 style={{ fontSize: 'var(--fs-body)', fontWeight: 700, margin: 'var(--s4) 0 var(--s2)' }} {...p} />,
  p: ({ node, ...p }) => <p style={{ margin: '0 0 var(--s3)', lineHeight: 1.6, fontSize: 'var(--fs-body)' }} {...p} />,
  ul: ({ node, ...p }) => <ul style={{ margin: '0 0 var(--s3)', paddingLeft: 'var(--s6)' }} {...p} />,
  ol: ({ node, ...p }) => <ol style={{ margin: '0 0 var(--s3)', paddingLeft: 'var(--s6)' }} {...p} />,
  li: ({ node, ...p }) => <li style={{ marginBottom: 'var(--s2)', lineHeight: 1.55, fontSize: 'var(--fs-body)' }} {...p} />,
  table: ({ node, ...p }) => <div className="md-table-wrap"><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-body)' }} {...p} /></div>,
  th: ({ node, ...p }) => <th style={{ textAlign: 'left', padding: 'var(--s2) var(--s3)', borderBottom: '2px solid var(--text)', fontWeight: 700, fontSize: 'var(--fs-caption)' }} {...p} />,
  td: ({ node, ...p }) => <td style={{ padding: 'var(--s2) var(--s3)', borderBottom: '1px solid var(--card-border)', verticalAlign: 'top' }} {...p} />,
};
