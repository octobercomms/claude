// Conversational social post planner — replaces the nine-at-a-time
// batch generator with a chat-driven refinement loop.
//
// The AM describes a post idea, Claude proposes a structured plan
// (title, hook, scenes with bullet points and style codes, equipment,
// captions, hashtags, reuse plan, approval gates), AM iterates, then
// locks. Same pattern as the report-template builder.
//
// The framework system (Hook-Story-Offer / AIDA / PAS) and the A-G
// video-style grammar from the original batch flow (services/social.js)
// are preserved here verbatim — they're the IP that makes the output
// actually shootable.

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-4-6';

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

# What to include in every plan
- Title — short, AM-readable.
- Platforms (array): instagram_reels | tiktok | youtube_shorts | instagram_feed | instagram_story | carousel.
- Duration (seconds).
- Performance hypothesis — which metric this post is meant to move (reach / saves / clicks / DMs). Without this we can't measure success.
- Hook — the first 1-3 seconds. Pattern interrupt. Generate this separately from the body.
- Framework + rationale.
- Scenes (3-8 of them). Each scene: name, duration_seconds, style_code (A-G if reel), shot (what's in frame + camera movement), bullets (the IDEA the talent should communicate — never a word-for-word script), b_roll (cutaways the editor needs), on_screen_text (text + in/out timing).
- CTA — what the viewer should do next.
- Caption + hashtags (separate for IG vs TT if formats differ enough).
- Equipment — minimum (phone shoot reality) and ideal (camera/lav mic) lists.
- Locations.
- Props / wardrobe.
- Talent — who's on camera, what they need to be briefed on.
- Editing notes — pace, transitions to avoid.
- Music brief — mood, tempo, Epidemic Sound / Artlist track suggestions.
- Reuse plan — same content cut for other platforms with format + duration notes.
- Approval gates — script approval, rough cut approval, final cut approval. Each gate names who from the client side owns it.

# Process rules
Every turn you MUST call exactly one tool: either propose_plan (commits a draft the AM can lock) or reply_only (text reply, no plan change). There is no third option.

Default to propose_plan. The AM can iterate on a draft but can't iterate on a promise. Only use reply_only for genuine clarifying questions you can't answer yourself.

Brief replies. British English. No filler.`;

const PROPOSE_PLAN_TOOL = {
  name: 'propose_plan',
  description: 'Surface a structured plan for the AM to review. Call whenever the plan should change.',
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
          performance_hypothesis: { type: 'string', description: 'Which metric this is meant to move and why.' },
          audience: { type: 'string' },
          framework: { type: 'string', enum: ['Hook-Story-Offer', 'AIDA', 'PAS', 'UGC'] },
          framework_rationale: { type: 'string' },
          hook: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'The verbal/visual hook for the first 1-3 seconds.' },
              rationale: { type: 'string' },
            },
            required: ['text'],
          },
          scenes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                number: { type: 'number' },
                name: { type: 'string' },
                duration_seconds: { type: 'number' },
                style_code: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], description: 'Reel scenes only.' },
                shot: { type: 'string', description: 'What the camera sees + camera movement.' },
                bullets: { type: 'array', items: { type: 'string' }, description: 'Talking points / ideas — NOT a word-for-word script.' },
                b_roll: { type: 'array', items: { type: 'string' } },
                on_screen_text: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      text: { type: 'string' },
                      timing_start: { type: 'number' },
                      timing_end: { type: 'number' },
                    },
                    required: ['text'],
                  },
                },
              },
              required: ['number', 'name', 'shot', 'bullets'],
            },
          },
          cta: { type: 'string' },
          caption: { type: 'string' },
          hashtags: { type: 'array', items: { type: 'string' } },
          equipment: {
            type: 'object',
            properties: {
              minimum: { type: 'array', items: { type: 'string' } },
              ideal: { type: 'array', items: { type: 'string' } },
            },
          },
          locations: { type: 'array', items: { type: 'string' } },
          props_wardrobe: { type: 'array', items: { type: 'string' } },
          talent: { type: 'string' },
          editing_notes: { type: 'string' },
          music: {
            type: 'object',
            properties: {
              mood: { type: 'string' },
              tempo: { type: 'string' },
              suggestions: { type: 'array', items: { type: 'string' } },
            },
          },
          reuse_plan: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                platform: { type: 'string' },
                duration_seconds: { type: 'number' },
                notes: { type: 'string' },
              },
              required: ['platform'],
            },
          },
          approval_gates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                gate: { type: 'string', description: 'e.g. "Script approval", "Rough cut approval", "Final cut approval".' },
                owner: { type: 'string', description: 'Name + role of the person responsible.' },
              },
              required: ['gate'],
            },
          },
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
  input_schema: {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
  },
};

// Turn-based chat — same shape as services/claude.js chatBuildReportTemplate.
// History is supplied by the frontend; we don't store it server-side until
// the AM locks (then the latest plan persists; the conversation is
// ephemeral by design).
async function chatBuildPlan({ client, currentPlan, history }) {
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

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: SYSTEM,
    tools: [PROPOSE_PLAN_TOOL, REPLY_ONLY_TOOL],
    tool_choice: { type: 'any' },
    messages,
  });

  const proposeUses = response.content.filter(b => b.type === 'tool_use' && b.name === 'propose_plan');
  const replyUses = response.content.filter(b => b.type === 'tool_use' && b.name === 'reply_only');
  const textBlocks = response.content.filter(b => b.type === 'text');
  const proposed = proposeUses.length ? proposeUses[proposeUses.length - 1].input?.plan : null;
  let reply = textBlocks.map(b => b.text).join('\n').trim();
  if (replyUses.length) {
    const replyMsg = replyUses.map(b => b.input?.message).filter(Boolean).join('\n').trim();
    reply = reply ? `${reply}\n${replyMsg}` : replyMsg;
  }
  if (!reply && proposed) reply = 'Updated the plan on the right — let me know what to change.';
  if (response.stop_reason === 'max_tokens' && !reply) {
    console.warn('[socialPlanner] hit max_tokens');
    reply = 'My response hit the size limit. Try splitting — e.g. "draft the scenes first, then we\'ll add captions and music".';
    return { reply, proposed: null };
  }
  if (!reply && !proposed) {
    console.warn('[socialPlanner] empty reply + empty proposed', { stop_reason: response.stop_reason });
    reply = `I didn't return a useful response (stop_reason: ${response.stop_reason || 'unknown'}). Try a smaller change first.`;
    return { reply, proposed: null };
  }
  return { reply, proposed };
}

// Convert a locked plan to markdown for PDF / Word export.
// chatExport.markdownToPdfBuffer / markdownToDocxBuffer takes it from
// there, so the social planner inherits the same branded shell as the
// AI Data Analyst exports.
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
  if (plan.locations?.length) {
    out.push(`\n## Locations`);
    for (const l of plan.locations) out.push(`- ${l}`);
  }
  if (plan.props_wardrobe?.length) {
    out.push(`\n## Props / wardrobe`);
    for (const p of plan.props_wardrobe) out.push(`- ${p}`);
  }
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
