// Social ideation — calls Claude with a structured tool to produce nine
// posts at a time, each with a hook, caption, hashtags, visual concept,
// and a frame-by-frame storyboard. The Claude prompt is grounded in:
//
//   1. The client's briefing + monthly focus (from the clients row)
//   2. Google Trends rising signals (via DataForSEO) so suggestions reach
//      for currently-moving topics rather than evergreen brand speak.
//   3. The client's competitor handles + any exemplars the AM pastes in,
//      so the model has a concrete shape to follow.
//   4. Proven copy frameworks (Hook-Story-Offer, AIDA, PAS) baked into
//      the system prompt so output is structured rather than free-form.

const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../db');
const dataForSEO = require('../connectors/dataforseo');
const apify = require('../connectors/apify');
const meta = require('../connectors/meta');
const { decrypt } = require('../utils/encryption');

const MODEL = 'claude-sonnet-4-6';

function client() {
  return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
}

const SYSTEM = `You design high-engagement organic social content for performance-marketing clients.
Every post you propose is anchored in a proven framework: Hook → Story → Offer; AIDA (attention/interest/desire/action); or Problem → Agitate → Solve. Never produce filler.

Your job is to translate the brand's brief and the current topical signals into nine concrete posts the account manager can either publish as-is or refine. Each post must:
 - Start with a verbal/visual hook that earns the first 3 seconds.
 - Be plausibly mid-funnel (educate or entertain), not directly salesy unless the brief says so.
 - Cite which framework you used and why this approach works for THIS topic + audience.
 - Include a frame-by-frame storyboard if the post is a Reel or Story (3-9 frames; each frame gets a shot description, on-screen text if any, and a voiceover or caption line).
 - For static posts and carousels, the storyboard is just the slides/panels.

# Reel storyboards — Video Style System
When the post is a reel, the storyboard must follow October's seven-style grammar so the same template handles every video. Tag each frame with a style code A-G:

 A · Text hook on black, 2-4s. ALWAYS the first frame of every reel. No filming — pure text overlay. Bold white or yellow on black. The provocative opener the viewer reads before they see a face.
 B · Talking head anchor, 10-45s. The host (AM or client) at a fixed desk/studio setup, front camera, RØDE mic. This is the anchor — other styles cut away from B and back to B. Aim for 2-3 B frames per reel, each 10-15s. Voiceover IS the dialogue.
 C · Word card, 1-2s. One word or a 3-word phrase on plain white or black. Hard cut. Punctuation between B sections — use 2-3 times per reel max. No filming.
 D · Screen reveal, 4-8s. Once per reel max. Close-up of a laptop screen — analytics, a landing page, a dashboard. Voiceover continues from B.
 E · B-roll voiceover, 5-12s. Used when content references the built environment, product, or client's project work. No talking to camera; voiceover runs over the footage. For agency posts that's London streets; for clients it's their projects/sites — far stronger and the main reason this style varies most by client.
 F · Prop close-up, 3-6s. Hands holding a physical object — notebook, printed brief, drawing, sample. Warm desk light, voiceover continues. Avoids stock-photo feel.
 G · Kinetic CTA on black, 3-5s. ALWAYS the last frame of every reel. URL or CTA in animated text. Brand-consistent — same font/motion across every video.

Sequence rule: A opens every reel, G closes every reel. Between them, cycle B with cutaways (C/D/E/F) so the viewer never sees more than ~15s of the same shot. Typical 60s reel: A → B → C → B → E → B → F → G. Don't pad — if a point only needs 3 B sections, ship 3.

For non-reel formats (carousels, static posts), omit style codes; the storyboard is just slides/panels.`;

