# The OMI expert agent

_Status: proposal, awaiting sign-off. No code written._

## What Daniel asked for

> "I'd love to brief Claude to go and prepare my press pitches. If I drop in
> the lists, it can import them and attach them, and give it a brief. The way I
> talk to you about what I want done, but with the knowledge you have of the
> mechanics and best way to use the tool."

> "It can never hit go on anything. It asks me to review and click go."

> "I also want it to read OMI and figure out the best way to achieve the goal.
> So I can propose what I'm doing, and it plans a route."

> "It is the expert of the tool. It knows the ins and outs of it, what is
> possible, what isn't. And yes, I want it to tell me what it cannot do."

Three requirements, in his numbering:

1. It should know what OMI can do, from a document that stays current.
2. It should take a goal and work out a sequence.
3. It should tell him what it thinks he should do.

## What already exists

More than either of us assumed. Worth stating precisely, because the gap is
smaller than the ambition and the cost of rebuilding what works is wasted.

| Piece | Where | State |
|---|---|---|
| Client-scoped tool-using chat | `backend/src/routes/chat.js` | Live. Full tool loop, 16 tools, mounted in `Layout.jsx` |
| Connector awareness | `get_client_info` in `chat.js` | Live. Returns every connector with status, config, last sync, errors |
| Cross-pillar strategist persona | `buildStrategistSystemPrompt` | Live. Reads the whole-account briefing, told to give priorities with reasoning |
| Propose then approve loop | `backend/src/services/mediaAssistant.js` | Live. `propose_actions` tool, `applyActions()` runs only after approval |
| Per-client readiness across suites | `backend/src/services/suiteProgress.js` | Live. Derives completion for eight suites from real data |

Three of the five pieces this needs are already shipped and in production.

## What is missing

**1. OMI does not describe its own actions.** `chat.js` has sixteen tools, of
which twelve read and four write (`generate_content_draft`,
`generate_social_posts`, `generate_ad_creatives`, `build_pitch_targets`). OMI
has dozens of actions. The agent cannot route through a capability it has never
been told about, so today it would tell Daniel something is impossible when the
screen for it exists.

**2. The pillar personas are cages.** `PILLAR_META` scopes each persona to one
pillar of PESO and gives it exactly one action tool. The complaint that OMI
"forces me to use it one way" is this object, in code.

**3. Nothing plans.** The chat answers turn by turn. There is no object
representing a route, so nothing can be reviewed before it runs, and nothing can
be approved step by step.

**4. It cannot state its own edges.** Asked whether OMI can do something, it
will guess from its system prompt. A guess that says yes is worse than a no.

## Requirement 1: knowledge that cannot go stale

Daniel's proposal is a written document the agent reviews, which I update
whenever the code changes. The mechanism is right. The maintenance model is the
one that has already failed here.

`CLAUDE.md` records the precedent: a wrong line in `agent-guide.md` survived six
sessions unnoticed. On 6 October 2026 I misclassified three cron-driven AI
services in a budget guard I had written hours earlier, in the same session. The
conclusion from that night was written down at the time: *a guard that
classifies wrongly is worse than no guard, because it reads as assurance.* A
capability document that is wrong is worse than none, because the agent will
plan a route through a capability that does not exist, or miss the right route
because the entry was never added.

So the document is **generated, not written**.

### Capability declarations

Every action in OMI gains a declaration, co-located with its own code, in the
file that implements it:

```js
// backend/src/routes/press.js
exports.capabilities = [{
  id: 'press.audience.build',
  label: 'Build a press release audience',
  surface: 'Earned → Press → Release → Audience',
  verb: 'read',                       // read | create | dispatch
  inputs:  [{ type: 'client' }, { type: 'press_release' }],
  outputs: [{ type: 'contact_list' }],
  requires: ['contacts'],             // connector or data prerequisites
  cost: { ai: false, dataforseo: false },
  limits: 'Excludes do-not-contact, unsubscribed, bounced, and per-release and per-client exclusions.',
}];
```

A build-time script walks the route and service files, collects every
declaration, and writes two artefacts from the same source:

- `backend/generated/capabilities.json`, which the agent loads.
- `docs/omi/capabilities.md`, which Daniel reads.

Both are committed, so a diff shows what changed when a capability changed.

### The guard

A test in `backend/tests/` asserts that every route handler which writes
(`POST`, `PATCH`, `PUT`, `DELETE`) is covered by a declaration, with an explicit
allow-list for the ones that are deliberately internal. This is the same shape
as `backend/tests/budget-gating.test.js`, which has been verified to fail when a
gate is removed rather than merely to pass. Adding a write route without
declaring it turns CI red.

That is the whole difference between this and a hand-written guide. The guide
depends on me remembering. This depends on me not being able to merge.

### The part that cannot be generated

Judgement does not live in code: which sequences are worth running, which waste
money, what OMI is weak at, what the three-step route is when the one-step route
exists but is bad. That stays hand-written in
`docs/omi/capability-notes.md`, deliberately short, and the agent is told to
label anything drawn from it as opinion rather than fact. A fact it gets wrong
costs Daniel a wasted hour. An opinion it gets wrong costs him a raised eyebrow.

## Requirement 2: planning

A plan is a stored object, not a paragraph. This is the difference between a
promise and a gate.

