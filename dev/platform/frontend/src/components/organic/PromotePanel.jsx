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
    body: 'Daily relevant queries from journalist platforms → Claude drafts an expert response in the client\'s voice → AM sends → earns links from real news outlets.',
    available: 'coming',
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

  useEffect(() => { refresh(); /* eslint-disable-line */ }, [clientId]);

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
