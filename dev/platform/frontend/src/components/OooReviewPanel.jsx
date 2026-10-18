import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Review queue for contact changes read out of out-of-office replies.
//
// Three doors feed it: OMI's own IMAP reply poll (the automatic one), a CSV
// upload of a MailFlow export, and MailFlow's token-gated push. Detection
// happens upstream; this screen is the approve-and-apply, and nothing is
// written to a contact until a person presses a button here.
//
// The two lists are the point. "In OMI" is a reply from someone already on the
// contact list -- press mail, in practice -- and can be worked through in a
// batch. "Not in OMI" is everyone else the inbox carries: suppliers,
// accountants, personal mail. Their auto-replies extract exactly as cleanly and
// are worth nothing, so they are listed apart, never pre-ticked, and decided
// one at a time.

const CLASS_STYLE = {
  journalist: { bg: 'var(--warm-soft)', color: 'var(--warm)' },
  client: { bg: '#e8f0ff', color: '#1d4ed8' },
  prospect: { bg: '#f3e8ff', color: '#7c3aed' },
  supplier: { bg: '#eef2f4', color: '#334155' },
  general: { bg: '#eee', color: 'var(--text-muted)' },
  unknown: { bg: '#eee', color: 'var(--text-subtle)' },
};

// Short labels for the gate codes in services/oooExtract.js. A flag is a reason
// to look, not a verdict: each one is shown with its explanation and the row
// can still be ticked.
const FLAG_LABEL = {
  no_email: 'No address',
  invalid_email: 'Incomplete address',
  functional_mailbox: 'Department mailbox',
  unsupported_email: 'Address unevidenced',
  stale: 'Old reply',
  no_new_address: 'No new address',
  name_inferred: 'Name guessed',
  name_unverified: 'Name unmatched',
  possible_departure: 'May have left',
};

const ORIGIN_LABEL = { imap: 'Inbox scan', csv: 'CSV upload', mailflow: 'MailFlow' };

