import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import SocialPlannerChat from '../components/SocialPlannerChat';
import Sparkline from '../components/Sparkline';
import SocialSuiteOverview from '../components/SocialSuiteOverview';
import SocialBrainstormStep from '../components/social/SocialBrainstormStep';
import SocialPlanStep from '../components/social/SocialPlanStep';
import SocialPublishStep from '../components/social/SocialPublishStep';
import SocialLearnStep from '../components/social/SocialLearnStep';
import RefineChat from '../components/RefineChat';
import SuiteOverview from '../components/SuiteOverview';
import SuiteTabs from '../components/SuiteTabs';
import SocialAuditPanel from '../components/SocialAuditPanel';
import SocialDmBotPanel from '../components/SocialDmBotPanel';
import IgOutreachPanel from '../components/IgOutreachPanel';
import SwipeFilePanel from '../components/SwipeFilePanel';
import HeygenReelsPanel from '../components/HeygenReelsPanel';
import ClientVideoPage from './ClientVideoPage';
import UiButton from '../components/ui/Button';
import { useTabParam } from '../hooks/useTabParam';
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
  // Top-level: overview / performance / pipeline / dm_bot (mirrors Organic).
  // Performance sub-tabs absorbed the old Insights group (winners +
  // competitors). Pipeline has 4 numbered steps. DM bot is its own
  // top-level tab (an always-on engagement automation, not a report).
  // 'loop' kept as alias for the renamed Performance landing so old deep
  // links resolve.
  const [socialTab, setSocialTab] = useTabParam('overview', [
    'overview',
    // Create
    'swipe', 'brainstorm', 'reels', 'video',
    // Schedule
    'plans', 'publish',
    // Engage
    'dm_bot', 'discover',
    // Measure
    'performance', 'competitors', 'audit', 'perf_insights',
    // legacy aliases kept so old deep links resolve
    'loop', 'learn',
  ]);

  // Redirect legacy deep links to their new homes.
  useEffect(() => {
    if (socialTab === 'loop') setSocialTab('perf_insights');
    if (socialTab === 'learn') setSocialTab('performance');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socialTab]);
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
      <div className="kicker"><span className="pip" /><span>{client?.name && <><span className="kicker-name">{client.name}</span> • </>}Shared</span></div>
      <header className="hero">
        <div>
          <h1 className="display mt-2">Shared</h1>
        </div>
        <div className="hero-actions">
          <UiButton variant="secondary" size="sm" onClick={toggleAutopilotPaused}>
            {client?.social_autopilot_paused ? '▶ Resume autopilot' : '⏸ Pause autopilot'}
          </UiButton>
        </div>
      </header>

      {/* Five top groups in workflow order: Overview / Create (Ideas · Posts ·
          Reels · Video) / Schedule (Plan · Publish) / Engage (DM bot · Discover) /
          Measure (Winners · Competitors · AI Audit · Insights). Sub-tab keys are
          unchanged so deep links stay valid; legacy 'loop'/'learn' redirect. */}
      {(() => {
        // Workflow order, left → right: Create → Schedule → Engage → Measure.
        const SUB_TABS = {
          create: [
            { key: 'swipe',      label: 'Ideas' },
            { key: 'brainstorm', label: 'Posts' },
            { key: 'reels',      label: 'Reels' },
            { key: 'video',      label: 'Video' },
          ],
          schedule: [
            { key: 'plans',   label: 'Plan' },
            { key: 'publish', label: 'Publish' },
          ],
          engage: [
            { key: 'dm_bot',   label: 'DM bot' },
            { key: 'discover', label: 'Discover' },
          ],
          measure: [
            { key: 'perf_insights', label: 'Insights' },
            { key: 'performance',   label: 'Winners' },
            { key: 'competitors',   label: 'Competitors' },
            { key: 'audit',         label: 'AI Audit' },
          ],
        };
        const GROUP_OF = {
          overview: 'overview',
          swipe: 'create', brainstorm: 'create', reels: 'create', video: 'create',
          plans: 'schedule', publish: 'schedule',
          dm_bot: 'engage', discover: 'engage',
          performance: 'measure', competitors: 'measure', audit: 'measure', perf_insights: 'measure',
          learn: 'measure', loop: 'measure',
        };
        const currentGroup = GROUP_OF[socialTab] || 'overview';
        const topTabs = [
          { key: 'overview', label: 'Overview', active: currentGroup === 'overview', onClick: () => setSocialTab('overview') },
          { key: 'create',   label: 'Create',   active: currentGroup === 'create',   onClick: () => setSocialTab('swipe') },
          { key: 'schedule', label: 'Schedule', active: currentGroup === 'schedule', onClick: () => setSocialTab('plans') },
          { key: 'engage',   label: 'Engage',   active: currentGroup === 'engage',   onClick: () => setSocialTab('dm_bot') },
          { key: 'measure',  label: 'Measure',  active: currentGroup === 'measure',  onClick: () => setSocialTab('perf_insights') },
        ];
        const subTabs = (SUB_TABS[currentGroup] || []).map(t => ({
          ...t, active: socialTab === t.key, onClick: () => setSocialTab(t.key),
        }));
        return (
          <>
            <SuiteTabs tabs={topTabs} />
            {subTabs.length > 0 && <SuiteTabs tabs={subTabs} variant="sub" />}
          </>
        );
      })()}

      {socialTab === 'overview' && (
        <SuiteOverview
          tagline="A month of on-brand content, mostly on autopilot."
          description="Brainstorm nine posts at once, film a reel in your own voice, schedule the lot across every channel — then learn what landed so the next batch starts ahead."
          ctaLabel="See performance"
          onCta={() => setSocialTab('loop')}
          status={[
            { label: 'Autopilot', value: client?.social_autopilot_paused ? 'Paused' : 'On', ok: !client?.social_autopilot_paused },
            { label: 'Plans', value: `${plans.length} scheduled`, ok: plans.length > 0 },
            { label: 'Competitors', value: competitors.length ? `${competitors.length} tracked` : 'None added', ok: competitors.length > 0 },
          ]}
          mapLayout="funnel"
          map={[
            { title: 'Create', subtitle: 'From swipe file to finished asset', nodes: [
              { label: 'Ideas', onClick: () => setSocialTab('swipe') },
              { label: 'Posts', onClick: () => setSocialTab('brainstorm') },
              { label: 'Reels', onClick: () => setSocialTab('reels') },
              { label: 'Video', onClick: () => setSocialTab('video') },
            ] },
            { title: 'Schedule', subtitle: 'Plan and autopilot to every channel', nodes: [
              { label: 'Plan',    onClick: () => setSocialTab('plans') },
              { label: 'Publish', onClick: () => setSocialTab('publish') },
            ] },
            { title: 'Engage', subtitle: 'Respond and reach out', nodes: [
              { label: 'DM bot',   onClick: () => setSocialTab('dm_bot') },
              { label: 'Discover', onClick: () => setSocialTab('discover') },
            ] },
            { title: 'Measure', subtitle: 'Insights, winners and what rivals do', nodes: [
              { label: 'Insights',    onClick: () => setSocialTab('perf_insights') },
              { label: 'Winners',     onClick: () => setSocialTab('performance') },
              { label: 'Competitors', onClick: () => setSocialTab('competitors') },
              { label: 'AI audit',    onClick: () => setSocialTab('audit') },
            ] },
          ]}
        />
      )}

      {/* PERFORMANCE → INSIGHTS — hero metrics, loop, next-up, recap. */}
      {socialTab === 'perf_insights' && (
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

      {/* PIPELINE → 1 BRAINSTORM */}
      {socialTab === 'brainstorm' && (
        <SocialBrainstormStep onNext={() => setSocialTab('plans')}>
          <BrainstormTab
            clientId={id}
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
        </SocialBrainstormStep>
      )}

      {/* PIPELINE → 2 PLAN */}
      {socialTab === 'plans' && (
        <SocialPlanStep onNext={() => setSocialTab('publish')} onBack={() => setSocialTab('brainstorm')}>
          <PlansList key={plansRefreshKey} clientId={id} clientName={client?.name} onOpen={(planId) => setPlannerOpen({ planId })} onNewPlan={() => setPlannerOpen({ planId: null })} />
        </SocialPlanStep>
      )}

      {/* PIPELINE → 3 PUBLISH */}
      {socialTab === 'publish' && (
        <SocialPublishStep
          plans={plans}
          client={client}
          onOpenPlan={(pid) => setPlannerOpen({ planId: pid })}
          onNext={() => setSocialTab('performance')}
          onBack={() => setSocialTab('plans')}
        />
      )}

      {/* PIPELINE → 4 LEARN — same WinnersPanel as Performance → Winners,
          framed as production feedback to close the loop. */}
      {socialTab === 'learn' && (
        <SocialLearnStep onBack={() => setSocialTab('publish')} onOpenHookVault={() => setHookVaultOpen(true)}>
          {(winners?.length || frameworkBreakdown?.length) ? (
            <WinnersPanel winners={winners} frameworkBreakdown={frameworkBreakdown} sparkline={sparkline} />
          ) : (
            <ExampleBlock storageKey={`social_winners_example_${id}`} title="this is what a winner looks like once posts start performing">
              <ExampleWinners />
            </ExampleBlock>
          )}
        </SocialLearnStep>
      )}

      {/* PERFORMANCE — Winners, framework breakdown, Hook Vault entry. */}
      {socialTab === 'performance' && (
        <div className="stack-lg">
          <div className="row between center wrap">
            <div>
              <div className="caption">Performance</div>
              <div className="h2 mt-2">Winners &amp; Hook Vault</div>
            </div>
            <UiButton variant="secondary" onClick={() => setHookVaultOpen(true)}>✦ Open Hook Vault</UiButton>
          </div>
          <p className="body" style={{ maxWidth: 640 }}>
            Your best-performing published posts surface here as <strong>winners</strong> — ranked by reach and
            engagement — and the framework breakdown shows which hook styles land. Winning hooks feed the Hook
            Vault for reuse across clients.
          </p>
          {(winners?.length || frameworkBreakdown?.length) ? (
            <WinnersPanel winners={winners} frameworkBreakdown={frameworkBreakdown} sparkline={sparkline} />
          ) : (
            <ExampleBlock storageKey={`social_winners_example_${id}`} title="this is what a winner looks like once posts start performing">
              <ExampleWinners />
            </ExampleBlock>
          )}
        </div>
      )}

      {/* COMPETITORS — editor, social scrape, landing-page diff,
          trending sounds (sounds are competitor-adjacent grounding). */}
      {socialTab === 'audit' && <SocialAuditPanel clientId={id} />}

      {socialTab === 'dm_bot' && <SocialDmBotPanel clientId={id} />}

      {socialTab === 'discover' && <IgOutreachPanel clientId={id} />}
      {socialTab === 'swipe' && <SwipeFilePanel clientId={id} />}
      {socialTab === 'reels' && <HeygenReelsPanel clientId={id} />}
      {socialTab === 'video' && <ClientVideoPage embedded clientId={id} />}

      {socialTab === 'competitors' && (
        <div className="stack-lg">
          <div>
            <div className="caption">Competitors</div>
            <div className="h2 mt-2">Whose hooks to model against</div>
          </div>
          <p className="body" style={{ maxWidth: 640 }}>
            Add 3–6 competitor handles. Each week we scrape their top-performing posts and pull regional
            trending sounds — both feed your next Brainstorm so Claude models against what's working in your niche.
          </p>
          <div id="competitor-editor-anchor">
            <CompetitorEditor competitors={competitors} onSave={saveCompetitors} />
          </div>
          {competitors.length > 0 ? (
            <CompetitorTrackerPanel
              posts={competitorPosts}
              refreshing={refreshingCompetitors}
              onRefresh={refreshCompetitorPosts}
              hasCompetitors={competitors.length > 0}
            />
          ) : (
            <ExampleBlock storageKey={`social_competitors_example_${id}`} title="this is what competitor tracking looks like once you add handles">
              <ExampleCompetitors />
            </ExampleBlock>
          )}
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
  clientId, batches, posts, activeBatchId, onSelectBatch, onDeleteBatch,
  onGenerate, onBulkSchedule, onShareForApproval, generating,
  engagement, mediaByPost, updatePost, deletePost, publishPost,
  refreshInsights, renderTemplates, generateMedia, deleteMedia,
}) {
  const hasAutopilotSupported = activeBatchId && posts.some(p => ['instagram','facebook','linkedin'].includes(p.platform));
  const [refiningId, setRefiningId] = useState(null);
  const [refineErr, setRefineErr] = useState(null);
  const refining = refiningId ? posts.find(p => p.id === refiningId) : null;
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
          {!posts.length && batches.length > 0 && (
            <div className="empty" style={{ padding: 'var(--s7)' }}><p className="body">Pick a batch on the left to see its posts.</p></div>
          )}
          {!posts.length && !batches.length && (
            <ExampleBlock storageKey={`social_brainstorm_example_${clientId}`} title="this is what one of the 9 posts looks like — click Generate for real ones">
              <ExamplePostCard />
            </ExampleBlock>
          )}
          {refining ? (
            <div>
              <div className="row between center mb-3">
                <button onClick={() => { setRefiningId(null); setRefineErr(null); }} className="btn btn-ghost btn-sm">
                  ← Back to all {posts.length} posts
                </button>
                <div className="caption">Refining: {refining.platform} · {refining.kind}{refining.framework ? ` · ${refining.framework}` : ''}</div>
              </div>
              {refineErr && <div className="callout callout-danger mb-3">{refineErr}</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', gap: 'var(--s4)' }}>
                <PostCard post={refining} engagement={engagement[refining.id]} media={mediaByPost[refining.id] || []}
                  onChange={patch => updatePost(refining.id, patch)}
                  onDelete={() => { setRefiningId(null); deletePost(refining.id); }}
                  onPublish={(url) => publishPost(refining.id, url)}
                  onRefreshInsights={() => refreshInsights(refining.id)}
                  onRenderTemplates={() => renderTemplates(refining.id)}
                  onGenerateMedia={(kind) => generateMedia(refining.id, kind)}
                  onDeleteMedia={(mediaId) => deleteMedia(mediaId, refining.id)} />
                <RefineChat
                  clientId={clientId}
                  kind="social_post"
                  artifact={renderPostForArtifact(refining)}
                  artifactMeta={`${refining.platform} · ${refining.kind}${refining.framework ? ` · ${refining.framework}` : ''}`}
                  onApplyRevision={(content) => {
                    const partial = parsePostFields(content);
                    if (!partial) {
                      setRefineErr('Could not parse revised post. Ask Claude to use the HOOK/CAPTION/HASHTAGS/STORYBOARD labels.');
                      return;
                    }
                    setRefineErr(null);
                    updatePost(refining.id, partial);
                  }}
                  onClose={() => setRefiningId(null)}
                  compact
                />
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 14 }}>
              {posts.map(p => (
                <div key={p.id} style={{ display: 'flex', flexDirection: 'column' }}>
                  <PostCard post={p} engagement={engagement[p.id]} media={mediaByPost[p.id] || []}
                    onChange={patch => updatePost(p.id, patch)}
                    onDelete={() => deletePost(p.id)}
                    onPublish={(url) => publishPost(p.id, url)}
                    onRefreshInsights={() => refreshInsights(p.id)}
                    onRenderTemplates={() => renderTemplates(p.id)}
                    onGenerateMedia={(kind) => generateMedia(p.id, kind)}
                    onDeleteMedia={(mediaId) => deleteMedia(mediaId, p.id)} />
                  <button onClick={() => setRefiningId(p.id)}
                    className="btn btn-secondary btn-sm"
                    style={{ marginTop: 6, alignSelf: 'flex-start' }}>
                    ✦ Refine with Claude
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Render a brainstorm post as a labelled text block so Claude sees the
// same structure the AM is editing. Storyboard frames render as a
// numbered list — the parser on the way back expects that shape.
function renderPostForArtifact(p) {
  const lines = [
    `PLATFORM: ${p.platform || ''} · ${p.kind || ''}`,
    p.framework ? `FRAMEWORK: ${p.framework}` : null,
    `HOOK: ${p.hook || ''}`,
    `CAPTION: ${p.caption || ''}`,
    `HASHTAGS: ${(p.hashtags || []).join(', ')}`,
    `STORYBOARD:\n${(p.storyboard || []).map((f, i) => `${i + 1}. ${typeof f === 'string' ? f : (f.description || JSON.stringify(f))}`).join('\n')}`,
  ].filter(Boolean);
  return lines.join('\n\n');
}

// Pull hook/caption/hashtags/storyboard back out of Claude's revision
// block. Tolerant of markdown bold and stray code fences. Returns only
// the fields that actually changed so the PUT is a partial update.
function parsePostFields(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').replace(/\*\*/g, '').trim();
  const labels = ['hook', 'caption', 'hashtags', 'storyboard'];
  const out = {};
  for (const label of labels) {
    const re = new RegExp(`(?:^|\\n)\\s*${label}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:${labels.join('|')})\\s*:|$)`, 'i');
    const m = cleaned.match(re);
    if (!m) continue;
    const raw = m[1].trim();
    if (!raw) continue;
    if (label === 'hashtags') {
      const tags = raw.split(/[,\n]/).map(t => t.trim().replace(/^#/, '')).filter(Boolean).slice(0, 30);
      if (tags.length) out.hashtags = tags;
    } else if (label === 'storyboard') {
      const frames = raw.split(/\n+/)
        .map(line => line.replace(/^\s*\d+[.)]\s*/, '').trim())
        .filter(Boolean);
      if (frames.length) out.storyboard = frames;
    } else {
      out[label] = raw;
    }
  }
  return Object.keys(out).length ? out : null;
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
      <div style={{ background: 'white', borderRadius: 'var(--r-sm)', width: 720, maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Bulk schedule {selected.size} of {posts.length} posts</h2>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
          Each ticked post becomes its own plan. The autopilot picks them up one per scheduled slot — fetches captions, reads the Drive folder, posts to the platforms below.
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Posts</div>
          <div style={{ maxHeight: 200, overflow: 'auto', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
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
              style={{ width: '100%', padding: '6px 8px', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', fontSize: 12 }} />
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
                    border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', cursor: 'pointer',
                  }}>{label}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Start date</div>
              <input type="date" value={startAt} onChange={e => setStartAt(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', fontSize: 12 }} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>Time</div>
              <input type="time" value={timeOfDay} onChange={e => setTimeOfDay(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', fontSize: 12 }} />
            </div>
          </div>
        </div>

        {error && <div style={{ padding: '8px 12px', background: 'var(--negative-soft)', color: 'var(--negative)', fontSize: 12, borderRadius: 'var(--r-sm)', marginBottom: 12 }}>{error}</div>}

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
      <div style={{ background: 'white', borderRadius: 'var(--r-sm)', width: 760, maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto', padding: 20 }}>
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
            style={{ flex: 1, padding: '6px 10px', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', fontSize: 13 }} />
          <select value={framework} onChange={e => setFramework(e.target.value)}
            style={{ padding: '6px 10px', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', fontSize: 12 }}>
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
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--surface-raised)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
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
                  style={{ background: 'var(--text)', color: 'white', border: 'none', borderRadius: 'var(--r-sm)', padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
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

function PlansList({ clientId, clientName, onOpen, onNewPlan }) {
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

  if (!plans.length) {
    return (
      <div>
        <div className="row between center wrap mb-4">
          <div>
            <div className="caption">Plans</div>
            <div className="h2 mt-2">Scheduled &amp; locked posts</div>
          </div>
          {onNewPlan && <UiButton variant="primary" onClick={onNewPlan}>+ Plan a post</UiButton>}
        </div>
        <p className="body mt-2 mb-5" style={{ maxWidth: 640 }}>
          A <strong>plan</strong> is a post you've approved and scheduled. Lock posts from a Brainstorm batch
          (or add one here), set a date, and autopilot publishes them to IG / Facebook / LinkedIn on cadence.
        </p>
        <ExampleBlock storageKey={`social_plans_example_${clientId}`} title="this is what a scheduled plan looks like">
          <div className="stack stack-sm">
            {[
              { when: 'Mon 10:00', ch: 'Instagram', hook: '3 ways to style a linen sofa for summer', status: 'Scheduled' },
              { when: 'Wed 10:00', ch: 'LinkedIn', hook: 'Why we switched to FSC-certified timber', status: 'Scheduled' },
              { when: 'Fri 10:00', ch: 'Facebook', hook: 'Behind the scenes: the new Quiet Luxury range', status: 'Draft' },
            ].map((r, i) => (
              <div key={i} className="card row between center" style={{ padding: 'var(--s3) var(--s4)' }}>
                <div className="row center" style={{ gap: 'var(--s4)' }}>
                  <span className="body-sm" style={{ fontWeight: 700, minWidth: 84 }}>{r.when}</span>
                  <span className="chip chip-outline">{r.ch}</span>
                  <span className="body-sm">{r.hook}</span>
                </div>
                <span className={`chip ${r.status === 'Scheduled' ? 'chip-success' : ''}`}>{r.status}</span>
              </div>
            ))}
          </div>
        </ExampleBlock>
      </div>
    );
  }

  return (
    <div>
      <div className="row between center wrap mb-4">
        <div>
          <div className="caption">Plans</div>
          <div className="h2 mt-2">Scheduled &amp; locked posts</div>
        </div>
        {onNewPlan && <UiButton variant="primary" onClick={onNewPlan}>+ Plan a post</UiButton>}
      </div>
    <div style={{ marginBottom: 22, padding: 14, background: 'var(--surface-raised)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Locked plans
        </div>
        <div style={{ display: 'flex', gap: 0, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
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
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'white', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
              <button type="button" onClick={() => onOpen(p.id)} style={{ background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0, color: 'var(--text)' }}>
                {p.title || '(untitled)'}
              </button>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {pubs.map(pub => {
                  const colour = pub.status === 'posted' ? 'var(--positive)' : pub.status === 'failed' ? 'var(--negative)' : pub.status === 'in_flight' ? 'var(--warning)' : 'var(--text-subtle)';
                  const bg = pub.status === 'posted' ? 'var(--positive-soft)' : pub.status === 'failed' ? 'var(--negative-soft)' : pub.status === 'in_flight' ? 'var(--warning-soft)' : 'var(--surface-sunken)';
                  const icon = pub.status === 'posted' ? '✓' : pub.status === 'failed' ? '✗' : '·';
                  return (
                    <span key={pub.platform} title={pub.error_message || pub.posted_url || pub.status}
                          style={{ fontSize: 11, color: colour, background: bg, padding: '2px 6px', borderRadius: 'var(--r-sm)', textTransform: 'capitalize' }}>
                      {icon} {pub.platform}
                    </span>
                  );
                })}
                {hasEng && (
                  <span style={{ fontSize: 11, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '2px 8px', borderRadius: 'var(--r-sm)' }}>
                    {eng.reach ? `${formatNum(eng.reach)} reach · ` : ''}{formatNum(eng.likes)} ♡ · {formatNum(eng.comments)} 💬{eng.shares ? ` · ${formatNum(eng.shares)} ↗` : ''}
                  </span>
                )}
                {p.scheduled_at && !pubs.some(x => x.status === 'posted') && editingPlanId !== p.id && (
                  <button type="button" onClick={() => beginEdit(p)}
                    style={{ fontSize: 11, color: 'var(--accent)', background: 'var(--accent-soft)', padding: '2px 8px', borderRadius: 'var(--r-sm)', border: 'none', cursor: 'pointer' }}
                    title="Click to reschedule">
                    ⏰ {new Date(p.scheduled_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                    {p.target_platforms?.length ? ` · ${p.target_platforms.join(', ')}` : ''}
                  </button>
                )}
                {editingPlanId === p.id && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <input type="datetime-local" value={editDraft} onChange={e => setEditDraft(e.target.value)}
                      style={{ fontSize: 11, padding: '2px 4px', border: '1px solid #1a56db', borderRadius: 'var(--r-sm)' }} />
                    <button type="button" onClick={() => saveEdit(p.id)} disabled={savingEdit}
                      style={{ fontSize: 11, padding: '2px 8px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer' }}>
                      {savingEdit ? '…' : 'Save'}
                    </button>
                    <button type="button" onClick={() => setEditingPlanId(null)}
                      style={{ fontSize: 11, padding: '2px 8px', background: 'white', color: 'var(--text-muted)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </span>
                )}
                <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{new Date(p.updated_at).toLocaleDateString('en-GB')}</span>
                <button type="button" onClick={() => downloadPlan(p.id, 'pdf')} style={{ background: 'white', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', padding: '2px 8px', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>↓ PDF</button>
                <button type="button" onClick={() => downloadPlan(p.id, 'docx')} style={{ background: 'white', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', padding: '2px 8px', fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>↓ Word</button>
              </div>
            </div>
          );
        })}
      </div>
      )}
    </div>
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
        <button type="button" onClick={() => shift(-1)} style={{ background: 'white', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>← Prev</button>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{monthLabel}</div>
        <button type="button" onClick={() => shift(1)} style={{ background: 'white', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>Next →</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
          <div key={d} style={{ fontSize: 10, color: 'var(--text-subtle)', textTransform: 'uppercase', textAlign: 'center', padding: '4px 0' }}>{d}</div>
        ))}
        {cells.map((cell, i) => (
          <div key={i} style={{ minHeight: 70, background: cell ? 'white' : 'transparent', border: cell ? '1px solid #eee' : 'none', borderRadius: 'var(--r-sm)', padding: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {cell && (
              <>
                <div style={{ fontSize: 10, color: 'var(--text-subtle)', textAlign: 'right' }}>{cell.getDate()}</div>
                {(byDay.get(cell.getDate()) || []).map(p => {
                  const pubs = Array.isArray(p.publications) ? p.publications : [];
                  const allPosted = pubs.length > 0 && pubs.every(x => x.status === 'posted');
                  const anyFailed = pubs.some(x => x.status === 'failed');
                  const bg = allPosted ? 'var(--positive-soft)' : anyFailed ? 'var(--negative-soft)' : 'var(--accent-soft)';
                  const fg = allPosted ? 'var(--positive)' : anyFailed ? 'var(--negative)' : 'var(--accent)';
                  const t = new Date(p.scheduled_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                  return (
                    <button key={p.id} type="button" onClick={() => onOpen(p.id)}
                      title={p.title || '(untitled)'}
                      style={{ background: bg, color: fg, border: 'none', borderRadius: 'var(--r-sm)', padding: '3px 5px', fontSize: 10, fontWeight: 600, textAlign: 'left', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
    <div className="card">
      <div className="row between center wrap mb-3">
        <div className="caption">Competitor handles</div>
        {!editing && (
          <button onClick={() => setEditing(true)} className="btn btn-secondary btn-sm">
            {competitors.length ? 'Edit' : '+ Add competitors'}
          </button>
        )}
      </div>
      {!competitors.length && !editing && (
        <p className="body-sm text-subtle">No competitors yet — add 3–6 handles to start tracking.</p>
      )}
      <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
        {competitors.map(c => (
          <span key={c} className="chip chip-outline" style={{ fontFamily: 'monospace' }}>
            {c}
            {editing && <button onClick={() => remove(c)} className="btn-ghost" style={{ fontSize: 14, padding: '0 2px' }}>×</button>}
          </span>
        ))}
        {editing && (
          <>
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && add()}
              placeholder="instagram:handle"
              style={{ padding: '6px 10px', fontSize: 12, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}
            />
            <button onClick={add} className="btn btn-secondary btn-sm">Add</button>
            <button onClick={() => setEditing(false)} className="btn btn-primary btn-sm">Done</button>
          </>
        )}
      </div>
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
    <div style={{ background: 'var(--surface)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', padding: '10px 14px', marginTop: 10, marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: sounds.length ? 8 : 0 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Trending TikTok sounds
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
          {sounds.length ? `${sounds.length} cached` : '(none pulled yet — click Refresh)'}
        </span>
        <button onClick={onRefresh} disabled={refreshing} style={{ marginLeft: 'auto', padding: '4px 12px', fontSize: 11, border: 'var(--border-w) solid var(--card-border)', background: 'var(--surface)', borderRadius: 'var(--r-pill)', cursor: 'pointer' }}>
          {refreshing ? 'Pulling…' : 'Refresh'}
        </button>
        {sounds.length > 5 && (
          <button onClick={() => setOpen(o => !o)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 11 }}>
            {open ? 'collapse' : `show all ${sounds.length}`}
          </button>
        )}
      </div>
      {!!visible.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {visible.map((s, i) => (
            <a key={s.id || i} href={s.tiktok_url || '#'} target="_blank" rel="noreferrer"
              style={{ fontSize: 11, padding: '4px 10px', background: 'var(--surface-raised)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-pill)', color: 'var(--text)', textDecoration: 'none', display: 'inline-flex', gap: 6, alignItems: 'center', maxWidth: 280 }}
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
    <div style={{ background: 'var(--warning-soft)', border: '1px solid #f0d260', padding: '12px 14px', borderRadius: 'var(--r-sm)', marginTop: 10, marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--warning)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Top performers — last 90 days
        </div>
        {reachSeries.length > 1 && (
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 11, color: 'var(--warning)' }}>
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
            <span key={b.framework} style={{ fontSize: 11, padding: '3px 10px', background: 'var(--surface)', border: '1px solid #f0d260', borderRadius: 'var(--r-pill)', color: 'var(--warning)' }}>
              <strong>{b.framework}</strong>: {b.avg_engagement_rate}% engagement
              <span style={{ color: 'var(--text-subtle)', marginLeft: 6 }}>({b.posts} post{b.posts === 1 ? '' : 's'})</span>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {winners.map(w => (
          <a key={w.id} href={w.published_url} target="_blank" rel="noreferrer" style={{ display: 'block', flex: '1 1 220px', minWidth: 220, padding: 10, background: 'var(--surface)', border: '1px solid #f0e0a0', borderRadius: 'var(--r-sm)', textDecoration: 'none', color: 'inherit', position: 'relative' }}>
            {w.is_heater && (
              <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 10, fontWeight: 700, padding: '2px 6px', background: 'var(--negative)', color: 'white', borderRadius: 'var(--r-sm)', letterSpacing: 0.5 }}>🔥 HEATER</span>
            )}
            <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{w.platform} · {w.kind}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: '4px 0', lineHeight: 1.3, paddingRight: w.is_heater ? 70 : 0 }}>{w.hook || '(no hook)'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{(w.caption || '').slice(0, 110)}…</div>
            <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, color: 'var(--warning)' }}>{w.engagement_rate}% engagement</div>
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
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="caption">Competitor tracker — top recent posts</div>
        <button type="button" onClick={onRefresh} disabled={refreshing} className="btn btn-secondary btn-sm">
          {refreshing ? 'Scraping…' : '↻ Refresh now'}
        </button>
      </div>
      {top.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>No scrape yet. Sunday's cron will populate this, or click Refresh now.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          {top.map(p => (
            <a key={p.id} href={p.post_url} target="_blank" rel="noreferrer"
              style={{ display: 'block', padding: 10, background: 'var(--surface)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', textDecoration: 'none', color: 'inherit' }}>
              <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.4, display: 'flex', justifyContent: 'space-between' }}>
                <span>@{p.handle} · {p.platform}</span>
                {p.view_count && <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>{formatNum(p.view_count)}</span>}
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

// Dismissible "this is what it looks like" block for empty states across
// the Social suite. Greyed sample content under a banner; the "Got it"
// dismissal is remembered per client/tab in localStorage.
function ExampleBlock({ storageKey, title, children }) {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(storageKey) === '1'; } catch { return false; }
  });
  if (dismissed) return null;
  return (
    <div className="example-block">
      <div className="example-banner">
        <span className="body-sm"><strong>Example</strong> — {title}</span>
        <button className="btn btn-secondary btn-sm" onClick={() => {
          setDismissed(true);
          try { localStorage.setItem(storageKey, '1'); } catch { /* ignore */ }
        }}>Got it</button>
      </div>
      <div className="example-body">{children}</div>
    </div>
  );
}

// Sample brainstorm post — mirrors the real PostCard's key fields so a
// first-time AM can see the shape of the output before generating.
function ExamplePostCard() {
  return (
    <div className="card" style={{ maxWidth: 420 }}>
      <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
        <span className="chip chip-accent">Instagram</span>
        <span className="chip chip-outline">PAS</span>
      </div>
      <div className="field">HOOK</div>
      <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>POV: your living room finally feels finished</div>
      <div className="field" style={{ marginTop: 8 }}>CAPTION</div>
      <div className="body-sm">The linen two-seater in Oatmeal — handmade in the UK, delivered in 4 weeks. Swipe to see it styled three ways. 🛋️</div>
      <div className="field" style={{ marginTop: 8 }}>HASHTAGS</div>
      <div className="body-sm" style={{ color: 'var(--text-muted)' }}>#interiordesign #linensofa #britishmade #quietluxury</div>
      <div className="field" style={{ marginTop: 8 }}>STORYBOARD</div>
      <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
        {['A', 'B', 'C', 'E', 'B', 'D', 'E', 'B', 'G'].map((c, i) => <StyleBadge key={i} code={c} />)}
      </div>
    </div>
  );
}

// Sample winners + framework breakdown for the empty Insights·Performance.
function ExampleWinners() {
  const winners = [
    { hook: 'POV: your living room finally feels finished', reach: '18.4k', eng: '5.2%', fw: 'PAS' },
    { hook: '3 ways to style a linen sofa for summer', reach: '12.1k', eng: '4.1%', fw: 'Listicle' },
    { hook: 'Why we switched to FSC-certified timber', reach: '9.8k', eng: '3.6%', fw: 'Story' },
  ];
  return (
    <div className="stack stack-sm">
      {winners.map((w, i) => (
        <div key={i} className="card row between center" style={{ padding: 'var(--s3) var(--s4)' }}>
          <div className="row center" style={{ gap: 'var(--s4)', minWidth: 0 }}>
            <span className="chip chip-outline">{w.fw}</span>
            <span className="body-sm" style={{ fontWeight: 600 }}>{w.hook}</span>
          </div>
          <div className="row center" style={{ gap: 'var(--s5)' }}>
            <span className="body-sm"><strong>{w.reach}</strong> <span className="text-subtle">reach</span></span>
            <span className="body-sm"><strong>{w.eng}</strong> <span className="text-subtle">eng</span></span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Sample competitor scrape for the empty Competitors tab.
function ExampleCompetitors() {
  const posts = [
    { handle: 'soho.home', platform: 'instagram', views: '212k', hook: 'The £49 trick that makes any room look expensive' },
    { handle: 'maker.and.son', platform: 'instagram', views: '88k', hook: 'We sat 200 people on this sofa. Here\'s what broke.' },
    { handle: 'loaf', platform: 'tiktok', views: '430k', hook: 'Rating viral sofa hacks so you don\'t have to' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
      {posts.map((p, i) => (
        <div key={i} className="card" style={{ padding: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: 0.4, display: 'flex', justifyContent: 'space-between' }}>
            <span>@{p.handle} · {p.platform}</span>
            <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>{p.views}</span>
          </div>
          <div style={{ fontSize: 12, margin: '4px 0', lineHeight: 1.35, fontWeight: 600 }}>{p.hook}</div>
        </div>
      ))}
    </div>
  );
}

// Inline badge for each storyboard frame's style code (A-G).
// Colour-coded so the AM can scan a 9-frame storyboard at a glance and
// confirm it follows the A → B → C → B → … → G grammar.
const STYLE_COLOURS = {
  A: { bg: 'var(--text)', fg: 'var(--surface)',    label: 'Hook' },
  B: { bg: 'var(--warning-soft)', fg: 'var(--warning)', label: 'Talk' },
  C: { bg: 'var(--accent-soft)',    fg: 'var(--text-muted)',    label: 'Word' },
  D: { bg: 'var(--accent-soft)', fg: 'var(--accent)', label: 'Screen' },
  E: { bg: 'var(--positive-soft)', fg: 'var(--positive)', label: 'B-roll' },
  F: { bg: 'var(--accent-soft)', fg: 'var(--accent)', label: 'Prop' },
  G: { bg: 'var(--accent)', fg: 'var(--text)', label: 'CTA' },
};

function StyleBadge({ code, duration }) {
  const c = STYLE_COLOURS[code] || { bg: 'var(--accent-soft)', fg: 'var(--text-muted)', label: code };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 22, borderRadius: 'var(--r-sm)', background: c.bg, color: c.fg,
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
    <div style={{ background: 'var(--positive-soft)', border: '1px solid #2e7d32', padding: '10px 14px', borderRadius: 'var(--r-sm)', marginTop: 10, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
      <strong style={{ fontSize: 12, color: 'var(--positive)' }}>Approval link ready —</strong>
      <input value={url} readOnly style={{ flex: 1, padding: '4px 8px', fontSize: 12, border: '1px solid #aac9b0', borderRadius: 'var(--r-sm)', background: 'var(--surface)', fontFamily: 'monospace' }} onFocus={e => e.target.select()} />
      <button onClick={() => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        style={{ padding: '4px 12px', fontSize: 11, background: 'var(--positive)', color: 'var(--surface)', border: 'none', borderRadius: 'var(--r-sm)', cursor: 'pointer' }}>
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
        <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{post.caption}</div>
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
              <img src={u} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: "var(--r-sm)", border: "var(--border-w) solid var(--card-border)" }} />
            </a>
          ))}
        </div>
      )}

      {engagement && (
        <div style={{ marginTop: 10, padding: '6px 10px', background: 'var(--warning-soft)', border: '1px solid #f0d260', borderRadius: 'var(--r-sm)', fontSize: 11, color: 'var(--warning)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {engagement.reach != null && <span><strong>{engagement.reach.toLocaleString()}</strong> reach</span>}
          {engagement.views != null && <span><strong>{engagement.views.toLocaleString()}</strong> views</span>}
          {engagement.likes != null && <span><strong>{engagement.likes.toLocaleString()}</strong> likes</span>}
          {engagement.comments != null && <span><strong>{engagement.comments.toLocaleString()}</strong> comments</span>}
          {engagement.shares != null && <span><strong>{engagement.shares.toLocaleString()}</strong> shares</span>}
          {engagement.saves != null && <span><strong>{engagement.saves.toLocaleString()}</strong> saves</span>}
          <button onClick={onRefreshInsights} style={{ background: 'none', border: 'none', color: 'var(--warning)', textDecoration: 'underline', cursor: 'pointer', fontSize: 11, padding: 0 }}>refresh</button>
        </div>
      )}

      {(videos.length > 0 || audios.length > 0) && (
        <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {videos.map(v => (
            <div key={v.id} style={{ position: 'relative' }}>
              <video src={v.url} controls style={{ width: 180, borderRadius: 'var(--r-sm)', background: '#000' }} />
              <button onClick={() => onDeleteMedia(v.id)} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: 'var(--surface)', border: 'var(--border-w) solid var(--card-border)', cursor: 'pointer', fontSize: 12, color: 'var(--negative)' }}>×</button>
            </div>
          ))}
          {audios.map(a => (
            <div key={a.id} style={{ position: 'relative', width: 220 }}>
              <audio src={a.url} controls style={{ width: '100%' }} />
              <button onClick={() => onDeleteMedia(a.id)} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: 'var(--surface)', border: 'var(--border-w) solid var(--card-border)', cursor: 'pointer', fontSize: 12, color: 'var(--negative)' }}>×</button>
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
        <div style={{ marginTop: 10, padding: 10, background: 'var(--surface-raised)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.5 }}>
            Paste the live Instagram, TikTok or LinkedIn URL once it's published. We'll pull engagement automatically (IG only — paste numbers manually for other networks via Edit).
          </div>
          <input value={publishUrl} onChange={e => setPublishUrl(e.target.value)} placeholder="https://instagram.com/p/…" style={{ width: '100%', padding: '6px 10px', fontSize: 12, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', boxSizing: 'border-box', marginBottom: 8 }} />
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
                  <td style={{ padding: "5px 6px", verticalAlign: "top", fontSize: 11, lineHeight: 1.4 }}>
                    {f.voiceover || ''}
                    {f.delivery && <div style={{ marginTop: 4, fontSize: 10, color: 'var(--accent)', fontStyle: 'italic' }}>🎬 {f.delivery}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {post.notes && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-subtle)', fontStyle: 'italic' }}>{post.notes}</div>}
        </div>
      )}

      {showImg && (
        <div style={{ marginTop: 10, padding: 10, background: 'var(--surface-raised)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
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
            style={{ width: '100%', padding: '6px 10px', fontSize: 12, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', marginBottom: 8, boxSizing: 'border-box' }}
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
  modal: { background: 'var(--surface)', borderRadius: 'var(--r-sm)', width: '100%', maxWidth: 540, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  label: { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12, marginBottom: 6 },
  textarea: { width: '100%', padding: '8px 10px', fontSize: 13, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' },
  pill: { padding: '5px 12px', fontSize: 12, border: 'var(--border-w) solid var(--card-border)', background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 'var(--r-pill)', textTransform: 'capitalize' },
  pillOn: { padding: '5px 12px', fontSize: 12, border: '1px solid #1a1a1a', background: 'var(--text)', color: 'var(--surface)', cursor: 'pointer', borderRadius: 'var(--r-pill)', fontWeight: 700, textTransform: 'capitalize' },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 },
};