const POSTS_TOOL = {
  name: 'propose_posts',
  description: 'Submit the batch of nine proposed posts. Always call this — never reply with free text.',
  input_schema: {
    type: 'object',
    properties: {
      posts: {
        type: 'array',
        minItems: 9,
        maxItems: 9,
        items: {
          type: 'object',
          properties: {
            platform: { type: 'string', enum: ['instagram', 'tiktok', 'linkedin', 'facebook'] },
            kind: { type: 'string', enum: ['post', 'reel', 'story', 'carousel'] },
            framework: { type: 'string', description: 'Hook-Story-Offer | AIDA | PAS | UGC-style' },
            framework_rationale: { type: 'string', description: 'Why this framework fits this topic + audience.' },
            hook: { type: 'string' },
            caption: { type: 'string' },
            hashtags: { type: 'array', items: { type: 'string' }, maxItems: 5, description: '3–5 highly relevant hashtags only (a couple niche/specific + one or two broader). Never a wall — per Instagram, count does not boost reach.' },
            visual_concept: { type: 'string', description: 'One-paragraph visual direction — composition, palette, mood, key references.' },
            suggested_sound: { type: 'string', description: 'For reels only — the title of a TikTok sound from the trending list provided, if one fits. Leave empty otherwise.' },
            storyboard: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  frame: { type: 'number' },
                  style: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], description: 'For reels only — the Video Style System code. A=text hook, B=talking head, C=word card, D=screen reveal, E=b-roll voiceover, F=prop close-up, G=kinetic CTA. Omit for non-reel formats.' },
                  shot: { type: 'string', description: 'What the camera sees in this frame.' },
                  on_screen_text: { type: 'string' },
                  voiceover: { type: 'string' },
                  delivery: { type: 'string', description: 'For talking-to-camera frames (style B) only — a short delivery note for the host: where to hold the lens, where to glance away, where to land a one-second pause. Omit for non-talking-head frames.' },
                  duration_sec: { type: 'number', description: 'Target duration. A: 2-4, B: 10-15, C: 1-2, D: 4-8, E: 5-12, F: 3-6, G: 3-5.' },
                },
                required: ['frame', 'shot'],
              },
            },
          },
          required: ['platform', 'kind', 'framework', 'hook', 'caption', 'visual_concept', 'storyboard'],
        },
      },
    },
    required: ['posts'],
  },
};

