/**
 * Claude-powered Meta Ads Optimizer
 * Usage: node src/optimizer.js
 * Then type prompts like:
 *   "increase the budget on the prospecting campaign by 20%"
 *   "pause all retargeting ad sets"
 *   "show me the last 7 days performance for each campaign"
 *   "write 3 new ad copy variations for the homeowner audience"
 */
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import * as readline from 'readline';
import { MetaClient } from './meta-client.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const meta = new MetaClient();

// ─── Resolve ad account ID ───────────────────────────────────────────────────

async function getAdAccountId() {
  if (process.env.META_AD_ACCOUNT_ID) return process.env.META_AD_ACCOUNT_ID;
  const res = await meta.getAdAccounts();
  const account = res.data?.find(a => a.account_status === 1) || res.data?.[0];
  if (!account) throw new Error('No ad account found.');
  return account.id;
}

// ─── Tool implementations ─────────────────────────────────────────────────────

async function listCampaigns({ adAccountId }) {
  const res = await meta.getCampaigns(
    adAccountId,
    'id,name,status,objective,daily_budget,lifetime_budget,effective_status'
  );
  return res.data ?? [];
}

async function listAdSets({ adAccountId, campaignId }) {
  const params = { fields: 'id,name,status,campaign_id,daily_budget,optimization_goal,effective_status,targeting' };
  if (campaignId) params.filtering = JSON.stringify([{ field: 'campaign_id', operator: 'EQUAL', value: campaignId }]);
  const res = await meta.get(`${adAccountId}/adsets`, params);
  return res.data ?? [];
}

async function updateCampaign({ campaignId, updates }) {
  const res = await meta.post(`${campaignId}`, updates);
  return res;
}

async function updateAdSet({ adSetId, updates }) {
  const res = await meta.post(`${adSetId}`, updates);
  return res;
}

async function getInsights({ adAccountId, level, datePreset, campaignId }) {
  const params = {
    fields: 'campaign_name,adset_name,impressions,clicks,spend,cpm,cpc,ctr,actions,cost_per_action_type',
    date_preset: datePreset || 'last_7d',
    level: level || 'campaign',
  };
  const target = campaignId ? campaignId : adAccountId;
  const res = await meta.get(`${target}/insights`, params);
  return res.data ?? [];
}

// ─── Tool definitions for Claude ─────────────────────────────────────────────

const TOOLS = [
  {
    name: 'list_campaigns',
    description: 'List all campaigns in the Meta ad account with their status, budget, and objective.',
    input_schema: {
      type: 'object',
      properties: {
        adAccountId: { type: 'string', description: 'The Meta ad account ID (e.g. act_123456)' },
      },
      required: ['adAccountId'],
    },
  },
  {
    name: 'list_ad_sets',
    description: 'List ad sets in the Meta ad account, optionally filtered by campaign.',
    input_schema: {
      type: 'object',
      properties: {
        adAccountId: { type: 'string', description: 'The Meta ad account ID' },
        campaignId: { type: 'string', description: 'Optional: filter to a specific campaign ID' },
      },
      required: ['adAccountId'],
    },
  },
  {
    name: 'update_campaign',
    description: 'Update a campaign. Can change status (ACTIVE/PAUSED), daily_budget (in cents), name, etc.',
    input_schema: {
      type: 'object',
      properties: {
        campaignId: { type: 'string', description: 'The campaign ID to update' },
        updates: {
          type: 'object',
          description: 'Fields to update, e.g. { "status": "PAUSED" } or { "daily_budget": 1000 }. daily_budget is in cents (e.g. 1000 = $10).',
        },
      },
      required: ['campaignId', 'updates'],
    },
  },
  {
    name: 'update_ad_set',
    description: 'Update an ad set. Can change status (ACTIVE/PAUSED), daily_budget (in cents), name, bid_amount, targeting, etc.',
    input_schema: {
      type: 'object',
      properties: {
        adSetId: { type: 'string', description: 'The ad set ID to update' },
        updates: {
          type: 'object',
          description: 'Fields to update. daily_budget is in cents.',
        },
      },
      required: ['adSetId', 'updates'],
    },
  },
  {
    name: 'get_insights',
    description: 'Fetch performance metrics (impressions, clicks, spend, CTR, CPC, conversions) for campaigns or ad sets.',
    input_schema: {
      type: 'object',
      properties: {
        adAccountId: { type: 'string', description: 'The Meta ad account ID' },
        level: { type: 'string', enum: ['account', 'campaign', 'adset', 'ad'], description: 'Aggregation level' },
        datePreset: {
          type: 'string',
          enum: ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'this_month', 'last_month'],
          description: 'Time range for insights',
        },
        campaignId: { type: 'string', description: 'Optional: scope insights to a specific campaign' },
      },
      required: ['adAccountId'],
    },
  },
];

