import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { roWrite, READ_ONLY_MSG } from '../utils/readOnly';
import SocialPlannerChat from '../components/SocialPlannerChat';
import Sparkline from '../components/Sparkline';
import SocialSuiteOverview from '../components/SocialSuiteOverview';
import Stepper from '../components/Stepper';
import { SocialPublishContent } from '../components/social/SocialPublishStep';
import SocialLearnStep from '../components/social/SocialLearnStep';
import RefineChat from '../components/RefineChat';
import SuiteOverview from '../components/SuiteOverview';
import SuiteTabs from '../components/SuiteTabs';
import SocialAuditPanel from '../components/SocialAuditPanel';
import SocialDmBotPanel from '../components/SocialDmBotPanel';
import IgOutreachPanel from '../components/IgOutreachPanel';
import SwipeFilePanel from '../components/SwipeFilePanel';
import HeygenReelsPanel from '../components/HeygenReelsPanel';
import AutoEditPanel from '../components/AutoEditPanel';
import SocialFactoryMap from '../components/SocialFactoryMap';
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
  const { readOnly } = useAuth(); // client logins: view-only, no produce/build
  const [client, setClient] = useState(null);
  const [batches, setBatches] = useState([]);
  const [posts, setPosts] = useState([]);
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [competitors, setCompetitors] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [brief, setBrief] = useState('');
  const [platforms, setPlatforms] = useState(['instagram', 'tiktok']);
  const [postCount, setPostCount] = useState(9);
  const [postLength, setPostLength] = useState('medium'); // caption length target
  const [reelDraft, setReelDraft] = useState(null);
  const [createView, setCreateView] = useState(null); // null = factory steps | 'reels' = avatar-reel produce overlay
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
    // Produce
    'produce',
    // Schedule
    'plans', 'publish',
    // Engage
    'dm_bot', 'discover',
    // Measure
    'performance', 'competitors', 'audit', 'perf_insights',
    // legacy aliases kept so old deep links resolve
    'loop', 'learn',
  ]);
  // The Create group is now one factory spanning the whole pipeline
  // (Ideas → Brief → Workbench → Plan → Publish). Schedule is no longer a
  // separate section — Plan + Publish are the factory's last two steps — so its
  // old 'plans'/'publish' leaf tabs resolve into that single experience too.
  const inCreate = ['brainstorm', 'reels', 'video', 'produce', 'plans', 'publish'].includes(socialTab);
  useEffect(() => { if (!inCreate) setCreateView(null); }, [inCreate]);

  // Redirect legacy deep links to their new homes. Client (read-only) logins
  // can't reach the Build/produce factory — bounce them to Overview.
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

  // Stitch the whole storyboard into ONE reel via Remotion. Returns a single
  // social_post_media row (kind='motion', stitched) — one downloadable MP4
  // instead of the separate A/C/G clips.
  async function stitchReel(postId) {
    try {
      const { media } = await api.post(`/social/posts/${postId}/stitch-reel`, {});
      setMediaByPost(prev => ({ ...prev, [postId]: [...(prev[postId] || []), media] }));
      toast(`Stitched ${media.metadata?.frames || ''} frames into one reel.`, 'success');
    } catch (e) {
      toast(`Stitch failed: ${e.message}`, 'error');
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
      const { batch, posts: newPosts } = await api.post(`/social/clients/${id}/generate`, { brief, platforms, count: postCount, length: postLength });
      setBatches([batch, ...batches]);
      setActiveBatchId(batch.id);
      setPosts(newPosts);
      setBrief('');
      toast(`Generated ${newPosts.length} posts.`, 'success');
    } catch (e) {
      // Keep the brief so the AM can reopen Generate and retry without retyping.
      toast(`Generation failed: ${e.message}`, 'error');
    } finally {
      setGenerating(false);
    }
  }

  // Push a brainstorm post into the avatar-reel generator: use its storyboard
  // voiceover as the spoken script (falling back to hook + caption), then jump
  // to the Reels step pre-filled so the AM just picks a look + voice.
  function pushPostToReel(post) {
    const vo = (post.storyboard || []).map(f => (f.voiceover || '').trim()).filter(Boolean).join(' ');
    const script = vo || [post.hook, post.caption].filter(Boolean).join('\n\n');
    setReelDraft({ title: (post.hook || '').slice(0, 80), script, ts: Date.now() });
    setCreateView('reels');
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
          <UiButton variant="secondary" size="sm" {...roWrite(readOnly, { onClick: toggleAutopilotPaused })}>
            {client?.social_autopilot_paused ? '▶ Resume autopilot' : '⏸ Pause autopilot'}
          </UiButton>
        </div>
      </header>

      {/* Four top groups in workflow order: Overview / Create / Engage / Measure.
          Create is now the whole factory — Ideas → Brief → Workbench → Plan →
          Publish — so Schedule is no longer a separate section; its 'plans'/
          'publish' keys map into Create (steps 4 & 5) and stay valid as deep
          links. Legacy 'loop'/'learn' redirect. */}
      {(() => {
        // Workflow order, left → right: Create → Engage → Measure.
        const SUB_TABS = {
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
          swipe: 'capture',
          brainstorm: 'create', reels: 'create', video: 'create', produce: 'create',
          plans: 'create', publish: 'create',
          dm_bot: 'engage', discover: 'engage',
          performance: 'measure', competitors: 'measure', audit: 'measure', perf_insights: 'measure',
          learn: 'measure', loop: 'measure',
        };
        const currentGroup = GROUP_OF[socialTab] || 'overview';
        const topTabs = [
          { key: 'overview', label: 'Overview', active: currentGroup === 'overview', onClick: () => setSocialTab('overview') },
          { key: 'capture',  label: 'Capture',  active: currentGroup === 'capture',  onClick: () => setSocialTab('swipe') },
          { key: 'create',   label: 'Build',    active: currentGroup === 'create',   onClick: () => setSocialTab('brainstorm') },
          { key: 'engage',   label: 'Engage',   active: currentGroup === 'engage',   onClick: () => setSocialTab('dm_bot') },
          { key: 'measure',  label: 'Measure',  active: currentGroup === 'measure',  onClick: () => setSocialTab('perf_insights') },
        ];
        const subTabs = (SUB_TABS[currentGroup] || []).map(t => ({
          ...t, active: socialTab === t.key, onClick: () => setSocialTab(t.key),
        }));
        return (
          <>
            <SuiteTabs tabs={topTabs} />
            {/* Create has its own stepper (Ideas → Brief → Workbench → Plan → Publish), so it skips the sub-tab bar. */}
            {subTabs.length > 0 && currentGroup !== 'create' && <SuiteTabs tabs={subTabs} variant="sub" />}
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
          diagram={(
            <SocialFactoryMap
              onWorkbench={() => setSocialTab('brainstorm')}
              onPublish={() => setSocialTab('plans')}
              onEngage={() => setSocialTab('dm_bot')}
              onMeasure={() => setSocialTab('perf_insights')}
            />
          )}
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
          onGenerate={() => setSocialTab('brainstorm')}
          onBulkSchedule={() => setBulkOpen(true)}
          onOpenPlan={(pid) => setPlannerOpen({ planId: pid })}
          onOpenHookVault={() => setHookVaultOpen(true)}
        />
      )}

      {/* CAPTURE — the swipe file. A research surface upstream of Build: paste a
          reel, capture it as an idea card, then "Use as brief" jumps into Build
          with the brief pre-filled. Lives on its own tab so Build stays focused
          on producing posts. */}
      {socialTab === 'swipe' && (
        <SwipeFilePanel clientId={id}
          onUseAsBrief={(text) => { setBrief(text); setSocialTab('brainstorm'); }} />
      )}

      {/* CREATE — the social factory: Ideas → Brief → Workbench → Schedule.
          Reels are absorbed as a per-post "Produce" overlay (createView). */}
      {inCreate && (createView === 'reels' ? (
        <div>
          <button className="btn btn-ghost btn-sm" style={{ marginBottom: 'var(--s4)' }} onClick={() => setCreateView(null)}>← Back to Make</button>
          <HeygenReelsPanel clientId={id} draft={reelDraft} onScheduled={() => { setCreateView(null); setSocialTab('plans'); }} />
        </div>
      ) : (
        <BrainstormTab
          clientId={id}
          batches={batches}
          posts={posts}
          activeBatchId={activeBatchId}
          onSelectBatch={selectBatch}
          onDeleteBatch={deleteBatch}
          onMakeReel={pushPostToReel}
          onOpenReels={() => { setReelDraft(null); setCreateView('reels'); }}
          onReuseBrief={(b) => setBrief(b.brief || '')}
          onBulkSchedule={() => setBulkOpen(true)}
          onShareForApproval={shareBatchForApproval}
          generating={generating}
          shareUrl={shareUrl}
          onDismissShare={() => setShareUrl(null)}
          socialTab={socialTab}
          onNavTab={setSocialTab}
          briefContent={(
            <BriefForm clientId={id} brief={brief} setBrief={setBrief}
              platforms={platforms} setPlatforms={setPlatforms}
              count={postCount} setCount={setPostCount}
              length={postLength} setLength={setPostLength}
              onSubmit={generate} submitting={generating} />
          )}
          plansContent={(
            <PlansList key={plansRefreshKey} clientId={id} clientName={client?.name}
              onOpen={(planId) => setPlannerOpen({ planId })} onNewPlan={() => setPlannerOpen({ planId: null })} />
          )}
          publishContent={(
            <SocialPublishContent plans={plans} client={client} onOpenPlan={(pid) => setPlannerOpen({ planId: pid })} />
          )}
          engagement={engagement}
          mediaByPost={mediaByPost}
          updatePost={updatePost}
          deletePost={deletePost}
          publishPost={publishPost}
          refreshInsights={refreshInsights}
          renderTemplates={renderTemplates}
          stitchReel={stitchReel}
          generateMedia={generateMedia}
          deleteMedia={deleteMedia}
        />
      ))}

      {/* PLAN + PUBLISH now render inside the Create factory as steps 4 & 5
          (see BrainstormTab) — no separate Schedule section. */}

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


      {generating && <GeneratingOverlay count={postCount} />}
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
  clientId, batches, posts, activeBatchId, onSelectBatch, onDeleteBatch, onReuseBrief, onMakeReel, onOpenReels,
  onBulkSchedule, onShareForApproval, generating, shareUrl, onDismissShare,
  socialTab, onNavTab, briefContent, plansContent, publishContent,
  engagement, mediaByPost, updatePost, deletePost, publishPost,
  refreshInsights, renderTemplates, stitchReel, generateMedia, deleteMedia,
}) {
  const { readOnly } = useAuth();
  const isMobile = useIsMobile();
  const hasAutopilotSupported = activeBatchId && posts.some(p => ['instagram','facebook','linkedin'].includes(p.platform));
  const [refiningId, setRefiningId] = useState(null);
  const [refineErr, setRefineErr] = useState(null);
  // The Create factory is now three plain stages:
  //   1 Create  (brief + generate)
  //   2 Review  (refine the batch)
  //   3 Schedule (Plan + Publish merged — lock, calendar, autopilot)
  // Create + Review share the 'brainstorm' tab (batch-aware split); Schedule
  // owns 'plans'/'publish'. The swipe file is now its own 'Capture' tab.
  const STEP_TAB = { 1: 'brainstorm', 2: 'brainstorm', 3: 'produce', 4: 'plans' };
  const stepForTab = (tab) =>
    tab === 'produce' ? 3
      : (tab === 'plans' || tab === 'publish') ? 4
      : (activeBatchId ? 2 : 1);
  const [step, setStep] = useState(() => stepForTab(socialTab));
  const refining = refiningId ? posts.find(p => p.id === refiningId) : null;

  // Keep the stepper in sync when the tab changes from outside — deep links,
  // the Overview map, or buttons elsewhere. 'brainstorm' is left to the
  // batch-aware logic below (it owns the Create↔Review split).
  useEffect(() => {
    if (socialTab === 'produce') setStep(3);
    else if (socialTab === 'plans' || socialTab === 'publish') setStep(4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socialTab]);

  // When a batch first appears (e.g. after generating), jump into Review.
  useEffect(() => { if (activeBatchId) setStep(s => (s < 2 ? 2 : s)); }, [activeBatchId]);

  const steps = [
    { title: 'Create', sub: 'Brief & generate' },
    { title: 'Review', sub: 'Refine your posts' },
    { title: 'Produce', sub: 'Make the assets' },
    { title: 'Schedule', sub: 'Calendar & autopilot' },
  ];
  // Review needs a batch; clamp back to Create when there isn't one. Schedule
  // is reachable anytime (it shows every scheduled plan, not just this batch).
  function goStep(n) {
    if (n === 2 && !activeBatchId) { setStep(1); if (onNavTab && socialTab !== 'brainstorm') onNavTab('brainstorm'); return; }
    setRefiningId(null); setRefineErr(null);
    setStep(n);
    if (onNavTab && STEP_TAB[n] && STEP_TAB[n] !== socialTab) onNavTab(STEP_TAB[n]);
  }

  const postGrid = refining ? (
    <div>
      <div className="row between center mb-3">
        <button onClick={() => { setRefiningId(null); setRefineErr(null); }} className="btn btn-ghost btn-sm">
          ← Back to all {posts.length} posts
        </button>
        <div className="caption">Refining: {refining.platform} · {refining.kind}{refining.framework ? ` · ${refining.framework}` : ''}</div>
      </div>
      {refineErr && <div className="callout callout-danger mb-3">{refineErr}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1fr) 380px', gap: 'var(--s4)' }}>
        <PostCard post={refining} clientId={clientId} engagement={engagement[refining.id]} media={mediaByPost[refining.id] || []}
          onChange={patch => updatePost(refining.id, patch)}
          onDelete={() => { setRefiningId(null); deletePost(refining.id); }}
          onPublish={(url) => publishPost(refining.id, url)}
          onRefreshInsights={() => refreshInsights(refining.id)}
          onRenderTemplates={() => renderTemplates(refining.id)}
          onStitchReel={() => stitchReel(refining.id)}
          onGenerateMedia={(kind) => generateMedia(refining.id, kind)}
          onMakeReel={() => onMakeReel && onMakeReel(refining)}
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
    // Collapsed grid — all posts at a glance; click a tile to open the full
    // editor + Claude refine view (the `refining` branch above).
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
      {posts.map((p, i) => {
        const cap = (p.caption || '').trim();
        const media = mediaByPost[p.id] || [];
        return (
          <button key={p.id} type="button" onClick={() => setRefiningId(p.id)}
            className="card" style={{ textAlign: 'left', cursor: 'pointer', padding: 'var(--s4)', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 140 }}>
            <div className="row between center">
              <span className="caption">{p.platform} · {p.kind}</span>
              <span className="body-xs text-subtle">#{i + 1}</span>
            </div>
            <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {p.hook || cap.slice(0, 80) || '(no hook)'}
            </div>
            {cap && (
              <div className="body-xs text-subtle" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{cap}</div>
            )}
            <div style={{ marginTop: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {p.framework && <span className="chip chip-neutral" style={{ fontSize: 9 }}>{p.framework}</span>}
              {media.length > 0 && <span className="chip chip-accent" style={{ fontSize: 9 }}>{media.length} media</span>}
              {p.status === 'published' && <span className="chip chip-success" style={{ fontSize: 9 }}>published</span>}
            </div>
            <span className="body-xs" style={{ color: 'var(--accent)' }}>Open to edit →</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div>
      <Stepper steps={steps} current={step} onStep={goStep} />

      {/* STAGE 1 — CREATE (just the brief; past batches now live on Review) */}
      {step === 1 && (
        <div className="panel-step">
          <div style={{ maxWidth: 720 }}>
            <div className="h3">Create a batch of posts</div>
            <p className="body-sm text-muted" style={{ marginTop: 4, marginBottom: 14 }}>
              Claude proposes a batch — hook, caption, hashtags, visual concept and a storyboard, grounded in the brand, Google Trends and what competitors shipped this week. Choose how many, then generate. Need a starting point? Grab a reel from <button className="btn-inline-link" onClick={() => onNavTab && onNavTab('swipe')}>Capture</button>.
            </p>
            {briefContent}
            {batches.length > 0 && (
              <p className="body-xs text-subtle" style={{ marginTop: 14 }}>
                Your {batches.length} past {batches.length === 1 ? 'batch lives' : 'batches live'} in <button className="btn-inline-link" onClick={() => goStep(2)}>Review</button> — open one to edit or reuse its brief.
              </p>
            )}
            {batches.length === 0 && (
              <div style={{ marginTop: 20 }}>
                <ExampleBlock storageKey={`social_brainstorm_example_${clientId}`} title="this is what one of the 9 posts looks like — click Generate for real ones">
                  <ExamplePostCard />
                </ExampleBlock>
              </div>
            )}
          </div>
        </div>
      )}

      {/* STAGE 2 — REVIEW (batches, collapsible — the active one expands to its
          post grid; older batches sit collapsed. Open one to edit its posts). */}
      {step === 2 && (
        <div className="panel-step">
          <div className="row between center wrap" style={{ gap: 14, marginBottom: 16 }}>
            <div style={{ maxWidth: 520 }}>
              <div className="h3">Review your batches</div>
              <p className="body-sm text-muted" style={{ marginTop: 4 }}>
                Open a batch to edit its posts or refine with Claude. When you’re happy, send them to Produce or straight to Schedule.
              </p>
            </div>
            <div className="row wrap center" style={{ gap: 8 }}>
              <UiButton variant="ghost" onClick={() => goStep(1)} disabled={generating}>+ New batch</UiButton>
              <UiButton variant="ghost" {...roWrite(readOnly, { onClick: onShareForApproval, disabled: !posts.length })}>{shareUrl ? 'New approval link' : 'Send for approval'}</UiButton>
              <UiButton variant="ghost" onClick={() => goStep(4)} disabled={!posts.length}>Schedule →</UiButton>
              <UiButton variant="primary" onClick={() => goStep(3)}>Produce →</UiButton>
            </div>
          </div>
          {shareUrl && <ShareLinkBanner url={shareUrl} onDismiss={onDismissShare} />}
          {!batches.length ? (
            <div className="empty" style={{ padding: 'var(--s7)' }}>
              <p className="body">No batches yet. <button className="btn-inline-link" onClick={() => goStep(1)}>Create a batch</button> to fill the workbench.</p>
            </div>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              {batches.map(b => {
                const open = b.id === activeBatchId;
                return (
                  <div key={b.id} className="card" style={{ padding: 0, overflow: 'hidden', borderColor: open ? 'var(--accent)' : 'var(--card-border)' }}>
                    <div onClick={() => { if (!open) onSelectBatch(b.id); }}
                      style={{ cursor: open ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                      <span aria-hidden style={{ color: 'var(--text-subtle)', fontSize: 12 }}>{open ? '▾' : '▸'}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>
                          {new Date(b.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {b.post_count} posts
                        </div>
                        {b.brief && <div className="body-xs text-subtle" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.brief}</div>}
                      </div>
                      <button className="btn-inline-link" style={{ fontSize: 11, flex: '0 0 auto' }}
                        onClick={(e) => { e.stopPropagation(); onReuseBrief(b); goStep(1); }} title="Load this brief into a new batch">Reuse brief</button>
                      <button onClick={(e) => { e.stopPropagation(); if (window.confirm('Delete this batch and its posts?')) onDeleteBatch(b.id); }}
                        title="Delete batch" style={{ flex: '0 0 auto', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-subtle)', fontSize: 14, lineHeight: 1, padding: 2 }}>✕</button>
                    </div>
                    {open && (
                      <div style={{ padding: '0 16px 16px' }}>
                        {!posts.length
                          ? <div className="body-sm text-subtle" style={{ padding: '8px 0 12px' }}>Loading posts…</div>
                          : postGrid}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* STAGE 3 — PRODUCE (the factory floor: every asset in/through production) */}
      {step === 3 && (
        <div className="panel-step">
          <ProduceBoard clientId={clientId} onOpenReels={onOpenReels} onBack={() => goStep(2)} onNext={() => goStep(4)} />
        </div>
      )}

      {/* STAGE 4 — SCHEDULE (Plan + Publish merged) */}
      {step === 4 && (
        <div className="panel-step">
          <div className="row between center wrap" style={{ gap: 14, marginBottom: 16 }}>
            <div style={{ maxWidth: 520 }}>
              <div className="h3">Schedule &amp; autopilot</div>
              <p className="body-sm text-muted" style={{ marginTop: 4 }}>
                Lock the posts you like onto the calendar — Mon / Wed / Fri at 10am suits most brands — or bulk-schedule the batch. Autopilot then ships each channel automatically; the live queue is below.
              </p>
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              <UiButton variant="ghost" onClick={() => goStep(3)}>← Back to Produce</UiButton>
              <UiButton variant="primary" {...roWrite(readOnly, { onClick: onBulkSchedule, disabled: !hasAutopilotSupported })}>📅 Bulk schedule</UiButton>
            </div>
          </div>
          {!hasAutopilotSupported && (
            <div className="callout callout-warning" style={{ marginBottom: 14 }}>Bulk scheduling needs Instagram, Facebook or LinkedIn posts in this batch — you can still lock individual posts onto the calendar below.</div>
          )}
          {plansContent}
          <div style={{ marginTop: 28, paddingTop: 18, borderTop: 'var(--border-w) solid var(--card-border)' }}>
            <div className="caption caption-muted mb-3">Autopilot queue — publishes to every channel on schedule</div>
            {publishContent}
          </div>
        </div>
      )}
    </div>
  );
}

// Produce — the factory floor. One live board of every asset in or through
// production for this client (avatar reels with live render status, plus
// rendered video / voiceover / images), newest first, auto-refreshing while
// anything is still rendering. Comes back to exactly where you left off.
const PROD_STATUS = {
  queued:     { label: 'Queued',     bg: 'var(--surface-sunken)', fg: 'var(--text-muted)' },
  processing: { label: 'Rendering…', bg: 'var(--accent-soft)',    fg: 'var(--accent)' },
  ready:      { label: 'Ready',      bg: 'var(--positive-soft)',  fg: 'var(--positive)' },
  failed:     { label: 'Failed',     bg: 'var(--negative-soft)',  fg: 'var(--negative)' },
};
const PROD_ICON = { reel: '🎬', video: '🎬', image: '🖼️', audio: '🎙️', motion: '✨' };

function ProduceBoard({ clientId, onOpenReels, onBack, onNext }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const pollRef = useRef(null);

  async function load() {
    try { const r = await api.get(`/social/clients/${clientId}/production`); setData(r); setErr(null); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [clientId]);
  // Keep polling only while something is still rendering.
  useEffect(() => {
    clearInterval(pollRef.current);
    if (data && data.producing > 0) pollRef.current = setInterval(load, 6000);
    return () => clearInterval(pollRef.current);
    /* eslint-disable-next-line */
  }, [data?.producing]);

  const items = data?.items || [];
  return (
    <div>
      <div className="row between center wrap" style={{ gap: 14, marginBottom: 16 }}>
        <div style={{ maxWidth: 560 }}>
          <div className="h3">Produce</div>
          <p className="body-sm text-muted" style={{ marginTop: 4 }}>
            Every asset you’ve sent to production — reels, images and voiceovers — in one line. Reels render in the background; check back any time to watch them land.
          </p>
        </div>
        <div className="row wrap center" style={{ gap: 8 }}>
          <UiButton variant="ghost" onClick={onBack}>← Back to Review</UiButton>
          {onOpenReels && <UiButton variant="secondary" onClick={onOpenReels}>🎬 New avatar reel</UiButton>}
          <UiButton variant="primary" onClick={onNext}>Schedule →</UiButton>
        </div>
      </div>
      {data?.producing > 0 && (
        <div className="body-xs text-subtle" style={{ marginBottom: 10 }}>● {data.producing} still rendering — this refreshes automatically.</div>
      )}
      {err && <div className="callout callout-warning" style={{ marginBottom: 12 }}>{err}</div>}
      {!data ? (
        <div className="body-sm text-subtle" style={{ padding: 20 }}>Loading production…</div>
      ) : !items.length ? (
        <div className="empty" style={{ padding: 'var(--s7)' }}>
          <p className="body">Nothing in production yet. Open a post in Review and produce a reel, image or voiceover — or start an avatar reel — and it’ll line up here.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
          {items.map(it => {
            const st = PROD_STATUS[it.status] || PROD_STATUS.ready;
            return (
              <div key={it.key} className="card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ aspectRatio: '1 / 1', background: 'var(--surface-sunken)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
                  {it.thumb
                    ? <img src={it.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: 34 }}>{PROD_ICON[it.kind] || '📄'}</span>}
                </div>
                <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className="chip" style={{ fontSize: 9, background: 'var(--surface-sunken)', color: 'var(--text-muted)' }}>{it.label}</span>
                    <span className="chip" style={{ fontSize: 9, background: st.bg, color: st.fg }}>{st.label}</span>
                    {it.platform && <span className="body-xs text-subtle" style={{ textTransform: 'capitalize' }}>{it.platform}</span>}
                  </div>
                  <div className="body-sm" style={{ fontWeight: 600, lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{it.title}</div>
                  {it.status === 'failed' && it.error && <div className="body-xs text-negative">{String(it.error).slice(0, 120)}</div>}
                  <div style={{ marginTop: 'auto' }}>
                    {it.url && it.status === 'ready'
                      ? <a href={it.url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">Open ↗</a>
                      : (it.status === 'processing' || it.status === 'queued')
                        ? <span className="body-xs text-subtle">In the render queue…</span>
                        : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Past-batches list — a vertical sidebar in Review, a wrapping row in Generate,
// or a compact stack (the Create step's right column: reuse a brief or ✕-delete).
function BatchRail({ batches, activeBatchId, onSelectBatch, onDeleteBatch, onReuseBrief, horizontal, compact }) {
  if (!batches.length) return <div className="body-sm text-subtle">Nothing yet — click Generate to start.</div>;
  if (compact) {
    return (
      <div className="stack" style={{ gap: 8 }}>
        {batches.map(b => (
          <div key={b.id} className="card" style={{ padding: '8px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, borderColor: b.id === activeBatchId ? 'var(--accent)' : 'var(--card-border)' }}
            onClick={() => onSelectBatch(b.id)} title="Open this batch in Review">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>
                {new Date(b.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {b.post_count} posts
              </div>
              {b.brief && <div className="body-xs text-subtle" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.brief}</div>}
            </div>
            <button onClick={(e) => { e.stopPropagation(); onReuseBrief(b); }} className="btn-inline-link" style={{ fontSize: 11, flex: '0 0 auto' }} title="Load this brief into the form">Reuse</button>
            <button onClick={(e) => { e.stopPropagation(); if (window.confirm('Delete this batch and its posts?')) onDeleteBatch(b.id); }}
              title="Delete batch" style={{ flex: '0 0 auto', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-subtle)', fontSize: 13, lineHeight: 1, padding: 2 }}>✕</button>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div>
      {!horizontal && <div className="caption caption-muted mb-3">Past batches</div>}
      <div className={horizontal ? 'row wrap' : 'stack stack-sm'} style={horizontal ? { gap: 10 } : undefined}>
        {batches.map(b => (
          <div key={b.id} className="card" style={{ padding: 10, cursor: 'pointer', width: horizontal ? 240 : 'auto', borderColor: b.id === activeBatchId ? 'var(--accent)' : 'var(--border-neutral)' }} onClick={() => onSelectBatch(b.id)}>
            <div className="h3">{new Date(b.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
            <div className="body-xs text-subtle mt-2">{b.post_count} posts</div>
            {b.brief && <div className="body-xs mt-2" style={{ lineHeight: 1.4 }}>{b.brief.slice(0, 64)}{b.brief.length > 64 ? '…' : ''}</div>}
            <div className="row wrap mt-3" style={{ gap: 6 }}>
              <button onClick={(e) => { e.stopPropagation(); onReuseBrief(b); }} className="btn btn-secondary btn-sm">Reuse brief</button>
              {b.id === activeBatchId && (
                <button onClick={(e) => { e.stopPropagation(); onDeleteBatch(b.id); }} className="btn btn-danger btn-sm">Delete batch</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// One production action: an aligned button + a plain-English "what this does".
// Used to group the post's producers by intent so the flow reads itself.
function ProdAction({ label, hint, onClick, disabled, active, href, safe }) {
  const { readOnly } = useAuth();
  // Produce actions are blocked for a read-only client; view/download actions
  // (safe, or an href link) stay usable so they can still open/download.
  const blocked = readOnly && !safe && !href;
  const btnCls = 'btn btn-sm ' + (active ? 'btn-primary' : 'btn-secondary');
  const btnStyle = { flex: '0 0 auto', minWidth: 168, justifyContent: 'flex-start' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {href
        ? <a href={href} target="_blank" rel="noreferrer" className={btnCls} style={btnStyle}>{label}</a>
        : <button type="button" {...roWrite(blocked, { onClick, disabled })} className={btnCls} style={btnStyle}>{label}</button>}
      <span className="body-xs text-subtle" style={{ lineHeight: 1.3 }}>{blocked ? READ_ONLY_MSG : hint}</span>
    </div>
  );
}

function ProdGroup({ title, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="caption caption-muted" style={{ marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

// Click-to-edit text — shows the value with a small "✎ edit" affordance; the
// editor saves via onSave(newValue). Used for a post's hook and caption.
function EditableText({ label, value, multiline, placeholder, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  useEffect(() => { if (!editing) setDraft(value || ''); }, [value, editing]);
  return (
    <div style={{ marginTop: 10 }}>
      <div className="caption mb-2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>{label}</span>
        {!editing && <button type="button" onClick={() => setEditing(true)} className="inline-edit-btn">✎ edit</button>}
      </div>
      {editing ? (
        <div>
          {multiline
            ? <textarea className="input" value={draft} onChange={e => setDraft(e.target.value)} style={{ minHeight: 90, width: '100%' }} placeholder={placeholder} />
            : <input className="input" value={draft} onChange={e => setDraft(e.target.value)} style={{ width: '100%' }} placeholder={placeholder} />}
          <div className="row" style={{ gap: 6, marginTop: 6 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { onSave(draft); setEditing(false); }}>Save</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setDraft(value || ''); setEditing(false); }}>Cancel</button>
          </div>
        </div>
      ) : (
        multiline
          ? <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{value || <em style={{ color: 'var(--text-subtle)' }}>(none)</em>}</div>
          : <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.4 }}>{value || <em style={{ color: 'var(--text-subtle)' }}>(none)</em>}</div>
      )}
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
  const isMobile = useIsMobile();
  const twoCol = isMobile ? '1fr' : '1fr 1fr';
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

        <div style={{ display: 'grid', gridTemplateColumns: twoCol, gap: 14, marginBottom: 14 }}>
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

        <div style={{ display: 'grid', gridTemplateColumns: twoCol, gap: 14, marginBottom: 14 }}>
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

  async function deletePlan(planId) {
    if (!window.confirm('Delete this plan? It will be removed from the schedule and the autopilot queue.')) return;
    try {
      await api.delete(`/social/clients/${clientId}/plans/${planId}`);
      setPlans(prev => prev.filter(p => p.id !== planId));
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
    }
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
                <button type="button" onClick={() => deletePlan(p.id)} title="Delete plan" style={{ background: 'white', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', padding: '2px 8px', fontSize: 11, color: 'var(--negative)', cursor: 'pointer' }}>✕</button>
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

// Full-screen "Generating…" overlay shown while a batch is being produced, so
// the brief modal can close immediately rather than freezing on its button.
function GeneratingOverlay({ count = 9 }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(20,20,20,0.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ textAlign: 'center', padding: 'var(--s8) var(--s9)', maxWidth: 360 }}>
        <div className="spinner" style={{ margin: '0 auto var(--s4)' }} />
        <div className="h3">Generating {count} post{count === 1 ? '' : 's'}…</div>
        <p className="body-sm text-muted" style={{ marginTop: 6 }}>Claude is writing hooks, captions and storyboards — this usually takes 20–40 seconds.</p>
      </div>
    </div>
  );
}

// The generate form, rendered inline as the Brief step of the Build factory
// (no longer a modal). Writes the brief, picks count + platforms + optional
// reference uploads, and kicks off generation.
function BriefForm({ clientId, brief, setBrief, platforms, setPlatforms, count = 9, setCount, length = 'medium', setLength, onSubmit, submitting }) {
  const { readOnly } = useAuth();
  const [uploads, setUploads] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  function togglePlatform(p) {
    setPlatforms(platforms.includes(p) ? platforms.filter(x => x !== p) : [...platforms, p]);
  }
  // Reference uploads land in the brand asset banks (prop_image / b_roll_clip),
  // which the generator already feeds into the prompt — so they ground the batch.
  async function uploadRef(file) {
    if (!file || !clientId) return;
    const kind = file.type.startsWith('video/') ? 'b_roll_clip' : 'prop_image';
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file); fd.append('kind', kind); fd.append('name', file.name);
      const res = await fetch(`/api/brand/clients/${clientId}/assets`, { method: 'POST', credentials: 'include', body: fd });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const asset = await res.json();
      setUploads(u => [...u, { id: asset.id, name: asset.name, kind }]);
    } catch (e) {
      alert(`Upload failed: ${e.message}`);
    } finally {
      setUploading(false);
    }
  }
  return (
    <div className="card" style={{ width: '100%' }}>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
        Optional brief — the more specific you are, the more useful the output. Examples:
        "We're launching a new mug colour next week", "Focus on UK studio kitchens", "Lean educational, not salesy."
        Leave empty for a balanced batch.
      </p>
      <label style={modalStyles.label}>Brief</label>
      <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={5} style={modalStyles.textarea} placeholder="What's the angle? Any constraints?" />
      <label style={modalStyles.label}>How many posts</label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[1, 2, 3, 4, 5, 6, 9].map(nn => (
          <button key={nn} type="button" onClick={() => setCount && setCount(nn)}
            style={{ width: 38, height: 38, borderRadius: 'var(--r-md)', cursor: 'pointer', fontWeight: 800, fontFamily: 'inherit',
              border: 'var(--border-w) solid ' + (count === nn ? 'var(--accent)' : 'var(--card-border)'),
              background: count === nn ? 'var(--accent)' : 'var(--surface)', color: 'var(--text)' }}>
            {nn}
          </button>
        ))}
      </div>
      <label style={modalStyles.label}>Post length</label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[
          { id: 'short', label: 'Short', hint: 'punchy — 1–2 lines' },
          { id: 'medium', label: 'Medium', hint: 'a short paragraph' },
          { id: 'long', label: 'Long', hint: 'detailed / storytelling' },
        ].map(o => (
          <button key={o.id} type="button" onClick={() => setLength && setLength(o.id)}
            title={o.hint}
            style={{ ...(length === o.id ? modalStyles.pillOn : modalStyles.pill) }}>
            {o.label}
          </button>
        ))}
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-subtle)', margin: '6px 0 0' }}>
        {length === 'short' ? 'Punchy captions, 1–2 lines.' : length === 'long' ? 'Detailed, storytelling captions.' : 'A short paragraph per post.'}
      </p>
      <label style={modalStyles.label}>Platforms</label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {['instagram', 'tiktok', 'linkedin', 'facebook'].map(p => (
          <button key={p} onClick={() => togglePlatform(p)} type="button" style={platforms.includes(p) ? modalStyles.pillOn : modalStyles.pill}>
            {p}
          </button>
        ))}
      </div>
      {clientId && (<>
        <label style={modalStyles.label}>Your content (optional)</label>
        <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) uploadRef(f); e.target.value = ''; }} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : '⬆ Attach image / clip'}
          </button>
          {uploads.map(u => <span key={u.id} style={modalStyles.pill}>{u.kind === 'b_roll_clip' ? '🎬' : '🖼'} {u.name.slice(0, 22)}</span>)}
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-subtle)', margin: '6px 0 0', lineHeight: 1.5 }}>
          Reference images/clips are saved to this client's brand assets and used to ground the generated posts.
        </p>
      </>)}
      <div style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-primary" {...roWrite(readOnly, { onClick: onSubmit, disabled: submitting || !platforms.length })}>
          {submitting ? 'Generating…' : `✦ Generate ${count} post${count === 1 ? '' : 's'}`}
        </button>
        {readOnly && <p className="body-xs text-subtle" style={{ marginTop: 8 }}>{READ_ONLY_MSG}</p>}
      </div>
    </div>
  );
}

function TrendingSoundsBar({ sounds, onRefresh, refreshing }) {
  const { readOnly } = useAuth();
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
        <button {...roWrite(readOnly, { onClick: onRefresh, disabled: refreshing })} style={{ marginLeft: 'auto', padding: '4px 12px', fontSize: 11, border: 'var(--border-w) solid var(--card-border)', background: 'var(--surface)', borderRadius: 'var(--r-pill)', cursor: 'pointer' }}>
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
  const { readOnly } = useAuth();
  if (!hasCompetitors) return null;
  const top = posts.slice(0, 6);
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="caption">Competitor tracker — top recent posts</div>
        <button type="button" {...roWrite(readOnly, { onClick: onRefresh, disabled: refreshing })} className="btn btn-secondary btn-sm">
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

function PostCard({ post, clientId, engagement, media, onChange, onDelete, onPublish, onRefreshInsights, onGenerateMedia, onRenderTemplates, onStitchReel, onDeleteMedia, onMakeReel }) {
  const { readOnly } = useAuth();
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
  const [showProd, setShowProd] = useState(false);
  const [showAutoEdit, setShowAutoEdit] = useState(false);

  async function handleGenerateMedia(kind) {
    setRenderingMedia(kind);
    try { await onGenerateMedia(kind); }
    finally { setRenderingMedia(null); }
  }
  // 'motion' = Remotion clips (A/C/G frames + stitched reels); shown in the
  // same video players as UGC video.
  const videos = (media || []).filter(m => m.kind === 'video' || m.kind === 'motion');
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

      <EditableText label="HOOK" value={post.hook} onSave={v => onChange({ hook: v })} />
      <EditableText label="CAPTION" value={post.caption} multiline onSave={v => onChange({ caption: v })} />

      {(post.hashtags || []).length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', columnGap: 6, rowGap: 2 }}>
          {post.hashtags.map(h => <span key={h} className="text-accent" style={{ fontSize: 11 }}>#{h.replace(/^#/, '')}</span>)}
        </div>
      )}

      {(post.image_urls || []).length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {post.image_urls.map((u, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <a href={u} target="_blank" rel="noreferrer">
                <img src={u} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: "var(--r-sm)", border: "var(--border-w) solid var(--card-border)" }} />
              </a>
              <a href={u} download target="_blank" rel="noreferrer" style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700 }}>↓</a>
            </div>
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
          <button {...roWrite(readOnly, { onClick: onRefreshInsights })} style={{ background: 'none', border: 'none', color: 'var(--warning)', textDecoration: 'underline', cursor: 'pointer', fontSize: 11, padding: 0 }}>refresh</button>
        </div>
      )}

      {(videos.length > 0 || audios.length > 0) && (
        <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {videos.map(v => (
            <div key={v.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ position: 'relative' }}>
                <video src={v.url} controls style={{ width: 180, borderRadius: 'var(--r-sm)', background: '#000' }} />
                <button onClick={() => onDeleteMedia(v.id)} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: 'var(--surface)', border: 'var(--border-w) solid var(--card-border)', cursor: 'pointer', fontSize: 12, color: 'var(--negative)' }}>×</button>
              </div>
              <a href={v.url} download target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>↓ Download</a>
            </div>
          ))}
          {audios.map(a => (
            <div key={a.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 220 }}>
              <div style={{ position: 'relative' }}>
                <audio src={a.url} controls style={{ width: '100%' }} />
                <button onClick={() => onDeleteMedia(a.id)} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: 'var(--surface)', border: 'var(--border-w) solid var(--card-border)', cursor: 'pointer', fontSize: 12, color: 'var(--negative)' }}>×</button>
              </div>
              <a href={a.url} download target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>↓ Download</a>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <button onClick={() => setShowProd(s => !s)} className="btn btn-secondary btn-sm">🎬 Produce {showProd ? '▴' : '▾'}</button>
        {showProd && (() => {
          const acg = (post.storyboard || []).filter(f => ['A', 'C', 'G'].includes(f.style)).length;
          return (
            <div style={{ marginTop: 10, padding: 'var(--s4)', background: 'var(--surface-raised)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
              <div className="body-xs text-subtle" style={{ marginBottom: 10 }}>Pick how you want to make this post — you only need one route to a finished asset.</div>

              <ProdGroup title="🎬 Make a video">
                {onMakeReel && (
                  <ProdAction label="Avatar reel" onClick={onMakeReel}
                    hint="You (or a digital twin) talking to camera — AI generated in HeyGen." />
                )}
                {clientId && (
                  <ProdAction label={showAutoEdit ? 'Cancel auto-edit' : 'Auto-edit a clip'} active={showAutoEdit}
                    onClick={() => setShowAutoEdit(s => !s)}
                    hint="Upload raw footage you filmed — we trim, caption and export it." />
                )}
                <ProdAction label={renderingMedia === 'video' ? 'Rendering UGC…' : 'UGC video'} disabled={renderingMedia === 'video'}
                  onClick={() => handleGenerateMedia('video')}
                  hint="An AI actor performs the script — good for talking-head style." />
                <ProdAction label={renderingMedia === 'voiceover' ? 'Rendering…' : 'Voiceover only'} disabled={renderingMedia === 'voiceover'}
                  onClick={() => handleGenerateMedia('voiceover')}
                  hint="Just the spoken audio track (to lay over your own footage)." />
                {acg >= 1 && (
                  <ProdAction label={renderingMedia === 'templates' ? 'Rendering A/C/G…' : 'Render text cards'} disabled={renderingMedia === 'templates'}
                    onClick={async () => { setRenderingMedia('templates'); try { await onRenderTemplates(); } finally { setRenderingMedia(null); } }}
                    hint="Render the A/C/G text-card frames from the storyboard." />
                )}
                {onStitchReel && acg >= 2 && (
                  <ProdAction label={renderingMedia === 'stitch' ? 'Stitching…' : 'Stitch into one reel'} disabled={renderingMedia === 'stitch'}
                    onClick={async () => { setRenderingMedia('stitch'); try { await onStitchReel(); } finally { setRenderingMedia(null); } }}
                    hint="Combine the rendered text-card frames into one finished reel." />
                )}
              </ProdGroup>

              <ProdGroup title="🖼 Make an image">
                <ProdAction label={showImg ? 'Cancel image' : 'Generate image'} active={showImg}
                  onClick={() => setShowImg(s => !s)}
                  hint="An AI still image for a feed post or carousel." />
              </ProdGroup>

              <ProdGroup title="📋 Plan & hand-off">
                <ProdAction safe label={open ? 'Hide storyboard' : `Storyboard (${(post.storyboard || []).length})`} active={open}
                  onClick={() => setOpen(o => !o)}
                  hint="The shot-by-shot plan behind this post." />
                <ProdAction safe label="Production brief" onClick={async () => {
                  try { const { url } = await api.get(`/social/posts/${post.id}/brief-url`); window.open(url, '_blank'); }
                  catch (e) { alert(`Could not open brief: ${e.message}`); }
                }} hint="A printable brief to hand whoever films it." />
              </ProdGroup>

              <div style={{ marginBottom: 0 }}>
                <div className="caption caption-muted" style={{ marginBottom: 6 }}>✅ Publish</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {post.status !== 'published' && (
                    <ProdAction label={showPublish ? 'Cancel' : 'Mark published'} active={showPublish}
                      onClick={() => setShowPublish(s => !s)}
                      hint="Paste the live URL once it's posted — we pull the stats (IG)." />
                  )}
                  {post.published_url && (
                    <ProdAction label="View live ↗" href={post.published_url} hint="Open the published post." />
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {showPublish && (
        <div style={{ marginTop: 10, padding: 10, background: 'var(--surface-raised)', border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.5 }}>
            Paste the live Instagram, TikTok or LinkedIn URL once it's published. We'll pull engagement automatically (IG only — paste numbers manually for other networks via Edit).
          </div>
          <input value={publishUrl} onChange={e => setPublishUrl(e.target.value)} placeholder="https://instagram.com/p/…" style={{ width: '100%', padding: '6px 10px', fontSize: 12, border: 'var(--border-w) solid var(--card-border)', borderRadius: 'var(--r-sm)', boxSizing: 'border-box', marginBottom: 8 }} />
          <button {...roWrite(readOnly, { onClick: () => { onPublish(publishUrl); setShowPublish(false); setPublishUrl(''); }, disabled: !publishUrl.trim() })}
            className="btn btn-primary btn-sm">
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
          <button {...roWrite(readOnly, { onClick: generateImage, disabled: generating })} className="btn btn-primary btn-sm">
            {generating ? 'Rendering…' : `Render with ${provider}`}
          </button>
        </div>
      )}

      {showAutoEdit && clientId && <AutoEditPanel clientId={clientId} post={post} />}
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
