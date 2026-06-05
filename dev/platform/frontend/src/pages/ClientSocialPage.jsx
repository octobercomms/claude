import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import SocialPlannerChat from '../components/SocialPlannerChat';
import Sparkline from '../components/Sparkline';
import SocialSuiteOverview from '../components/SocialSuiteOverview';
import SuiteTabs from '../components/SuiteTabs';
import UiButton from '../components/ui/Button';
import { palette as UiPalette } from '../styles/tokens';
const SUITE_ACCENT_SOCIAL = UiPalette.suite.social;

// Social Phase 1 — generate 9 posts at a time, grounded in the client's
// briefing + Google Trends signals. Each post has a hook, caption,
// hashtags, a visual concept, and a frame-by-frame storyboard. AM can
// generate images via Replicate (Flux) or Ideogram.
export default function ClientSocialPage() {
  const { id } = useParams();
  const toast = useToast();
  const [client, setClient] = useState(null);
  const [batches, setBatches] = useState([]);
  const [posts, setPosts] = useState([]);
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [competitors, setCompetitors] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  const [brief, setBrief] = useState('');
  const [platforms, setPlatforms] = useState(['instagram', 'tiktok']);
  const [winners, setWinners] = useState([]);
  const [sparkline, setSparkline] = useState([]);
  const [competitorPosts, setCompetitorPosts] = useState([]);
  const [refreshingCompetitors, setRefreshingCompetitors] = useState(false);
  const [competitorPages, setCompetitorPages] = useState([]);
  const [competitorChanges, setCompetitorChanges] = useState([]);
  const [refreshingPages, setRefreshingPages] = useState(false);
  const [engagement, setEngagement] = useState({});
  const [mediaByPost, setMediaByPost] = useState({});
  const [shareUrl, setShareUrl] = useState(null);
  const [frameworkBreakdown, setFrameworkBreakdown] = useState([]);
  const [trendingSounds, setTrendingSounds] = useState([]);
  const [refreshingSounds, setRefreshingSounds] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(null); // { planId } | null
  const [plansRefreshKey, setPlansRefreshKey] = useState(0);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [hookVaultOpen, setHookVaultOpen] = useState(false);
  const [socialTab, setSocialTab] = useState(() => {
    const q = new URLSearchParams(window.location.search).get('tab');
    return ['overview','brainstorm','plans','performance','competitors'].includes(q) ? q : 'overview';
  });
  // Lifted to page level so the SocialSuiteOverview can read it for
  // state-aware "where you are in the loop" detection. PlansList
  // receives the array as a prop instead of fetching its own.
  const [plans, setPlans] = useState([]);

  async function loadAll() {
    const [c, bs, comp, ws, eng, fb, ts, sp, cp, pl, cpages, cchanges] = await Promise.all([
      api.get(`/clients/${id}`),
      api.get(`/social/clients/${id}/batches`),
      api.get(`/social/clients/${id}/competitors`),
      api.get(`/social/clients/${id}/winners?days=90&limit=5`).catch(() => []),
      api.get(`/social/clients/${id}/engagement`).catch(() => []),
      api.get(`/social/clients/${id}/framework-breakdown?days=90`).catch(() => []),
      api.get(`/social/clients/${id}/trending-sounds`).catch(() => ({ sounds: [] })),
      api.get(`/social/clients/${id}/sparkline?days=30`).catch(() => []),
      api.get(`/social/clients/${id}/competitor-posts?limit=10`).catch(() => []),
      api.get(`/social/clients/${id}/plans`).catch(() => []),
      api.get(`/social/clients/${id}/competitor-pages`).catch(() => []),
      api.get(`/social/clients/${id}/competitor-page-changes`).catch(() => []),
    ]);
    setPlans(pl || []);
    setCompetitorPages(cpages || []);
    setCompetitorChanges(cchanges || []);
    setClient(c);
    setBatches(bs);
    setCompetitors(comp.competitors || []);
    setWinners(ws || []);
    setFrameworkBreakdown(fb || []);
    setTrendingSounds(ts.sounds || []);
    setSparkline(sp || []);
    setCompetitorPosts(cp || []);
    const eMap = {};
    for (const e of (eng || [])) eMap[e.post_id] = e;
    setEngagement(eMap);
    if (bs.length && !activeBatchId) {
      setActiveBatchId(bs[0].id);
      const p = await api.get(`/social/clients/${id}/posts?batch_id=${bs[0].id}`);
      setPosts(p);
    }
  }
  useEffect(() => { loadAll(); /* eslint-disable-line */ }, [id, plansRefreshKey]);

  async function selectBatch(batchId) {
    setActiveBatchId(batchId);
    const p = await api.get(`/social/clients/${id}/posts?batch_id=${batchId}`);
    setPosts(p);
    // Lazy-load media for the visible posts.
    const map = {};
    for (const post of p) {
      try {
        const mediaRows = await api.get(`/social/posts/${post.id}/media`);
        if (mediaRows.length) map[post.id] = mediaRows;
      } catch {}
    }
    setMediaByPost(map);
  }

  async function generateMedia(postId, kind) {
    try {
      const path = kind === 'video' ? 'video' : 'voiceover';
      const { media } = await api.post(`/social/posts/${postId}/${path}`, {});
      setMediaByPost(prev => ({ ...prev, [postId]: [...(prev[postId] || []), media] }));
      toast(`${kind === 'video' ? 'UGC video' : 'Voiceover'} ready.`, 'success');
    } catch (e) {
      toast(`${kind} failed: ${e.message}`, 'error');
    }
  }

  // Render every A / C / G frame in the storyboard via Remotion. Each
  // resolved frame writes a new social_post_media row of kind='motion';
  // we merge them into the per-post media map so the inline players
  // appear without a full refresh.
  async function renderTemplates(postId) {
    try {
      const { rendered } = await api.post(`/social/posts/${postId}/render-templates`, {});
      const success = rendered.filter(r => r.id);
      const errors = rendered.filter(r => r.error);
      setMediaByPost(prev => ({ ...prev, [postId]: [...(prev[postId] || []), ...success] }));
      if (success.length) toast(`Rendered ${success.length} A/C/G clip${success.length === 1 ? '' : 's'} via Remotion.`, 'success');
      if (errors.length) toast(`Some renders failed: ${errors.map(e => `${e.style}: ${e.error}`).join('; ')}`, 'error');
    } catch (e) {
      toast(`Template render failed: ${e.message}`, 'error');
    }
  }

  async function deleteMedia(mediaId, postId) {
    try {
      await api.delete(`/social/media/${mediaId}`);
      setMediaByPost(prev => ({ ...prev, [postId]: (prev[postId] || []).filter(m => m.id !== mediaId) }));
    } catch (e) {
      toast(`Could not delete: ${e.message}`, 'error');
    }
  }

  async function refreshTrendingSounds() {
    setRefreshingSounds(true);
    try {
      const r = await api.post(`/social/clients/${id}/trending-sounds/refresh`, { region: 'GB' });
      setTrendingSounds(r.sounds || []);
      toast(`Pulled ${r.sounds?.length || 0} trending sounds.`, 'success');
    } catch (e) {
      toast(`Could not refresh sounds: ${e.message}`, 'error');
    } finally {
      setRefreshingSounds(false);
    }
  }

  async function shareBatchForApproval() {
    if (!activeBatchId) return;
    try {
      const { public_url } = await api.post(`/approvals/clients/${id}/links`, {
        scope: 'social_batch',
        scope_id: activeBatchId,
        title: `Social batch — ${client?.name || ''} ${new Date().toLocaleDateString('en-GB')}`,
        expires_days: 14,
      });
      setShareUrl(public_url);
    } catch (e) {
      toast(`Could not generate link: ${e.message}`, 'error');
    }
  }

  async function generate() {
    setGenerating(true);
    try {
      const { batch, posts: newPosts } = await api.post(`/social/clients/${id}/generate`, { brief, platforms });
      setBatches([batch, ...batches]);
      setActiveBatchId(batch.id);
      setPosts(newPosts);
      setShowBrief(false);
      setBrief('');
      toast(`Generated ${newPosts.length} posts.`, 'success');
    } catch (e) {
      toast(`Generation failed: ${e.message}`, 'error');
    } finally {
      setGenerating(false);
    }
  }

  async function updatePost(postId, patch) {
    try {
      const updated = await api.put(`/social/posts/${postId}`, patch);
      setPosts(prev => prev.map(p => p.id === postId ? updated : p));
    } catch (e) {
      toast(`Update failed: ${e.message}`, 'error');
    }
  }

  async function deletePost(postId) {
    if (!confirm('Delete this post?')) return;
    try {
      await api.delete(`/social/posts/${postId}`);
      setPosts(prev => prev.filter(p => p.id !== postId));
    } catch (e) {
      toast(`Delete failed: ${e.message}`, 'error');
    }
  }

  async function deleteBatch(batchId) {
    if (!confirm('Delete this entire batch and all its posts?')) return;
    try {
      await api.delete(`/social/batches/${batchId}`);
      const next = batches.filter(b => b.id !== batchId);
      setBatches(next);
      if (next[0]) selectBatch(next[0].id);
      else { setActiveBatchId(null); setPosts([]); }
    } catch (e) {
      toast(`Delete failed: ${e.message}`, 'error');
    }
  }

  async function saveCompetitors(next) {
    try {
      const r = await api.put(`/social/clients/${id}/competitors`, { competitors: next });
      setCompetitors(r.competitors || []);
    } catch (e) {
      toast(`Could not save: ${e.message}`, 'error');
    }
  }

  async function refreshCompetitorPosts() {
    setRefreshingCompetitors(true);
    try {
      await api.post(`/social/clients/${id}/competitor-posts/refresh`, {});
      const cp = await api.get(`/social/clients/${id}/competitor-posts?limit=10`);
      setCompetitorPosts(cp || []);
      toast('Competitor scrape refreshed.', 'success');
    } catch (e) {
      toast(`Refresh failed: ${e.message}`, 'error');
    } finally {
      setRefreshingCompetitors(false);
    }
  }

  async function refreshCompetitorPages() {
    setRefreshingPages(true);
    try {
      await api.post(`/social/clients/${id}/competitor-pages/refresh`, {});
      const cchanges = await api.get(`/social/clients/${id}/competitor-page-changes`);
      setCompetitorChanges(cchanges || []);
      toast('Landing-page diff refreshed.', 'success');
    } catch (e) {
      toast(`Refresh failed: ${e.message}`, 'error');
    } finally {
      setRefreshingPages(false);
    }
  }

  async function addCompetitorPage(url, label) {
    try {
      const page = await api.post(`/social/clients/${id}/competitor-pages`, { url, label });
      setCompetitorPages(prev => {
        if (prev.some(p => p.id === page.id)) return prev.map(p => p.id === page.id ? page : p);
        return [...prev, page];
      });
    } catch (e) {
      toast(`Could not add: ${e.message}`, 'error');
    }
  }

  async function removeCompetitorPage(pageId) {
    if (!confirm('Stop tracking this URL?')) return;
    try {
      await api.delete(`/social/competitor-pages/${pageId}`);
      setCompetitorPages(prev => prev.filter(p => p.id !== pageId));
      setCompetitorChanges(prev => prev.filter(c => c.page_id !== pageId));
    } catch (e) {
      toast(`Delete failed: ${e.message}`, 'error');
    }
  }

  async function toggleAutopilotPaused() {
    const next = !client?.social_autopilot_paused;
    try {
      const r = await api.patch(`/clients/${id}/social-autopilot-paused`, { paused: next });
      setClient(c => ({ ...c, social_autopilot_paused: r.social_autopilot_paused }));
      toast(next ? 'Autopilot paused — no plans will publish until you resume.' : 'Autopilot resumed.', 'success');
    } catch (e) {
      toast(`Could not toggle: ${e.message}`, 'error');
    }
  }

  async function publishPost(postId, url) {
    try {
      const { post } = await api.post(`/social/posts/${postId}/publish`, { published_url: url });
      setPosts(prev => prev.map(p => p.id === postId ? post : p));
      // Refetch engagement so the card shows the first snapshot
      const eng = await api.get(`/social/clients/${id}/engagement`);
      const eMap = {};
      for (const e of eng) eMap[e.post_id] = e;
      setEngagement(eMap);
      toast('Marked published — engagement will refresh daily.', 'success');
    } catch (e) {
      toast(`Could not publish: ${e.message}`, 'error');
    }
  }

  async function refreshInsights(postId) {
    try {
      await api.post(`/social/posts/${postId}/refresh-insights`);
      const eng = await api.get(`/social/clients/${id}/engagement`);
      const eMap = {};
      for (const e of eng) eMap[e.post_id] = e;
      setEngagement(eMap);
      toast('Insights refreshed.', 'success');
    } catch (e) {
      toast(`Refresh failed: ${e.message}`, 'error');
    }
  }

  return (
    <div className="suite-social">
      {/* HERO — always visible across tabs. Tab-specific actions sit
          inside each tab's section head instead of a global toolbar. */}
      <header className="hero">
        <div>
          <div className="client-name">{client?.name || ''}</div>
          <h1 className="display mt-2"><span className="text-accent">Social</span></h1>
        </div>
        <div className="hero-actions">
          <UiButton variant="primary" size="sm" onClick={() => setPlannerOpen({ planId: null })}>+ Plan a post</UiButton>
          <UiButton variant="secondary" size="sm" onClick={toggleAutopilotPaused}>
            {client?.social_autopilot_paused ? '▶ Resume autopilot' : '⏸ Pause autopilot'}
          </UiButton>
        </div>
      </header>

      <SuiteTabs tabs={[
        { key: 'overview',     label: 'Overview',     active: socialTab === 'overview',     onClick: () => setSocialTab('overview') },
        { key: 'brainstorm',   label: 'Brainstorm',   active: socialTab === 'brainstorm',   onClick: () => setSocialTab('brainstorm') },
        { key: 'plans',        label: 'Plans',        active: socialTab === 'plans',        onClick: () => setSocialTab('plans') },
        { key: 'performance',  label: 'Performance',  active: socialTab === 'performance',  onClick: () => setSocialTab('performance') },
        { key: 'competitors',  label: 'Competitors',  active: socialTab === 'competitors',  onClick: () => setSocialTab('competitors') },
      ]} />

      {/* OVERVIEW — hero metrics, loop, next-up, plus a recap of what's
          most worth looking at. */}
      {socialTab === 'overview' && (
        <SocialSuiteOverview
          clientId={id}
          client={client}
          batches={batches}
          posts={posts}
          plans={plans}
          competitors={competitors}
          winners={winners}
          competitorPosts={competitorPosts}
          sparkline={sparkline}
          onAddCompetitor={() => setSocialTab('competitors')}
          onGenerate={() => { setSocialTab('brainstorm'); setShowBrief(true); }}
          onBulkSchedule={() => setBulkOpen(true)}
          onOpenPlan={(pid) => setPlannerOpen({ planId: pid })}
          onOpenHookVault={() => setHookVaultOpen(true)}
        />
      )}

      {/* BRAINSTORM — past batches sidebar + 9-post grid + generate. */}
      {socialTab === 'brainstorm' && (
        <BrainstormTab
          batches={batches}
          posts={posts}
          activeBatchId={activeBatchId}
          onSelectBatch={selectBatch}
          onDeleteBatch={deleteBatch}
          onGenerate={() => setShowBrief(true)}
          onBulkSchedule={() => setBulkOpen(true)}
          onShareForApproval={shareBatchForApproval}
          generating={generating}
          engagement={engagement}
          mediaByPost={mediaByPost}
          updatePost={updatePost}
          deletePost={deletePost}
          publishPost={publishPost}
          refreshInsights={refreshInsights}
          renderTemplates={renderTemplates}
          generateMedia={generateMedia}
          deleteMedia={deleteMedia}
        />
      )}

      {/* PLANS — list / calendar of locked plans. */}
      {socialTab === 'plans' && (
        <PlansList key={plansRefreshKey} clientId={id} clientName={client?.name} onOpen={(planId) => setPlannerOpen({ planId })} />
      )}

      {/* PERFORMANCE — Winners, framework breakdown, Hook Vault entry. */}
      {socialTab === 'performance' && (
        <div className="stack-lg">
          <div className="row end">
            <UiButton variant="secondary" onClick={() => setHookVaultOpen(true)}>✦ Open Hook Vault</UiButton>
          </div>
          <WinnersPanel winners={winners} frameworkBreakdown={frameworkBreakdown} sparkline={sparkline} />
        </div>
      )}

      {/* COMPETITORS — editor, social scrape, landing-page diff,
          trending sounds (sounds are competitor-adjacent grounding). */}
      {socialTab === 'competitors' && (
        <div className="stack-lg">
          <div id="competitor-editor-anchor">
            <CompetitorEditor competitors={competitors} onSave={saveCompetitors} />
          </div>
          <CompetitorTrackerPanel
            posts={competitorPosts}
            refreshing={refreshingCompetitors}
            onRefresh={refreshCompetitorPosts}
            hasCompetitors={competitors.length > 0}
          />
          <TrendingSoundsBar sounds={trendingSounds} onRefresh={refreshTrendingSounds} refreshing={refreshingSounds} />
        </div>
      )}

      {shareUrl && (
        <ShareLinkBanner url={shareUrl} onDismiss={() => setShareUrl(null)} />
      )}

      {showBrief && (
        <BriefModal
          onClose={() => setShowBrief(false)}
          brief={brief} setBrief={setBrief}
          platforms={platforms} setPlatforms={setPlatforms}
          onSubmit={generate} submitting={generating}
        />
      )}
      {plannerOpen && (
        <SocialPlannerChat
          clientId={id}
          clientName={client?.name}
          planId={plannerOpen.planId}
          seedHook={plannerOpen.seedHook}
          onClose={() => setPlannerOpen(null)}
          onSaved={() => setPlansRefreshKey(k => k + 1)}
        />
      )}
      {hookVaultOpen && (
        <HookVaultModal
          clientId={id}
          onClose={() => setHookVaultOpen(false)}
          onUse={(hook) => { setHookVaultOpen(false); setPlannerOpen({ planId: null, seedHook: hook }); }}
        />
      )}
      {bulkOpen && (
        <BulkScheduleModal
          clientId={id}
          posts={posts.filter(p => ['instagram','facebook','linkedin'].includes(p.platform))}
          onClose={() => setBulkOpen(false)}
          onScheduled={() => { setBulkOpen(false); setPlansRefreshKey(k => k + 1); loadPostsAndStatus(); }}
        />
      )}
    </div>
  );

  async function loadPostsAndStatus() {
    if (!activeBatchId) return;
    try {
      const p = await api.get(`/social/clients/${id}/posts?batch_id=${activeBatchId}`);
      setPosts(p);
    } catch {}
  }
}

