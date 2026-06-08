import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../utils/api';
import PipelineStep from './PipelineStep';

// Pipeline → Promote. "Automated backlinks" reframed as automated
// prospecting + earned-link outreach: scrape sites linking to
// competitors via DFS Backlinks, score, push the best into the existing
// Outreach engine as a campaign. Pre-1-July-2026 the DFS Backlinks
// endpoint is gated so the scan button is disabled with a clear note.
// The "what tactics we can do" panel is always visible so AMs see the
// promise even before DFS unlocks.
const TACTICS = [
  {
    key: 'competitor_link',
    title: 'Mine competitor backlinks',
    body: 'DFS pulls sites linking to your competitors. We score by relevance + domain rank, dedupe, push the best as a campaign in Outreach.',
    available: 'after',  // unlocks with DFS Backlinks on 1 July 2026
  },
  {
    key: 'broken_link',
    title: 'Broken-link outreach',
    body: 'Crawl high-DA sites in the niche, find broken outbound links, email the site owner offering your content as replacement. 100% white-hat.',
    available: 'coming',
  },
  {
    key: 'digital_pr',
    title: 'Featured / Qwoted / SOS journalist queries',
    body: 'Paste a journalist query → Claude drafts an expert response in the client\'s voice → you send from your inbox → earns links from real news outlets.',
    available: 'live',
  },
  {
    key: 'data_pr',
    title: 'Data-PR generator',
    body: 'Use the client\'s own connector data (Shopify orders, GA4 patterns) to generate original-research stories Claude pitches to journalists. Naturally earned links.',
    available: 'coming',
  },
];

