import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// A tracked click URL → a short, human label (the host, minus www), so a row
// reads "clicked: downloadfor.press · octobercomms.com" instead of a run-on of
// full URLs that looks like one broken link. Falls back to the raw string.
function linkLabel(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); }
  catch { return String(u || '').replace(/^https?:\/\//, '').split('/')[0] || u; }
}

const PAGE = 100;
// The header columns that map to a server-side sort (full-dataset ordering).
// Other columns (clicks, status) can only reorder the rows already loaded.
const SERVER_SORT = { name: 'name', company: 'publication', email: 'email', opens: 'opens', interest_score: 'interest' };

// Results + the 24/7 watcher view for a press campaign: open/click rates, a
// searchable, paginated per-journalist table (repeat-open counts, what they
// clicked, warm flag), the warm threshold, and the suppression lists.
// A 10k-recipient campaign is served in pages — totals come from cheap
// aggregates, the table loads 100 at a time, and search hits the server so you
// can jump straight to one journalist to stop their follow-ups.
export default function PressCampaignAnalytics({ clientId, release }) {
  const toast = useToast();
  const [summary, setSummary] = useState(null);   // totals + delivery + recipient_total
  const [recipients, setRecipients] = useState([]); // accumulated page rows
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [qInput, setQInput] = useState('');
  const [query, setQuery] = useState('');          // debounced search term
  const [serverSort, setServerSort] = useState('interest');
  const [sort, setSort] = useState({ key: 'interest_score', dir: 'desc' });
  const [cfg, setCfg] = useState(null);
  // The rule is edited as a draft, then applied. It used to save on every
  // keystroke, which was harmless when saving did nothing to the existing
  // results — now that applying re-scores the whole client, it has to be
  // deliberate, and it has to show what it will do first.
  const [draft, setDraft] = useState(null);
  const [effect, setEffect] = useState(null);   // { warm_now, warm_after, … }
  const [applying, setApplying] = useState(false);
  const [supp, setSupp] = useState(null);
  // Whether reply polling is actually running. It fails silently when no inbox
  // is connected, which looks identical to "nobody ever unsubscribes by reply".
  const [replyStatus, setReplyStatus] = useState(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasting, setPasting] = useState(false);
  const [pasteResult, setPasteResult] = useState(null);

  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  // Warm-config loads once — it doesn't change with search/paging.
  useEffect(() => {
    let alive = true;
    api.get(`/press/clients/${clientId}/warm-config`).then(c => { if (alive) { setCfg(c); setDraft(c); } }).catch(() => {});
    api.get(`/press/releases/${release.id}/reply-status`).then(r => { if (alive) setReplyStatus(r); }).catch(() => {});
    return () => { alive = false; };
  }, [clientId, release.id]);

  const fetchPage = useCallback(async (offset) => {
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset), sort: serverSort });
    if (query) params.set('q', query);
    return api.get(`/press/releases/${release.id}/analytics?${params.toString()}`);
  }, [release.id, serverSort, query]);

  // (Re)load from the top — runs on mount and whenever search or server sort
  // changes (fetchPage identity depends on both).
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const a = await fetchPage(0);
      setSummary(a);
      setRecipients(a.recipients || []);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [fetchPage, toast]);
  useEffect(() => { load(); }, [load]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const a = await fetchPage(recipients.length);
      setRecipients(prev => [...prev, ...(a.recipients || [])]);
      setSummary(s => ({ ...s, ...a, recipients: undefined })); // keep fresh totals, drop the page copy
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoadingMore(false); }
  }

  // Campaign-level hold on ALL follow-ups (steps 2+). The first email keeps
  // finishing; every follow-up waits until resumed. Nothing is cancelled.
  const [holdBusy, setHoldBusy] = useState(false);
  async function toggleFollowupHold() {
    const campaignId = summary?.campaign_id;
    if (!campaignId) return;
    const paused = summary?.delivery?.followups_paused;
    if (paused && !window.confirm('Resume follow-ups? Each pending follow-up is re-dated to 5 / 10 / 16 days after THAT journalist’s own first email (not the launch date), so nobody gets one too soon. Then they go out on their own schedule.')) return;
    if (!paused && !window.confirm('Hold ALL follow-ups for this campaign? The first email keeps finishing, but no follow-up (step 2+) will go out until you resume. Nothing is cancelled — you can resume any time.')) return;
    setHoldBusy(true);
    try {
      const r = await api.post(`/outreach/campaigns/${campaignId}/${paused ? 'resume-all-followups' : 'pause-followups'}`, {});
      setSummary(s => ({ ...s, delivery: { ...s.delivery, followups_paused: !paused } }));
      toast(paused
        ? `Follow-ups resumed${r?.reanchored ? ` — ${r.reanchored.toLocaleString()} re-dated to each journalist’s own first-email + 5/10/16 days` : ''}.`
        : 'Follow-ups held — no more will go out until you resume.', 'success');
      await load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setHoldBusy(false); }
  }

  const [retrying, setRetrying] = useState(false);
  const ruleChanged = !!cfg && !!draft
    && (Number(draft.min_opens || 0) !== Number(cfg.min_opens || 0)
        || (draft.any_click !== false) !== (cfg.any_click !== false));

  // Ask the server what the proposed rule would do to the journalists already
  // on the list, without writing anything. Debounced: the number box fires per
  // keystroke.
  useEffect(() => {
    if (!draft || !ruleChanged) { setEffect(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      api.post(`/press/clients/${clientId}/warm-config/preview`, draft)
        .then(r => { if (alive) setEffect(r); })
        .catch(() => { if (alive) setEffect(null); });
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [clientId, draft, ruleChanged]);

  async function unsubscribePasted() {
    if (!pasteText.trim()) return;
    setPasting(true); setPasteResult(null);
    try {
      const r = await api.post(`/press/clients/${clientId}/unsubscribe-emails`, { emails: pasteText });
      setPasteResult(r);
      if (r.unsubscribed) { setPasteText(''); await load(); }
      toast(r.unsubscribed
        ? `${r.unsubscribed} unsubscribed for this client. Their queued follow-ups are cancelled.`
        : 'Nobody new — they were already unsubscribed.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setPasting(false); }
  }

  async function applyCfg() {
    if (!draft) return;
    setApplying(true);
    try {
      const r = await api.put(`/press/clients/${clientId}/warm-config`, draft);
      setCfg({ min_opens: r.min_opens ?? 0, any_click: r.any_click !== false });
      setEffect(null);
      toast(r.warmed || r.cooled
        ? `Rule applied: ${r.warmed} warm, ${r.cooled} no longer warm.`
        : 'Rule applied — nobody changed category.', 'success');
      await load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setApplying(false); }
  }
  async function retryFailed() {
    const campaignId = summary?.campaign_id;
    if (!campaignId) return;
    setRetrying(true);
    try {
      const r = await api.post(`/outreach/campaigns/${campaignId}/retry-failed`, {});
      toast(r.requeued ? `Re-queued ${r.requeued} failed send(s) — they'll go out on the next send cycle.` : 'Nothing to retry.', 'success');
      await load();
    } catch (e) { toast(e.message, 'error'); }
    finally { setRetrying(false); }
  }
  async function loadSuppression() {
    try { setSupp(await api.get(`/press/releases/${release.id}/suppression`)); }
    catch (e) { toast(e.message, 'error'); }
  }

  const [exporting, setExporting] = useState(false);
  async function exportCsv() {
    setExporting(true);
    try {
      // The server builds and streams the file, walking every matching
      // recipient. This used to ask /analytics for limit=100000, which clamps
      // to 1,000 to keep the on-screen table cheap: the download looked
      // complete and was missing everyone past row 1,000.
      const params = new URLSearchParams({ sort: serverSort });
      if (query) params.set('q', query);
      const res = await api.raw(`/press/releases/${release.id}/export.csv?${params.toString()}`);
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `press-results-${(release.title || 'campaign').replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.csv`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) { toast(e.message, 'error'); }
    finally { setExporting(false); }
  }

  function sortBy(key) {
    const srv = SERVER_SORT[key];
    if (srv) {
      // Server-sortable column — reorder the whole dataset from the top.
      setServerSort(srv);
      setSort({ key, dir: 'desc' });
    } else {
      // No server equivalent — reorder just the rows already loaded.
      setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
    }
  }
  // A single ordered rank for the Status column so it sorts sensibly — failed
  // at the top (desc), then unsubscribed, warm, bounced, replied, opened, none.
  const statusRank = (r) => r.failed_count ? 6 : r.unsubscribed_at ? 5 : r.warm_at ? 4 : r.bounced ? 3 : r.replied ? 2 : r.opened ? 1 : 0;

  // Stop the remaining follow-ups to one journalist for THIS campaign only —
  // the move when they reply "not for me". Doesn't unsubscribe them.
  const [stopBusy, setStopBusy] = useState(null);
  async function stopFollowups(r) {
    if (!summary?.campaign_id) return;
    if (!window.confirm(`Stop the remaining follow-up emails to ${r.name || r.email} for this campaign? They stay a contact — this only cancels this campaign's follow-ups.`)) return;
    setStopBusy(r.contact_id);
    try {
      const res = await api.post(`/outreach/campaigns/${summary.campaign_id}/contacts/${r.contact_id}/stop-followups`, {});
      setRecipients(prev => prev.map(x => x.contact_id === r.contact_id ? { ...x, followups_stopped: true } : x));
      toast(res.cancelled ? `Follow-ups stopped (${res.cancelled} cancelled).` : 'No pending follow-ups — nothing to stop.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setStopBusy(null); }
  }
  async function resumeFollowups(r) {
    if (!summary?.campaign_id) return;
    setStopBusy(r.contact_id);
    try {
      await api.post(`/outreach/campaigns/${summary.campaign_id}/contacts/${r.contact_id}/resume-followups`, {});
      setRecipients(prev => prev.map(x => x.contact_id === r.contact_id ? { ...x, followups_stopped: false } : x));
      toast('Follow-ups resumed for this journalist.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setStopBusy(null); }
  }
  // Manually mark a journalist unsubscribed for this client (belt-and-braces
  // for opt-outs OMI can't auto-detect). Cancels their pending sends.
  const [unsubBusy, setUnsubBusy] = useState(null); // contact_id in flight
  async function unsubscribeContact(r) {
    if (!window.confirm(`Mark ${r.name || r.email} as unsubscribed? They won’t receive any further emails for this client, and any queued sends to them are cancelled.`)) return;
    setUnsubBusy(r.contact_id);
    try {
      await api.post(`/outreach/clients/${clientId}/contacts/${r.contact_id}/unsubscribe`, {});
      setRecipients(prev => prev.map(x => x.contact_id === r.contact_id ? { ...x, unsubscribed_at: new Date().toISOString() } : x));
      toast('Marked unsubscribed — any pending emails to them are cancelled.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setUnsubBusy(null); }
  }

  // Rows for display. Server-sorted columns keep the order the server (and
  // load-more accumulation) gave; client-only columns reorder what's loaded.
  const isServerKey = !!SERVER_SORT[sort.key];
  const decorated = (recipients || []).map(r => ({ ...r, _status: statusRank(r) }));
  const rows = isServerKey ? decorated : decorated.sort((a, b) => {
    const dir = sort.dir === 'desc' ? -1 : 1;
    const av = a[sort.key] ?? 0, bv = b[sort.key] ?? 0;
    if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * dir;
    return (av - bv) * dir;
  });

  const t = summary?.totals || {};
  const recipientTotal = summary?.recipient_total ?? t.recipients ?? 0;
  const hasMore = recipients.length < recipientTotal;
  const Stat = ({ n, label, sub }) => (
    <div style={{ minWidth: 90 }}>
      <div style={{ fontSize: 'var(--fs-section)', fontWeight: 700, lineHeight: 1 }}>{n ?? '—'}</div>
      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', marginTop: 'var(--s1)' }}>{label}{sub != null ? ` · ${sub}%` : ''}</div>
    </div>
  );
  const Th = ({ k, children, right }) => (
    <th onClick={() => sortBy(k)} style={{ cursor: 'pointer', textAlign: right ? 'right' : 'left', padding: 'var(--s2) var(--s2)', fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' }}>
      {children}{sort.key === k ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  );

  if (loading && !summary) return <div className="text-subtle" style={{ padding: 'var(--s4)' }}>Loading results…</div>;

  return (
    <div className="stack" style={{ marginTop: 'var(--s2)' }}>
      <div style={{ display: 'flex', gap: 'var(--s6)', flexWrap: 'wrap', alignItems: 'baseline', padding: 'var(--s4)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', background: 'var(--surface-raised)' }}>
        <Stat n={t.recipients} label="recipients" />
        <Stat n={t.opened} label="opened" sub={t.open_rate} />
        <Stat n={t.clicked} label="clicked" sub={t.click_rate} />
        <Stat n={t.replied} label="replied" sub={t.reply_rate} />
        <div style={{ minWidth: 90 }}>
          <div style={{ fontSize: 'var(--fs-section)', fontWeight: 700, lineHeight: 1, color: t.warm ? 'var(--warm)' : 'var(--text)' }}>{t.warm ?? 0}</div>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', marginTop: 'var(--s1)' }}>🔥 warm</div>
        </div>
        <div style={{ minWidth: 90 }}>
          <div style={{ fontSize: 'var(--fs-section)', fontWeight: 700, lineHeight: 1 }}>{t.unsubscribed ?? 0}</div>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', marginTop: 'var(--s1)' }}>
            unsubscribed{t.unsub_rate != null ? ` · ${t.unsub_rate}%` : ''}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s2)' }}>
          <button className="btn btn-secondary btn-sm" onClick={load}>Refresh</button>
          <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={exporting}>{exporting ? 'Exporting…' : 'Export CSV'}</button>
        </div>
      </div>

      {/* Delivery health — the send queue, distinct from engagement above.
          Split into the first-email blast (what "sending status" really means)
          and follow-ups (scheduled for later, conditional on engagement), so a
          10k send doesn't read as "39,604 still going out". Per-step rows spell
          out each email's own progress; a spinner shows when a batch is live. */}
      {(() => {
        const d = summary?.delivery;
        if (!d) return null;
        const first = d.first || { sent: d.sent || 0, sending: d.in_flight || 0, scheduled: 0, failed: d.failed || 0, cancelled: d.cancelled || 0, total: 0 };
        const fu = d.followups || { sent: 0, sending: 0, scheduled: 0, failed: 0, cancelled: 0, total: 0 };
        const firstTotal = first.total || (first.sent + first.sending + first.scheduled + first.failed + first.cancelled);
        const totalFailed = (first.failed || 0) + (fu.failed || 0);
        if (firstTotal + (fu.total || 0) === 0) return null;
        const num = (n) => (n || 0).toLocaleString();
        const pct = firstTotal ? Math.round((first.sent / firstTotal) * 100) : 0;
        const going = (first.sending || 0) + (first.scheduled || 0);
        const fuPending = (fu.sending || 0) + (fu.scheduled || 0);
        const active = d.active_sending;
        // Per-step rows. Fall back to a synthesised first-email row if the
        // backend didn't send the breakdown (older API).
        const steps = (d.steps && d.steps.length) ? d.steps
          : [{ step_number: 1, is_first: true, ...first, total: firstTotal }];
        const stepName = (s) => s.is_first ? 'First email' : `Follow-up ${s.step_number - 1}`;
        const fmtDate = (d) => { try { return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch { return ''; } };
        // Plain-English timing for a step: what its configured delay is and when
        // it actually sends — so "why has Follow-up 1 already sent?" is answerable
        // at a glance (and a wrongly-early send is obvious).
        const timing = (s) => {
          const bits = [];
          if (s.delay_days != null) bits.push(s.is_first ? 'goes out immediately' : `set to send ${s.delay_days} day${s.delay_days === 1 ? '' : 's'} after launch`);
          if (s.first_sent_at) bits.push(`started sending ${fmtDate(s.first_sent_at)}`);
          else if (s.next_scheduled_at) bits.push(`next goes out ${fmtDate(s.next_scheduled_at)}`);
          return bits.join(' · ');
        };
        const Bar = ({ done, total, color }) => (
          <div style={{ flex: 1, height: 6, background: 'var(--accent-soft, #eee)', borderRadius: 'var(--r-pill)', overflow: 'hidden', minWidth: 60 }}>
            <div style={{ width: `${total ? Math.round((done / total) * 100) : 0}%`, height: '100%', background: color, borderRadius: 'var(--r-pill)', transition: 'width .3s' }} />
          </div>
        );
        const fmtDT = (d) => { try { return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };
        return (
          <div style={{ padding: 'var(--s3) var(--s4)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-caption)' }}>
            {/* Campaign timeline — authoritative created / launched / first-send
                dates, so "when did this actually start?" is unambiguous. */}
            {(d.launched_at || d.created_at || d.first_sent_at) && (
              <div style={{ marginBottom: 'var(--s3)', paddingBottom: 'var(--s2)', borderBottom: 'var(--border-w) solid var(--card-border)', color: 'var(--text-subtle)', display: 'flex', gap: 'var(--s4)', flexWrap: 'wrap' }}>
                {d.created_at && <span title="When you first built this campaign (before any send)."><strong style={{ color: 'var(--text-muted)' }}>Created</strong> {fmtDT(d.created_at)}</span>}
                {d.launched_at && <span title="When the campaign was first switched on to send. Follow-up delays used to count from here — now they count from each journalist's own first email instead."><strong style={{ color: 'var(--text-muted)' }}>First activated</strong> {fmtDT(d.launched_at)}</span>}
                {d.first_sent_at && <span title="The earliest email that actually went out — often an initial small batch, before the full send."><strong style={{ color: 'var(--text-muted)' }}>First email out</strong> {fmtDT(d.first_sent_at)}</span>}
              </div>
            )}
            {/* Headline: first-email blast */}
            <div style={{ display: 'flex', gap: 'var(--s4)', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 'var(--s2)' }}>
                {active && <span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} aria-label="sending" />}
                {active ? 'Sending now' : 'Sending'}
              </span>
              <span style={{ color: 'var(--positive, #15803d)' }}>✓ {num(first.sent)} of {num(firstTotal)} emailed</span>
              {going > 0 && <span style={{ color: 'var(--text-muted)' }}>⧗ {num(going)} still going out{active ? ' (~2,000/hr)' : ''}</span>}
              {first.failed > 0 && <span style={{ color: 'var(--negative)' }}>✕ {num(first.failed)} failed</span>}
              {first.cancelled > 0 && <span style={{ color: 'var(--text-subtle)' }}>{num(first.cancelled)} skipped (bounced/unsub)</span>}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s2)' }}>
                {(fuPending > 0 || fu.sent > 0 || d.followups_paused) && (
                  <button className="btn btn-secondary btn-sm" onClick={toggleFollowupHold} disabled={holdBusy}
                    title={d.followups_paused ? 'Let follow-ups start going out again' : 'Stop every follow-up (steps 2+) going out — the first email still finishes'}>
                    {holdBusy ? '…' : d.followups_paused ? '▶ Resume follow-ups' : '⏸ Hold follow-ups'}
                  </button>
                )}
                {totalFailed > 0 && (
                  <button className="btn btn-primary btn-sm" onClick={retryFailed} disabled={retrying}>
                    {retrying ? 'Re-queueing…' : `Retry ${num(totalFailed)} failed`}
                  </button>
                )}
              </div>
            </div>
            {d.followups_paused && (
              <div style={{ marginTop: 'var(--s2)', padding: 'var(--s2) var(--s3)', borderRadius: 'var(--r-sm)', background: 'var(--warm-soft)', color: 'var(--warm)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
                ⏸ Follow-ups are on hold — no step-2+ emails will go out until you resume. The first email still finishes.
              </div>
            )}
            {/* Overall first-email progress bar */}
            {firstTotal > 0 && (
              <div style={{ marginTop: 'var(--s2)', display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
                <Bar done={first.sent} total={firstTotal} color="var(--positive, #15803d)" />
                <span style={{ color: 'var(--text-subtle)', minWidth: 34, textAlign: 'right' }}>{pct}%</span>
              </div>
            )}

            {/* Per-step breakdown — "each email send amount" */}
            <div style={{ marginTop: 'var(--s3)', display: 'grid', gap: 'var(--s2)' }}>
              {steps.map(s => {
                const done = s.sent;
                const stotal = s.total || (s.sent + s.sending + s.scheduled + s.failed + s.cancelled);
                const spct = stotal ? Math.round((done / stotal) * 100) : 0;
                const label = s.is_first
                  ? `${num(done)} sent`
                  : (s.sent > 0 ? `${num(done)} sent · ${num(s.scheduled + s.sending)} scheduled` : `${num(s.scheduled + s.sending)} scheduled`);
                const tinfo = timing(s);
                return (
                  <div key={s.step_number}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
                      <span style={{ width: 92, flexShrink: 0, color: 'var(--text-muted)' }}>{stepName(s)}</span>
                      <Bar done={done} total={stotal} color={s.is_first ? 'var(--positive, #15803d)' : 'var(--accent, #6366f1)'} />
                      <span style={{ minWidth: 150, textAlign: 'right', color: 'var(--text-subtle)' }}>{label}</span>
                      <span style={{ width: 34, textAlign: 'right', color: 'var(--text-subtle)' }}>{spct}%</span>
                    </div>
                    {tinfo && (
                      <div style={{ marginLeft: 'var(--s10)', marginTop: 'var(--s1)', fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>{tinfo}</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Plain-language explainer for the follow-up rows */}
            {(fuPending > 0 || fu.sent > 0) && (
              <div style={{ marginTop: 'var(--s3)', paddingTop: 'var(--s2)', borderTop: 'var(--border-w) solid var(--card-border)', color: 'var(--text-subtle)', lineHeight: 1.5 }}>
                📆 Follow-ups go to <strong>every journalist</strong> — it often takes a few emails to land — each on its own day (set by the sequence delay), <strong>not</strong> all at once. They’re skipped only for anyone who’s been marked <em>stop</em>, unsubscribed, bounced, or already replied, so these counts shrink as people drop out.
              </div>
            )}
          </div>
        );
      })()}

      {/* Opt-outs. Two routes in: the one-click link in every email, and a
          reply that asks to be removed — which only works if OMI can read the
          inbox those replies land in. When it cannot, say so here rather than
          leaving it to look like nobody ever asks. */}
      {replyStatus && (
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>
          {!replyStatus.configured ? (
            <div style={{ padding: 'var(--s3)', border: 'var(--border-w) solid var(--warn, #b8860b)', borderRadius: 'var(--r-sm)' }}>
              <strong>Reply polling is off.</strong> No inbox is connected, so a journalist who replies
              “unsubscribe” is never taken off the list automatically — you have to do it by hand.
              Connect the mailbox journalists reply to in Settings → Outreach (IMAP host, user, app password).
              {replyStatus.reply_to ? <> This campaign’s reply-to is <strong>{replyStatus.reply_to}</strong>, so that is the inbox to connect.</> : null}
            </div>
          ) : replyStatus.inbox_matches_reply_to === false ? (
            <div style={{ padding: 'var(--s3)', border: 'var(--border-w) solid var(--warn, #b8860b)', borderRadius: 'var(--r-sm)' }}>
              <strong>Replies are landing somewhere OMI cannot see.</strong> It polls{' '}
              <strong>{replyStatus.inbox}</strong>, but this campaign tells journalists to reply to{' '}
              <strong>{replyStatus.reply_to}</strong>. Unsubscribe replies to that address are not picked up.
            </div>
          ) : (
            <div>
              Reply polling is on ({replyStatus.inbox}), every 15 minutes.
              {replyStatus.last_ok_at ? ` Last checked ${new Date(replyStatus.last_ok_at).toLocaleString('en-GB')}.` : ' Not run yet.'}
              {replyStatus.last_match_at ? ` Last matched a reply ${new Date(replyStatus.last_match_at).toLocaleString('en-GB')}.` : ''}
              {replyStatus.last_error ? ` Last error: ${replyStatus.last_error}` : ''}
            </div>
          )}
          <button className="btn btn-link btn-sm" style={{ paddingLeft: 0 }} onClick={() => setPasteOpen(o => !o)}>
            {pasteOpen ? '✕ close' : '＋ Unsubscribe people by email'}
          </button>
          {pasteOpen && (
            <div style={{ padding: 'var(--s3)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
              <div style={{ marginBottom: 'var(--s2)' }}>
                Paste the addresses of anyone who asked to come off, however they asked. Names, angle brackets,
                commas and line breaks are all fine — paste straight from Gmail. They are unsubscribed for this
                client only, and anything still queued for them is cancelled.
              </div>
              <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={5} className="input"
                placeholder={'Jane Smith <jane@outlet.com>\nsam@another.co.uk'}
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' }} />
              <div className="row" style={{ gap: 'var(--s2)', marginTop: 'var(--s2)', alignItems: 'center' }}>
                <button className="btn btn-primary btn-sm" onClick={unsubscribePasted} disabled={pasting || !pasteText.trim()}>
                  {pasting ? 'Unsubscribing…' : 'Unsubscribe them'}
                </button>
                {pasteResult && (
                  <span>
                    {pasteResult.unsubscribed} unsubscribed
                    {pasteResult.already ? `, ${pasteResult.already} already were` : ''}
                    {pasteResult.unknown?.length ? `, ${pasteResult.unknown.length} not in the list: ${pasteResult.unknown.slice(0, 5).join(', ')}` : ''}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Warm threshold. 0 opens is a real setting, not an empty box: it means
          opens never warm anyone on their own. The control used to render it as
          "opens ≥ 0", which reads as "everyone qualifies", and a min of 1 meant
          it could never be set back. */}
      {draft && (
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>
          <div style={{ display: 'flex', gap: 'var(--s4)', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontWeight: 600 }}>“Warm” when</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
              opens ≥
              <input type="number" min="0" value={draft.min_opens ?? 0}
                onChange={e => setDraft(d => ({ ...d, min_opens: e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                className="input" style={{ width: 48 }} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
              <input type="checkbox" checked={draft.any_click !== false}
                onChange={e => setDraft(d => ({ ...d, any_click: e.target.checked }))} />
              or any link click
            </label>
            {ruleChanged && (
              <button className="btn btn-primary btn-sm" onClick={applyCfg} disabled={applying}>
                {applying ? 'Re-scoring…' : 'Apply to this client'}
              </button>
            )}
            {ruleChanged && (
              <button className="btn btn-link btn-sm" onClick={() => { setDraft(cfg); setEffect(null); }}>cancel</button>
            )}
          </div>
          <div style={{ marginTop: 'var(--s2)', color: 'var(--text-subtle)' }}>
            {Number(draft.min_opens || 0) === 0
              ? 'Opens are ignored — only a link click warms a journalist. Apple Mail and Gmail pre-fetch tracking pixels without anyone reading, so an opens threshold is a bar machines clear on their own.'
              : `${draft.min_opens} opens or more will warm a journalist on their own. Watch for false positives: image proxies fetch the tracking pixel repeatedly without a human involved.`}
            {' '}The rule is shared by every release for this client.
          </div>
          {effect && (
            <div style={{ marginTop: 'var(--s2)', padding: 'var(--s2)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
              Applying this would take <strong>{effect.warm_now.toLocaleString()}</strong> warm to{' '}
              <strong>{effect.warm_after.toLocaleString()}</strong>
              {effect.newly_warm ? ` · ${effect.newly_warm.toLocaleString()} added` : ''}
              {effect.no_longer_warm ? ` · ${effect.no_longer_warm.toLocaleString()} removed` : ''}
              {'. '}Nobody is emailed about the change.
            </div>
          )}
          <div style={{ marginTop: 'var(--s1)', color: 'var(--text-subtle)' }}>
            Warm journalists appear on the client’s coverage dashboard automatically.
          </div>
        </div>
      )}

      {/* Search — jump straight to a journalist to stop their follow-ups. */}
      <div style={{ display: 'flex', gap: 'var(--s3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="search"
          value={qInput}
          onChange={e => setQInput(e.target.value)}
          placeholder="Search name, email or outlet…"
          className="input" style={{ flex: 1, minWidth: 220 }}
        />
        {qInput && <button className="btn btn-link btn-sm" onClick={() => setQInput('')}>Clear</button>}
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', whiteSpace: 'nowrap' }}>
          {loading ? 'Searching…' : `Showing ${rows.length.toLocaleString()} of ${recipientTotal.toLocaleString()}${query ? ' matching' : ''}`}
        </span>
      </div>

      {/* Per-recipient table */}
      <div style={{ overflowX: 'auto', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-body)' }}>
          <thead><tr style={{ borderBottom: 'var(--border-w) solid var(--card-border)' }}>
            <Th k="name">Journalist</Th>
            <Th k="company">Publication</Th>
            <Th k="email">Email</Th>
            <Th k="opens" right>Opens</Th>
            <Th k="clicks">Clicked</Th>
            <Th k="interest_score" right>Interest</Th>
            <Th k="_status">Status</Th>
          </tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={7} style={{ padding: 'var(--s4)', color: 'var(--text-subtle)' }}>{query ? 'No journalists match that search.' : 'No sends yet — results appear once the campaign goes out.'}</td></tr>}
            {rows.map(r => (
              <tr key={r.contact_id} style={{ borderTop: 'var(--border-w) solid var(--accent-soft)' }}>
                <td style={{ padding: 'var(--s2) var(--s2)', fontWeight: 600 }}>{r.name || <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>—</span>}</td>
                <td style={{ padding: 'var(--s2) var(--s2)' }}>{r.company || <span style={{ color: 'var(--text-subtle)' }}>—</span>}</td>
                <td style={{ padding: 'var(--s2) var(--s2)', color: 'var(--text-muted)' }}>{r.email}</td>
                <td style={{ padding: 'var(--s2) var(--s2)', textAlign: 'right', fontWeight: r.opens >= 3 ? 700 : 400 }}>{r.opens || 0}</td>
                <td style={{ padding: 'var(--s2) var(--s2)' }}>
                  {r.clicks ? (
                    <div>
                      <span style={{ fontWeight: 700 }}>{r.clicks}</span>
                      {r.clicked_urls?.length ? (
                        <div style={{ fontSize: 'var(--fs-caption)', marginTop: 'var(--s1)' }}>
                          {r.clicked_urls.slice(0, 3).map((u, i) => (
                            <React.Fragment key={i}>
                              {i ? <span style={{ color: 'var(--text-subtle)' }}> · </span> : null}
                              <a href={u} target="_blank" rel="noreferrer" title={u} style={{ color: 'var(--text)', textDecoration: 'underline' }}>{linkLabel(u)}</a>
                            </React.Fragment>
                          ))}
                          {r.clicked_urls.length > 3 ? <span style={{ color: 'var(--text-subtle)' }}> +{r.clicked_urls.length - 3} more</span> : null}
                        </div>
                      ) : null}
                    </div>
                  ) : <span style={{ color: 'var(--text-subtle)' }}>0</span>}
                </td>
                <td style={{ padding: 'var(--s2) var(--s2)', textAlign: 'right' }}>{r.interest_score || 0}</td>
                <td style={{ padding: 'var(--s2) var(--s2)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
                    {r.unsubscribed_at ? <span className="chip" style={{ background: '#eee', color: 'var(--text-muted)' }}>unsubscribed</span>
                      : r.failed_count ? <span className="chip" style={{ background: '#fde8e8', color: 'var(--negative)' }} title={r.fail_reason || 'The email could not be sent.'}>✕ failed</span>
                      : r.warm_at ? <span className="chip chip-warm">🔥 warm</span>
                      : r.bounced ? <span className="chip" style={{ color: 'var(--negative)' }}>bounced</span>
                      : r.replied ? <span className="chip chip-accent">replied</span>
                      : r.opened ? <span className="chip">opened</span>
                      : <span style={{ color: 'var(--text-subtle)', fontSize: 'var(--fs-caption)' }}>—</span>}
                    {r.followups_stopped ? (
                      <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>
                        follow-ups stopped · <button className="btn btn-link btn-sm" title="Put them back in the sequence"
                          onClick={() => resumeFollowups(r)} disabled={stopBusy === r.contact_id}
                          style={{ padding: 0, fontSize: 'var(--fs-caption)', color: 'var(--text)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                          {stopBusy === r.contact_id ? '…' : 'resume'}
                        </button>
                      </span>
                    ) : !r.unsubscribed_at && (
                      <>
                        <button className="btn btn-link btn-sm" title="Stop this campaign's follow-ups to them (keeps them as a contact)"
                          onClick={() => stopFollowups(r)} disabled={stopBusy === r.contact_id}
                          style={{ padding: 0, fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                          {stopBusy === r.contact_id ? '…' : 'stop follow-ups'}
                        </button>
                        <button className="btn btn-link btn-sm" title="Mark this journalist unsubscribed (all this client's emails)"
                          onClick={() => unsubscribeContact(r)} disabled={unsubBusy === r.contact_id}
                          style={{ padding: 0, fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                          {unsubBusy === r.contact_id ? '…' : 'unsubscribe'}
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {hasMore && (
        <div style={{ textAlign: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : `Load more (${(recipientTotal - recipients.length).toLocaleString()} left)`}
          </button>
        </div>
      )}

      {/* Suppression */}
      <div>
        {!supp ? (
          <button className="btn btn-link btn-sm" onClick={loadSuppression}>Show unsubscribes &amp; do-not-contact</button>
        ) : (
          <div>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', marginBottom: 'var(--s2)' }}>
            From this campaign’s recipients — anyone who unsubscribed or is do-not-contact/bounced, so they weren’t (or won’t be) delivered.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s3)' }}>
            <div>
              <div className="field-label">Unsubscribed ({supp.unsubscribed.length})</div>
              <div style={{ maxHeight: 180, overflowY: 'auto', fontSize: 'var(--fs-caption)' }}>
                {!supp.unsubscribed.length && <div className="text-subtle">None.</div>}
                {supp.unsubscribed.map(u => <div key={u.id} style={{ padding: 'var(--s1) 0' }}>{u.name || u.email} <span className="text-subtle">· {u.email}</span></div>)}
              </div>
            </div>
            <div>
              <div className="field-label">Do-not-contact / bounced ({supp.do_not_contact.length})</div>
              <div style={{ maxHeight: 180, overflowY: 'auto', fontSize: 'var(--fs-caption)' }}>
                {!supp.do_not_contact.length && <div className="text-subtle">None.</div>}
                {supp.do_not_contact.map(u => <div key={u.id} style={{ padding: 'var(--s1) 0' }}>{u.name || u.email} <span className="text-subtle">· {u.email}</span></div>)}
              </div>
            </div>
          </div>
          </div>
        )}
      </div>
    </div>
  );
}
