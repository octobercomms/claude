// Social → Discover. A compliant Instagram outreach cockpit: a discovery engine
// finds public IG profiles matching the client's ICP (web search today; IG
// Graph hashtag + Apollo/PDL as pluggable sources), and the AM does the actual
// DMing BY HAND — each prospect has an "Open DM" deep link and a copy-paste,
// AI-personalised draft. No automation of the account, no bulk sending.

import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';

const STATUS = {
  new:      { label: 'New',      cls: 'chip-neutral' },
  queued:   { label: 'Queued',   cls: 'chip-outline' },
  messaged: { label: 'Messaged', cls: 'chip-accent' },
  replied:  { label: 'Replied',  cls: 'chip-success' },
  skipped:  { label: 'Skipped',  cls: 'chip-neutral' },
};

export default function IgOutreachPanel({ clientId }) {
  const toast = useToast();
  const [prospects, setProspects] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [source, setSource] = useState('serper');
  const [icp, setIcp] = useState('');
  const [location, setLocation] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [running, setRunning] = useState(false);
  const [drafting, setDrafting] = useState(null);

  async function load() {
    try { const r = await api.get(`/ig-outreach/clients/${clientId}/prospects`); setProspects(r.prospects || []); }
    catch (e) { toast(e.message, 'error'); }
    finally { setLoaded(true); }
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [clientId]);

  async function discover() {
    if (source === 'serper' && !icp.trim() && !hashtags.trim()) { toast('Enter an ICP (e.g. "architects, interior designers") or some hashtags.', 'error'); return; }
    setRunning(true);
    try {
      const r = await api.post(`/ig-outreach/clients/${clientId}/discover`, {
        source, icp: icp.trim(), location: location.trim(),
        hashtags: hashtags.split(',').map(s => s.trim()).filter(Boolean),
      });
      setProspects(r.prospects || []);
      toast(`Found ${r.found}, added ${r.added} new.`, r.added ? 'success' : 'info');
    } catch (e) { toast(e.message, 'error'); }
    finally { setRunning(false); }
  }

  async function setStatus(id, status) {
    try { const r = await api.patch(`/ig-outreach/clients/${clientId}/prospects/${id}`, { status }); setProspects(prev => prev.map(p => p.id === id ? r : p)); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function draft(id) {
    setDrafting(id);
    try { const r = await api.post(`/ig-outreach/clients/${clientId}/prospects/${id}/draft`, {}); setProspects(prev => prev.map(p => p.id === id ? r : p)); }
    catch (e) { toast(e.message, 'error'); }
    finally { setDrafting(null); }
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied — paste it in the DM.', 'success'); }
    catch { toast('Copy failed — select and copy manually.', 'error'); }
  }

  if (!loaded) return <div className="text-subtle" style={{ padding: 20 }}>Loading…</div>;

  const counts = prospects.reduce((a, p) => { a[p.status] = (a[p.status] || 0) + 1; return a; }, {});

  return (
    <div>
      <div className="callout" style={{ marginBottom: 'var(--s5)' }}>
        <strong>Discovery, not automation.</strong> This finds public profiles to approach — <em>you</em> send the DMs by hand from Instagram.
        Keep it to a few personalised messages a day; it's about good targeting, not volume.
      </div>

      {/* Discovery controls */}
      <div className="card" style={{ marginBottom: 'var(--s5)' }}>
        <div className="caption" style={{ marginBottom: 10 }}>Find prospects</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select className="input" style={{ flex: '0 0 150px' }} value={source} onChange={e => setSource(e.target.value)}>
            <option value="serper">Web search</option>
            <option value="hashtag" disabled>IG hashtag (needs Meta setup)</option>
            <option value="apollo" disabled>Apollo/PDL (coming soon)</option>
          </select>
          <input className="input" style={{ flex: '2 1 240px' }} placeholder="Roles, e.g. architects, interior designers, landscape architects"
            value={icp} onChange={e => setIcp(e.target.value)} />
          <input className="input" style={{ flex: '1 1 140px' }} placeholder="Location, e.g. Atlanta"
            value={location} onChange={e => setLocation(e.target.value)} />
          <input className="input" style={{ flex: '1 1 140px' }} placeholder="Hashtags (optional)"
            value={hashtags} onChange={e => setHashtags(e.target.value)} />
          <button className="btn btn-primary" onClick={discover} disabled={running}>{running ? 'Searching…' : 'Run discovery'}</button>
        </div>
        <div className="body-xs text-subtle" style={{ marginTop: 8 }}>
          Several roles at once is fine. New finds are de-duped against everyone already in the queue.
        </div>
      </div>

      {/* Queue */}
      <div className="section-head">
        <div className="caption">Queue</div>
        <span className="body-xs text-subtle">
          {prospects.length} total · {counts.new || 0} new · {counts.messaged || 0} messaged · {counts.replied || 0} replied
        </span>
      </div>

      {!prospects.length ? (
        <p className="body-sm text-subtle">No prospects yet — run a discovery above.</p>
      ) : (
        <div className="stack stack-sm">
          {prospects.map(p => {
            const st = STATUS[p.status] || STATUS.new;
            return (
              <div key={p.id} className="card" style={{ padding: 'var(--s4)', opacity: p.status === 'skipped' ? 0.55 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
                  <div style={{ minWidth: 0 }}>
                    <a href={p.profile_url || `https://www.instagram.com/${p.username}/`} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>@{p.username}</a>
                    {p.display_name && p.display_name !== p.username && <span className="text-subtle"> · {p.display_name}</span>}
                    {p.bio && <div className="body-xs text-subtle" style={{ marginTop: 2 }}>{p.bio}</div>}
                  </div>
                  <span className={`chip ${st.cls}`} style={{ fontSize: 10, flex: '0 0 auto' }}>{st.label}</span>
                </div>

                {p.draft && (
                  <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--surface-sunken)', borderRadius: 'var(--r-sm)' }}>
                    <div className="body-sm">{p.draft}</div>
                    <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => copy(p.draft)}>Copy message</button>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                  <a href={`https://ig.me/m/${p.username}`} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm">Open DM ↗</a>
                  <button className="btn btn-secondary btn-sm" onClick={() => draft(p.id)} disabled={drafting === p.id}>{drafting === p.id ? 'Drafting…' : (p.draft ? '↻ Redraft' : '✦ Draft message')}</button>
                  {p.status !== 'messaged' && p.status !== 'replied' && <button className="btn btn-secondary btn-sm" onClick={() => setStatus(p.id, 'messaged')}>Mark messaged</button>}
                  {p.status === 'messaged' && <button className="btn btn-secondary btn-sm" onClick={() => setStatus(p.id, 'replied')}>Mark replied</button>}
                  {p.status !== 'skipped' && <button className="btn btn-ghost btn-sm" onClick={() => setStatus(p.id, 'skipped')}>Skip</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
