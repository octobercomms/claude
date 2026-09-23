import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

// Public manage page behind the link in the Google Calendar invite
// (/b/:token). Move or cancel a book-a-call booking. No login.
const CSS = `
.bm{--y:#e7cd41;--ink:#fff;--mut:#b4b4b4;--line:rgba(255,255,255,.24);background:#0d0d0d;color:var(--ink);min-height:100vh;font-family:'Brockmann',-apple-system,'Segoe UI',sans-serif;text-transform:lowercase;line-height:1.5}
.bm .wrap{max-width:720px;margin:0 auto;padding:48px 20px}
.bm h1{font-size:clamp(32px,6vw,48px);font-weight:800;letter-spacing:-.02em;line-height:1.05;margin:0}
.bm .when{border-left:3px solid var(--y);padding-left:12px;margin:22px 0;font-size:18px;font-weight:700}
.bm .mut{color:var(--mut)}
.bm .btn{display:inline-block;background:var(--y);color:#111;border:0;border-radius:100px;padding:13px 24px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;text-decoration:none;text-transform:lowercase;margin:6px 10px 6px 0}
.bm .btn.ghost{background:transparent;color:var(--ink);border:2px solid var(--ink)}
.bm .btn:disabled{opacity:.5}
.bm .lab{font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--mut);margin:22px 0 8px}
.bm .days{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px}
.bm .day,.bm .t{border:2px solid var(--line);background:transparent;color:var(--ink);padding:10px 12px;cursor:pointer;font-family:inherit;font-weight:700;font-size:14px;text-transform:lowercase}
.bm .day{flex:0 0 auto;min-width:74px}
.bm .on,.bm .t:hover{border-color:var(--y);color:var(--y)}
.bm .times{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px}
.bm textarea{width:100%;background:transparent;border:0;border-bottom:1.5px solid var(--line);color:var(--ink);font:inherit;padding:8px 2px;margin:10px 0}
.bm .err{color:#ff7a66;font-weight:700;margin-top:12px}
`;

const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London'; } catch { return 'Europe/London'; } })();
const fmt = (iso, o) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...o }).format(new Date(iso));
const dayKey = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const whenText = (iso) => `${fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' })}, ${fmt(iso, { hour: '2-digit', minute: '2-digit' })}`;

export default function BookingManagePage() {
  const { token } = useParams();
  const base = `/api/public/booking/manage/${encodeURIComponent(token)}`;
  const [b, setB] = useState(undefined);
  const [mode, setMode] = useState(null);     // 'move' | 'cancel'
  const [slots, setSlots] = useState(null);
  const [day, setDay] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    document.title = 'Your call with October';
    fetch(base).then(r => (r.ok ? r.json() : null)).then(setB).catch(() => setB(null));
  }, [base]);

  async function post(path, body) {
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${base}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Something went wrong.');
      setB(j); setMode(null);
    } catch (e) { setErr(e.message); if (path === 'move') loadSlots(); } finally { setBusy(false); }
  }
  function loadSlots() {
    fetch('/api/public/booking/slots').then(r => r.json()).then(j => setSlots(j.slots || [])).catch(() => setSlots([]));
  }

  if (b === undefined) return <Shell><p className="mut">loading…</p></Shell>;
  if (b === null) return <Shell><h1>booking not found</h1><p className="mut" style={{ marginTop: 12 }}>Email hello@octobercomms.com and we will sort it.</p></Shell>;

  const groups = {};
  (slots || []).forEach(s => { (groups[dayKey(s)] = groups[dayKey(s)] || []).push(s); });
  const days = Object.keys(groups);
  const activeDay = day && groups[day] ? day : days[0];

  return (
    <Shell>
      <h1>{b.status === 'cancelled' ? 'call cancelled' : 'your call with october'}</h1>
      <div className="when" style={b.status === 'cancelled' ? { textDecoration: 'line-through', opacity: 0.6 } : null}>{whenText(b.start)}</div>
      <p className="mut">times shown in {TZ.replace(/_/g, ' ')}</p>
      {b.status === 'confirmed' && b.meet_url && <a className="btn" href={b.meet_url} target="_blank" rel="noreferrer">join on google meet</a>}
      {b.status === 'cancelled' && <a className="btn" href="https://octobercomms.com/book/">book a new time</a>}

      {!mode && b.status === 'confirmed' && (
        <div style={{ marginTop: 10 }}>
          {b.can_reschedule && <button className="btn ghost" onClick={() => { setMode('move'); loadSlots(); }}>move it</button>}
          {b.can_cancel && <button className="btn ghost" onClick={() => setMode('cancel')}>cancel</button>}
        </div>
      )}

      {mode === 'move' && (
        <div>
          {slots === null ? <p className="mut" style={{ marginTop: 20 }}>loading times…</p> : !days.length ? <p className="mut" style={{ marginTop: 20 }}>No other times open. Reply to the invite and we will find one.</p> : (<>
            <div className="lab">choose a day</div>
            <div className="days">{days.map(k => (
              <button key={k} className={'day' + (k === activeDay ? ' on' : '')} onClick={() => setDay(k)}>
                {fmt(groups[k][0], { weekday: 'short' })}<br /><span className="mut" style={{ fontWeight: 400, fontSize: 11 }}>{fmt(groups[k][0], { day: 'numeric', month: 'short' })}</span>
              </button>))}</div>
            <div className="lab">choose a time</div>
            <div className="times">{groups[activeDay].map(s => (
              <button key={s} className="t" disabled={busy} onClick={() => post('move', { start: s })}>{fmt(s, { hour: '2-digit', minute: '2-digit' })}</button>))}</div>
          </>)}
          <button className="btn ghost" style={{ marginTop: 18 }} onClick={() => setMode(null)}>keep the current time</button>
        </div>
      )}

      {mode === 'cancel' && (
        <div style={{ marginTop: 16 }}>
          <textarea rows={2} placeholder="anything we should know? (optional)" value={reason} onChange={e => setReason(e.target.value)} />
          <button className="btn" disabled={busy} onClick={() => post('cancel', { reason })}>{busy ? 'cancelling…' : 'cancel the call'}</button>
          <button className="btn ghost" onClick={() => setMode(null)}>keep it</button>
        </div>
      )}
      {err && <div className="err">{err}</div>}
    </Shell>
  );
}

function Shell({ children }) {
  return <div className="bm"><style>{CSS}</style><div className="wrap">{children}</div></div>;
}
