import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

// Book-a-call admin: connect the Google Calendar that takes bookings, set
// availability, copy the embed for octobercomms.com, see what's booked.
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const rangesToText = (r = []) => r.map(([a, b]) => `${a}-${b}`).join(', ');
const textToRanges = (t) => String(t || '').split(',').map(s => s.trim()).filter(Boolean).map(s => s.split('-').map(x => x.trim()));

export default function BookingSettingsPage() {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [hoursText, setHoursText] = useState({});
  const [upcoming, setUpcoming] = useState([]);
  const [preview, setPreview] = useState(null);

  useEffect(() => { load(); /* eslint-disable-line */ }, []);
  useEffect(() => {
    const onMsg = (e) => { if (e.data?.provider === 'google_calendar' || String(e.data?.message || '').includes('Calendar')) load(); };
    window.addEventListener('message', onMsg);
    window.addEventListener('focus', loadStatus);
    return () => { window.removeEventListener('message', onMsg); window.removeEventListener('focus', loadStatus); };
  }, []); // eslint-disable-line

  async function loadStatus() { try { setStatus(await api.get('/booking/status')); } catch { /* ignore */ } }
  async function load() {
    try {
      const [st, s, up] = await Promise.all([api.get('/booking/status'), api.get('/booking/settings'), api.get('/booking/upcoming')]);
      setStatus(st); setCfg(s.config); setUpcoming(up);
      setHoursText(Object.fromEntries(DAYS.map((_, i) => [i, rangesToText(s.config.hours[i])])));
      if (st.connected) api.get('/booking/slots').then(setPreview).catch(e => setPreview({ error: e.message }));
    } catch (e) { toast(e.message, 'error'); }
  }
  async function save() {
    try {
      const hours = Object.fromEntries(DAYS.map((_, i) => [i, textToRanges(hoursText[i])]));
      const r = await api.put('/booking/settings', { ...cfg, hours });
      setCfg(r.config); toast('Saved.', 'success');
      api.get('/booking/slots').then(setPreview).catch(() => {});
    } catch (e) { toast(e.message, 'error'); }
  }
  async function disconnect() {
    if (!confirm('Disconnect the calendar? The booking widget will stop offering times.')) return;
    await api.post('/booking/disconnect', {}); load();
  }

  if (!cfg || !status) return <div className="text-subtle" style={{ padding: 'var(--s5)' }}>Loading…</div>;
  const origin = window.location.origin;
  const snippet = `<script src="${origin}/api/public/booking/embed.js" data-theme="dark"></script>`;
  const num = (k, label, w = 90) => (
    <div className="field" style={{ width: w }}><label className="field-label">{label}</label>
      <input className="input" type="number" value={cfg[k]} onChange={e => setCfg({ ...cfg, [k]: e.target.value })} /></div>
  );

  return (
    <div className="stack" style={{ gap: 'var(--s4)' }}>
      <div className="card" style={{ borderColor: status.connected ? 'var(--card-border)' : 'var(--accent)' }}>
        <div className="caption mb-2">Google Calendar</div>
        {status.connected ? (
          <div className="row between center wrap" style={{ gap: 'var(--s2)' }}>
            <div className="body-sm">Connected as <strong>{status.email || 'your Google account'}</strong>. Bookings create a Google Meet event on this calendar and Google sends the invite.</div>
            <button className="btn btn-ghost btn-sm" onClick={disconnect}>Disconnect</button>
          </div>
        ) : (
          <div className="row between center wrap" style={{ gap: 'var(--s2)' }}>
            <div className="body-sm">Connect the Google account whose calendar takes bookings. OMI reads only busy times, never event details, and creates the Meet events.</div>
            <button className="btn btn-primary" onClick={() => window.open('/auth/google/calendar/start', 'gcal', 'width=520,height=680')}>Connect Google Calendar</button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="caption mb-3">Availability</div>
        <div className="row wrap" style={{ gap: 'var(--s2)' }}>
          {num('duration', 'Length (min)')}{num('buffer', 'Buffer (min)')}{num('step', 'Start every (min)')}
          {num('min_notice_hours', 'Min notice (h)', 110)}{num('horizon_days', 'Days ahead')}{num('max_per_day', 'Max per day')}
          <div className="field" style={{ width: 180 }}><label className="field-label">Time zone</label>
            <input className="input" value={cfg.timezone} onChange={e => setCfg({ ...cfg, timezone: e.target.value })} /></div>
        </div>
        <div className="stack mt-2" style={{ gap: 4 }}>
          {DAYS.map((d, i) => (
            <div key={d} className="row center" style={{ gap: 'var(--s2)' }}>
              <div className="body-sm" style={{ width: 96 }}>{d}</div>
              <input className="input" style={{ flex: 1 }} value={hoursText[i] || ''} placeholder="closed"
                onChange={e => setHoursText({ ...hoursText, [i]: e.target.value })} />
            </div>
          ))}
          <div className="body-xs text-muted">Ranges as 09:30-12:30, 13:30-17:00. Blank means closed.</div>
        </div>
        <div className="field mt-2"><label className="field-label">Days off (YYYY-MM-DD, comma separated)</label>
          <input className="input" value={(cfg.blackout_dates || []).join(', ')} onChange={e => setCfg({ ...cfg, blackout_dates: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></div>
        <div className="field"><label className="field-label">Also block time from these calendar IDs (comma separated)</label>
          <input className="input" value={(cfg.calendar_ids || []).join(', ')} onChange={e => setCfg({ ...cfg, calendar_ids: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="primary, you@personal.com" /></div>
        <div className="field"><label className="field-label">Event title</label>
          <input className="input" value={cfg.title} onChange={e => setCfg({ ...cfg, title: e.target.value })} /></div>
        <button className="btn btn-primary" onClick={save}>Save</button>
        {preview && <div className="body-xs text-muted mt-2">{preview.error ? `Preview: ${preview.error}` : `Visitors see ${preview.slots.length} open times over the next ${cfg.horizon_days} days.`}</div>}
      </div>

      <div className="card">
        <div className="caption mb-2">Embed on octobercomms.com</div>
        <div className="body-sm mb-2">Paste into an Elementor HTML widget on the booking page. It takes the site's look (dark, yellow, lowercase) and links bookings to the visitor's Snapshot automatically.</div>
        <pre className="body-xs" style={{ background: 'var(--surface-raised)', padding: 'var(--s3)', borderRadius: 'var(--r-sm)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{snippet}</pre>
        <button className="btn btn-secondary btn-sm" onClick={() => { navigator.clipboard?.writeText(snippet); toast('Copied.', 'success'); }}>Copy</button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>Budget</th><th>Wants</th><th>Status</th></tr></thead>
          <tbody>
            {!upcoming.length && <tr><td colSpan={5} className="text-subtle">No bookings yet.</td></tr>}
            {upcoming.map(b => (
              <tr key={b.id} style={{ cursor: b.lead_id ? 'pointer' : 'default' }} onClick={() => b.lead_id && window.location.assign(`/leads/${b.lead_id}`)}>
                <td>{new Date(b.start_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                <td className="strong">{b.name}<div className="body-xs text-muted">{b.company}</div></td>
                <td className="text-muted">{b.answers?.budget || '—'}</td>
                <td className="text-muted" style={{ maxWidth: 260 }}>{b.answers?.goal || '—'}</td>
                <td>{b.status}{b.reschedule_count ? ` · moved ${b.reschedule_count}×` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
