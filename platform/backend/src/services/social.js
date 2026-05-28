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
            hashtags: { type: 'array', items: { type: 'string' }, maxItems: 8 },
            visual_concept: { type: 'string', description: 'One-paragraph visual direction — composition, palette, mood, key references.' },
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

async function generateBatch({ clientId, brief, platforms }) {
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

  const competitorList = (c.social_competitors || []).filter(Boolean);
  const platformList = Array.isArray(platforms) && platforms.length ? platforms : ['instagram', 'tiktok'];

  const userPrompt = `Client: ${c.name}
About the brand: ${c.briefing_field || '(no briefing — work from the brief below alone)'}
This month's focus: ${c.monthly_focus || '(none)'}

Brief from the account manager (treat this as the directive):
${brief || '(no extra brief — propose a balanced batch)'}

Platforms in scope: ${platformList.join(', ')}
Competitor handles (use as style/voice reference if helpful): ${competitorList.length ? competitorList.join(', ') : '(none configured)'}

${trends ? `Currently rising signals (Google Trends, last 30 days, UK): ${trends.rising.map(r => r.label).filter(Boolean).join(', ') || '(no rising queries)'}` : '(no trend signal available — proceed without)'}

Brand asset banks available for E/F frames (refer to a clip or prop by name in your "shot" field so the AM knows which existing asset to use, rather than inventing new footage):
 - B-roll bank (Style E): ${bRollBank.length ? bRollBank.map(a => a.name).join(', ') : '(no clips uploaded yet — describe what they should film)'}
 - Prop library (Style F): ${propBank.length ? propBank.map(a => a.name).join(', ') : '(no props uploaded yet — describe what they should photograph)'}

${winners.length
  ? `Posts that have actually performed well for THIS brand in the last 90 days (model the new batch on what's already engaging this audience — don't copy verbatim, lift the angle and structure):\n${winners.map((w, i) => `${i + 1}. [${w.platform} · ${w.kind} · ${w.engagement_rate}% engagement] hook: "${w.hook || '(none)'}" — caption opener: "${(w.caption || '').slice(0, 120)}…"`).join('\n')}`
  : 'No published-post engagement data yet — design on brand + brief + trends alone. After the AM publishes a few of these and marks them published, future batches will draw on what worked.'}

Produce exactly nine posts. Mix the platforms in scope. Mix reels + static + carousel so the AM can choose; if the brief asks for one kind specifically, follow that. Use British English.`;

  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: SYSTEM,
    tools: [POSTS_TOOL],
    tool_choice: { type: 'tool', name: 'propose_posts' },
    messages: [{ role: 'user', content: userPrompt }],
  });

  const toolUse = response.content.find(b => b.type === 'tool_use' && b.name === 'propose_posts');
  if (!toolUse) throw new Error('Claude did not return a posts batch');
  const posts = toolUse.input?.posts || [];

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
      const { rows: postRows } = await dbClient.query(
        `INSERT INTO social_posts
          (batch_id, client_id, position, kind, platform, hook, caption, hashtags, visual_concept, storyboard, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          batch.id, clientId, i,
          p.kind || 'post',
          p.platform || 'instagram',
          p.hook || null,
          p.caption || null,
          p.hashtags || [],
          p.visual_concept || null,
          JSON.stringify(p.storyboard || []),
          [p.framework, p.framework_rationale].filter(Boolean).join(' — ') || null,
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
  return rows
    .map(r => {
      const reachLike = r.reach || r.impressions || r.views || 0;
      const interactions = (r.likes || 0) + (r.comments || 0) + (r.shares || 0) + (r.saves || 0);
      const rate = reachLike > 0 ? Math.round((interactions / reachLike) * 1000) / 10 : 0;
      return { ...r, engagement_rate: rate };
    })
    .sort((a, b) => b.engagement_rate - a.engagement_rate)
    .slice(0, limit);
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

// Pull a fresh engagement snapshot for a single post. IG only for now —
// returns null + a reason for any other platform.
async function refreshEngagement(post) {
  if (!post.external_id || post.external_platform !== 'instagram') {
    return { skipped: true, reason: 'Only Instagram engagement is auto-fetched. Paste platform numbers manually for other networks.' };
  }
  const creds = await loadMetaCredentials(post.client_id);
  if (!creds) return { skipped: true, reason: 'No active Meta connector for this client.' };
  const insights = await meta.fetchInstagramMediaInsights(creds, post.external_id);
  const reach = insights.reach ?? null;
  const impressions = insights.impressions ?? null;
  const views = insights.plays ?? insights.video_views ?? null;
  const likes = insights.likes ?? null;
  const comments = insights.comments ?? null;
  const shares = insights.shares ?? null;
  const saves = insights.saved ?? null;
  const watch = insights.ig_reels_video_view_total_time ?? null;
  await pool.query(
    `INSERT INTO social_post_engagement
       (post_id, impressions, reach, views, likes, comments, shares, saves, watch_time_sec, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (post_id, fetched_at) DO NOTHING`,
    [post.id, impressions, reach, views, likes, comments, shares, saves, watch, JSON.stringify(insights)]
  );
  return { ok: true, insights };
}

module.exports = { generateBatch, getRecentWinners, refreshEngagement, loadMetaCredentials };
