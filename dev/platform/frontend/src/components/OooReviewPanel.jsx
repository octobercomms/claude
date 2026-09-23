import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Review queue for MailFlow out-of-office contact-change suggestions. MailFlow
// detects/extracts the change; OMI (here) is the approve-and-apply. Each card is
// one lasting change — a sender who left/moved, or an alternate contact they
// named — that a person approves before anything is written to a contact.

const CLASS_STYLE = {
  journalist: { bg: '#fff2e8', color: '#c2410c' },
  client: { bg: '#e8f0ff', color: '#1d4ed8' },
  prospect: { bg: '#f3e8ff', color: '#7c3aed' },
  supplier: { bg: '#eef2f4', color: '#334155' },
  general: { bg: '#eee', color: 'var(--text-muted)' },
  unknown: { bg: '#eee', color: 'var(--text-subtle)' },
};

function fmtDate(d) {
  if (!d) return '';
  const t = new Date(d);
  return isNaN(t) ? '' : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function OooReviewPanel() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null); // suggestion id in flight
  const [altPick, setAltPick] = useState({}); // { [suggestionId]: Set(indexes) }

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    api.get('/outreach/ooo/suggestions?status=pending')
      .then(setData)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const suggestions = data?.suggestions || [];
  const counts = data?.counts || {};

  function toggleAlt(sid, idx, altLen) {
    setAltPick((prev) => {
      const cur = prev[sid] || new Set(Array.from({ length: altLen }, (_, i) => i)); // default all
      const next = new Set(cur);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return { ...prev, [sid]: next };
    });
  }

  async function apply(s) {
    setBusy(s.id);
    try {
      const body = s.category === 'mentions_alt_contact'
        ? { alt_indexes: Array.from(altPick[s.id] || new Set((s.alt_contacts || []).map((_, i) => i))) }
        : {};
      const r = await api.post(`/outreach/ooo/suggestions/${s.id}/apply`, body);
      toast(r.note || 'Applied.', 'success');
      setData((d) => ({ ...d, suggestions: (d.suggestions || []).filter((x) => x.id !== s.id), counts: { ...d.counts, pending: Math.max(0, (d.counts?.pending || 1) - 1), applied: (d.counts?.applied || 0) + 1 } }));
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  }
  async function dismiss(s) {
    setBusy(s.id);
    try {
      await api.post(`/outreach/ooo/suggestions/${s.id}/dismiss`, {});
      setData((d) => ({ ...d, suggestions: (d.suggestions || []).filter((x) => x.id !== s.id), counts: { ...d.counts, pending: Math.max(0, (d.counts?.pending || 1) - 1), dismissed: (d.counts?.dismissed || 0) + 1 } }));
    } catch (e) { toast(e.message, 'error'); }
    finally { setBusy(null); }
  }

  const ClassChip = ({ cls }) => {
    const st = CLASS_STYLE[cls] || CLASS_STYLE.unknown;
    return <span className="chip" style={{ background: st.bg, color: st.color, textTransform: 'capitalize' }}>{cls || 'unknown'}</span>;
  };

  if (loading) return <div className="text-subtle" style={{ padding: 16 }}>Loading contact updates…</div>;

  return (
    <div>
      <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 'var(--fs-body)', color: 'var(--text-muted)', flex: 1, minWidth: 240 }}>
          {err ? <span style={{ color: 'var(--negative)' }}>{err}</span>
            : suggestions.length
              ? `${suggestions.length} contact change${suggestions.length === 1 ? '' : 's'} to review — from out-of-office replies MailFlow spotted. Nothing is applied until you approve it.`
              : 'No contact updates to review. When a journalist’s auto-reply says they’ve moved or named someone else, it’ll appear here.'}
        </div>
        {(counts.applied || counts.dismissed) ? (
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>{counts.applied || 0} applied · {counts.dismissed || 0} dismissed</span>
        ) : null}
        <button className="btn btn-secondary btn-sm" onClick={load}>Refresh</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {suggestions.map((s) => {
          const p = s.person || {};
          const src = s.source || {};
          const isMoved = s.category === 'left_or_moved';
          const picked = altPick[s.id] || new Set((s.alt_contacts || []).map((_, i) => i));
          return (
            <div key={s.id} className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                <span className="chip chip-accent">{isMoved ? 'Left / moved' : 'Names an alternate contact'}</span>
                <ClassChip cls={s.contact_class} />
                {typeof s.confidence === 'number' && (
                  <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>confidence {Math.round(s.confidence * 100)}%</span>
                )}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => apply(s)} disabled={busy === s.id}>
                    {busy === s.id ? 'Applying…' : (isMoved ? 'Apply change' : 'Add selected')}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => dismiss(s)} disabled={busy === s.id}>Dismiss</button>
                </span>
              </div>

              {isMoved ? (
                <div style={{ fontSize: 'var(--fs-body)' }}>
                  <div style={{ fontWeight: 600 }}>{p.name || p.current_email || '(unknown)'}</div>
                  <div style={{ color: 'var(--text-muted)', marginTop: 3, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    {p.new_email && <span>email: <span style={{ color: 'var(--text-subtle)' }}>{p.current_email || '—'}</span> → <strong>{p.new_email}</strong></span>}
                    {p.new_company && <span>company → <strong>{p.new_company}</strong></span>}
                    {p.role && <span>role → <strong>{p.role}</strong></span>}
                  </div>
                  <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)', marginTop: 5 }}>
                    {s.matched_contact_id
                      ? <>Matches <strong>{s.matched_name || s.matched_email}</strong>{s.matched_email ? ` · ${s.matched_email}` : ''} — applying updates that record.</>
                      : <>No existing contact matched — applying will create a new library contact.</>}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 'var(--fs-body)' }}>
                  <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>Add as new contact{(s.alt_contacts || []).length === 1 ? '' : 's'}:</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {(s.alt_contacts || []).map((a, i) => (
                      <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input type="checkbox" checked={picked.has(i)} onChange={() => toggleAlt(s.id, i, (s.alt_contacts || []).length)} />
                        <span><strong>{a.name || a.email || '(unnamed)'}</strong>{a.email ? ` · ${a.email}` : ''}{a.role ? ` · ${a.role}` : ''}{a.company ? ` · ${a.company}` : ''}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {(src.subject || src.quote) && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: 'var(--border-w) solid var(--card-border)', fontSize: 'var(--fs-caption)', color: 'var(--text-subtle)' }}>
                  {src.subject && <div>{src.subject}{src.message_date ? ` · ${fmtDate(src.message_date)}` : ''}</div>}
                  {src.quote && <div style={{ fontStyle: 'italic', marginTop: 2 }}>“{src.quote}”</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