function fmtDate(d) {
  if (!d) return '';
  const t = new Date(d);
  return isNaN(t) ? '' : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const TABS = [
  { key: 'known', label: 'In OMI', status: 'pending' },
  { key: 'unknown', label: 'Not in OMI', status: 'pending' },
  { key: 'applied', label: 'Applied', status: 'applied' },
];

export default function OooReviewPanel() {
  const toast = useToast();
  const [tab, setTab] = useState('known');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);        // suggestion id in flight
  const [batching, setBatching] = useState(false);
  const [altPick, setAltPick] = useState({});    // { [sid]: Set(indexes) }
  const [chosen, setChosen] = useState(new Set()); // suggestion ids ticked for the batch
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState(null);
  const [scanDays, setScanDays] = useState(90);
  const [scanning, setScanning] = useState(false);

  const active = TABS.find((t) => t.key === tab) || TABS[0];

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    const bucket = active.key === 'applied' ? 'all' : active.key;
    api.get(`/outreach/ooo/suggestions?status=${active.status}&bucket=${bucket}`)
      .then((d) => { setData(d); setChosen(new Set()); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [active.key, active.status]);
  useEffect(() => { load(); }, [load]);

  const suggestions = data?.suggestions || [];
  const counts = data?.counts || {};

  // Which alternates are ticked. An entry the importer flagged starts unticked:
  // a department mailbox or an address nothing evidences should take a
  // deliberate press, not an absent-minded one.
  const defaultAlts = useCallback((s) => {
    const alts = s.alt_contacts || [];
    return new Set(alts.map((a, i) => (a.flags?.length ? null : i)).filter((i) => i !== null));
  }, []);
  function picked(s) { return altPick[s.id] || defaultAlts(s); }

  function toggleAlt(s, idx) {
    const cur = picked(s);
    const next = new Set(cur);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    setAltPick((prev) => ({ ...prev, [s.id]: next }));
  }

  // A suggestion is offered for the batch only in the "In OMI" list and only
  // when nothing is flagged and something is actually ticked.
  const batchable = useMemo(() => suggestions.filter((s) => (
    active.key === 'known' && !(s.flags || []).length
      && (s.category === 'left_or_moved' || picked(s).size > 0)
  )), [suggestions, active.key, altPick]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleChosen(id) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function bodyFor(s) {
    return s.category === 'mentions_alt_contact' ? { alt_indexes: Array.from(picked(s)) } : {};
  }

  function drop(id, to) {
    setData((d) => ({
      ...d,
      suggestions: (d.suggestions || []).filter((x) => x.id !== id),
      counts: {
        ...d.counts,
        pending: Math.max(0, (d.counts?.pending || 1) - 1),
        [`pending_${active.key}`]: Math.max(0, (d.counts?.[`pending_${active.key}`] || 1) - 1),
        [to]: (d.counts?.[to] || 0) + 1,
      },
    }));
  }

  async function apply(s) {
    setBusy(s.id);
    try {
      const r = await api.post(`/outreach/ooo/suggestions/${s.id}/apply`, bodyFor(s));
      toast(r.note || 'Applied.', 'success');
      drop(s.id, 'applied');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  }

  async function dismiss(s) {
    setBusy(s.id);
    try {
      await api.post(`/outreach/ooo/suggestions/${s.id}/dismiss`, {});
      drop(s.id, 'dismissed');
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  }

  async function undo(s) {
    setBusy(s.id);
    try {
      const r = await api.post(`/outreach/ooo/suggestions/${s.id}/undo`, {});
      toast(r.note || 'Undone.', 'success');
      setData((d) => ({ ...d, suggestions: (d.suggestions || []).filter((x) => x.id !== s.id) }));
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  }

  // The one "press go once" path. The server never picks the set; only the ids
  // ticked here are sent, because "apply everything pending" is the operation
  // this queue must not offer.
  async function applyChosen() {
    const ids = Array.from(chosen);
    if (!ids.length) return;
    setBatching(true);
    try {
      const r = await api.post('/outreach/ooo/suggestions/apply-batch', { ids });
      toast(r.failed
        ? `Applied ${r.applied}; ${r.failed} failed. ${(r.results || []).filter((x) => !x.ok).map((x) => x.error).join(' ')}`
        : `Applied ${r.applied} change${r.applied === 1 ? '' : 's'}.`,
        r.failed ? 'error' : 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setBatching(false); }
  }

  async function upload() {
    if (!file) return;
    setImporting(true); setReport(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.postForm('/outreach/ooo/import', fd);
      setReport(r);
      toast(`Queued ${r.suggestions_queued} for review. Nothing applied.`, 'success');
      setFile(null);
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setImporting(false); }
  }

  async function scanInbox() {
    setScanning(true); setReport(null);
    try {
      const r = await api.post('/outreach/ooo/backfill', { days: Number(scanDays) || 90 });
      if (r.skipped) { toast(r.skipped, 'error'); return; }
      setReport(r);
      toast(
        `Read ${r.scanned} message${r.scanned === 1 ? '' : 's'}; queued ${r.suggestions_queued}.`
        + (r.recovered ? ` ${r.recovered} recovered from replies an earlier scan misread.` : ''),
        'success'
      );
      load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setScanning(false); }
  }

  const ClassChip = ({ cls }) => {
    const st = CLASS_STYLE[cls] || CLASS_STYLE.unknown;
    return <span className="chip" style={{ background: st.bg, color: st.color, textTransform: 'capitalize' }}>{cls || 'unknown'}</span>;
  };

  const FlagChip = ({ flag }) => (
    <span
      className="chip"
      title={flag.detail}
      style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}
    >
      {FLAG_LABEL[flag.code] || flag.code}
    </span>
  );

  const tabCount = (k) => (k === 'applied' ? counts.applied : counts[`pending_${k}`]) || 0;

  return (
    <div>
      {/* ── Bringing replies in ───────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 'var(--s3)', padding: 'var(--s4)' }}>
        <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-muted)', marginBottom: 'var(--s3)' }}>
          The reply poll reads out-of-office replies as they arrive and queues any contact
          change it finds. Scan further back to catch up on replies already in the inbox,
          or upload a MailFlow export. Neither applies anything.
        </div>
        <div style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
            <label style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>Scan the last</label>
            <input
              type="number" min="1" max="730" value={scanDays}
              onChange={(e) => setScanDays(e.target.value)}
              style={{ width: 70 }}
            />
            <label style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>days</label>
            <button className="btn btn-secondary btn-sm" onClick={scanInbox} disabled={scanning}>
              {scanning ? 'Reading the inbox…' : 'Scan inbox'}
            </button>
          </div>
          <span style={{ color: 'var(--card-border)' }}>|</span>
          <div style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center' }}>
            <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <button className="btn btn-secondary btn-sm" onClick={upload} disabled={!file || importing}>
              {importing ? 'Reading…' : 'Upload export'}
            </button>
          </div>
          <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={load}>Refresh</button>
        </div>

        {report && (
          <div style={{ marginTop: 'var(--s3)', paddingTop: 'var(--s3)', borderTop: 'var(--border-w) solid var(--card-border)', fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>
            {report.rows_read != null && <span>{report.rows_read} rows read · </span>}
            {report.scanned != null && <span>{report.scanned} messages read · {report.auto_replies || 0} auto-replies · </span>}
            <strong>{report.suggestions_queued}</strong> queued for review
            {report.from_known_sender != null && <> · {report.from_known_sender} from a contact in OMI, {report.from_unknown_sender} from someone else</>}
            {/* Recovered from messages an older reader had written off. Shown
                because "N queued" alone cannot tell you a re-read did anything,
                and the whole point of versioning the reader was to find out. */}
            {report.recovered > 0 && (
              <div style={{ marginTop: 'var(--s1)', color: 'var(--text)' }}>
                <strong>{report.recovered}</strong> of those came from auto-replies an earlier scan
                could not read properly. They had been recorded as naming nobody.
              </div>
            )}
            {report.flagged && Object.keys(report.flagged).length > 0 && (
              <div style={{ marginTop: 'var(--s1)' }}>
                Flagged: {Object.entries(report.flagged).map(([k, n]) => `${FLAG_LABEL[k] || k} (${n})`).join(' · ')}
              </div>
            )}
            {report.errors?.length > 0 && (
              <div style={{ marginTop: 'var(--s1)', color: 'var(--negative)' }}>{report.errors.length} row(s) could not be read.</div>
            )}
          </div>
        )}
      </div>

      {/* ── The two lists ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 'var(--s2)', marginBottom: 'var(--s3)', flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`btn btn-sm ${tab === t.key ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setTab(t.key)}
          >
            {t.label} ({tabCount(t.key)})
          </button>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 'var(--s3)', padding: 'var(--s3)', fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>
        {active.key === 'known' && 'Replies from people already on the contact list. Tick the ones you want and apply them together.'}
        {active.key === 'unknown' && 'Replies from senders OMI does not hold — not all of your mail is press. Each one is a separate decision, and none is ticked for you.'}
        {active.key === 'applied' && 'Already applied. Undo restores the exact values that were overwritten; a contact that has since been emailed is left in place and named.'}
      </div>

      {/* ── Batch bar ─────────────────────────────────────────────────────── */}
      {active.key === 'known' && batchable.length > 0 && (
        <div
          className="card"
          style={{ marginBottom: 'var(--s3)', padding: 'var(--s3)', display: 'flex', gap: 'var(--s3)', alignItems: 'center', flexWrap: 'wrap', background: 'var(--positive-soft)' }}
        >
          <label style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={chosen.size === batchable.length && batchable.length > 0}
              onChange={(e) => setChosen(e.target.checked ? new Set(batchable.map((s) => s.id)) : new Set())}
            />
            <span>Select the {batchable.length} unflagged change{batchable.length === 1 ? '' : 's'}</span>
          </label>
          <button
            className="btn btn-primary btn-sm"
            style={{ marginLeft: 'auto' }}
            onClick={applyChosen}
            disabled={!chosen.size || batching}
          >
            {batching ? 'Applying…' : `Apply ${chosen.size} change${chosen.size === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-subtle" style={{ padding: 'var(--s4)' }}>Loading contact updates…</div>
      ) : err ? (
        <div className="card" style={{ padding: 'var(--s4)', color: 'var(--negative)' }}>{err}</div>
      ) : !suggestions.length ? (
        <div className="card" style={{ padding: 'var(--s4)', color: 'var(--text-subtle)' }}>
          {active.key === 'applied'
            ? 'Nothing has been applied yet.'
            : 'Nothing to review here. Scan the inbox above to look further back.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
          {suggestions.map((s) => {
            const p = s.person || {};
            const src = s.source || {};
            const isMoved = s.category === 'left_or_moved';
            const isApplied = s.status === 'applied';
            const alts = s.alt_contacts || [];
            const pick = picked(s);
            const flags = s.flags || [];
            const inBatch = batchable.some((b) => b.id === s.id);

            return (
              <div key={s.id} className="card" style={{ padding: 'var(--s4)' }}>
                <div style={{ display: 'flex', gap: 'var(--s3)', alignItems: 'center', flexWrap: 'wrap', marginBottom: 'var(--s2)' }}>
                  {inBatch && (
                    <input
                      type="checkbox"
                      checked={chosen.has(s.id)}
                      onChange={() => toggleChosen(s.id)}
                      title="Include in the batch"
                    />
                  )}
                  <span className="chip chip-accent">{isMoved ? 'Left / moved' : 'Names someone else'}</span>
                  <ClassChip cls={s.contact_class} />
                  {!s.sender_known && (
                    <span className="chip" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>Sender not in OMI</span>
                  )}
                  {s.origin && (
                    <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>{ORIGIN_LABEL[s.origin] || s.origin}</span>
                  )}
                  {typeof s.confidence === 'number' && (
                    <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>confidence {Math.round(s.confidence * 100)}%</span>
                  )}
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s2)' }}>
                    {isApplied ? (
                      <button className="btn btn-secondary btn-sm" onClick={() => undo(s)} disabled={busy === s.id}>
                        {busy === s.id ? 'Undoing…' : 'Undo'}
                      </button>
                    ) : (
                      <>
                        <button className="btn btn-primary btn-sm" onClick={() => apply(s)} disabled={busy === s.id}>
                          {busy === s.id ? 'Applying…' : (isMoved ? 'Apply change' : `Add ${pick.size || 0}`)}
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => dismiss(s)} disabled={busy === s.id}>Decline</button>
                      </>
                    )}
                  </span>
                </div>

                {flags.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s1)', marginBottom: 'var(--s2)' }}>
                    <div style={{ display: 'flex', gap: 'var(--s1)', flexWrap: 'wrap' }}>
                      {flags.map((f, i) => <FlagChip key={i} flag={f} />)}
                    </div>
                    {flags.map((f, i) => (
                      <div key={i} style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>{f.detail}</div>
                    ))}
                  </div>
                )}

                {isMoved ? (
                  <div style={{ fontSize: 'var(--fs-body)' }}>
                    <div style={{ fontWeight: 600 }}>{p.name || p.current_email || '(unknown)'}</div>
                    <div style={{ color: 'var(--text-muted)', marginTop: 'var(--s1)', display: 'flex', flexWrap: 'wrap', gap: 'var(--s3)' }}>
                      {p.new_email
                        ? <span>email: <span style={{ color: 'var(--text-subtle)' }}>{p.current_email || '—'}</span> → <strong>{p.new_email}</strong></span>
                        : <span style={{ color: 'var(--text-subtle)' }}>email unchanged ({p.current_email || '—'})</span>}
                      {p.new_company && <span>company → <strong>{p.new_company}</strong></span>}
                      {p.role && <span>role → <strong>{p.role}</strong></span>}
                    </div>
                    <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', marginTop: 'var(--s1)' }}>
                      {s.matched_contact_id
                        ? <>Updates <strong>{s.matched_name || s.matched_email}</strong>{s.matched_email ? ` · ${s.matched_email}` : ''}.</>
                        : <>No existing contact matched — applying creates a new library contact.</>}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 'var(--fs-body)' }}>
                    <div style={{ color: 'var(--text-muted)', marginBottom: 'var(--s1)' }}>
                      {isApplied ? 'Contacts added:' : `Add as new contact${alts.length === 1 ? '' : 's'}:`}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
                      {alts.map((a, i) => {
                        // One reply often names five people in a single
                        // sentence, and the extractor gives each of them that
                        // same sentence. Printing it five times buries the
                        // names it is meant to support, so a quote is shown
                        // only the first time it appears on this card.
                        const firstWithQuote = a.quote
                          && alts.findIndex((o) => o.quote === a.quote) === i;
                        return (
                        <div key={i} style={{ display: 'flex', gap: 'var(--s2)', alignItems: 'flex-start' }}>
                          {!isApplied && (
                            <input
                              type="checkbox"
                              checked={pick.has(i)}
                              onChange={() => toggleAlt(s, i)}
                              style={{ marginTop: 3 }}
                            />
                          )}
                          <div>
                            <div>
                              <strong>{a.name || a.email || '(unnamed)'}</strong>
                              {a.email ? ` · ${a.email}` : ''}
                              {a.role ? ` · ${a.role}` : ''}
                              {a.company ? ` · ${a.company}` : ''}
                            </div>
                            {(a.flags || []).length > 0 && (
                              <div style={{ display: 'flex', gap: 'var(--s1)', flexWrap: 'wrap', marginTop: 2 }}>
                                {a.flags.map((f, j) => <FlagChip key={j} flag={f} />)}
                              </div>
                            )}
                            {firstWithQuote && (
                              <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', fontStyle: 'italic', marginTop: 2 }}>
                                “{a.quote}”
                              </div>
                            )}
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {isApplied && s.applied_note && (
                  <div style={{ marginTop: 'var(--s2)', fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>
                    {s.applied_note}
                    {s.applied_by ? ` · ${s.applied_by}` : ''}
                    {s.applied_at ? ` · ${fmtDate(s.applied_at)}` : ''}
                  </div>
                )}

                {(src.subject || src.from_email) && (
                  <div style={{ marginTop: 'var(--s2)', paddingTop: 'var(--s2)', borderTop: 'var(--border-w) solid var(--card-border)', fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>
                    {src.from_email && <div>From {src.from_email}</div>}
                    {src.subject && <div>{src.subject}{src.message_date ? ` · ${fmtDate(src.message_date)}` : ''}</div>}
                    {isMoved && src.quote && <div style={{ fontStyle: 'italic', marginTop: 'var(--s1)' }}>“{src.quote}”</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