// ─── Execute tool calls from Claude ──────────────────────────────────────────

async function executeTool(name, input) {
  switch (name) {
    case 'list_campaigns':   return listCampaigns(input);
    case 'list_ad_sets':     return listAdSets(input);
    case 'update_campaign':  return updateCampaign(input);
    case 'update_ad_set':    return updateAdSet(input);
    case 'get_insights':     return getInsights(input);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── Main optimizer loop ──────────────────────────────────────────────────────

async function runOptimizer() {
  console.log('nvelope.co — Meta Ads Optimizer (powered by Claude)\n');
  console.log('Type a prompt to manage your campaigns. Examples:');
  console.log('  "show me all campaigns and their status"');
  console.log('  "increase the prospecting campaign daily budget by 20%"');
  console.log('  "pause all retargeting ad sets"');
  console.log('  "what was the spend and CTR over the last 7 days?"');
  console.log('  "write 3 new ad copy variations for homeowners"\n');
  console.log('Type "exit" to quit.\n');

  const adAccountId = await getAdAccountId();
  console.log(`Connected to ad account: ${adAccountId}\n`);

  const systemPrompt = `You are an expert Meta Ads manager for nvelope.co, a B2B lead generation marketplace connecting homeowners with architecture and design studios.

Your role: help the user manage, optimise, and analyse their Meta advertising campaigns via tool calls and clear explanations.

Context about nvelope.co campaigns:
- Objective: drive lead form submissions from homeowners planning renovations, extensions, or new builds
- Core conversion event: quiz completion → lead form submit on /studio/[studio-slug]/
- Target CPL: $80–$150 in month 1, improving to $50–$100 by month 3+
- Budget split: 50% prospecting, 30% retargeting, 20% lookalike (once 100+ leads)
- Kill rule: pause any ad set that spends 3× target CPL with zero conversions
- Scale rule: increase budget max 20% at a time when CPL is on target
- All campaigns start as PAUSED (drafts) — only activate when user confirms

Ad account ID: ${adAccountId}

When making changes:
1. Always describe what you're about to do before making API calls
2. Confirm the action with the result after making changes
3. Flag anything that looks off (high spend with no conversions, frequency issues, budget exhausted)
4. When writing ad copy, follow the campaign architecture: direct CTA, quiz-first messaging, social proof angles

When reporting on performance, summarise clearly: spend, impressions, clicks, CTR, CPL if conversion data is available.`;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const messages = [];

  const ask = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

  while (true) {
    const userInput = await ask('You: ');
    if (userInput.trim().toLowerCase() === 'exit') {
      console.log('\nExiting optimizer. Goodbye!');
      rl.close();
      break;
    }
    if (!userInput.trim()) continue;

    messages.push({ role: 'user', content: userInput });

    // Agentic loop — Claude may call multiple tools before responding
    while (true) {
      const response = await anthropic.messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        system: systemPrompt,
        tools: TOOLS,
        messages,
      });

      // Collect any text output to display
      for (const block of response.content) {
        if (block.type === 'text' && block.text) {
          console.log(`\nClaude: ${block.text}\n`);
        }
      }

      if (response.stop_reason === 'end_turn') {
        messages.push({ role: 'assistant', content: response.content });
        break;
      }

      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content });

        const toolResults = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;

          console.log(`  [tool] ${block.name}(${JSON.stringify(block.input)})`);
          try {
            const result = await executeTool(block.name, block.input);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result, null, 2),
            });
          } catch (err) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              is_error: true,
              content: err.message,
            });
          }
        }

        messages.push({ role: 'user', content: toolResults });
        // Continue the loop so Claude can process the tool results
        continue;
      }

      // Unexpected stop reason
      messages.push({ role: 'assistant', content: response.content });
      break;
    }
  }
}

runOptimizer().catch(err => {
  console.error('Optimizer failed:', err.message);
  process.exit(1);
});
