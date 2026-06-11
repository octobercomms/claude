// Conversational social post planner — see docs/platform/social-posts-planner.md.
//
// Phase 2 (this revision):
//   - Agentic loop with grounding tools: Claude can call get_winners,
//     get_trending_sounds, get_competitor_handles BEFORE drafting so
//     suggestions are based on what's actually been working for THIS
//     client, not generic best practice.
//   - Attachment support: AM can upload an image or PDF (example post,
//     brand guidelines, mood board) and Claude treats it as visual
//     reference for the plan.
//   - Tighter chat replies: system prompt requires a one-sentence
//     change summary alongside every propose_plan call, so the chat
//     log narrates the actual diff instead of "Updated the plan".

const Anthropic = require('@anthropic-ai/sdk');
const social = require('./social');

const MODEL = 'claude-sonnet-4-6';
const MAX_TOOL_ROUNDS = 5;

function getClient() {
  return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
}

const SYSTEM = `You are designing a single social post (or short series) for a performance-marketing client of October Communications. You speak conversationally with the account manager and use the propose_plan tool to surface a structured plan whenever the plan should change.

Anchor every plan in a proven framework: Hook → Story → Offer (HSO); AIDA (attention/interest/desire/action); or Problem → Agitate → Solve (PAS). Cite which you used and why it fits THIS topic + audience.

# Reel storyboards — Video Style System
For reels, the scenes follow October's seven-style grammar. Tag each scene with a style code A-G:

 A · Text hook on black, 2-4s. ALWAYS the first scene. No filming — pure text overlay. Bold white or yellow on black. The provocative opener.
 B · Talking head anchor, 10-45s. Host at a fixed desk/studio setup, front camera, RØDE mic. 2-3 B scenes per reel, each 10-15s.
 C · Word card, 1-2s. One word or 3-word phrase on plain white or black. Punctuation between B sections — 2-3 max per reel. No filming.
 D · Screen reveal, 4-8s. Once per reel max. Close-up of a laptop screen — analytics, landing page, dashboard.
 E · B-roll voiceover, 5-12s. References built environment, product, or client project work. No talking to camera.
 F · Prop close-up, 3-6s. Hands holding a physical object — notebook, sample, brief. Warm desk light.
 G · Kinetic CTA on black, 3-5s. ALWAYS the last scene. URL or CTA in animated text.

Sequence: A opens every reel, G closes every reel. Between, cycle B with cutaways (C/D/E/F). Never more than ~15s of the same shot. Typical 60s reel: A → B → C → B → E → B → F → G.

For non-reel formats (carousel, static, story), omit style codes.

# Grounding — use the data tools BEFORE drafting
Before proposing a plan (or when the AM asks for ideas), call the available data tools to ground your suggestions in what's actually working for this client:
- get_winners: the client's recent best-performing posts (hooks that worked, frameworks used).
- get_trending_sounds: current TikTok sounds the client could ride.
- get_competitor_handles: handles the client benchmarks against.

Only skip the tools when you already have everything you need from the conversation. Once you've pulled the data you need, propose the plan.

# What to include in every plan
- Title — short, AM-readable.
- Platforms (array): instagram_reels | tiktok | youtube_shorts | instagram_feed | instagram_story | carousel.
- Duration (seconds).
- Performance hypothesis — which metric this is meant to move (reach / saves / clicks / DMs). Without this we can't measure success.
- Hook — the first 1-3 seconds. Pattern interrupt. Generate this separately from the body.
- Framework + rationale.
- Scenes (3-8). Each: name, duration_seconds, style_code (A-G if reel), shot (what's in frame + camera movement), bullets (the IDEA the talent should communicate — never a word-for-word script), b_roll (cutaways), on_screen_text (text + in/out timing).
- CTA — what the viewer should do next.
- Caption + hashtags.
- Equipment — minimum (phone shoot reality) and ideal (camera/lav mic) lists.
- Locations, props/wardrobe, talent.
- Editing notes, music brief (mood, tempo, Epidemic Sound / Artlist tracks).
- Reuse plan — same content cut for other platforms with format + duration notes.
- Approval gates — script approval, rough cut approval, final cut approval. Each gate names who from the client side owns it.

# Process rules
Every turn ends in exactly one of: propose_plan (commits a draft) OR reply_only (genuine clarifying question). Data tools (get_winners etc.) can be called any number of times BEFORE the final propose_plan / reply_only.

When you call propose_plan, ALSO include a short text block (one sentence, max 20 words) narrating what changed in this revision — e.g. "Tightened to 30s by merging Scenes 4 and 5 and dropping the screen reveal." Never just call propose_plan with no narrative.

Default to propose_plan over reply_only. The AM can iterate on a draft but can't iterate on a promise. Use reply_only only for genuine clarifying questions you can't answer yourself or by reading the data tools.

Brief replies. British English. No filler.

# Attachments
If the AM attaches an image or PDF, treat it as visual / written reference for the plan. An image is usually an example post they want to match the style of; a PDF is usually brand guidelines or a mood board. Reflect what you see in the plan (caption tone, scene composition, props).`;