```
agent_plans
  id, client_id, goal TEXT, status, created_by, created_at
  reasoning TEXT          -- why this route, in prose, for Daniel
  cannot TEXT[]           -- what it could not do, and why
agent_plan_steps
  id, plan_id, seq
  capability_id           -- must exist in capabilities.json
  label, inputs JSONB
  est_cost_usd NUMERIC
  needs_input BOOLEAN     -- something only Daniel can supply
  status                  -- pending | approved | running | done | failed | skipped
  result JSONB
```

The agent gets one new tool, `propose_plan`, which writes a plan and its steps
and returns nothing executable. There is no `execute_plan` tool. The agent
cannot run a step, because the only thing that can is
`POST /clients/:id/agent-plans/:planId/steps/:stepId/run`, which requires a
session and is called by Daniel's click. The constraint is structural. A prompt
instruction saying "never send" is a request; a missing endpoint is a fact.

Validation at write time, not at run time:

- Every `capability_id` must exist in `capabilities.json`, else the step is
  rejected and the agent is told why. This is what stops it inventing a route.
- Any step whose capability has `verb: 'dispatch'` is forced to
  `needs_input: true` and carries a standing warning in the UI. Sending is
  always Daniel's click, per his constraint, and this holds even if a future
  prompt change would have allowed otherwise.
- `est_cost_usd` is summed across the plan and shown before approval.

## Requirement 3: recommendations

The agent is asked what Daniel should do, which means it needs a basis and needs
to be honest when it has none. The basis it already has:

- `suiteProgress.js` readiness, per suite, derived from real data.
- The saved cross-PESO briefing, which the strategist persona already reads.
- Live connector data, SEO rankings, CRO findings, anomalies, the context log.
- Media health (`mediaHealth.js`) for anything earned.

Rules in the prompt, each of which exists because of something that has already
gone wrong:

- Recommend from readiness and data, never from a general sense of good practice.
- Where the data is thin, say the data is thin and name what would fix it.
  Never fill the gap.
- Say what you cannot do, naming the capability that is missing rather than
  implying OMI is simply bad at it.
- Quote the cost of a recommendation before recommending it.

## Where it lives

Admin, as Daniel said, because it is cross-client and cross-tool rather than
sitting inside one pillar. A client selector at the top, then one chat. The
existing pillar personas stay as they are for people who want the narrow view;
this is the way in for a goal that does not fit a pillar.

Below the chat, a plan panel: the goal, the reasoning, the steps with their
costs, a Go per step, a Go for the whole plan, and the `cannot` list rendered
plainly rather than buried.

## Cost

This agent spends money on every turn, which on the evidence of 6 October 2026
is the thing most likely to go wrong. Four incidents that day came from AI calls
sitting outside a budget, the worst of them billing $20.75 against a $10 budget
while Settings read "stopped".

So, on day one and not later:

- A new task budget, `assistant`, in its own migration, seeded with no cap so
  Daniel sets it himself.
- Every call routed through `callClaude`, not a direct `new Anthropic()`. The
  direct-SDK pattern is the root cause of three separate incidents, and it only
  exists where `web_search` is needed. This agent does not need `web_search`.
- `assertUnderTaskCap` before the turn, `noteTaskSpend` after it, because the
  30-second spend cache otherwise lets a long conversation bill past the cap.
- `backend/tests/budget-gating.test.js` extended to cover the new service.

Expected cost per turn with full tool use is in the range of $0.05 to $0.20 on
Sonnet, so a $10 cap is roughly 60 to 200 briefing conversations a month. That
is a usable number, not a scaled-back one.

## The risk, named

A registry covering four capabilities out of forty is worse than none, because
the agent will plan confidently through the four and declare the other
thirty-six impossible. `capability-architecture.md` already states this risk for
the UI; it is sharper here, because a wrong next-step suggestion in a sidebar is
ignorable and a wrong plan wastes an afternoon.

The mitigation is sequencing, not care. Declarations come before the planner,
and the planner ships only once the CI guard is green across every write route.
Until then the agent is a better strategist with no plan object, which is still
an improvement on today and is honest about its own limits.

## Build order

Each phase is useful on its own and testable before the next, per Daniel's
earlier requirement that every part can be tested as it is developed.

| Phase | What ships | Test |
|---|---|---|
| 1 | Declaration format, generator, both artefacts, CI guard with an allow-list | CI fails on an undeclared write route |
| 2 | Declarations filled in across every write route, allow-list emptied | Generated `capabilities.md` reviewed by Daniel against what he knows OMI does |
| 3 | `assistant` task budget, the new service on `callClaude`, budget guard extended | Budget test covers it; a capped budget stops a turn |
| 4 | The Admin chat, cross-client, reading `capabilities.json`, no plan object | Daniel asks it what OMI can do and checks the answers |
| 5 | `agent_plans`, `propose_plan`, the plan panel, per-step Go, dispatch forcing | A proposed send stops at prepared, never sent |
| 6 | `capability-notes.md`, recommendations grounded in readiness | Daniel asks for a recommendation on a thin-data client and it says the data is thin |

Phase 2 is the bulk of the work and the phase most likely to be rushed. It is
also the one that decides whether any of this is trustworthy.

## Open questions for Daniel

1. Does the plan panel need to save a plan for later, or is a plan always acted
   on in the session that made it? Saving is cheap now and expensive to retrofit.
2. Should a plan be able to span clients, or is one plan always one client?
   One client is simpler and matches how the rest of OMI is scoped.
3. On phase 4, is a cross-client agent that can read everything but write
   nothing useful on its own, or should phase 5 land with it?