async function generateBatch({ clientId, brief, platforms, count, length }) {
  // How many posts to produce this batch (1–9; default 9).
  const n = Math.max(1, Math.min(9, parseInt(count, 10) || 9));
  // Caption-length target — the AM picks this on the brief form.
  const LENGTH_GUIDE = {
    short: 'Keep every caption SHORT — 1–2 punchy lines, ~20–40 words. No preamble.',
    medium: 'Keep captions MEDIUM — one tight paragraph, ~40–80 words.',
    long: 'Write LONG, detailed captions — 2–4 short paragraphs, storytelling, ~120–200 words.',
  };
  const lengthGuide = LENGTH_GUIDE[length] || LENGTH_GUIDE.medium;
  const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  const c = rows[0];
  if (!c) throw new Error('Client not found');

  // Topical signal — DataForSEO Google Trends rising queries for keywords
  // pulled from the client's briefing / domain. Best-effort: if creds
  // aren't set or the request fails, we just go without.
  const trendSeed = extractTrendKeywords(c, brief);
  let trends = null;
  try {
    if (trendSeed.length) trends = await dataForSEO.fetchGoogleTrends(trendSeed);
  } catch (err) {
    console.warn('[social] trends fetch failed (non-fatal):', err.message);
  }

  // Performance loop — what's actually worked for this client in the last
  // 90 days. The top 5 by engagement rate go into the prompt as concrete
  // exemplars to model. Closes the "scientifically backed" loop with the
  // client's own data, not a generic trend.
  const winners = await getRecentWinners(clientId, { days: 90, limit: 5 });

  // Brand asset banks — Claude needs to know what b-roll clips and prop
  // images already exist for this client so it can pick from them in
  // E/F frames rather than inventing footage that doesn't exist.
  const { rows: assets } = await pool.query(
    `SELECT id, kind, name FROM brand_assets WHERE client_id = $1
     AND kind IN ('b_roll_clip', 'prop_image') ORDER BY kind, created_at DESC LIMIT 100`,
    [clientId]
  );
  const bRollBank = assets.filter(a => a.kind === 'b_roll_clip');
  const propBank = assets.filter(a => a.kind === 'prop_image');

  // Trending TikTok sounds — pulled from the most recent cached snapshot
  // (refreshed via /refresh-trending-sounds). Surfacing the top ~10 in
  // the prompt lets Claude suggest sounds that pair with the storyboard
  // rather than the AM hunting for music after the fact.
  const trendingSounds = await getRecentTrendingSounds(clientId, { limit: 10 });

  const competitorList = (c.social_competitors || []).filter(Boolean);
  const platformList = Array.isArray(platforms) && platforms.length ? platforms : ['instagram', 'tiktok'];

  // Pull the top recent competitor posts the weekly Sunday scrape
  // landed. Surfaces them in the prompt as exemplars so the batch
  // generator can lift the angle / structure of what the competitive
  // set is actually shipping rather than guessing from handles alone.
  const { rows: competitorPosts } = await pool.query(
    `SELECT handle, platform, hook, view_count, likes_count
       FROM competitor_posts
      WHERE client_id = $1
        AND fetched_at >= NOW() - INTERVAL '14 days'
      ORDER BY view_count DESC NULLS LAST
      LIMIT 8`,
    [clientId]
  );

  const userPrompt = `Client: ${c.name}
About the brand: ${c.briefing_field || '(no briefing — work from the brief below alone)'}
This month's focus: ${c.monthly_focus || '(none)'}

Brief from the account manager (treat this as the directive):
${brief || '(no extra brief — propose a balanced batch)'}

Platforms in scope: ${platformList.join(', ')}
Competitor handles (use as style/voice reference if helpful): ${competitorList.length ? competitorList.join(', ') : '(none configured)'}

${competitorPosts.length
  ? `What competitors are actually shipping right now (top scraped posts from the last 14 days — lift the angle / hook structure, don't copy verbatim):
${competitorPosts.map((p, i) => `${i + 1}. [@${p.handle} · ${p.platform}${p.view_count ? ` · ${Number(p.view_count).toLocaleString()} views` : ''}] "${p.hook || '(no hook captured)'}"`).join('\n')}`
  : '(no scraped competitor posts yet — Sunday\'s cron will populate this)'}

${trends ? `Currently rising signals (Google Trends, last 30 days, UK): ${trends.rising.map(r => r.label).filter(Boolean).join(', ') || '(no rising queries)'}` : '(no trend signal available — proceed without)'}

Brand asset banks available for E/F frames (refer to a clip or prop by name in your "shot" field so the AM knows which existing asset to use, rather than inventing new footage):
 - B-roll bank (Style E): ${bRollBank.length ? bRollBank.map(a => a.name).join(', ') : '(no clips uploaded yet — describe what they should film)'}
 - Prop library (Style F): ${propBank.length ? propBank.map(a => a.name).join(', ') : '(no props uploaded yet — describe what they should photograph)'}

${trendingSounds.length
  ? `Trending TikTok sounds right now (suggest a suggested_sound on reel posts where it fits — pick one by name from this list, don't invent):\n${trendingSounds.map((s, i) => `${i + 1}. "${s.title}" by ${s.author || 'unknown'}${s.use_count ? ` (used in ${s.use_count.toLocaleString()} videos)` : ''}`).join('\n')}`
  : '(no trending sounds cached — the AM can click Refresh Trending Sounds on the Social tab to pull a fresh set)'}

${winners.length
  ? `Posts that have actually performed well for THIS brand in the last 90 days (model the new batch on what's already engaging this audience — don't copy verbatim, lift the angle and structure):\n${winners.map((w, i) => `${i + 1}. [${w.platform} · ${w.kind} · ${w.engagement_rate}% engagement] hook: "${w.hook || '(none)'}" — caption opener: "${(w.caption || '').slice(0, 120)}…"`).join('\n')}`
  : 'No published-post engagement data yet — design on brand + brief + trends alone. After the AM publishes a few of these and marks them published, future batches will draw on what worked.'}

Produce exactly ${n} post${n === 1 ? '' : 's'}. Mix the platforms in scope. Mix reels + static + carousel so the AM can choose; if the brief asks for one kind specifically, follow that. Use British English. Keep hashtags to 3–5 highly relevant ones per post (see the Instagram playbook) — never a wall.

Caption length: ${lengthGuide}`;

  // The propose_posts tool, with the array bounds set to the requested count.
  const postsTool = {
    ...POSTS_TOOL,
    input_schema: {
      ...POSTS_TOOL.input_schema,
      properties: {
        ...POSTS_TOOL.input_schema.properties,
        posts: { ...POSTS_TOOL.input_schema.properties.posts, minItems: n, maxItems: n },
      },
    },
  };

  const response = await client().messages.create({
    model: MODEL,
    // Full posts with frame-by-frame storyboards are large; 8k truncated the
    // tool-call JSON mid-batch (stop_reason 'max_tokens'), leaving the posts
    // array empty. Give it real headroom (scaled loosely to the count).
    max_tokens: Math.min(16000, 2200 + n * 1600),
    system: require('./claude').cacheableSystem(SYSTEM + require('./playbooks').systemSuffix(['instagram-ranking', 'talking-head', 'visual-treatments'])),
    tools: [postsTool],
    tool_choice: { type: 'tool', name: 'propose_posts' },
    messages: [{ role: 'user', content: userPrompt }],
  });
  require('./costLog').recordClaudeCost({ model: MODEL, response, feature: 'social_strategy', clientId: clientId || null });

  const toolUse = response.content.find(b => b.type === 'tool_use' && b.name === 'propose_posts');
  if (!toolUse) throw new Error('Claude did not return a posts batch');
  const posts = toolUse.input?.posts || [];
  // Never persist an empty batch — surface a clear, retryable error instead of
  // silently creating a batch with no posts.
  if (!posts.length) {
    throw new Error(response.stop_reason === 'max_tokens'
      ? 'The batch was cut off before any posts came back — please try again.'
      : 'The model returned no posts — please try again.');
  }

  // Persist as one batch + nine post rows.
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const { rows: batchRows } = await dbClient.query(
      `INSERT INTO social_batches (client_id, brief, exemplars, trends)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [
        clientId,
        brief || null,
        JSON.stringify({ competitors: competitorList }),
        JSON.stringify(trends || null),
      ]
    );
    const batch = batchRows[0];
    const inserted = [];
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      // suggested_sound piggy-backs on the visual_concept blob because
      // the platform doesn't have a dedicated column for it — keeps the
      // schema small and lets the storyboard renderer pick it up from
      // one field whether it's a recommendation or a manual override.
      const visualWithSound = p.suggested_sound
        ? `${p.visual_concept || ''}\n\nSuggested sound: ${p.suggested_sound}`.trim()
        : p.visual_concept;
      const { rows: postRows } = await dbClient.query(
        `INSERT INTO social_posts
          (batch_id, client_id, position, kind, platform, hook, caption, hashtags, visual_concept, storyboard, notes, framework)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
          batch.id, clientId, i,
          p.kind || 'post',
          p.platform || 'instagram',
          p.hook || null,
          p.caption || null,
          p.hashtags || [],
          visualWithSound || null,
          JSON.stringify(p.storyboard || []),
          [p.framework, p.framework_rationale].filter(Boolean).join(' — ') || null,
          p.framework || null,
        ]
      );
      inserted.push(postRows[0]);
    }
    await dbClient.query('COMMIT');
    return { batch, posts: inserted };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

// Pull 2-4 short tokens out of the client's name / briefing so DataForSEO
// Google Trends has something to graph. Better than nothing when the AM
// hasn't supplied an explicit topic.
function extractTrendKeywords(client, brief) {
  const text = `${client.briefing_field || ''} ${brief || ''}`;
  // Take the first noun-like words, drop super-common ones.
  const tokens = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOP.has(w));
  const uniq = [];
  for (const t of tokens) if (!uniq.includes(t) && uniq.length < 4) uniq.push(t);
  // Always include the brand name as a baseline so trends contains at
  // least one curve.
  if (client.name && !uniq.includes(client.name.toLowerCase())) uniq.unshift(client.name.toLowerCase());
  return uniq.slice(0, 4);
}

const STOP = new Set([
  'about','also','because','been','being','brand','company','clients','customers',
  'every','from','have','here','into','just','more','only','other','over','same',
  'some','such','than','that','their','them','they','this','those','through',
  'used','very','were','what','when','where','which','while','with','would','your',
  'monthly','focus','none','marketing','agency','team','really','want','need',
]);

// Pull the latest engagement snapshot for every published post for a
// client, score by an engagement-rate proxy (likes + comments + shares +
// saves) / reach, and return the top N. Used both by generateBatch (as
// prompt grounding) and by the Winners panel on the Social tab.
async function getRecentWinners(clientId, { days = 90, limit = 5 } = {}) {
  const { rows } = await pool.query(
    `WITH latest AS (
       SELECT DISTINCT ON (e.post_id)
         e.post_id, e.reach, e.impressions, e.likes, e.comments, e.shares, e.saves, e.views, e.fetched_at
       FROM social_post_engagement e
       JOIN social_posts p ON p.id = e.post_id
       WHERE p.client_id = $1
         AND p.published_at IS NOT NULL
         AND p.published_at >= NOW() - ($2::int || ' days')::interval
       ORDER BY e.post_id, e.fetched_at DESC
     )
     SELECT p.id, p.platform, p.kind, p.hook, p.caption, p.published_url, p.published_at,
            l.reach, l.impressions, l.likes, l.comments, l.shares, l.saves, l.views
     FROM latest l JOIN social_posts p ON p.id = l.post_id`,
    [clientId, days]
  );
  const scored = rows
    .map(r => {
      const reachLike = r.reach || r.impressions || r.views || 0;
      const interactions = (r.likes || 0) + (r.comments || 0) + (r.shares || 0) + (r.saves || 0);
      const rate = reachLike > 0 ? Math.round((interactions / reachLike) * 1000) / 10 : 0;
      return { ...r, reach_like: reachLike, engagement_rate: rate };
    });

  // "Heater" detection — any post whose reach is at least 2× the
  // 30-day median across this client's published posts. Median is more
  // robust than mean here because one viral post would otherwise drag
  // the threshold up so high that nothing else qualifies.
  const reaches = scored.map(r => r.reach_like).filter(n => n > 0).sort((a, b) => a - b);
  const median = reaches.length ? reaches[Math.floor(reaches.length / 2)] : 0;
  const heaterThreshold = median * 2;
  const withHeater = scored.map(r => ({
    ...r,
    is_heater: heaterThreshold > 0 && r.reach_like >= heaterThreshold,
  }));

  return withHeater
    .sort((a, b) => b.engagement_rate - a.engagement_rate)
    .slice(0, limit);
}

// Aggregated hook library for a client. Pulls every hook that appears
// on any social_posts row, deduplicates, attaches the post's framework
// + the best engagement we've recorded for any usage of that hook.
// Used by the Hook Vault UI to surface what's worked so the AM can
// reuse a proven opener as the seed for a new plan.
async function getHookVault(clientId, { framework = null, search = null, limit = 100 } = {}) {
  const params = [clientId];
  let extra = '';
  if (framework) { params.push(framework); extra += ` AND p.framework = $${params.length}`; }
  if (search) { params.push(`%${search}%`); extra += ` AND p.hook ILIKE $${params.length}`; }
  params.push(limit);
  const { rows } = await pool.query(
    `WITH latest AS (
       SELECT DISTINCT ON (e.post_id)
         e.post_id, e.reach, e.impressions, e.likes, e.comments, e.shares, e.saves, e.views
       FROM social_post_engagement e
       ORDER BY e.post_id, e.fetched_at DESC
     ),
     joined AS (
       SELECT TRIM(p.hook) AS hook,
              p.framework, p.platform, p.kind,
              COALESCE(l.reach, l.impressions, l.views, 0) AS reach_like,
              COALESCE(l.likes, 0) + COALESCE(l.comments, 0)
                + COALESCE(l.shares, 0) + COALESCE(l.saves, 0) AS interactions
         FROM social_posts p
         LEFT JOIN latest l ON l.post_id = p.id
        WHERE p.client_id = $1
          AND p.hook IS NOT NULL
          AND TRIM(p.hook) <> ''
          ${extra}
     )
     SELECT hook,
            (ARRAY_AGG(framework ORDER BY reach_like DESC NULLS LAST))[1] AS framework,
            (ARRAY_AGG(platform ORDER BY reach_like DESC NULLS LAST))[1] AS platform,
            (ARRAY_AGG(kind ORDER BY reach_like DESC NULLS LAST))[1] AS kind,
            COUNT(*)::int AS use_count,
            MAX(reach_like)::bigint AS best_reach,
            MAX(interactions)::bigint AS best_interactions
       FROM joined
      GROUP BY hook
      ORDER BY best_reach DESC NULLS LAST, use_count DESC
      LIMIT $${params.length}`,
    params
  );
  return rows.map(r => ({
    hook: r.hook,
    framework: r.framework,
    platform: r.platform,
    kind: r.kind,
    use_count: r.use_count,
    best_reach: Number(r.best_reach || 0),
    best_interactions: Number(r.best_interactions || 0),
  }));
}

// Daily reach sparkline for a single client's last N days. Returns one
// point per day (max reach across that day's snapshots, aggregated
// across all posts). Used by the Analytics summary chips so the AM
// sees momentum at a glance without opening individual posts.
async function getReachSparkline(clientId, { days = 30 } = {}) {
  const { rows } = await pool.query(
    `WITH daily AS (
       SELECT DATE_TRUNC('day', e.fetched_at) AS day,
              SUM(COALESCE(e.reach, e.impressions, e.views, 0)) AS reach,
              SUM(COALESCE(e.likes, 0) + COALESCE(e.comments, 0)
                  + COALESCE(e.shares, 0) + COALESCE(e.saves, 0)) AS interactions
         FROM social_post_engagement e
         JOIN social_posts p ON p.id = e.post_id
        WHERE p.client_id = $1
          AND e.fetched_at >= NOW() - ($2::int || ' days')::interval
        GROUP BY day
        ORDER BY day ASC
     )
     SELECT day, reach::bigint, interactions::bigint FROM daily`,
    [clientId, days]
  );
  return rows.map(r => ({
    day: r.day,
    reach: Number(r.reach || 0),
    interactions: Number(r.interactions || 0),
  }));
}

// Look up the active Meta connector for a client and return decrypted
// creds, or null if there isn't one configured. Used by the engagement-
// refresh path so we don't have to repeat the wiring per route.
async function loadMetaCredentials(clientId) {
  const { rows } = await pool.query(
    `SELECT credentials FROM connectors
     WHERE client_id = $1 AND connector_type IN ('meta_ads', 'instagram_insights') AND status = 'active'
     LIMIT 1`,
    [clientId]
  );
  if (!rows.length) return null;
  return decrypt(rows[0].credentials);
}

// Pull a fresh engagement snapshot for a single post. Dispatches by
// platform: IG via Graph media insights, FB via Page-post insights +
// reaction summaries, LinkedIn via socialActions (likes + comments only,
// member-level posts don't expose impressions). Other platforms (TikTok,
// YouTube) fall through to a skipped result.
async function refreshEngagement(post) {
  if (!post.external_id) return { skipped: true, reason: 'No external_id on this post — engagement fetch needs it.' };
  if (post.external_platform === 'instagram') {
    const creds = await loadMetaCredentials(post.client_id);
    if (!creds) return { skipped: true, reason: 'No active Meta connector for this client.' };
    const insights = await meta.fetchInstagramMediaInsights(creds, post.external_id);
    const views = insights.plays ?? insights.video_views ?? null;
    const watch = insights.ig_reels_video_view_total_time ?? null;
    await pool.query(
      `INSERT INTO social_post_engagement
         (post_id, impressions, reach, views, likes, comments, shares, saves, watch_time_sec, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (post_id, fetched_at) DO NOTHING`,
      [post.id, insights.impressions ?? null, insights.reach ?? null, views,
       insights.likes ?? null, insights.comments ?? null, insights.shares ?? null,
       insights.saved ?? null, watch, JSON.stringify(insights)]
    );
    return { ok: true, insights };
  }
  if (post.external_platform === 'facebook') {
    const creds = await loadMetaCredentials(post.client_id);
    if (!creds) return { skipped: true, reason: 'No active Meta connector for this client.' };
    const e = await meta.fetchFacebookPostEngagement(creds, post.external_id);
    await pool.query(
      `INSERT INTO social_post_engagement
         (post_id, impressions, reach, views, likes, comments, shares, saves, watch_time_sec, raw)
       VALUES ($1, $2, $3, NULL, $4, $5, $6, NULL, NULL, $7)
       ON CONFLICT (post_id, fetched_at) DO NOTHING`,
      [post.id, e.impressions, e.reach, e.likes, e.comments, e.shares, JSON.stringify(e.raw)]
    );
    return { ok: true, insights: e };
  }
  if (post.external_platform === 'linkedin') {
    const { rows } = await pool.query(
      `SELECT credentials FROM connectors
        WHERE client_id = $1 AND connector_type = 'linkedin_organic' AND status = 'active' LIMIT 1`,
      [post.client_id]
    );
    if (!rows.length) return { skipped: true, reason: 'No active LinkedIn connector for this client.' };
    const linkedinConn = require('../connectors/linkedin');
    const creds = decrypt(rows[0].credentials);
    const e = await linkedinConn.fetchPostEngagement(creds, post.external_id);
    await pool.query(
      `INSERT INTO social_post_engagement
         (post_id, impressions, reach, views, likes, comments, shares, saves, watch_time_sec, raw)
       VALUES ($1, NULL, NULL, NULL, $2, $3, NULL, NULL, NULL, $4)
       ON CONFLICT (post_id, fetched_at) DO NOTHING`,
      [post.id, e.likes, e.comments, JSON.stringify(e.raw)]
    );
    return { ok: true, insights: e };
  }
  return { skipped: true, reason: `Engagement auto-fetch is not implemented for ${post.external_platform}. Paste numbers manually.` };
}

// Return the latest cached set of trending sounds for a client. Falls
// back to global cache (client_id IS NULL) when no client-specific
// snapshot exists, then to an empty list. Cached for 7 days — older
// snapshots are ignored.
async function getRecentTrendingSounds(clientId, { limit = 25 } = {}) {
  const { rows } = await pool.query(
    `SELECT sounds FROM trending_sounds_snapshots
     WHERE (client_id = $1 OR client_id IS NULL)
       AND fetched_at >= NOW() - INTERVAL '7 days'
     ORDER BY client_id NULLS LAST, fetched_at DESC
     LIMIT 1`,
    [clientId]
  );
  const all = rows[0]?.sounds || [];
  return Array.isArray(all) ? all.slice(0, limit) : [];
}

// Pull a fresh trending-sounds snapshot from Apify and persist it.
// Apify charges per actor run, so callers should debounce: this is
// intentionally on-demand rather than a per-request fetch.
async function refreshTrendingSounds({ clientId, region = 'GB', limit = 25 } = {}) {
  const sounds = await apify.fetchTrendingSounds({ region, limit });
  await pool.query(
    `INSERT INTO trending_sounds_snapshots (client_id, region, sounds, source)
     VALUES ($1, $2, $3, 'apify')`,
    [clientId || null, region, JSON.stringify(sounds)]
  );
  return sounds;
}

// Engagement breakdown by framework. Joins the latest engagement
// snapshot per published post against social_posts.framework and
// computes an average engagement rate. Drives the Winners panel
// chips so the AM can see "PAS is averaging 8.2% — keep using it"
// without doing the maths.
async function getFrameworkBreakdown(clientId, { days = 90 } = {}) {
  const { rows } = await pool.query(
    `WITH latest AS (
       SELECT DISTINCT ON (e.post_id)
         e.post_id, e.reach, e.impressions, e.likes, e.comments, e.shares, e.saves, e.views
       FROM social_post_engagement e
       JOIN social_posts p ON p.id = e.post_id
       WHERE p.client_id = $1
         AND p.published_at IS NOT NULL
         AND p.published_at >= NOW() - ($2::int || ' days')::interval
       ORDER BY e.post_id, e.fetched_at DESC
     )
     SELECT p.framework, p.id,
            COALESCE(l.reach, l.impressions, l.views, 0) AS reach,
            COALESCE(l.likes, 0) + COALESCE(l.comments, 0)
              + COALESCE(l.shares, 0) + COALESCE(l.saves, 0) AS interactions
     FROM latest l JOIN social_posts p ON p.id = l.post_id`,
    [clientId, days]
  );
  const byFramework = {};
  for (const r of rows) {
    const fw = r.framework || '(unspecified)';
    const bucket = byFramework[fw] = byFramework[fw] || { framework: fw, posts: 0, rate_sum: 0 };
    bucket.posts++;
    if (r.reach > 0) bucket.rate_sum += (r.interactions / r.reach);
  }
  return Object.values(byFramework)
    .map(b => ({
      framework: b.framework,
      posts: b.posts,
      avg_engagement_rate: b.posts ? Math.round((b.rate_sum / b.posts) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.avg_engagement_rate - a.avg_engagement_rate);
}

module.exports = {
  generateBatch, getRecentWinners, getReachSparkline, getHookVault,
  refreshEngagement, loadMetaCredentials,
  getRecentTrendingSounds, refreshTrendingSounds, getFrameworkBreakdown,
};