const PROPOSE_PLAN_TOOL = {
  name: 'propose_plan',
  description: 'Surface a structured plan for the AM to review. Call whenever the plan should change. ALWAYS include a short text block alongside narrating what changed.',
  input_schema: {
    type: 'object',
    properties: {
      plan: {
        type: 'object',
        properties: {
          version: { type: 'number' },
          title: { type: 'string' },
          platforms: { type: 'array', items: { type: 'string', enum: ['instagram_reels', 'tiktok', 'youtube_shorts', 'instagram_feed', 'instagram_story', 'carousel'] } },
          duration_seconds: { type: 'number' },
          performance_hypothesis: { type: 'string' },
          audience: { type: 'string' },
          framework: { type: 'string', enum: ['Hook-Story-Offer', 'AIDA', 'PAS', 'UGC'] },
          framework_rationale: { type: 'string' },
          hook: { type: 'object', properties: { text: { type: 'string' }, rationale: { type: 'string' } }, required: ['text'] },
          scenes: { type: 'array', items: {
            type: 'object',
            properties: {
              number: { type: 'number' },
              name: { type: 'string' },
              duration_seconds: { type: 'number' },
              style_code: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] },
              shot: { type: 'string' },
              bullets: { type: 'array', items: { type: 'string' } },
              b_roll: { type: 'array', items: { type: 'string' } },
              on_screen_text: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, timing_start: { type: 'number' }, timing_end: { type: 'number' } }, required: ['text'] } },
            },
            required: ['number', 'name', 'shot', 'bullets'],
          } },
          cta: { type: 'string' },
          caption: { type: 'string' },
          hashtags: { type: 'array', items: { type: 'string' } },
          equipment: { type: 'object', properties: { minimum: { type: 'array', items: { type: 'string' } }, ideal: { type: 'array', items: { type: 'string' } } } },
          locations: { type: 'array', items: { type: 'string' } },
          props_wardrobe: { type: 'array', items: { type: 'string' } },
          talent: { type: 'string' },
          editing_notes: { type: 'string' },
          music: { type: 'object', properties: { mood: { type: 'string' }, tempo: { type: 'string' }, suggestions: { type: 'array', items: { type: 'string' } } } },
          reuse_plan: { type: 'array', items: { type: 'object', properties: { platform: { type: 'string' }, duration_seconds: { type: 'number' }, notes: { type: 'string' } }, required: ['platform'] } },
          approval_gates: { type: 'array', items: { type: 'object', properties: { gate: { type: 'string' }, owner: { type: 'string' } }, required: ['gate'] } },
        },
        required: ['version', 'title', 'framework', 'hook', 'scenes'],
      },
    },
    required: ['plan'],
  },
};

const REPLY_ONLY_TOOL = {
  name: 'reply_only',
  description: 'Send a plain reply without changing the plan. Use ONLY for genuine clarifying questions.',
  input_schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
};

// Grounding tools — call BEFORE propose_plan to base suggestions on
// what's actually working for this client.
const GET_WINNERS_TOOL = {
  name: 'get_winners',
  description: "Get this client's recent best-performing posts (top 5 by engagement, last 90 days). Use to see which hooks and frameworks have worked for them.",
  input_schema: { type: 'object', properties: {} },
};
const GET_TRENDING_SOUNDS_TOOL = {
  name: 'get_trending_sounds',
  description: 'Get current trending TikTok sounds the client could ride.',
  input_schema: { type: 'object', properties: {} },
};
const GET_COMPETITOR_HANDLES_TOOL = {
  name: 'get_competitor_handles',
  description: "Get the client's competitor social handles. Use to inform tone, style, or differentiation.",
  input_schema: { type: 'object', properties: {} },
};
const GET_FRAMEWORK_BREAKDOWN_TOOL = {
  name: 'get_framework_breakdown',
  description: 'Which copy frameworks (HSO / AIDA / PAS) have delivered the best engagement for this client over the last 90 days.',
  input_schema: { type: 'object', properties: {} },
};

