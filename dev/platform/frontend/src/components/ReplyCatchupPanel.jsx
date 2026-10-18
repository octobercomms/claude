import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Replies that arrived while a mailbox went unread.
//
// The live poll looks back three days, which is right for stopping a follow-up
// before it goes out and useless for a backlog. October had one: press releases
// replied to press@ while the poll read hello@, so months of replies were never
// matched and never checked for opt-outs.
//
// Scanning writes nothing. Applying is a press, per row or over a ticked set.
// Both actions only ever stop mail going out, which is why opt-outs are
// pre-ticked and why there is no undo: reversing an opt-out would resume mail
// to someone who asked you to stop.

function fmtDate(d) {
  if (!d) return '';
  const t = new Date(d);
  return isNaN(t) ? '' : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * What pressing Apply on this row will do, in plain words.
 *
 * Daniel's question, verbatim: "the apply button - im not sure what im
 * applying. is it going to unsubscribe from my database, the campaign, that
 * client?" Every clause below is built from the row's own fields. Where a
 * number is not known — rows raised before the scan counted them — the clause
 * is left out rather than guessed, because "cancels 0 follow-ups" on a row
 * that has four queued is worse than saying nothing.
 *
 * The two actions have different scopes on purpose, and that is exactly what
 * was unclear:
 *   - an opt-out is recorded against ONE client, the one whose campaign they
 *     replied to. The contact stays in the library; other clients can still
 *     email them.
 *   - marking a reply stops queued follow-ups to that contact ANYWHERE.
 */
function whatApplyDoes(it) {
  const who = it.contact_name || it.from_email;
  const client = it.client_name || 'this client';
  const known = it.counts_known;
  const lines = [];

  if (it.unsubscribe) {
    const queued = known && it.pending_client > 0
      ? ` and cancels ${it.pending_client} queued email${it.pending_client === 1 ? '' : 's'} to them for ${client}`
      : '';
    lines.push({
      strong: `Takes ${who} off the ${client} list${queued}.`,
      plain: 'They stay in your contacts, and your other clients can still email them. Nothing is deleted.',
    });
  }

  if (it.mark_replied) {
    const n = it.send_ids?.length || 0;
    const marked = n ? `Records that ${who} replied, against ${n} send${n === 1 ? '' : 's'}` : `Records that ${who} replied`;
    const queued = known && it.pending_all > 0
      ? `, and stops ${it.pending_all} follow-up${it.pending_all === 1 ? '' : 's'} still queued to them across OMI`
      : '';
    lines.push({
      strong: `${marked}${queued}.`,
      plain: 'Corrects your reply figures. Nobody is removed from any list.',
    });
  }

  if (!lines.length) return null;

  // The recommendation, and the reason for it. An opt-out is not a judgement
  // call: they asked, and leaving it costs you a complaint. A reply is a
  // tidy-up with one consequence worth naming.
  const recommend = it.unsubscribe
    ? 'Apply this. They asked to be removed and are still on the list.'
    : (known && it.pending_all > 0
      ? 'Worth applying, so you stop chasing someone who already answered.'
      : 'Safe to apply. It only corrects the numbers.');

  return { lines, recommend, urgent: Boolean(it.unsubscribe) };
}

const TABS = [
  { key: 'pending', label: 'To review' },
  { key: 'applied', label: 'Applied' },
  { key: 'dismissed', label: 'Dismissed' },
];

export default function ReplyCatchupPanel() {
  const toast = useToast();
  const [tab, setTab] = useState('pending');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [batching, setBatching] = useState(false);
  const [chosen, setChosen] = useState(new Set());
  const [days, setDays] = useState(180);
  const [scanning, setScanning] = useState(false);
  const [report, setReport] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    api.get(`/outreach/reply-catchup?status=${tab}`)
      .then((d) => { setData(d); setChosen(new Set()); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  const items = data?.items || [];
  const counts = data?.counts || {};

  // Opt-outs are pre-ticked. They are the compliance half and the half where
  // doing nothing is the harmful option: every one of these is someone who
  // asked to be removed and is still on the list.
  const optOuts = useMemo(() => items.filter((i) => i.unsubscribe), [items]);

  async function scan() {
    setScanning(true); setReport(null);
    try {
      const r = await api.post('/outreach/reply-catchup/scan', { days: Number(days) || 180 });
      if (r.skipped) { toast(r.skipped, 'error'); return; }
      setReport(r);
      toast(`Read ${r.scanned} message${r.scanned === 1 ? '' : 's'}; found ${r.found} to review. Nothing applied.`, 'success');
      setTab('pending');
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setScanning(false); }
  }

  async function applyOne(it) {
    setBusy(it.id);
    try {
      const r = await api.post(`/outreach/reply-catchup/${it.id}/apply`, {});
      toast(r.note || 'Applied.', 'success');
      setData((d) => ({ ...d, items: (d.items || []).filter((x) => x.id !== it.id) }));
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  }

  async function dismissOne(it) {
    setBusy(it.id);
    try {
      await api.post(`/outreach/reply-catchup/${it.id}/dismiss`, {});
      setData((d) => ({ ...d, items: (d.items || []).filter((x) => x.id !== it.id) }));
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  }

  async function applyChosen() {
    const ids = Array.from(chosen);
    if (!ids.length) return;
    setBatching(true);
    try {
      const r = await api.post('/outreach/reply-catchup/apply-batch', { ids });
      toast(r.failed
        ? `Applied ${r.applied}; ${r.failed} failed.`
        : `Applied ${r.applied} repl${r.applied === 1 ? 'y' : 'ies'}.`,
        r.failed ? 'error' : 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBatching(false); }
  }

  function toggle(id) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const tabCount = (k) => counts[k] || 0;

  return (
    <div>
      {/* ── Finding them ─────────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 'var(--s3)', padding: 'var(--s4)' }}>
        <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-muted)', marginBottom: 'var(--s3)' }}>
          Reply polling only looks back three days, so replies that arrived while a
          mailbox was not being read were never matched and never checked for opt-outs.
          This reads further back across every mailbox switched on for replies and shows
          you what it would do. Scanning changes nothing. Anything already waiting here
          is re-read too, so a scan corrects proposals raised earlier; what you have
          applied or dismissed is left alone.
        </div>
        <div style={{ display: 'flex', gap: 'var(--s3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>Look back</label>
          <input type="number" min="1" max="1095" value={days} onChange={(e) => setDays(e.target.value)} style={{ width: 80 }} />
          <label style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>days</label>
          <button className="btn btn-primary btn-sm" onClick={scan} disabled={scanning}>
            {scanning ? 'Reading the mailboxes…' : 'Find missed replies'}
          </button>
          <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={load}>Refresh</button>
        </div>
        {report && (
          <div style={{ marginTop: 'var(--s3)', paddingTop: 'var(--s3)', borderTop: 'var(--border-w) solid var(--card-border)', fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>
            {report.scanned} messages read over {report.window_days} days · <strong>{report.found}</strong> to review
            {report.opt_outs ? <> · <strong style={{ color: 'var(--negative)' }}>{report.opt_outs} opt-out{report.opt_outs === 1 ? '' : 's'}</strong></> : null}
            {report.already_handled ? ` · ${report.already_handled} already handled` : ''}
            {report.refreshed ? ` · ${report.refreshed} re-read` : ''}
            {report.inboxes?.length > 1 && (
              <div style={{ marginTop: 'var(--s1)' }}>
                {report.inboxes.map((b) => `${b.inbox}: ${b.found} of ${b.scanned}`).join(' · ')}
              </div>
            )}
            {report.errors?.length > 0 && (
              <div style={{ marginTop: 'var(--s1)', color: 'var(--negative)' }}>{report.errors.join(' | ')}</div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 'var(--s2)', marginBottom: 'var(--s3)', flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.key} className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(t.key)}>
            {t.label} ({tabCount(t.key)})
          </button>
        ))}
      </div>

      {tab === 'pending' && counts.pending_opt_outs > 0 && (
        <div className="card" style={{ marginBottom: 'var(--s3)', padding: 'var(--s3)', background: 'var(--negative-soft)', color: 'var(--negative)', fontSize: 'var(--fs-body)' }}>
          <strong>{counts.pending_opt_outs} of these asked to be removed</strong> and are still on the list.
          Applying those is the part that matters; the rest only tidies your reply figures.
          Ones marked <em>One-Click</em> were generated by the recipient’s mail client, so they are
          recorded as opt-outs without being counted as replies.
          <div style={{ marginTop: 'var(--s2)', color: 'var(--text-muted)', fontSize: 'var(--fs-caption)' }}>
            An opt-out is recorded against one client only — the one whose campaign they replied
            to. The contact stays in your library and your other clients can still email them.
            Each card below spells out what its own Apply will do.
          </div>
        </div>
      )}

      {/* ── Batch bar ────────────────────────────────────────────────────── */}
      {tab === 'pending' && items.length > 0 && (
        <div className="card" style={{ marginBottom: 'var(--s3)', padding: 'var(--s3)', display: 'flex', gap: 'var(--s3)', alignItems: 'center', flexWrap: 'wrap', background: 'var(--positive-soft)' }}>
          <label style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={chosen.size === items.length && items.length > 0}
              onChange={(e) => setChosen(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
            />
            <span>Select all {items.length}</span>
          </label>
          {optOuts.length > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={() => setChosen(new Set(optOuts.map((i) => i.id)))}>
              Select the {optOuts.length} opt-out{optOuts.length === 1 ? '' : 's'}
            </button>
          )}
          <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={applyChosen} disabled={!chosen.size || batching}>
            {batching ? 'Applying…' : `Apply ${chosen.size}`}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-subtle" style={{ padding: 'var(--s4)' }}>Loading…</div>
      ) : err ? (
        <div className="card" style={{ padding: 'var(--s4)', color: 'var(--negative)' }}>{err}</div>
      ) : !items.length ? (
        <div className="card" style={{ padding: 'var(--s4)', color: 'var(--text-subtle)' }}>
          {tab === 'pending'
            ? 'Nothing to review. Run a scan above to look further back.'
            : `Nothing ${tab} yet.`}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
          {items.map((it) => {
            const isApplied = it.status === 'applied';
            const plan = whatApplyDoes(it);
            return (
              <div key={it.id} className="card" style={{ padding: 'var(--s4)', borderLeft: it.unsubscribe ? '4px solid var(--negative)' : undefined }}>
                <div style={{ display: 'flex', gap: 'var(--s3)', alignItems: 'center', flexWrap: 'wrap', marginBottom: 'var(--s2)' }}>
                  {tab === 'pending' && (
                    <input type="checkbox" checked={chosen.has(it.id)} onChange={() => toggle(it.id)} />
                  )}
                  {it.unsubscribe && (
                    <span className="chip" style={{ background: 'var(--negative-soft)', color: 'var(--negative)' }}>Asked to be removed</span>
                  )}
                  {it.mark_replied && (
                    <span className="chip chip-accent">
                      Replied{it.send_ids?.length > 1 ? ` · ${it.send_ids.length} sends` : ''}
                    </span>
                  )}
                  {/* Gmail pressed the button, not the journalist. Shown so the
                      absence of a "Replied" chip reads as a decision rather
                      than an omission. */}
                  {it.machine_opt_out && (
                    <span
                      className="chip"
                      style={{ background: 'var(--surface-raised)', color: 'var(--text-muted)' }}
                      title="A List-Unsubscribe One-Click opt-out. Their mail client generated it, so it counts as an opt-out but not as a reply."
                    >
                      One-Click · not a reply
                    </span>
                  )}
                  {it.inbox_label && (
                    <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>{it.inbox_label}</span>
                  )}
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s2)' }}>
                    {!isApplied && tab === 'pending' && (
                      <>
                        <button className="btn btn-primary btn-sm" onClick={() => applyOne(it)} disabled={busy === it.id}>
                          {busy === it.id ? 'Applying…' : 'Apply'}
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => dismissOne(it)} disabled={busy === it.id}>Dismiss</button>
                      </>
                    )}
                  </span>
                </div>

                <div style={{ fontSize: 'var(--fs-body)' }}>
                  <strong>{it.contact_name || it.from_email}</strong>
                  {it.contact_name ? <span style={{ color: 'var(--text-subtle)' }}> · {it.from_email}</span> : null}
                  {it.campaign_name && (
                    <span style={{ color: 'var(--text-muted)' }}> · {it.campaign_name}{it.client_name ? ` (${it.client_name})` : ''}</span>
                  )}
                </div>

                {it.unsub_phrase && (
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--negative)', marginTop: 'var(--s1)' }}>
                    Matched on “{it.unsub_phrase}”
                  </div>
                )}

                {it.snippet && (
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 'var(--s2)', paddingLeft: 'var(--s3)', borderLeft: 'var(--border-w) solid var(--card-border)' }}>
                    “{it.snippet}”
                  </div>
                )}

                {/* What the button does, under the message, where the
                    decision is actually made. Only on the review tab: on an
                    applied row the applied_note below says what happened,
                    which beats restating what would have happened. */}
                {tab === 'pending' && plan && (
                  <div
                    style={{
                      marginTop: 'var(--s3)',
                      padding: 'var(--s3)',
                      borderRadius: 'var(--r-sm)',
                      background: plan.urgent ? 'var(--negative-soft)' : 'var(--surface-raised)',
                      fontSize: 'var(--fs-caption)',
                    }}
                  >
                    <div style={{ color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 'var(--s1)' }}>
                      If you press Apply
                    </div>
                    {plan.lines.map((l, i) => (
                      <div key={i} style={{ marginBottom: 'var(--s1)' }}>
                        <strong style={{ color: 'var(--text)' }}>{l.strong}</strong>{' '}
                        <span style={{ color: 'var(--text-muted)' }}>{l.plain}</span>
                      </div>
                    ))}
                    <div style={{ color: plan.urgent ? 'var(--negative)' : 'var(--text-muted)', fontWeight: plan.urgent ? 600 : 400 }}>
                      {plan.recommend}
                    </div>
                  </div>
                )}

                <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', marginTop: 'var(--s2)' }}>
                  {it.subject ? `${it.subject} · ` : ''}{fmtDate(it.received_at)}
                  {isApplied && it.applied_note ? ` — ${it.applied_note}${it.applied_by ? ` · ${it.applied_by}` : ''}` : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
