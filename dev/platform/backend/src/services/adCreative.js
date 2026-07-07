// Ad Creative generation. Claude returns a batch of ad concepts using
// proven direct-response frameworks (PAS, AIDA, Problem/Solution, Social
// Proof, FOMO, Before/After), grounded in:
//
//   1. The client's briefing + monthly focus
//   2. The brand assets the AM selected (palette, fonts, product images,
//      guidelines) — included verbatim in the prompt so the visual
//      concepts reach for the right palette / style
//   3. Recent campaign performance pulled from Google Ads / Meta Ads
//      connectors so winning angles inform the next batch
//   4. Optional brief from the AM
//
// Output is concepts only at this stage. Image rendering happens per-
// concept via the ad creatives route, generating multiple aspect ratios
// from one prompt.

const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../db');

const MODEL = 'claude-sonnet-4-6';

function getClient() {
  return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
}

const SYSTEM = `You design direct-response ad creative for performance-marketing clients. Each concept you propose anchors in a proven framework: PAS (problem-agitate-solve), AIDA, Before/After, Social Proof, FOMO, or Problem/Solution. Never produce filler.

For each concept:
 - Pick the angle that fits the brand + the recent performance signal you were given.
 - Write a scroll-stopping headline (under 40 chars).
 - Write a body that earns the click without overpromising.
 - Specify the CTA verb ("Shop", "Try free", "Book a call", etc.).
 - Write a visual_concept paragraph that another designer (or an image model) could render — composition, palette references, hero element, copy placement.
 - State which framework you used and why.

British English. No clichés. No emojis unless the brief says so. Hone in on what the brand actually offers — generic ad-speak gets ignored.`;

const TOOL = {
  name: 'propose_ad_creatives',
  description: 'Submit the batch of ad creative concepts. Always call this — never reply with free text.',
  input_schema: {
    type: 'object',
    properties: {
      creatives: {
        type: 'array',
        minItems: 6,
        items: {
          type: 'object',
          properties: {
            angle: { type: 'string', description: 'One-line label for the angle, e.g. "Founder story", "Side-by-side comparison".' },
            framework: { type: 'string', enum: ['PAS', 'AIDA', 'Before/After', 'Social Proof', 'FOMO', 'Problem/Solution', 'UGC'] },
            framework_rationale: { type: 'string' },
            headline: { type: 'string' },
            body: { type: 'string' },
            cta: { type: 'string' },
            visual_concept: { type: 'string' },
          },
          required: ['angle', 'framework', 'headline', 'body', 'cta', 'visual_concept'],
        },
      },
    },
    required: ['creatives'],
  },
};

// Stored brief label for the auto-generated worked example, so the Brief
// list reads sensibly even though no AM brief was typed.
const EXAMPLE_BRIEF_LABEL = 'Example — auto-generated from the client profile to preview each step. Safe to delete.';

async function generateBatch({ clientId, brief, platform = 'meta', count = 8, assetIds = [], campaignContext, isExample = false }) {
  const { rows: clientRows } = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  const client = clientRows[0];
  if (!client) throw new Error('Client not found');

  let assetSummary = '(no brand assets selected)';
  if (assetIds.length) {
    const { rows: assets } = await pool.query(
      'SELECT id, kind, name, metadata FROM brand_assets WHERE id = ANY($1) AND client_id = $2',
      [assetIds, clientId]
    );
    if (assets.length) {
      assetSummary = assets.map(a => {
        const meta = a.metadata && Object.keys(a.metadata).length ? ` — ${JSON.stringify(a.metadata)}` : '';
        return `[${a.kind}] ${a.name}${meta}`;
      }).join('\n');
    }
  }

  const userPrompt = `Client: ${client.name}
About: ${client.briefing_field || '(no briefing set)'}
This month's focus: ${client.monthly_focus || '(none)'}

Brief from the account manager:
${brief || '(no extra brief — propose a balanced batch covering several angles)'}

Platform target: ${platform}
Number of concepts: ${count}

Brand assets selected as visual reference (use these to ground the visual_concept paragraph in real brand elements — refer to specific palette hex codes, product images, etc.):
${assetSummary}

${campaignContext ? `Recent paid performance (use to inform which angles are working / not):\n${JSON.stringify(campaignContext, null, 2)}` : '(no recent campaign data supplied — design on brand + brief alone)'}

Produce exactly ${count} ad creative concepts. Vary the framework — don't return six PAS variants. Mix mid-funnel hooks with bottom-funnel offers if appropriate to the brief.`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 6000,
    system: require('./claude').cacheableSystem(SYSTEM + require('./playbooks').systemSuffix(['copywriting', 'ad-copy', 'visual-treatments'])),
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'propose_ad_creatives' },
    messages: [{ role: 'user', content: userPrompt }],
  });
  require('./costLog').recordClaudeCost({ model: MODEL, response, feature: 'ad_creative', clientId: client?.id || null });

  const toolUse = response.content.find(b => b.type === 'tool_use' && b.name === 'propose_ad_creatives');
  if (!toolUse) throw new Error('Claude did not return creatives');
  const creatives = toolUse.input?.creatives || [];

  // Persist as one batch + N creative rows.
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const { rows: batchRows } = await dbClient.query(
      `INSERT INTO ad_creative_batches (client_id, brief, platform, asset_ids, campaign_context, is_example)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [clientId, isExample ? EXAMPLE_BRIEF_LABEL : (brief || null), platform, assetIds, JSON.stringify(campaignContext || null), isExample]
    );
    const batch = batchRows[0];
    const inserted = [];
    for (let i = 0; i < creatives.length; i++) {
      const c = creatives[i];
      const { rows: row } = await dbClient.query(
        `INSERT INTO ad_creatives
          (batch_id, client_id, position, angle, framework, headline, body, cta, visual_concept, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          batch.id, clientId, i,
          c.angle || null, c.framework || null,
          c.headline || null, c.body || null, c.cta || null,
          c.visual_concept || null,
          c.framework_rationale || null,
        ]
      );
      inserted.push(row[0]);
    }
    await dbClient.query('COMMIT');
    return { batch, creatives: inserted };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