async function runDataTool(name, clientId) {
  try {
    if (name === 'get_winners') return await social.getRecentWinners(clientId, { days: 90, limit: 5 });
    if (name === 'get_trending_sounds') return (await social.getRecentTrendingSounds(clientId).catch(() => ({ sounds: [] })))?.sounds || [];
    if (name === 'get_framework_breakdown') return await social.getFrameworkBreakdown(clientId, { days: 90 });
    if (name === 'get_competitor_handles') {
      const pool = require('../db');
      const { rows } = await pool.query('SELECT social_competitors FROM clients WHERE id = $1', [clientId]);
      return rows[0]?.social_competitors || [];
    }
    return { error: `Unknown tool: ${name}` };
  } catch (err) {
    return { error: err.message };
  }
}

// Agentic loop — Claude can call data tools any number of times before
// landing on propose_plan or reply_only. Hard-capped by MAX_TOOL_ROUNDS.
async function chatBuildPlan({ client, currentPlan, history, attachment }) {
  const userIntro = `Client: ${client.name}
About: ${client.briefing_field || '(no briefing set)'}
Monthly focus: ${client.monthly_focus || '(none set)'}

${currentPlan
  ? `Current saved plan:\n${JSON.stringify(currentPlan, null, 2)}`
  : 'No plan saved yet — this conversation will produce the first one.'}`;

  const messages = [
    { role: 'user', content: userIntro },
    ...history.map(m => ({ role: m.role, content: m.content })),
  ];

  // If an attachment came in this turn, splice it onto the latest user
  // message as a document/image content block so Claude can read it.
  if (attachment?.buffer && attachment?.mimeType) {
    const last = messages[messages.length - 1];
    if (last && last.role === 'user') {
      const block = attachment.mimeType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: attachment.buffer.toString('base64') } }
        : { type: 'image', source: { type: 'base64', media_type: attachment.mimeType, data: attachment.buffer.toString('base64') } };
      const textBlock = { type: 'text', text: typeof last.content === 'string' ? last.content : '' };
      last.content = [block, textBlock];
    }
  }

  const tools = [
    GET_WINNERS_TOOL, GET_TRENDING_SOUNDS_TOOL, GET_COMPETITOR_HANDLES_TOOL, GET_FRAMEWORK_BREAKDOWN_TOOL,
    PROPOSE_PLAN_TOOL, REPLY_ONLY_TOOL,
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: SYSTEM,
      tools,
      // Don't force a tool on data-fetch rounds — let Claude choose. The
      // system prompt makes the contract: end on propose_plan or reply_only.
      messages,
    });
    require('./costLog').recordClaudeCost({ model: MODEL, response, feature: 'social_planner', clientId: client?.id || null });

    const dataToolUses = response.content.filter(b => b.type === 'tool_use' && ['get_winners', 'get_trending_sounds', 'get_competitor_handles', 'get_framework_breakdown'].includes(b.name));
    const proposeUses = response.content.filter(b => b.type === 'tool_use' && b.name === 'propose_plan');
    const replyUses = response.content.filter(b => b.type === 'tool_use' && b.name === 'reply_only');

    // If Claude ended on propose_plan / reply_only, return now.
    if (proposeUses.length || replyUses.length || response.stop_reason === 'end_turn') {
      const textBlocks = response.content.filter(b => b.type === 'text');
      const proposed = proposeUses.length ? proposeUses[proposeUses.length - 1].input?.plan : null;
      let reply = textBlocks.map(b => b.text).join('\n').trim();
      if (replyUses.length) {
        const replyMsg = replyUses.map(b => b.input?.message).filter(Boolean).join('\n').trim();
        reply = reply ? `${reply}\n${replyMsg}` : replyMsg;
      }
      if (!reply && proposed) reply = 'Plan updated — let me know what to change.';
      if (response.stop_reason === 'max_tokens' && !reply) {
        return { reply: "My response hit the size limit. Try splitting the request — e.g. 'draft the scenes first, then we'll add equipment and reuse'.", proposed: null };
      }
      if (!reply && !proposed) {
        return { reply: `I didn't return a useful response (stop_reason: ${response.stop_reason || 'unknown'}). Try a smaller change first.`, proposed: null };
      }
      return { reply, proposed };
    }

    // Otherwise, run the data tools and append results, then loop.
    if (dataToolUses.length) {
      messages.push({ role: 'assistant', content: response.content });
      const toolResults = [];
      for (const t of dataToolUses) {
        const result = await runDataTool(t.name, client.id);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: t.id,
          content: JSON.stringify(result).slice(0, 4000),
        });
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Defensive: stuck without progress.
    return { reply: 'I got stuck without producing a plan. Try sending a more specific instruction.', proposed: null };
  }
  return { reply: 'Hit the maximum number of grounding rounds. Try a more direct instruction so I can land on a plan.', proposed: null };
}

