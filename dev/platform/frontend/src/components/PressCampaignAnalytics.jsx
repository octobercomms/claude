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

// Results + the 24/7 watcher view for a press campaign: open/click rates, a
// sortable per-journalist table (repeat-open counts, what they clicked, warm
// flag), the warm threshold, and the suppression lists. Reads
// /press/releases/:id/analytics + /press/clients/:clientId/*.
export default function PressCampaignAnalytics({ clientId, release }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState({ key: 'interest_score', dir: 'desc' });
  const [cfg, setCfg] = useState(null);
  const [supp, setSupp] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, c] = await Promise.all([
        api.get(`/press/releases/${release.id}/analytics`),
        api.get(`/press/clients/${clientId}/warm-config`).catch(() => null),
      ]);
      setData(a); setCfg(c);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }, [release.id, clientId, toast]);
  useEffect(() => { load(); }, [load]);

  const [retrying, setRetrying] = useState(false);
  async function saveCfg(next) {
    setCfg(next);
    try { await api.put(`/press/clients/${clientId}/warm-config`, next); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function retryFailed() {
    const campaignId = data?.campaign_id;
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

  function exportCsv() {
    const rows = (data?.recipients || []).map(r => [
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
  }

  function sortBy(key) {
    setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  }
  // A single ordered rank for the Status column so it sorts sensibly — failed
  // at the top (desc), then unsubscribed, warm, bounced, replied, opened, none.
  const statusRank = (r) => r.failed_count ? 6 : r.unsubscribed_at ? 5 : r.warm_at ? 4 : r.bounced ? 3 : r.replied ? 2 : r.opened ? 1 : 0;

  // Stop the remaining follow-ups to one journalist for THIS campaign only —
  // the move when they reply "not for me". Doesn't unsubscribe them.
  const [stopBusy, setStopBusy] = useState(null);
  async function stopFollowups(r) {
    if (!data?.campaign_id) return;
    if (!window.confirm(`Stop the remaining follow-up emails to ${r.name || r.email} for this campaign? They stay a contact — this only cancels this campaign's follow-ups.`)) return;
    setStopBusy(r.contact_id);
    try {
      const res = await api.post(`/outreach/campaigns/${data.campaign_id}/contacts/${r.contact_id}/stop-followups`, {});
      setData(d => ({ ...d, recipients: (d.recipients || []).map(x => x.contact_id === r.contact_id ? { ...x, followups_stopped: true } : x) }));
      toast(res.cancelled ? `Follow-ups stopped (${res.cancelled} cancelled).` : 'No pending follow-ups — nothing to stop.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setStopBusy(null); }
  }
  async function resumeFollowups(r) {
    if (!data?.campaign_id) return;
    setStopBusy(r.contact_id);
    try {
      await api.post(`/outreach/campaigns/${data.campaign_id}/contacts/${r.contact_id}/resume-followups`, {});
      setData(d => ({ ...d, recipients: (d.recipients || []).map(x => x.contact_id === r.contact_id ? { ...x, followups_stopped: false } : x) }));
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
      setData(d => ({ ...d, recipients: (d.recipients || []).map(x => x.contact_id === r.contact_id ? { ...x, unsubscribed_at: new Date().toISOString() } : x) }));
      toast('Marked unsubscribed — any pending emails to them are cancelled.', 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setUnsubBusy(null); }
  }
  const rows = (data?.recipients || []).map(r => ({ ...r, _status: statusRank(r) })).sort((a, b) => {
    const dir = sort.dir === 'desc' ? -1 : 1;
    const av = a[sort.key] ?? 0, bv = b[sort.key] ?? 0;
    if (typeof av === 'string' || typeof bv === 'string') return String(av).localeCompare(String(bv)) * dir;
    return (av - bv) * dir;
  });

  const t = data?.totals || {};
  const Stat = ({ n, label, sub }) => (
    <div style={{ minWidth: 90 }}>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{n ?? '—'}</div>
      <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 3 }}>{label}{sub != null ? ` · ${sub}%` : ''}</div>
    </div>
  );
  const Th = ({ k, children, right }) => (
    <th onClick={() => sortBy(k)} style={{ cursor: 'pointer', textAlign: right ? 'right' : 'left', padding: '6px 8px', fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' }}>
      {children}{sort.key === k ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  );

  if (loading) return <div className="text-subtle" style={{ padding: 16 }}>Loading results…</div>;

  return (
    <div className="stack" style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'baseline', padding: 14, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', background: 'var(--surface-raised)' }}>
        <Stat n={t.recipients} label="recipients" />
        <Stat n={t.opened} label="opened" sub={t.open_rate} />
        <Stat n={t.clicked} label="clicked" sub={t.click_rate} />
        <Stat n={t.replied} label="replied" sub={t.reply_rate} />
        <div style={{ minWidth: 90 }}>
          <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, color: t.warm ? '#c2410c' : 'var(--text)' }}>{t.warm ?? 0}</div>
          <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 3 }}>🔥 warm</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button className="btn btn-secondary btn-sm" onClick={load}>Refresh</button>
          <button className="btn btn-secondary btn-sm" onClick={exportCsv}>Export CSV</button>
        </div>
      </div>

      {/* Delivery health — the send queue, distinct from engagement above.
          Split into the first-email blast (what "sending status" really means)
          and follow-ups (scheduled for later, conditional on engagement), so a
          10k send doesn't read as "39,604 still going out". Per-step rows spell
          out each email's own progress; a spinner shows when a batch is live. */}
      {(() => {
        const d = data?.delivery;
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
        const Bar = ({ done, total, color }) => (
          <div style={{ flex: 1, height: 6, background: 'var(--accent-soft, #eee)', borderRadius: 999, overflow: 'hidden', minWidth: 60 }}>
            <div style={{ width: `${total ? Math.round((done / total) * 100) : 0}%`, height: '100%', background: color, borderRadius: 999, transition: 'width .3s' }} />
          </div>
        );
        return (
          <div style={{ padding: '12px 14px', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', fontSize: 12 }}>
            {/* Headline: first-email blast */}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                {active && <span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} aria-label="sending" />}
                {active ? 'Sending now' : 'Sending'}
              </span>
              <span style={{ color: 'var(--positive, #15803d)' }}>✓ {num(first.sent)} of {num(firstTotal)} emailed</span>
              {going > 0 && <span style={{ color: 'var(--text-muted)' }}>⧗ {num(going)} still going out{active ? ' (~500/hr)' : ''}</span>}
              {first.failed > 0 && <span style={{ color: 'var(--negative)' }}>✕ {num(first.failed)} failed</span>}
              {first.cancelled > 0 && <span style={{ color: 'var(--text-subtle)' }}>{num(first.cancelled)} skipped (bounced/unsub)</span>}
              {totalFailed > 0 && (
                <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={retryFailed} disabled={retrying}>
                  {retrying ? 'Re-queueing…' : `Retry ${num(totalFailed)} failed`}
                </button>
              )}
            </div>
            {/* Overall first-email progress bar */}
            {firstTotal > 0 && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Bar done={first.sent} total={firstTotal} color="var(--positive, #15803d)" />
                <span style={{ color: 'var(--text-subtle)', minWidth: 34, textAlign: 'right' }}>{pct}%</span>
              </div>
            )}

            {/* Per-step breakdown — "each email send amount" */}
            <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
              {steps.map(s => {
                const done = s.sent;
                const stotal = s.total || (s.sent + s.sending + s.scheduled + s.failed + s.cancelled);
                const spct = stotal ? Math.round((done / stotal) * 100) : 0;
                const label = s.is_first
                  ? `${num(done)} sent`
                  : (s.sent > 0 ? `${num(done)} sent · ${num(s.scheduled + s.sending)} scheduled` : `${num(s.scheduled + s.sending)} scheduled`);
                return (
                  <div key={s.step_number} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 92, flexShrink: 0, color: 'var(--text-muted)' }}>{stepName(s)}</span>
                    <Bar done={done} total={stotal} color={s.is_first ? 'var(--positive, #15803d)' : 'var(--accent, #6366f1)'} />
                    <span style={{ minWidth: 150, textAlign: 'right', color: 'var(--text-subtle)' }}>{label}</span>
                    <span style={{ width: 34, textAlign: 'right', color: 'var(--text-subtle)' }}>{spct}%</span>
                  </div>
                );
              })}
            </div>

            {/* Plain-language explainer for the follow-up rows */}
            {fuPending > 0 && (
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: 'var(--border-w) solid var(--card-border)', color: 'var(--text-subtle)', lineHeight: 1.5 }}>
                📆 The follow-up rows above are <strong>scheduled, not queued to blast</strong> — each goes out on its own day (set by the sequence delay) and only to journalists who’ve opened. Most of these numbers will shrink, never all send at once.
              </div>
            )}
          </div>
        );
      })()}

      {/* Warm threshold */}
      {cfg && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
          <span style={{ fontWeight: 600 }}>“Warm” when</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            opens ≥
            <input type="number" min="1" value={cfg.min_opens ?? 3} onChange={e => saveCfg({ ...cfg, min_opens: parseInt(e.target.value, 10) || 1 })}
              style={{ width: 48, padding: '2px 5px', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={cfg.any_click !== false} onChange={e => saveCfg({ ...cfg, any_click: e.target.checked })} />
            or any link click
          </label>
          <span style={{ color: 'var(--text-subtle)' }}>· warm journalists appear on the client’s coverage dashboard automatically.</span>
        </div>
      )}

      {/* Per-recipient table */}
      <div style={{ overflowX: 'auto', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ borderBottom: 'var(--border-w) solid var(--card-border)' }}>
            <Th k="name">Journalist</Th>
            <Th k="opens" right>Opens</Th>
            <Th k="clicks" right>Clicks</Th>
            <Th k="interest_score" right>Interest</Th>
            <Th k="_status">Status</Th>
          </tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={5} style={{ padding: 14, color: 'var(--text-subtle)' }}>No sends yet — results appear once the campaign goes out.</td></tr>}
            {rows.map(r => (
              <tr key={r.contact_id} style={{ borderTop: 'var(--border-w) solid var(--accent-soft)' }}>
                <td style={{ padding: '6px 8px' }}>
                  <div style={{ fontWeight: 600 }}>{r.name || r.email}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{r.company || ''}{r.company && r.email ? ' · ' : ''}{r.email}</div>
                  {r.clicked_urls?.length ? (
                    <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 2 }}>
                      clicked{' '}
                      {r.clicked_urls.slice(0, 3).map((u, i) => (
                        <React.Fragment key={i}>
                          {i ? <span> · </span> : null}
                          <a href={u} target="_blank" rel="noreferrer" title={u} style={{ color: 'var(--accent)' }}>{linkLabel(u)}</a>
                        </React.Fragment>
                      ))}
                      {r.clicked_urls.length > 3 ? <span> +{r.clicked_urls.length - 3} more</span> : null}
                    </div>
                  ) : null}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: r.opens >= 3 ? 700 : 400 }}>{r.opens || 0}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: r.clicks ? 700 : 400, color: r.clicks ? 'var(--accent)' : 'inherit' }}>{r.clicks || 0}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{r.interest_score || 0}</td>
                <td style={{ padding: '6px 8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {r.unsubscribed_at ? <span className="chip" style={{ background: '#eee', color: 'var(--text-muted)' }}>unsubscribed</span>
                      : r.failed_count ? <span className="chip" style={{ background: '#fde8e8', color: 'var(--negative)' }} title={r.fail_reason || 'The email could not be sent.'}>✕ failed</span>
                      : r.warm_at ? <span className="chip" style={{ background: '#fff2e8', color: '#c2410c' }}>🔥 warm</span>
                      : r.bounced ? <span className="chip" style={{ color: 'var(--negative)' }}>bounced</span>
                      : r.replied ? <span className="chip chip-accent">replied</span>
                      : r.opened ? <span className="chip">opened</span>
                      : <span style={{ color: 'var(--text-subtle)', fontSize: 12 }}>—</span>}
                    {r.followups_stopped ? (
                      <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
                        follow-ups stopped · <button className="btn btn-link btn-sm" title="Put them back in the sequence"
                          onClick={() => resumeFollowups(r)} disabled={stopBusy === r.contact_id}
                          style={{ padding: 0, fontSize: 11, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                          {stopBusy === r.contact_id ? '…' : 'resume'}
                        </button>
                      </span>
                    ) : !r.unsubscribed_at && (
                      <>
                        <button className="btn btn-link btn-sm" title="Stop this campaign's follow-ups to them (keeps them as a contact)"
                          onClick={() => stopFollowups(r)} disabled={stopBusy === r.contact_id}
                          style={{ padding: 0, fontSize: 11, color: 'var(--text-subtle)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                          {stopBusy === r.contact_id ? '…' : 'stop follow-ups'}
                        </button>
                        <button className="btn btn-link btn-sm" title="Mark this journalist unsubscribed (all this client's emails)"
                          onClick={() => unsubscribeContact(r)} disabled={unsubBusy === r.contact_id}
                          style={{ padding: 0, fontSize: 11, color: 'var(--text-subtle)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
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

      {/* Suppression */}
      <div>
        {!supp ? (
          <button className="btn btn-link btn-sm" onClick={loadSuppression}>Show unsubscribes &amp; do-not-contact</button>
        ) : (
          <div>
          <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 6 }}>
            From this campaign’s recipients — anyone who unsubscribed or is do-not-contact/bounced, so they weren’t (or won’t be) delivered.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div className="field-label">Unsubscribed ({supp.unsubscribed.length})</div>
              <div style={{ maxHeight: 180, overflowY: 'auto', fontSize: 12 }}>
                {!supp.unsubscribed.length && <div className="text-subtle">None.</div>}
                {supp.unsubscribed.map(u => <div key={u.id} style={{ padding: '3px 0' }}>{u.name || u.email} <span className="text-subtle">· {u.email}</span></div>)}
              </div>
            </div>
            <div>
              <div className="field-label">Do-not-contact / bounced ({supp.do_not_contact.length})</div>
              <div style={{ maxHeight: 180, overflowY: 'auto', fontSize: 12 }}>
                {!supp.do_not_contact.length && <div className="text-subtle">None.</div>}
                {supp.do_not_contact.map(u => <div key={u.id} style={{ padding: '3px 0' }}>{u.name || u.email} <span className="text-subtle">· {u.email}</span></div>)}
              </div>
            </div>
          </div>
          </div>
        )}
      </div>
    </div>
  );
}