// Single-concept preview — a throwaway "sample ad" from the brief text so the
// AM sees the direction before committing to (and paying for) a full batch.
// Same grounding as generateBatch, but one concept and NOT persisted.
const SAMPLE_TOOL = {
  ...TOOL,
  input_schema: {
    ...TOOL.input_schema,
    properties: {
      creatives: { ...TOOL.input_schema.properties.creatives, minItems: 1, maxItems: 1 },
    },
  },
};

async function sampleAd({ clientId, brief, platform = 'meta' }) {
  const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  const client = rows[0];
  if (!client) throw new Error('Client not found');

  const userPrompt = `Client: ${client.name}
About: ${client.briefing_field || '(no briefing set)'}
This month's focus: ${client.monthly_focus || '(none)'}

Brief from the account manager:
${brief || '(no brief yet — propose one strong on-brand concept)'}

Platform target: ${platform}

Produce ONE ad creative concept — the single strongest angle for this brief. This is a quick preview so the AM can see the direction before generating a full batch.`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: require('./claude').cacheableSystem(SYSTEM + require('./playbooks').systemSuffix(['copywriting', 'ad-copy', 'visual-treatments'])),
    tools: [SAMPLE_TOOL],
    tool_choice: { type: 'tool', name: 'propose_ad_creatives' },
    messages: [{ role: 'user', content: userPrompt }],
  });
  require('./costLog').recordClaudeCost({ model: MODEL, response, feature: 'ad_creative_sample', clientId: client.id });

  const toolUse = response.content.find(b => b.type === 'tool_use' && b.name === 'propose_ad_creatives');
  const c = toolUse?.input?.creatives?.[0];
  if (!c) throw new Error('Claude did not return a sample ad');
  return {
    angle: c.angle || null, framework: c.framework || null, framework_rationale: c.framework_rationale || null,
    headline: c.headline || null, body: c.body || null, cta: c.cta || null, visual_concept: c.visual_concept || null,
  };
}

// Return the client's persisted "worked example" batch, generating it once
// if it doesn't exist yet. Kept small (3 concepts) and grounded purely in the
// client profile — no AM brief — so a brand-new client immediately has a real
// batch that flows through every Build step. Idempotent: repeated calls return
// the same batch rather than piling up examples.
async function ensureExampleBatch({ clientId }) {
  const { rows } = await pool.query(
    `SELECT b.*, (SELECT COUNT(*)::int FROM ad_creatives c WHERE c.batch_id = b.id) AS creative_count
       FROM ad_creative_batches b
      WHERE b.client_id = $1 AND b.is_example = true
      ORDER BY b.created_at DESC LIMIT 1`,
    [clientId]
  );
  if (rows.length) {
    const batch = rows[0];
    const { rows: creatives } = await pool.query(
      'SELECT * FROM ad_creatives WHERE batch_id = $1 ORDER BY position ASC, created_at ASC',
      [batch.id]
    );
    return { batch, creatives, created: false };
  }
  // count matches the tool schema's minItems (6) so the prompt and schema
  // don't contradict — a compact but varied set to walk through.
  const { batch, creatives } = await generateBatch({ clientId, brief: null, platform: 'meta', count: 6, isExample: true });
  batch.creative_count = creatives.length;
  return { batch, creatives, created: true };
}

module.exports = { generateBatch, sampleAd, ensureExampleBatch };