// Convert a locked plan to markdown for PDF / Word export.
function planToMarkdown(plan) {
  if (!plan) return '';
  const out = [];
  out.push(`# ${plan.title || 'Social Post Plan'}`);
  if (plan.platforms?.length) out.push(`\n**Platforms:** ${plan.platforms.join(', ')}`);
  if (plan.duration_seconds) out.push(`\n**Duration:** ${plan.duration_seconds}s`);
  if (plan.audience) out.push(`\n**Audience:** ${plan.audience}`);
  if (plan.performance_hypothesis) out.push(`\n**Performance hypothesis:** ${plan.performance_hypothesis}`);
  if (plan.framework) {
    out.push(`\n**Framework:** ${plan.framework}`);
    if (plan.framework_rationale) out.push(`> ${plan.framework_rationale}`);
  }
  if (plan.hook?.text) {
    out.push(`\n## Hook (first 1–3 seconds)\n${plan.hook.text}`);
    if (plan.hook.rationale) out.push(`> ${plan.hook.rationale}`);
  }
  if (plan.scenes?.length) {
    out.push(`\n## Scenes`);
    for (const s of plan.scenes) {
      out.push(`\n### Scene ${s.number}${s.style_code ? ` [${s.style_code}]` : ''} — ${s.name || ''}`);
      if (s.duration_seconds) out.push(`*${s.duration_seconds}s*`);
      if (s.shot) out.push(`\n**Shot:** ${s.shot}`);
      if (s.bullets?.length) {
        out.push(`\n**Bullet points (talk to these — not a script):**`);
        for (const b of s.bullets) out.push(`- ${b}`);
      }
      if (s.b_roll?.length) {
        out.push(`\n**B-roll:**`);
        for (const b of s.b_roll) out.push(`- ${b}`);
      }
      if (s.on_screen_text?.length) {
        out.push(`\n**On-screen text:**`);
        for (const t of s.on_screen_text) {
          const timing = (t.timing_start != null && t.timing_end != null) ? ` (${t.timing_start}s–${t.timing_end}s)` : '';
          out.push(`- "${t.text}"${timing}`);
        }
      }
    }
  }
  if (plan.cta) out.push(`\n## Call to action\n${plan.cta}`);
  if (plan.caption) out.push(`\n## Caption\n${plan.caption}`);
  if (plan.hashtags?.length) out.push(`\n**Hashtags:** ${plan.hashtags.map(h => h.startsWith('#') ? h : '#' + h).join(' ')}`);
  if (plan.equipment) {
    out.push(`\n## Equipment`);
    if (plan.equipment.minimum?.length) {
      out.push(`\n**Minimum (phone shoot):**`);
      for (const e of plan.equipment.minimum) out.push(`- ${e}`);
    }
    if (plan.equipment.ideal?.length) {
      out.push(`\n**Ideal:**`);
      for (const e of plan.equipment.ideal) out.push(`- ${e}`);
    }
  }
  if (plan.locations?.length) { out.push(`\n## Locations`); for (const l of plan.locations) out.push(`- ${l}`); }
  if (plan.props_wardrobe?.length) { out.push(`\n## Props / wardrobe`); for (const p of plan.props_wardrobe) out.push(`- ${p}`); }
  if (plan.talent) out.push(`\n## Talent\n${plan.talent}`);
  if (plan.editing_notes) out.push(`\n## Editing notes\n${plan.editing_notes}`);
  if (plan.music) {
    out.push(`\n## Music`);
    if (plan.music.mood) out.push(`- **Mood:** ${plan.music.mood}`);
    if (plan.music.tempo) out.push(`- **Tempo:** ${plan.music.tempo}`);
    if (plan.music.suggestions?.length) {
      out.push(`- **Track suggestions:**`);
      for (const t of plan.music.suggestions) out.push(`  - ${t}`);
    }
  }
  if (plan.reuse_plan?.length) {
    out.push(`\n## Reuse plan`);
    out.push(`\n| Platform | Duration | Notes |`);
    out.push(`|---|---|---|`);
    for (const r of plan.reuse_plan) {
      out.push(`| ${r.platform} | ${r.duration_seconds ? r.duration_seconds + 's' : '—'} | ${r.notes || ''} |`);
    }
  }
  if (plan.approval_gates?.length) {
    out.push(`\n## Approval gates`);
    out.push(`\n| Gate | Owner |`);
    out.push(`|---|---|`);
    for (const g of plan.approval_gates) out.push(`| ${g.gate} | ${g.owner || '—'} |`);
  }
  return out.join('\n');
}

function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') return 'plan must be an object';
  if (!plan.title) return 'plan.title is required';
  if (!plan.framework) return 'plan.framework is required';
  if (!plan.hook?.text) return 'plan.hook.text is required';
  if (!Array.isArray(plan.scenes) || !plan.scenes.length) return 'plan.scenes must have at least one scene';
  return null;
}

module.exports = { chatBuildPlan, planToMarkdown, validatePlan };
