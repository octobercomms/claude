import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import ProposalDocument, { PROPOSAL_CSS } from '../components/proposal/ProposalDocument';

// Public, token-gated proposal page. No login, plain fetch. Measures which
// section is on screen each second the tab is visible and reports the deltas
// every 10s (and on hide via sendBeacon), so OMI's alerts can say what the
// prospect actually read. ?preview=1 renders without tracking.

function sessionKey() {
  try {
    let k = sessionStorage.getItem('pp_session');
    if (!k) { k = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('pp_session', k); }
    return k;
  } catch { return Math.random().toString(36).slice(2); }
}

export default function ProposalPublicPage() {
  const { token } = useParams();
  const [data, setData] = useState(undefined);
  const preview = new URLSearchParams(window.location.search).has('preview');

  useEffect(() => {
    document.title = 'Proposal from October Communications';
    // Private link: keep it out of search indexes if it is ever shared on.
    const robots = document.createElement('meta');
    robots.name = 'robots'; robots.content = 'noindex, nofollow';
    document.head.appendChild(robots);
    fetch(`/api/public/proposal/${encodeURIComponent(token)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { setData(d); if (d?.content?.company_name) document.title = `${d.content.company_name}: proposal from October`; })
      .catch(() => setData(null));
    return () => robots.remove();
  }, [token]);

  useTracking(token, !!data && !preview);

  if (data === undefined) return <Shell><div style={{ padding: 80, textAlign: 'center', color: '#b9b9b9' }}>loading…</div></Shell>;
  if (data === null) return <Shell><div style={{ padding: 80, textAlign: 'center', color: '#b9b9b9' }}>This proposal link isn't active. Email hello@octobercomms.com and we'll resend it.</div></Shell>;

  return (
    <Shell>
      <ProposalDocument data={data} acceptSlot={<Accept token={token} data={data} />} />
    </Shell>
  );
}

function Shell({ children }) {
  return <div style={{ background: '#0d0d0d', minHeight: '100vh' }}><style>{PROPOSAL_CSS}</style>{children}</div>;
}

function useTracking(token, enabled) {
  const pending = useRef({});
  useEffect(() => {
    if (!enabled) return undefined;
    const session = sessionKey();
    const base = `/api/public/proposal/${encodeURIComponent(token)}`;
    fetch(`${base}/open`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session }) }).catch(() => {});

    // Which section holds the most of the viewport right now.
    const ratios = {};
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { ratios[e.target.dataset.section] = e.intersectionRatio * e.boundingClientRect.height; });
    }, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
    document.querySelectorAll('[data-section]').forEach(el => io.observe(el));

    const tick = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const top = Object.entries(ratios).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] > 0) pending.current[top[0]] = (pending.current[top[0]] || 0) + 1;
    }, 1000);

    const flush = (beacon = false) => {
      const sections = pending.current;
      if (!Object.keys(sections).length) return;
      pending.current = {};
      const body = JSON.stringify({ session, sections });
      if (beacon && navigator.sendBeacon) navigator.sendBeacon(`${base}/ping`, new Blob([body], { type: 'text/plain' }));
      else fetch(`${base}/ping`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, keepalive: true }).catch(() => {});
    };
    const every = setInterval(() => flush(false), 10000);
    const onHide = () => { if (document.visibilityState === 'hidden') flush(true); };
    const onPageHide = () => flush(true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      clearInterval(tick); clearInterval(every); io.disconnect();
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      flush(true);
    };
  }, [token, enabled]);
}

function Accept({ token, data }) {
  const [pkg, setPkg] = useState(data.accepted_package || data.content?.recommended || 'advanced');
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(data.accepted ? {} : null);

  async function go() {
    setErr(''); setBusy(true);
    try {
      const r = await fetch(`/api/public/proposal/${encodeURIComponent(token)}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, package: pkg, agreed }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Something went wrong.');
      if (j.next_url) { window.location.href = j.next_url; return; }
      setDone(j);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (done) {
    return <div className="box hl" style={{ marginTop: 20 }}><h3>agreed. thank you.</h3><p style={{ margin: 0 }}>We'll be in touch today to set up the Direct Debit and book the audit kick-off.</p></div>;
  }
  return (
    <div style={{ marginTop: 20 }}>
      <div className="radio">
        {(data.packages || []).map(p => (
          <label key={p.key} className={pkg === p.key ? 'on' : ''}>
            <input type="radio" name="pkg" value={p.key} checked={pkg === p.key} onChange={() => setPkg(p.key)} style={{ display: 'none' }} />
            {p.name} · {(data.content?.currency || '£')}{Number(p.monthly).toLocaleString('en-GB')}/month
          </label>
        ))}
      </div>
      <input type="text" placeholder="your full name" value={name} onChange={e => setName(e.target.value)} autoComplete="name" />
      <label className="agree">
        <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{ marginTop: 3 }} />
        <span>I agree to October Communications' <a href={data.terms_url} target="_blank" rel="noreferrer">terms and conditions</a> and to a monthly Direct Debit for the level above, which can be altered or paused with notice.</span>
      </label>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button className="btn" onClick={go} disabled={busy || !agreed || !name.trim()}>{busy ? 'one moment…' : 'agree and set up direct debit'}</button>
        <a className="btn ghost" href={`mailto:${data.contact_email}?subject=${encodeURIComponent('Question on the proposal')}`}>ask a question first</a>
      </div>
      {err && <div className="err">{err}</div>}
    </div>
  );
}
