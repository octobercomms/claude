import React, { useEffect, useState } from 'react';
import { api } from '../../utils/api';
import PipelineStep from './PipelineStep';

// Pipeline → Publish. Pick a saved draft → choose destination (WordPress,
// Shopify blog, clipboard, DOCX export) → publish now or schedule. Every
// publish goes through the connectors we already hold, no new credentials
// to ask the client for. Auto-publishing is gated on an explicit AM click
// — no silent posting from the generator (that's the "scaled content
// abuse" Google penalises).
export default function PublishPanel({ clientId, onNext }) {
  const [drafts, setDrafts] = useState([]);
  const [connectors, setConnectors] = useState([]);
  const [activeDraft, setActiveDraft] = useState(null);
  const [platform, setPlatform] = useState('wordpress');
  const [connectorId, setConnectorId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [statusOverride, setStatusOverride] = useState('draft');
  const [publishing, setPublishing] = useState(false);
  const [err, setErr] = useState(null);
  const [lastResult, setLastResult] = useState(null);

  useEffect(() => {
    api.get(`/seo/clients/${clientId}/drafts`).then(r => setDrafts(r.drafts || [])).catch(() => {});
    api.get(`/connectors/client/${clientId}`).then(setConnectors).catch(() => {});
  }, [clientId]);

  const wpConnectors = connectors.filter(c => c.connector_type === 'woocommerce' && c.status === 'active');
  const shopifyConnectors = connectors.filter(c => c.connector_type === 'shopify' && c.status === 'active');

  // When platform changes, reset connector selection.
  useEffect(() => {
    if (platform === 'wordpress') setConnectorId(wpConnectors[0]?.id || '');
    else if (platform === 'shopify') setConnectorId(shopifyConnectors[0]?.id || '');
    else setConnectorId('');
    /* eslint-disable-next-line */
  }, [platform, connectors.length]);

  async function publishNow() {
    if (!activeDraft) return;
    if ((platform === 'wordpress' || platform === 'shopify') && !connectorId) {
      setErr(`No ${platform} connector available — connect one on the Setup tab first.`);
      return;
    }
    setPublishing(true);
    setErr(null);
    setLastResult(null);
    try {
      const result = await api.post(`/drafts/${activeDraft.id}/publish`, {
        platform,
        connector_id: connectorId || null,
        scheduled_at: scheduledAt || null,
        status_override: statusOverride,
      });
      setLastResult(result);
    } catch (e) { setErr(e.message); }
    finally { setPublishing(false); }
  }

  async function copyToClipboard() {
    if (!activeDraft) return;
    try {
      const md = await fetch(`/api/seo/drafts/${activeDraft.id}/export/md`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      }).then(r => r.text());
      await navigator.clipboard.writeText(md);
      setLastResult({ status: 'copied', platform: 'clipboard' });
      // Record the export as a publication so the AM has a record.
      await api.post(`/drafts/${activeDraft.id}/publish`, { platform: 'clipboard' }).catch(() => {});
    } catch (e) { setErr(e.message); }
  }

  function downloadDocx() {
    if (!activeDraft) return;
    const url = `/api/seo/drafts/${activeDraft.id}/export/docx`;
    fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${(activeDraft.title || 'draft').replace(/[^a-z0-9-]+/gi, '-')}.docx`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(a.href);
      });
  }

  return (
    <PipelineStep
      num={4} title="Publish" onNext={onNext} nextLabel="Promote it"
      tagline="Push the draft to WordPress or Shopify directly — schedule for later, or publish now. Squarespace and others: copy plain markdown to the clipboard or download as DOCX."
    >
      {!drafts.length ? (
        <div style={{ color: 'var(--text-subtle)', padding: 20, fontSize: 13 }}>
          No drafts yet. Generate one on the Draft step first.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 22 }}>
          <div>
            <div className="caption mb-3">Pick a draft</div>
            {drafts.map(d => (
              <div key={d.id} className="card"
                style={{ padding: 10, marginBottom: 8, cursor: 'pointer',
                  background: d.id === activeDraft?.id ? 'var(--accent-soft)' : 'var(--surface)' }}
                onClick={() => { setActiveDraft(d); setLastResult(null); }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{d.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>
                  {d.word_count?.toLocaleString() || 0} words · {d.status}
                </div>
                {(d.publications || []).length > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--positive)', marginTop: 4 }}>
                    ✓ {d.publications.map(p => `${p.platform}${p.status === 'failed' ? ' (failed)' : ''}`).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div>
            {!activeDraft ? (
              <div style={{ color: 'var(--text-subtle)', padding: 20 }}>Pick a draft on the left.</div>
            ) : (
              <div className="card">
                <div className="caption mb-3">Publish "{activeDraft.title}"</div>

                <div style={{ marginBottom: 14 }}>
                  <div className="caption mb-2" style={{ fontSize: 10 }}>Destination</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {[
                      { k: 'wordpress', label: 'WordPress', disabled: !wpConnectors.length, reason: 'connect WooCommerce' },
                      { k: 'shopify',   label: 'Shopify blog', disabled: !shopifyConnectors.length, reason: 'connect Shopify' },
                      { k: 'clipboard', label: 'Copy to clipboard' },
                      { k: 'docx',      label: 'Download .docx' },
                    ].map(p => (
                      <button key={p.k}
                        onClick={() => !p.disabled && setPlatform(p.k)}
                        disabled={p.disabled}
                        title={p.disabled ? `Unavailable — ${p.reason}` : ''}
                        className={`btn btn-sm ${platform === p.k && !p.disabled ? 'btn-primary' : 'btn-secondary'}`}
                        style={p.disabled ? { opacity: 0.4, cursor: 'not-allowed' } : {}}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {platform === 'wordpress' && wpConnectors.length > 1 && (
                  <div style={{ marginBottom: 14 }}>
                    <div className="caption mb-2" style={{ fontSize: 10 }}>WordPress site</div>
                    <select value={connectorId} onChange={e => setConnectorId(e.target.value)}
                      style={{ padding: '6px 10px', fontSize: 13, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
                      {wpConnectors.map(c => <option key={c.id} value={c.id}>{c.store_label || c.id}</option>)}
                    </select>
                  </div>
                )}

                {(platform === 'wordpress' || platform === 'shopify') && (
                  <>
                    <div style={{ marginBottom: 14 }}>
                      <div className="caption mb-2" style={{ fontSize: 10 }}>How</div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {[
                          { k: 'draft',    label: 'Save as draft (recommended)' },
                          { k: 'publish',  label: 'Publish live now' },
                        ].map(o => (
                          <button key={o.k} onClick={() => setStatusOverride(o.k)}
                            className={`btn btn-sm ${statusOverride === o.k ? 'btn-primary' : 'btn-secondary'}`}>
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ marginBottom: 14 }}>
                      <div className="caption mb-2" style={{ fontSize: 10 }}>Or schedule for later (optional)</div>
                      <input type="datetime-local" value={scheduledAt}
                        onChange={e => setScheduledAt(e.target.value)}
                        style={{ padding: '6px 10px', fontSize: 13, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }} />
                    </div>
                  </>
                )}

                <div style={{ marginTop: 16 }}>
                  {platform === 'docx' ? (
                    <button onClick={downloadDocx} className="btn btn-primary">Download .docx</button>
                  ) : platform === 'clipboard' ? (
                    <button onClick={copyToClipboard} className="btn btn-primary">Copy markdown to clipboard</button>
                  ) : (
                    <button onClick={publishNow} className="btn btn-primary" disabled={publishing}>
                      {publishing ? 'Publishing…' : scheduledAt ? 'Schedule publish' : (statusOverride === 'publish' ? 'Publish live now' : 'Save as draft')}
                    </button>
                  )}
                </div>

                {err && <div className="callout callout-danger" style={{ marginTop: 12 }}>{err}</div>}
                {lastResult && (
                  <div className="callout" style={{ marginTop: 12, background: 'var(--positive-soft)', color: 'var(--positive)', padding: 12, borderRadius: 'var(--r-sm)' }}>
                    {lastResult.status === 'copied' ? '✓ Markdown copied to clipboard.' :
                     lastResult.status === 'scheduled' ? `✓ Scheduled for ${new Date(lastResult.scheduled_at).toLocaleString('en-GB')}` :
                     lastResult.status === 'published' ? <>✓ Published.{lastResult.external_url && <> <a href={lastResult.external_url} target="_blank" rel="noreferrer">View live post →</a></>}</> :
                     `✓ ${lastResult.status}`}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </PipelineStep>
  );
}