export default function PromotePanel({ clientId }) {
  const { user } = useAuth();
  const dfsUnlocked = !!user?.dataforseo_availability?.unlocked;
  const dfsAvailable = user?.dataforseo_availability?.enabled_from;
  const [prospects, setProspects] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState(null);

  // Journalist responses — Featured / Qwoted / SOS digital PR flow
  const [responses, setResponses] = useState([]);
  const [showDrafter, setShowDrafter] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [querySource, setQuerySource] = useState('featured');
  const [journalistName, setJournalistName] = useState('');
  const [outlet, setOutlet] = useState('');
  const [deadline, setDeadline] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [activeResponse, setActiveResponse] = useState(null);
  const [editBody, setEditBody] = useState('');
  const [editStatus, setEditStatus] = useState('draft');
  const [editUrl, setEditUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { refresh(); refreshResponses(); /* eslint-disable-line */ }, [clientId]);

  async function refresh() {
    try {
      const { prospects: p } = await api.get(`/seo/clients/${clientId}/backlink-prospects`);
      setProspects(p);
    } catch (e) { setErr(e.message); }
  }

  async function scan() {
    setScanning(true);
    setErr(null);
    try {
      const result = await api.post(`/seo/clients/${clientId}/backlink-prospects/scan`, {});
      await refresh();
      setErr(result.inserted ? null : 'Scan completed but no new prospects found.');
    } catch (e) { setErr(e.message); }
    finally { setScanning(false); }
  }

  async function refreshResponses() {
    try {
      const { responses: r } = await api.get(`/seo/clients/${clientId}/journalist-responses`);
      setResponses(r);
    } catch (e) { /* non-fatal */ }
  }

  async function draftResponse() {
    if (!queryText.trim()) return;
    setDrafting(true);
    setErr(null);
    try {
      const r = await api.post(`/seo/clients/${clientId}/journalist-responses`, {
        source: querySource,
        query_text: queryText.trim(),
        journalist_name: journalistName.trim() || null,
        outlet: outlet.trim() || null,
        deadline: deadline || null,
      });
      setResponses(prev => [r, ...prev]);
      openResponse(r);
      setQueryText(''); setJournalistName(''); setOutlet(''); setDeadline('');
      setShowDrafter(false);
    } catch (e) { setErr(e.message); }
    finally { setDrafting(false); }
  }

  function openResponse(r) {
    setActiveResponse(r);
    setEditBody(r.response_md || '');
    setEditStatus(r.status || 'draft');
    setEditUrl(r.external_url || '');
  }

  async function saveResponse() {
    if (!activeResponse) return;
    setSaving(true);
    try {
      const updated = await api.put(`/seo/journalist-responses/${activeResponse.id}`, {
        response_md: editBody,
        status: editStatus,
        external_url: editUrl || null,
      });
      setActiveResponse(updated);
      setResponses(prev => prev.map(r => r.id === updated.id ? updated : r));
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  }

  async function deleteResponse(id) {
    if (!confirm('Delete this draft?')) return;
    try {
      await api.delete(`/seo/journalist-responses/${id}`);
      const next = responses.filter(r => r.id !== id);
      setResponses(next);
      if (activeResponse?.id === id) setActiveResponse(null);
    } catch (e) { setErr(e.message); }
  }

  function copyResponse() {
    if (!editBody) return;
    navigator.clipboard.writeText(editBody);
  }

  return (
    <PipelineStep
      num={5} title="Promote"
      tagline="Earned-link prospecting. We scrape competitor backlinks, score them, then push the best into Outreach as a campaign. Each link earned through a real pitch — no purchased / network links, no PBNs, no comment spam. That's the only version Google doesn't punish."
    >
      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <div className="caption">Competitor link mining</div>
            <div className="h3 mt-2">Find sites linking to competitors that aren't linking to you</div>
          </div>
          <button onClick={scan} disabled={!dfsUnlocked || scanning} className="btn btn-primary"
            title={!dfsUnlocked ? `Available when DFS Backlinks unlocks${dfsAvailable ? ' on ' + new Date(dfsAvailable).toLocaleDateString('en-GB') : ''}` : ''}>
            {scanning ? 'Scanning…' : dfsUnlocked ? 'Scan competitors' : 'Gated until 1 Jul 2026'}
          </button>
        </div>
        {err && <div className="callout callout-danger" style={{ marginBottom: 10 }}>{err}</div>}
        {!prospects.length ? (
          <div style={{ color: 'var(--text-subtle)', fontSize: 13, padding: '12px 0' }}>
            {dfsUnlocked
              ? 'No prospects yet. Run a scan — needs at least one competitor domain set on the Content Gaps tab.'
              : 'Feature is built and ready. The DataForSEO Backlinks endpoint requires a paid commitment that activates 1 July 2026; until then this button is disabled.'}
          </div>
        ) : (
          <div style={{ padding: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th className="caption" style={{ padding: '8px 10px' }}>Source</th>
                  <th className="caption" style={{ padding: '8px 10px' }}>Linked to</th>
                  <th className="caption" style={{ padding: '8px 10px', textAlign: 'right' }}>DR</th>
                  <th className="caption" style={{ padding: '8px 10px', textAlign: 'right' }}>Score</th>
                  <th className="caption" style={{ padding: '8px 10px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {prospects.slice(0, 50).map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={{ padding: '8px 10px', fontSize: 12 }}>
                      <strong>{p.source_domain}</strong>
                      {p.source_url && <div style={{ fontSize: 10, color: 'var(--text-subtle)' }}>{p.source_url.slice(0, 80)}</div>}
                    </td>
                    <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text-subtle)' }}>{p.competitor_domain || '—'}</td>
                    <td style={{ padding: '8px 10px', fontSize: 12, textAlign: 'right' }}>{p.domain_rank ?? '—'}</td>
                    <td style={{ padding: '8px 10px', fontSize: 12, textAlign: 'right', fontWeight: 700 }}>{p.relevance_score}</td>
                    <td style={{ padding: '8px 10px', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)' }}>{p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Journalist responses — Featured / Qwoted / SOS */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <div className="caption">Digital PR</div>
            <div className="h3 mt-2">Featured / Qwoted / SOS journalist responses</div>
            <p className="body-sm text-muted mt-2" style={{ maxWidth: 720 }}>
              Paste a journalist query — Claude drafts an expert response in the client's voice grounded in the brand briefing. Edit it, copy, send from your own inbox.
            </p>
          </div>
          <button onClick={() => setShowDrafter(s => !s)} className="btn btn-primary">
            {showDrafter ? 'Cancel' : '+ New response'}
          </button>
        </div>

        {showDrafter && (
          <div style={{ background: 'var(--surface-raised)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', padding: 'var(--s5)', marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
              <select value={querySource} onChange={e => setQuerySource(e.target.value)}
                style={{ padding: '7px 10px', fontSize: 12, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
                <option value="featured">Featured.com</option>
                <option value="qwoted">Qwoted</option>
                <option value="sos">Source of Sources</option>
                <option value="other">Other</option>
                <option value="manual">Manual</option>
              </select>
              <input value={journalistName} onChange={e => setJournalistName(e.target.value)} placeholder="Journalist name (optional)"
                style={{ padding: '7px 10px', fontSize: 12, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }} />
              <input value={outlet} onChange={e => setOutlet(e.target.value)} placeholder="Outlet (optional)"
                style={{ padding: '7px 10px', fontSize: 12, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }} />
              <input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)}
                style={{ padding: '7px 10px', fontSize: 12, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }} />
            </div>
            <textarea
              value={queryText} onChange={e => setQueryText(e.target.value)} rows={5}
              placeholder="Paste the journalist's query verbatim. The more context (who they're writing for, angle, deadline) the better."
              style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }}
            />
            <div style={{ marginTop: 10 }}>
              <button onClick={draftResponse} className="btn btn-primary" disabled={drafting || !queryText.trim()}>
                {drafting ? 'Drafting…' : 'Draft response'}
              </button>
            </div>
          </div>
        )}

        {!!responses.length && (
          <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 18 }}>
            <div>
              {responses.map(r => (
                <div key={r.id} className="card"
                  style={{ padding: 10, marginBottom: 8, cursor: 'pointer',
                    background: r.id === activeResponse?.id ? 'var(--accent-soft)' : 'var(--surface)' }}
                  onClick={() => openResponse(r)}>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                    {r.source}{r.outlet ? ` · ${r.outlet}` : ''} · <span style={{ fontWeight: 700 }}>{r.status}</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 12, lineHeight: 1.3 }}>{r.query_text.slice(0, 100)}{r.query_text.length > 100 ? '…' : ''}</div>
                  {r.deadline && (
                    <div style={{ fontSize: 10, color: new Date(r.deadline) < new Date() ? 'var(--negative)' : 'var(--text-subtle)', marginTop: 4 }}>
                      Deadline: {new Date(r.deadline).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div>
              {activeResponse ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div className="caption">Response draft</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <select value={editStatus} onChange={e => setEditStatus(e.target.value)}
                        style={{ padding: '4px 8px', fontSize: 12, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
                        <option value="draft">Draft</option>
                        <option value="sent">Sent</option>
                        <option value="won">Won (link earned)</option>
                        <option value="rejected">Rejected</option>
                        <option value="skipped">Skipped</option>
                      </select>
                      <button onClick={copyResponse} className="btn btn-secondary btn-sm">Copy</button>
                      <button onClick={saveResponse} className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                      <button onClick={() => deleteResponse(activeResponse.id)} className="btn btn-ghost btn-sm" style={{ color: 'var(--negative)' }}>Delete</button>
                    </div>
                  </div>
                  <div style={{ background: 'var(--surface-raised)', padding: 'var(--s3) var(--s4)', borderRadius: 'var(--r-sm)', fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
                    <strong style={{ color: 'var(--text)' }}>Q:</strong> {activeResponse.query_text}
                  </div>
                  <textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={14}
                    style={{ width: '100%', padding: '12px 14px', fontSize: 13, lineHeight: 1.6, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }} />
                  {(editStatus === 'won' || editStatus === 'sent') && (
                    <input value={editUrl} onChange={e => setEditUrl(e.target.value)}
                      placeholder="Published article URL (once it goes live)"
                      style={{ width: '100%', padding: '7px 10px', fontSize: 12, marginTop: 8, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', boxSizing: 'border-box' }} />
                  )}
                </>
              ) : (
                <div style={{ color: 'var(--text-subtle)', padding: 20 }}>Pick a response on the left, or click "+ New response" to draft a new one.</div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="caption mb-3">Other tactics</div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        {TACTICS.map(t => (
          <div key={t.key} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div className="h3" style={{ flex: 1 }}>{t.title}</div>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
                              padding: '2px 6px', borderRadius: 'var(--r-sm)',
                              background: t.available === 'after' && dfsUnlocked ? 'var(--positive-soft)' : 'var(--warning-soft)',
                              color: t.available === 'after' && dfsUnlocked ? 'var(--positive)' : 'var(--warning)' }}>
                {t.available === 'after' && dfsUnlocked ? 'Live' : t.available === 'after' ? '1 Jul' : 'Soon'}
              </span>
            </div>
            <p className="body-sm mt-2 text-muted">{t.body}</p>
          </div>
        ))}
      </div>
    </PipelineStep>
  );
}
