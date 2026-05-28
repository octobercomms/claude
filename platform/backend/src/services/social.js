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

British English. No emojis unless the brief explicitly says the brand uses them. No hashtag walls (max 8 hashtags, mix of broad + niche).`;

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
                  shot: { type: 'string', description: 'What the camera sees in this frame.' },
                  on_screen_text: { type: 'string' },
                  voiceover: { type: 'string' },
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

module.exports = { generateBatch };
