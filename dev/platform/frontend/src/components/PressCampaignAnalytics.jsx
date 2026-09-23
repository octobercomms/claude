import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { csvEscape } from '../utils/csv';

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
  const [supp, setSupp] = useState(null);

  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(qInput.trim()), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  // Warm-config loads once — it doesn't change with search/paging.
  useEffect(() => {
    let alive = true;
    api.get(`/press/clients/${clientId}/warm-config`).then(c => { if (alive) setCfg(c); }).catch(() => {});
    return () => { alive = false; };
  }, [clientId]);

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
  async function saveCfg(next) {
    setCfg(next);
    try { await api.put(`/press/clients/${clientId}/warm-config`, next); }
    catch (e) { toast(e.message, 'error'); }
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
      // Export the whole set (respecting any active search), not just the
      // rows currently loaded on screen.
      const params = new URLSearchParams({ limit: '100000', offset: '0', sort: serverSort });
      if (query) params.set('q', query);
      const full = await api.get(`/press/releases/${release.id}/analytics?${params.toString()}`);
      const src = full.recipients || [];
      const rows = src.map(r => [
        r.name, r.email, r.company, r.opens, r.clicks, r.warm_at ? 'warm' : '',
        r.replied ? 'replied' : '', r.bounced ? 'bounced' : '',
        r.failed_count ? 'failed' : '', r.failed_count ? (r.fail_reason || '') : '',
        (r.clicked_urls || []).join(' | '),
      ]);
      const header = ['Name', 'Email', 'Outlet', 'Opens', 'Clicks', 'Warm', 'Replied', 'Bounced', 'Failed', 'Fail reason', 'Clicked URLs'];
      const csv = [header, ...rows].map(r => r.map(csvEscape).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `press-results-${(release.title || 'campaign').replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.csv`;
      a.click();
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

      {/* Warm threshold */}
      {cfg && (
        <div style={{ display: 'flex', gap: 'var(--s4)', flexWrap: 'wrap', alignItems: 'center', fontSize: 'var(--fs-caption)', color: 'var(--text-muted)' }}>
          <span style={{ fontWeight: 600 }}>“Warm” when</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
            opens ≥
            <input type="number" min="1" value={cfg.min_opens ?? 3} onChange={e => saveCfg({ ...cfg, min_opens: parseInt(e.target.value, 10) || 1 })}
              style={{ width: 48, padding: 'var(--s1) var(--s1)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--s2)' }}>
            <input type="checkbox" checked={cfg.any_click !== false} onChange={e => saveCfg({ ...cfg, any_click: e.target.checked })} />
            or any link click
          </label>
          <span style={{ color: 'var(--text-subtle)' }}>· warm journalists appear on the client’s coverage dashboard automatically.</span>
        </div>
      )}

      {/* Search — jump straight to a journalist to stop their follow-ups. */}
      <div style={{ display: 'flex', gap: 'var(--s3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="search"
          value={qInput}
          onChange={e => setQInput(e.target.value)}
          placeholder="Search name, email or outlet…"
          style={{ flex: 1, minWidth: 220, padding: 'var(--s2) var(--s3)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', fontSize: 'var(--fs-body)' }}
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