// Brainstorm tab — the 9-post idea generator. Past batches on the
// left, the active batch's post cards on the right, plus the
// brainstorm-only actions (Generate / Bulk schedule / Share for
// approval) in the section head.
function BrainstormTab({
  batches, posts, activeBatchId, onSelectBatch, onDeleteBatch,
  onGenerate, onBulkSchedule, onShareForApproval, generating,
  engagement, mediaByPost, updatePost, deletePost, publishPost,
  refreshInsights, renderTemplates, generateMedia, deleteMedia,
}) {
  const hasAutopilotSupported = activeBatchId && posts.some(p => ['instagram','facebook','linkedin'].includes(p.platform));
  return (
    <div>
      <div className="row between center wrap mb-4">
        <div>
          <div className="caption">Brainstorm</div>
          <div className="h2 mt-2">9-post batches</div>
        </div>
        <div className="row wrap">
          {hasAutopilotSupported && (
            <UiButton variant="secondary" onClick={onBulkSchedule}>📅 Bulk schedule</UiButton>
          )}
          {activeBatchId && (
            <UiButton variant="secondary" onClick={onShareForApproval}>Share for approval</UiButton>
          )}
          <UiButton variant="primary" onClick={onGenerate} disabled={generating}>
            {generating ? 'Generating…' : 'Generate 9 posts'}
          </UiButton>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 22 }}>
        <div>
          <div className="caption caption-muted mb-3">Past batches</div>
          {!batches.length && <div className="body-sm text-subtle">Nothing yet — click Generate to start.</div>}
          <div className="stack stack-sm">
            {batches.map(b => (
              <div key={b.id} className="card" style={{ padding: 10, cursor: 'pointer', borderColor: b.id === activeBatchId ? 'var(--accent)' : 'var(--border-neutral)' }} onClick={() => onSelectBatch(b.id)}>
                <div className="h3">{new Date(b.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                <div className="body-xs text-subtle mt-2">{b.post_count} posts</div>
                {b.brief && <div className="body-xs mt-2" style={{ lineHeight: 1.4 }}>{b.brief.slice(0, 64)}{b.brief.length > 64 ? '…' : ''}</div>}
                {b.id === activeBatchId && (
                  <button onClick={(e) => { e.stopPropagation(); onDeleteBatch(b.id); }} className="btn btn-danger btn-sm mt-3">Delete batch</button>
                )}
              </div>
            ))}
          </div>
        </div>
        <div>
          {!posts.length && <div className="empty" style={{ padding: 'var(--s7)' }}><p className="body">Pick a batch on the left, or generate a new one.</p></div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 14 }}>
            {posts.map(p => (
              <PostCard key={p.id} post={p} engagement={engagement[p.id]} media={mediaByPost[p.id] || []}
                onChange={patch => updatePost(p.id, patch)}
                onDelete={() => deletePost(p.id)}
                onPublish={(url) => publishPost(p.id, url)}
                onRefreshInsights={() => refreshInsights(p.id)}
                onRenderTemplates={() => renderTemplates(p.id)}
                onGenerateMedia={(kind) => generateMedia(p.id, kind)}
                onDeleteMedia={(mediaId) => deleteMedia(mediaId, p.id)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BulkScheduleModal({ clientId, posts, onClose, onScheduled }) {
  // Default-select every autopilot-supported post. The AM untiCKS what
  // they don't want rather than starting from zero.
  const [selected, setSelected] = useState(() => new Set(posts.map(p => p.id)));
  const [targetPlatforms, setTargetPlatforms] = useState(['instagram']);
  const [driveFolderUrl, setDriveFolderUrl] = useState('');
  // Default cadence: Mon/Wed/Fri at 10am, starting tomorrow.
  const [daysOfWeek, setDaysOfWeek] = useState([1, 3, 5]);
  const [timeOfDay, setTimeOfDay] = useState('10:00');
  const [startAt, setStartAt] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  function toggle(id) {
    setSelected(s => { const next = new Set(s); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function togglePlatform(p) {
    setTargetPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  }
  function toggleDay(d) {
    setDaysOfWeek(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort());
  }

  async function submit() {
    if (!selected.size) { setError('Pick at least one post.'); return; }
    if (!targetPlatforms.length) { setError('Pick at least one platform.'); return; }
    if (!daysOfWeek.length) { setError('Pick at least one day of the week.'); return; }
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/social/clients/${clientId}/bulk-schedule`, {
        post_ids: [...selected],
        target_platforms: targetPlatforms,
        drive_folder_url: driveFolderUrl || null,
        start_at: new Date(`${startAt}T${timeOfDay}:00`).toISOString(),
        days_of_week: daysOfWeek,
        time_of_day: timeOfDay,
      });
      onScheduled();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const dayLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'white', borderRadius: 8, width: 720, maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Bulk schedule {selected.size} of {posts.length} posts</h2>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
          Each ticked post becomes its own plan. The autopilot picks them up one per scheduled slot — fetches captions, reads the Drive folder, posts to the platforms below.
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Posts</div>
          <div style={{ maxHeight: 200, overflow: 'auto', border: '2px solid var(--accent)', borderRadius: 4 }}>
            {posts.map(p => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 10px', borderBottom: '1px solid #f5f5f5', cursor: 'pointer', fontSize: 12 }}>
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} style={{ marginTop: 2 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{p.hook || p.caption?.slice(0, 60) || '(no hook)'}</div>
                  <div style={{ color: 'var(--text-subtle)', fontSize: 11 }}>{p.platform} · {p.kind}{p.framework ? ` · ${p.framework}` : ''}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Target platforms</div>
            <div style={{ display: 'flex', gap: 12 }}>
              {['instagram','facebook','linkedin'].map(p => (
                <label key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', textTransform: 'capitalize' }}>
                  <input type="checkbox" checked={targetPlatforms.includes(p)} onChange={() => togglePlatform(p)} /> {p}
                </label>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Drive folder URL (shared)</div>
            <input type="text" value={driveFolderUrl} onChange={e => setDriveFolderUrl(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/…"
              style={{ width: '100%', padding: '6px 8px', border: '2px solid var(--accent)', borderRadius: 4, fontSize: 12 }} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Days of week</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {dayLabels.map((label, i) => (
                <button key={i} type="button" onClick={() => toggleDay(i)}
                  style={{
                    flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 600,
                    background: daysOfWeek.includes(i) ? 'var(--text)' : 'white',
                    color: daysOfWeek.includes(i) ? 'white' : 'var(--text-muted)',
                    border: '2px solid var(--accent)', borderRadius: 4, cursor: 'pointer',
                  }}>{label}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Start date</div>
              <input type="date" value={startAt} onChange={e => setStartAt(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', border: '2px solid var(--accent)', borderRadius: 4, fontSize: 12 }} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Time</div>
              <input type="time" value={timeOfDay} onChange={e => setTimeOfDay(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', border: '2px solid var(--accent)', borderRadius: 4, fontSize: 12 }} />
            </div>
          </div>
        </div>

        {error && <div style={{ padding: '8px 12px', background: '#fff0f0', color: 'var(--negative)', fontSize: 12, borderRadius: 4, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="button" onClick={submit} disabled={submitting} className="btn btn-primary">
            {submitting ? 'Scheduling…' : `Schedule ${selected.size} post${selected.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// Searchable library of every hook this client has used. Sorted by
// best engagement per hook, framework-filterable, with a "use this →"
// that opens the planner chat with the hook pre-seeded as the brief.
// Search runs server-side via ILIKE so a vault with thousands of hooks
// stays snappy.
function HookVaultModal({ clientId, onClose, onUse }) {
  const [hooks, setHooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [framework, setFramework] = useState('');
  const [search, setSearch] = useState('');
  // Debounce typing so we don't fire 8 requests for "carousel"
  const [searchDebounced, setSearchDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (framework) params.set('framework', framework);
    if (searchDebounced) params.set('q', searchDebounced);
    api.get(`/social/clients/${clientId}/hooks?${params.toString()}`)
      .then(r => setHooks(r || []))
      .catch(() => setHooks([]))
      .finally(() => setLoading(false));
  }, [clientId, framework, searchDebounced]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'white', borderRadius: 8, width: 760, maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Hook Vault</h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Every hook this client has used, sorted by best reach.</div>
          </div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search hooks…"
            style={{ flex: 1, padding: '6px 10px', border: '2px solid var(--accent)', borderRadius: 4, fontSize: 13 }} />
          <select value={framework} onChange={e => setFramework(e.target.value)}
            style={{ padding: '6px 10px', border: '2px solid var(--accent)', borderRadius: 4, fontSize: 12 }}>
            <option value="">All frameworks</option>
            <option value="Hook-Story-Offer">Hook-Story-Offer</option>
            <option value="AIDA">AIDA</option>
            <option value="PAS">PAS</option>
            <option value="UGC">UGC</option>
          </select>
        </div>
        {loading ? (
          <div style={{ color: 'var(--text-subtle)', padding: 20, textAlign: 'center', fontSize: 12 }}>Loading…</div>
        ) : !hooks.length ? (
          <div style={{ color: 'var(--text-subtle)', padding: 20, textAlign: 'center', fontSize: 12 }}>
            No hooks yet. Generate a brainstorm batch — every hook you save lands here.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {hooks.map((h, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--surface-raised)', border: '2px solid var(--accent)', borderRadius: 4 }}>
                <div style={{ flex: 1, marginRight: 12 }}>
                  <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600, lineHeight: 1.4 }}>{h.hook}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 3, display: 'flex', gap: 8 }}>
                    {h.framework && <span>{h.framework}</span>}
                    <span>·</span>
                    <span>{h.platform} / {h.kind}</span>
                    {h.best_reach > 0 && (<><span>·</span><span>best {formatNum(h.best_reach)} reach</span></>)}
                    {h.use_count > 1 && (<><span>·</span><span>used {h.use_count}×</span></>)}
                  </div>
                </div>
                <button type="button" onClick={() => onUse(h.hook)}
                  style={{ background: 'var(--text)', color: 'white', border: 'none', borderRadius: 4, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  Use this →
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatNum(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'm';
  if (v >= 1_000) return (v / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(v));
}

function PlansList({ clientId, clientName, onOpen }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingPlanId, setEditingPlanId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [view, setView] = useState('list');   // 'list' | 'calendar'

  useEffect(() => {
    let cancelled = false;
    api.get(`/social/clients/${clientId}/plans`)
      .then(r => { if (!cancelled) { setPlans(r); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId]);

  function beginEdit(plan) {
    const iso = plan.scheduled_at ? new Date(plan.scheduled_at).toISOString().slice(0, 16) : '';
    setEditDraft(iso);
    setEditingPlanId(plan.id);
  }

  async function saveEdit(planId) {
    setSavingEdit(true);
    try {
      await api.patch(`/social/clients/${clientId}/plans/${planId}/schedule`, {
        scheduled_at: editDraft ? new Date(editDraft).toISOString() : null,
      });
      // Refetch so the list reflects the new time + any status changes
      // (e.g. failed publications dropping off if scheduled_at moved
      // forward).
      const r = await api.get(`/social/clients/${clientId}/plans`);
      setPlans(r);
      setEditingPlanId(null);
    } catch (e) {
      alert(`Reschedule failed: ${e.message}`);
    } finally {
      setSavingEdit(false);
    }
  }

  async function downloadPlan(planId, format) {
    try {
      const res = await api.raw(`/social/clients/${clientId}/plans/${planId}/export.${format}`);
      if (!res.ok) throw new Error('download failed');
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') || '';
      const m = cd.match(/filename="([^"]+)"/);
      const filename = m ? m[1] : `social-plan.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {}
  }

  if (loading) return null;
  if (!plans.length) return null;

  return (
    <div style={{ marginBottom: 22, padding: 14, background: 'var(--surface-raised)', border: '2px solid var(--accent)', borderRadius: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Locked plans
        </div>
        <div style={{ display: 'flex', gap: 0, border: '2px solid var(--accent)', borderRadius: 4, overflow: 'hidden' }}>
          {['list', 'calendar'].map(v => (
            <button key={v} type="button" onClick={() => setView(v)}
              style={{
                padding: '4px 10px', fontSize: 11, fontWeight: 600,
                background: view === v ? 'var(--text)' : 'white',
                color: view === v ? 'white' : 'var(--text-muted)',
                border: 'none', cursor: 'pointer', textTransform: 'capitalize',
              }}>{v}</button>
          ))}
        </div>
      </div>
      {view === 'calendar' ? (
        <PlansCalendar plans={plans} onOpen={onOpen} />
      ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {plans.map(p => {
          // Compact per-platform status chips. posted is green, failed
          // red, in_flight amber, pending grey. Click into the plan to
          // see the full error / posted URL.
          const pubs = Array.isArray(p.publications) ? p.publications : [];
          const eng = p.engagement || {};
          const hasEng = Number(eng.likes || 0) + Number(eng.comments || 0) + Number(eng.shares || 0) > 0;
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'white', border: '2px solid var(--accent)', borderRadius: 4 }}>
              <button type="button" onClick={() => onOpen(p.id)} style={{ background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0, color: 'var(--text)' }}>
                {p.title || '(untitled)'}
              </button>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {pubs.map(pub => {
                  const colour = pub.status === 'posted' ? 'var(--positive)' : pub.status === 'failed' ? 'var(--negative)' : pub.status === 'in_flight' ? '#b86e00' : 'var(--text-subtle)';
                  const bg = pub.status === 'posted' ? '#e8f5e9' : pub.status === 'failed' ? '#ffebee' : pub.status === 'in_flight' ? '#fff4e1' : 'var(--surface-sunken)';
                  const icon = pub.status === 'posted' ? '✓' : pub.status === 'failed' ? '✗' : '·';
                  return (
                    <span key={pub.platform} title={pub.error_message || pub.posted_url || pub.status}
                          style={{ fontSize: 11, color: colour, background: bg, padding: '2px 6px', borderRadius: 3, textTransform: 'capitalize' }}>
                      {icon} {pub.platform}
                    </span>
                  );
                })}
                {hasEng && (
                  <span style={{ fontSize: 11, color: '#1a56db', background: '#eef2ff', padding: '2px 8px', borderRadius: 3 }}>
                    {eng.reach ? `${formatNum(eng.reach)} reach · ` : ''}{formatNum(eng.likes)} ♡ · {formatNum(eng.comments)} 💬{eng.shares ? ` · ${formatNum(eng.shares)} ↗` : ''}
                  </span>
                )}
                {p.scheduled_at && !pubs.some(x => x.status === 'posted') && editingPlanId !== p.id && (
                  <button type="button" onClick={() => beginEdit(p)}
                    style={{ fontSize: 11, color: '#1a56db', background: '#eef2ff', padding: '2px 8px', borderRadius: 3, border: 'none', cursor: 'pointer' }}
                    title="Click to reschedule">
                    ⏰ {new Date(p.scheduled_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                    {p.target_platforms?.length ? ` · ${p.target_platforms.join(', ')}` : ''}
                  </button>
                )}
                {editingPlanId === p.id && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <input type="datetime-local" value={editDraft} onChange={e => setEditDraft(e.target.value)}
                      style={{ fontSize: 11, padding: '2px 4px', border: '1px solid #1a56db', borderRadius: 3 }} />
                    <button type="button" onClick={() => saveEdit(p.id)} disabled={savingEdit}
                      style={{ fontSize: 11, padding: '2px 8px', background: '#1a56db', color: 'white', border: 'none', borderRadius: 3, cursor: 'pointer' }}>
                      {savingEdit ? '…' : 'Save'}
                    </button>
                    <button type="button" onClick={() => setEditingPlanId(null)}
                      style={{ fontSize: 11, padding: '2px 8px', background: 'white', color: 'var(--text-muted)', border: '2px solid var(--accent)', borderRadius: 3, cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </span>
                )}
                <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{new Date(p.updated_at).toLocaleDateString('en-GB')}</span>
                <button type="button" onClick={() => downloadPlan(p.id, 'pdf')} style={{ background: 'white', border: '2px solid var(--accent)', borderRadius: 4, padding: '2px 8px', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>↓ PDF</button>
                <button type="button" onClick={() => downloadPlan(p.id, 'docx')} style={{ background: 'white', border: '2px solid var(--accent)', borderRadius: 4, padding: '2px 8px', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>↓ Word</button>
              </div>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

// Monthly grid view of scheduled plans. Click a chip to open the plan
// in the planner chat. Renders only plans with a scheduled_at; bulk-
// scheduled brainstorm posts therefore appear; draft plans without a
// schedule don't (they have no slot to render in).
function PlansCalendar({ plans, onOpen }) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date(); d.setDate(1); return d;
  });
  const scheduled = plans.filter(p => p.scheduled_at);
  const month = cursor.getMonth();
  const year = cursor.getFullYear();
  const monthLabel = cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const firstDow = new Date(year, month, 1).getDay();   // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Compose 6 rows × 7 cols, padding leading + trailing.
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  // Bucket plans by yyyy-mm-dd of scheduled_at.
  const byDay = new Map();
  for (const p of scheduled) {
    const dt = new Date(p.scheduled_at);
    if (dt.getMonth() !== month || dt.getFullYear() !== year) continue;
    const k = dt.getDate();
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(p);
  }
  function shift(n) {
    const next = new Date(cursor); next.setMonth(next.getMonth() + n); setCursor(next);
  }
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <button type="button" onClick={() => shift(-1)} style={{ background: 'white', border: '2px solid var(--accent)', borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>← Prev</button>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{monthLabel}</div>
        <button type="button" onClick={() => shift(1)} style={{ background: 'white', border: '2px solid var(--accent)', borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>Next →</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', textAlign: 'center', padding: '4px 0' }}>{d}</div>
        ))}
        {cells.map((cell, i) => (
          <div key={i} style={{ minHeight: 70, background: cell ? 'white' : 'transparent', border: cell ? '1px solid #eee' : 'none', borderRadius: 4, padding: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {cell && (
              <>
                <div style={{ fontSize: 10, color: 'var(--text-subtle)', textAlign: 'right' }}>{cell.getDate()}</div>
                {(byDay.get(cell.getDate()) || []).map(p => {
                  const pubs = Array.isArray(p.publications) ? p.publications : [];
                  const allPosted = pubs.length > 0 && pubs.every(x => x.status === 'posted');
                  const anyFailed = pubs.some(x => x.status === 'failed');
                  const bg = allPosted ? '#e8f5e9' : anyFailed ? '#ffebee' : '#eef2ff';
                  const fg = allPosted ? 'var(--positive)' : anyFailed ? 'var(--negative)' : '#1a56db';
                  const t = new Date(p.scheduled_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                  return (
                    <button key={p.id} type="button" onClick={() => onOpen(p.id)}
                      title={p.title || '(untitled)'}
                      style={{ background: bg, color: fg, border: 'none', borderRadius: 3, padding: '3px 5px', fontSize: 10, fontWeight: 600, textAlign: 'left', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t} · {(p.title || '').slice(0, 22)}
                    </button>
                  );
                })}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CompetitorEditor({ competitors, onSave }) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  function add() {
    if (!draft.trim()) return;
    const next = Array.from(new Set([...competitors, draft.trim()])).slice(0, 6);
    onSave(next);
    setDraft('');
  }
  function remove(handle) {
    onSave(competitors.filter(c => c !== handle));
  }
  return (
    <div className="row wrap" style={{ alignItems: "center", gap: 6, padding: "8px 12px", background: "var(--surface-raised)", border: "var(--border-w) solid var(--accent)", borderRadius: "var(--r-sm)", marginBottom: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 8 }}>
        Competitor handles
      </span>
      {competitors.map(c => (
        <span key={c} className="chip chip-outline" style={{ fontFamily: "monospace" }}>
          {c}
          {editing && <button onClick={() => remove(c)} className="btn-ghost" style={{ fontSize: 14, padding: "0 2px" }}>×</button>}
        </span>
      ))}
      {editing ? (
        <>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="instagram:handle"
            style={{ padding: '4px 8px', fontSize: 12, border: '2px solid var(--accent)', borderRadius: 4, marginLeft: 6 }}
          />
          <button onClick={add} className="btn btn-secondary btn-sm">Add</button>
          <button onClick={() => setEditing(false)} className="btn btn-secondary btn-sm">Done</button>
        </>
      ) : (
        <button onClick={() => setEditing(true)} style={{ background: 'none', border: 'none', color: '#1a4f9c', cursor: 'pointer', fontSize: 12, marginLeft: 6 }}>edit</button>
      )}
    </div>
  );
}

function BriefModal({ onClose, brief, setBrief, platforms, setPlatforms, onSubmit, submitting }) {
  function togglePlatform(p) {
    setPlatforms(platforms.includes(p) ? platforms.filter(x => x !== p) : [...platforms, p]);
  }
  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.modal} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 700 }}>Generate 9 posts</h2>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
          Optional brief — the more specific you are, the more useful the output. Examples:
          "We're launching a new mug colour next week", "Focus on UK studio kitchens", "Lean educational, not salesy."
          Leave empty for a balanced batch.
        </p>
        <label style={modalStyles.label}>Brief</label>
        <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={5} style={modalStyles.textarea} placeholder="What's the angle? Any constraints?" />
        <label style={modalStyles.label}>Platforms</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['instagram', 'tiktok', 'linkedin', 'facebook'].map(p => (
            <button key={p} onClick={() => togglePlatform(p)} type="button" style={platforms.includes(p) ? modalStyles.pillOn : modalStyles.pill}>
              {p}
            </button>
          ))}
        </div>
        <div style={modalStyles.footer}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={onSubmit} disabled={submitting || !platforms.length}>
            {submitting ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TrendingSoundsBar({ sounds, onRefresh, refreshing }) {
  const [open, setOpen] = React.useState(false);
  const visible = open ? sounds : sounds.slice(0, 5);
  return (
    <div style={{ background: 'var(--surface)', border: '2px solid var(--accent)', borderRadius: 6, padding: '10px 14px', marginTop: 10, marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: sounds.length ? 8 : 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Trending TikTok sounds
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
          {sounds.length ? `${sounds.length} cached` : '(none pulled yet — click Refresh)'}
        </span>
        <button onClick={onRefresh} disabled={refreshing} style={{ marginLeft: 'auto', padding: '4px 12px', fontSize: 11, border: '2px solid var(--accent)', background: 'var(--surface)', borderRadius: 999, cursor: 'pointer' }}>
          {refreshing ? 'Pulling…' : 'Refresh'}
        </button>
        {sounds.length > 5 && (
          <button onClick={() => setOpen(o => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1a4f9c', fontSize: 11 }}>
            {open ? 'collapse' : `show all ${sounds.length}`}
          </button>
        )}
      </div>
      {!!visible.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {visible.map((s, i) => (
            <a key={s.id || i} href={s.tiktok_url || '#'} target="_blank" rel="noreferrer"
              style={{ fontSize: 11, padding: '4px 10px', background: '#f6f6f6', border: '2px solid var(--accent)', borderRadius: 999, color: 'var(--text)', textDecoration: 'none', display: 'inline-flex', gap: 6, alignItems: 'center', maxWidth: 280 }}
              title={`${s.title} — ${s.author || 'unknown'}`}>
              <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
              {s.use_count && <span style={{ color: 'var(--text-subtle)', fontSize: 10 }}>{s.use_count.toLocaleString()}</span>}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function WinnersPanel({ winners, frameworkBreakdown, sparkline }) {
  if (!winners?.length && !frameworkBreakdown?.length) return null;
  const reachSeries = (sparkline || []).map(p => p.reach);
  const interactionSeries = (sparkline || []).map(p => p.interactions);
  return (
    <div style={{ background: '#fffceb', border: '1px solid #f0d260', padding: '12px 14px', borderRadius: 6, marginTop: 10, marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#7a5a00', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Top performers — last 90 days
        </div>
        {reachSeries.length > 1 && (
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 11, color: '#5d4000' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--text-subtle)' }}>Reach 30d</span>
              <Sparkline values={reachSeries} width={90} height={22} />
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--text-subtle)' }}>Engagement 30d</span>
              <Sparkline values={interactionSeries} width={90} height={22} />
            </span>
          </div>
        )}
      </div>
      {frameworkBreakdown?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {frameworkBreakdown.map(b => (
            <span key={b.framework} style={{ fontSize: 11, padding: '3px 10px', background: 'var(--surface)', border: '1px solid #f0d260', borderRadius: 999, color: '#5d4000' }}>
              <strong>{b.framework}</strong>: {b.avg_engagement_rate}% engagement
              <span style={{ color: 'var(--text-subtle)', marginLeft: 6 }}>({b.posts} post{b.posts === 1 ? '' : 's'})</span>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {winners.map(w => (
          <a key={w.id} href={w.published_url} target="_blank" rel="noreferrer" style={{ display: 'block', flex: '1 1 220px', minWidth: 220, padding: 10, background: 'var(--surface)', border: '1px solid #f0e0a0', borderRadius: 4, textDecoration: 'none', color: 'inherit', position: 'relative' }}>
            {w.is_heater && (
              <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 10, fontWeight: 700, padding: '2px 6px', background: 'var(--negative)', color: 'white', borderRadius: 3, letterSpacing: 0.5 }}>🔥 HEATER</span>
            )}
            <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{w.platform} · {w.kind}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: '4px 0', lineHeight: 1.3, paddingRight: w.is_heater ? 70 : 0 }}>{w.hook || '(no hook)'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{(w.caption || '').slice(0, 110)}…</div>
            <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: '#7a5a00' }}>{w.engagement_rate}% engagement</div>
          </a>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 8 }}>The next batch you generate will model these. 🔥 Heater = 2× the 30-day median reach.</div>
    </div>
  );
}

// Competitor scrape surface. Every Sunday at 06:00 the cron pulls the
// latest reels from each client's social_competitors handles via Apify
// and lands them here. Hidden entirely when the client has no
// competitors configured (the AM is told to add some on the
// CompetitorEditor below). Sorted by view count, top 6 shown inline.
function CompetitorTrackerPanel({ posts, refreshing, onRefresh, hasCompetitors }) {
  if (!hasCompetitors) return null;
  const top = posts.slice(0, 6);
  return (
    <div style={{ background: '#f5f3ff', border: '1px solid #d9d0f0', padding: '12px 14px', borderRadius: 6, marginTop: 10, marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#5b3d8e', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Competitor tracker — top recent posts
        </div>
        <button type="button" onClick={onRefresh} disabled={refreshing}
          style={{ fontSize: 11, padding: '3px 10px', background: 'white', color: '#5b3d8e', border: '1px solid #d9d0f0', borderRadius: 3, cursor: 'pointer' }}>
          {refreshing ? 'Scraping…' : '↻ Refresh now'}
        </button>
      </div>
      {top.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>No scrape yet. Sunday's cron will populate this, or click Refresh now.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {top.map(p => (
            <a key={p.id} href={p.post_url} target="_blank" rel="noreferrer"
              style={{ display: 'block', padding: 10, background: 'white', border: '1px solid #e5deef', borderRadius: 4, textDecoration: 'none', color: 'inherit' }}>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.4, display: 'flex', justifyContent: 'space-between' }}>
                <span>@{p.handle} · {p.platform}</span>
                {p.view_count && <span style={{ color: '#5b3d8e', fontWeight: 700 }}>{formatNum(p.view_count)}</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text)', margin: '4px 0', lineHeight: 1.35, fontWeight: 600 }}>
                {p.hook || (p.caption || '').slice(0, 80) || '(no caption)'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {p.likes_count ? `${formatNum(p.likes_count)} ♡` : ''}
                {p.likes_count && p.comments_count ? ' · ' : ''}
                {p.comments_count ? `${formatNum(p.comments_count)} 💬` : ''}
              </div>
            </a>
          ))}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginTop: 8 }}>Scraped weekly. Hooks here feed into the next batch's prompt as exemplars.</div>
    </div>
  );
}

// Inline badge for each storyboard frame's style code (A-G).
// Colour-coded so the AM can scan a 9-frame storyboard at a glance and
// confirm it follows the A → B → C → B → … → G grammar.
const STYLE_COLOURS = {
  A: { bg: 'var(--text)', fg: 'var(--surface)',    label: 'Hook' },
  B: { bg: '#fff4d6', fg: '#8a6500', label: 'Talk' },
  C: { bg: 'var(--accent-soft)',    fg: 'var(--text-muted)',    label: 'Word' },
  D: { bg: '#eef2ff', fg: '#3949ab', label: 'Screen' },
  E: { bg: '#e4f4e8', fg: 'var(--positive)', label: 'B-roll' },
  F: { bg: '#f4eafd', fg: '#5e2d8c', label: 'Prop' },
  G: { bg: 'var(--accent)', fg: 'var(--text)', label: 'CTA' },
};

function StyleBadge({ code, duration }) {
  const c = STYLE_COLOURS[code] || { bg: 'var(--accent-soft)', fg: 'var(--text-muted)', label: code };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 22, borderRadius: 11, background: c.bg, color: c.fg,
        fontSize: 11, fontWeight: 700,
      }}>{code}</span>
      <span style={{ fontSize: 10, color: 'var(--text-subtle)', fontWeight: 600 }}>
        {c.label}{duration ? ` · ${duration}s` : ''}
      </span>
    </span>
  );
}

function ShareLinkBanner({ url, onDismiss }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ background: '#e4f4e8', border: '1px solid #2e7d32', padding: '10px 14px', borderRadius: 4, marginTop: 10, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
      <strong style={{ fontSize: 12, color: 'var(--positive)' }}>Approval link ready —</strong>
      <input value={url} readOnly style={{ flex: 1, padding: '4px 8px', fontSize: 12, border: '1px solid #aac9b0', borderRadius: 3, background: 'var(--surface)', fontFamily: 'monospace' }} onFocus={e => e.target.select()} />
      <button onClick={() => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        style={{ padding: '4px 12px', fontSize: 11, background: 'var(--positive)', color: 'var(--surface)', border: 'none', borderRadius: 3, cursor: 'pointer' }}>
        {copied ? 'Copied' : 'Copy'}
      </button>
      <button onClick={onDismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--positive)' }}>×</button>
    </div>
  );
}

function PostCard({ post, engagement, media, onChange, onDelete, onPublish, onRefreshInsights, onGenerateMedia, onRenderTemplates, onDeleteMedia }) {
  const [open, setOpen] = useState(false);
  const [showImg, setShowImg] = useState(false);
  const [imgPrompt, setImgPrompt] = useState('');
  const [provider, setProvider] = useState('replicate');
  const [aspect, setAspect] = useState('1:1');
  const [styleBrief, setStyleBrief] = useState('');
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState(null);
  const [showPublish, setShowPublish] = useState(false);
  const [publishUrl, setPublishUrl] = useState('');
  const [renderingMedia, setRenderingMedia] = useState(null);

  async function handleGenerateMedia(kind) {
    setRenderingMedia(kind);
    try { await onGenerateMedia(kind); }
    finally { setRenderingMedia(null); }
  }
  const videos = (media || []).filter(m => m.kind === 'video');
  const audios = (media || []).filter(m => m.kind === 'audio');

  async function generateImage() {
    setGenerating(true);
    setErr(null);
    try {
      const r = await api.post(`/social/posts/${post.id}/image`, {
        provider, aspect_ratio: aspect, style_brief: styleBrief,
      });
      onChange({}); // trigger parent re-render via prop pattern
      Object.assign(post, r.post);
      setShowImg(false);
    } catch (e) {
      setErr(e.message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span className="chip chip-neutral" style={{ fontSize: 10 }}>{post.platform}</span>
          <span className="chip chip-neutral" style={{ fontSize: 10 }}>{post.kind}</span>
          <span className="chip chip-neutral" style={{ fontSize: 10 }}>{post.status}</span>
        </div>
        <button onClick={onDelete} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--negative)', fontSize: 18, lineHeight: 1 }}>×</button>
      </div>

      <div style={{ marginTop: 10 }}>
        <div className="caption mb-2">HOOK</div>
        <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.4 }}>{post.hook || <em style={{ color: 'var(--text-subtle)' }}>(none)</em>}</div>
      </div>

      <div style={{ marginTop: 10 }}>
        <div className="caption mb-2">CAPTION</div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: '#222', whiteSpace: 'pre-wrap' }}>{post.caption}</div>
      </div>

      {(post.hashtags || []).length > 0 && (
        <div style={{ marginTop: 8 }}>
          {post.hashtags.map(h => <span key={h} className="text-accent" style={{ fontSize: 11, marginRight: 6 }}>#{h.replace(/^#/, '')}</span>)}
        </div>
      )}

      {(post.image_urls || []).length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {post.image_urls.map((u, i) => (
            <a key={i} href={u} target="_blank" rel="noreferrer">
              <img src={u} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: "var(--r-sm)", border: "var(--border-w) solid var(--accent)" }} />
            </a>
          ))}
        </div>
      )}

      {engagement && (
        <div style={{ marginTop: 10, padding: '6px 10px', background: '#fffceb', border: '1px solid #f0d260', borderRadius: 4, fontSize: 11, color: '#5d4000', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {engagement.reach != null && <span><strong>{engagement.reach.toLocaleString()}</strong> reach</span>}
          {engagement.views != null && <span><strong>{engagement.views.toLocaleString()}</strong> views</span>}
          {engagement.likes != null && <span><strong>{engagement.likes.toLocaleString()}</strong> likes</span>}
          {engagement.comments != null && <span><strong>{engagement.comments.toLocaleString()}</strong> comments</span>}
          {engagement.shares != null && <span><strong>{engagement.shares.toLocaleString()}</strong> shares</span>}
          {engagement.saves != null && <span><strong>{engagement.saves.toLocaleString()}</strong> saves</span>}
          <button onClick={onRefreshInsights} style={{ background: 'none', border: 'none', color: '#7a5a00', textDecoration: 'underline', cursor: 'pointer', fontSize: 11, padding: 0 }}>refresh</button>
        </div>
      )}

      {(videos.length > 0 || audios.length > 0) && (
        <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {videos.map(v => (
            <div key={v.id} style={{ position: 'relative' }}>
              <video src={v.url} controls style={{ width: 180, borderRadius: 4, background: '#000' }} />
              <button onClick={() => onDeleteMedia(v.id)} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: 'var(--surface)', border: '2px solid var(--accent)', cursor: 'pointer', fontSize: 12, color: 'var(--negative)' }}>×</button>
            </div>
          ))}
          {audios.map(a => (
            <div key={a.id} style={{ position: 'relative', width: 220 }}>
              <audio src={a.url} controls style={{ width: '100%' }} />
              <button onClick={() => onDeleteMedia(a.id)} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: 'var(--surface)', border: '2px solid var(--accent)', cursor: 'pointer', fontSize: 12, color: 'var(--negative)' }}>×</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => setOpen(o => !o)} className="btn btn-secondary btn-sm">
          {open ? 'Hide storyboard' : `Storyboard (${(post.storyboard || []).length} frames)`}
        </button>
        <button onClick={async () => {
          try {
            const { url } = await api.get(`/social/posts/${post.id}/brief-url`);
            window.open(url, '_blank');
          } catch (e) { alert(`Could not open brief: ${e.message}`); }
        }} className="btn btn-secondary btn-sm">
          Production brief
        </button>
        <button onClick={() => setShowImg(s => !s)} className="btn btn-secondary btn-sm">
          {showImg ? 'Cancel image' : 'Generate image'}
        </button>
        <button onClick={() => handleGenerateMedia('voiceover')} disabled={renderingMedia === 'voiceover'} className="btn btn-secondary btn-sm">
          {renderingMedia === 'voiceover' ? 'Rendering…' : 'Generate voiceover'}
        </button>
        <button onClick={() => handleGenerateMedia('video')} disabled={renderingMedia === 'video'} className="btn btn-secondary btn-sm">
          {renderingMedia === 'video' ? 'Rendering UGC…' : 'Generate UGC video'}
        </button>
        {(post.storyboard || []).some(f => ['A', 'C', 'G'].includes(f.style)) && (
          <button onClick={async () => {
            setRenderingMedia('templates');
            try { await onRenderTemplates(); } finally { setRenderingMedia(null); }
          }} disabled={renderingMedia === 'templates'} className="btn btn-secondary btn-sm">
            {renderingMedia === 'templates' ? 'Rendering A/C/G…' : 'Render A/C/G clips'}
          </button>
        )}
        {post.status !== 'published' && (
          <button onClick={() => setShowPublish(s => !s)} className="btn btn-secondary btn-sm">
            {showPublish ? 'Cancel' : 'Mark published'}
          </button>
        )}
        {post.published_url && (
          <a href={post.published_url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">View live ↗</a>
        )}
      </div>

      {showPublish && (
        <div style={{ marginTop: 10, padding: 10, background: 'var(--surface-raised)', border: '2px solid var(--accent)', borderRadius: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.5 }}>
            Paste the live Instagram, TikTok or LinkedIn URL once it's published. We'll pull engagement automatically (IG only — paste numbers manually for other networks via Edit).
          </div>
          <input value={publishUrl} onChange={e => setPublishUrl(e.target.value)} placeholder="https://instagram.com/p/…" style={{ width: '100%', padding: '6px 10px', fontSize: 12, border: '2px solid var(--accent)', borderRadius: 4, boxSizing: 'border-box', marginBottom: 8 }} />
          <button onClick={() => { onPublish(publishUrl); setShowPublish(false); setPublishUrl(''); }}
            className="btn btn-primary btn-sm" disabled={!publishUrl.trim()}>
            Save & pull insights
          </button>
        </div>
      )}

      {open && (
        <div style={{ marginTop: 10, borderTop: '1px solid #eee', paddingTop: 10 }}>
          <div className="caption mb-2">VISUAL CONCEPT</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10 }}>{post.visual_concept}</div>
          <div className="caption mb-2">STORYBOARD</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "5px 6px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }} className="text-subtle">Style</th>
                <th style={{ textAlign: "left", padding: "5px 6px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }} className="text-subtle">#</th>
                <th style={{ textAlign: "left", padding: "5px 6px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }} className="text-subtle">Shot</th>
                <th style={{ textAlign: "left", padding: "5px 6px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }} className="text-subtle">On-screen</th>
                <th style={{ textAlign: "left", padding: "5px 6px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 }} className="text-subtle">Voiceover</th>
              </tr>
            </thead>
            <tbody>
              {(post.storyboard || []).map((f, i) => (
                <tr key={i} style={{ borderTop: '1px solid #f0f0f0' }}>
                  <td style={{ padding: "5px 6px", verticalAlign: "top", fontSize: 11, lineHeight: 1.4 }}>
                    {f.style ? <StyleBadge code={f.style} duration={f.duration_sec} /> : <span style={{ color: 'var(--text-subtle)' }}>—</span>}
                  </td>
                  <td style={{ padding: "5px 6px", verticalAlign: "top", fontSize: 11, lineHeight: 1.4 }}>{f.frame ?? i + 1}</td>
                  <td style={{ padding: "5px 6px", verticalAlign: "top", fontSize: 11, lineHeight: 1.4 }}>{f.shot}</td>
                  <td style={{ padding: "5px 6px", verticalAlign: "top", fontSize: 11, lineHeight: 1.4 }}>{f.on_screen_text || ''}</td>
                  <td style={{ padding: "5px 6px", verticalAlign: "top", fontSize: 11, lineHeight: 1.4 }}>{f.voiceover || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {post.notes && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-subtle)', fontStyle: 'italic' }}>{post.notes}</div>}
        </div>
      )}

      {showImg && (
        <div style={{ marginTop: 10, padding: 10, background: 'var(--surface-raised)', border: '2px solid var(--accent)', borderRadius: 4 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {['replicate', 'ideogram', 'adobe'].map(p => (
              <button key={p} onClick={() => setProvider(p)} type="button" className={`btn ${provider === p ? "btn-primary" : "btn-secondary"} btn-sm`}>{p}</button>
            ))}
            <select value={aspect} onChange={e => setAspect(e.target.value)} className="input">
              <option value="1:1">1:1</option>
              <option value="4:5">4:5</option>
              <option value="9:16">9:16</option>
              <option value="16:9">16:9</option>
            </select>
          </div>
          <input
            value={styleBrief}
            onChange={e => setStyleBrief(e.target.value)}
            placeholder="Style brief — e.g. Josef Müller-Brockmann style"
            style={{ width: '100%', padding: '6px 10px', fontSize: 12, border: '2px solid var(--accent)', borderRadius: 4, marginBottom: 8, boxSizing: 'border-box' }}
          />
          {err && <div style={{ color: 'var(--negative)', fontSize: 11, marginBottom: 6 }}>{err}</div>}
          <button onClick={generateImage} className="btn btn-primary btn-sm" disabled={generating}>
            {generating ? 'Rendering…' : `Render with ${provider}`}
          </button>
        </div>
      )}
    </div>
  );
}


const modalStyles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 20px', zIndex: 1000 },
  modal: { background: 'var(--surface)', borderRadius: 8, width: '100%', maxWidth: 540, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12, marginBottom: 6 },
  textarea: { width: '100%', padding: '8px 10px', fontSize: 13, border: '2px solid var(--accent)', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' },
  pill: { padding: '5px 12px', fontSize: 12, border: '2px solid var(--accent)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 999, textTransform: 'capitalize' },
  pillOn: { padding: '5px 12px', fontSize: 12, border: '1px solid #1a1a1a', background: 'var(--text)', color: 'var(--surface)', cursor: 'pointer', borderRadius: 999, fontWeight: 700, textTransform: 'capitalize' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 },
};
