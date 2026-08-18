# Pillar Overview Chat — the acting agent on every PESO overview

Turns each PESO pillar's **Overview** tab from a static launchpad into a chat with
Claude that already knows the pillar's live numbers and can *do* the pillar's
jobs — so the account manager stops mining data and setting up content by hand.

**"Chat leads, data stays":** the chat renders as the lead element at the top of
the Overview tab; the existing `SuiteOverview` launchpad is kept directly below,
untouched.

## Where it is

| Pillar | Page | Persona |
|--------|------|---------|
| Paid | `pages/ClientAdsPage.jsx` | `paid` |
| Earned | `pages/ClientPRPage.jsx` | `earned` |
| Shared | `pages/ClientSocialPage.jsx` | `shared` |
| Owned | `pages/ClientSEOPage.jsx` | `owned` |
| Data hub | `components/StrategistBriefingPanel.jsx` (Strategist) | `strategist` (pre-existing) |

Front end: one reusable component `components/OverviewChat.jsx` (a pillar-scoped
sibling of `StrategistChat`). It posts to the existing chat agent with
`persona=<pillar>`, renders Markdown, and exports any answer to PDF/Word. Each
pillar has its own conversation thread and starter prompts.

## How it works (backend)

It reuses the existing tool-using agent in **`routes/chat.js`** — no new endpoint.
The pillar personas (`paid`/`earned`/`shared`/`owned`) join the existing
`analyst`/`strategist` personas:

- **Threads.** `thread === persona`, so each pillar keeps its own history
  (`client_chat_messages`). `GET`/`POST`/`DELETE /chat/:clientId` accept the
  pillar as `?thread=` / `persona` (whitelisted via `VALID_THREADS`).
- **System prompt.** `buildPillarSystemPrompt(pillar, …)` frames the agent as
  October's specialist for that pillar, tells it to lead with the overview and
  the data tools, and sets a **hard boundary**: never send, publish, or
  schedule anything live — prepare the draft and hand off to the AM's button.
- **Tools.** `personaTools(persona)` = the base read tools (connector data, SEO
  rankings, CRO findings, anomalies, reports, context log) **plus** two pillar
  tools:
  - `get_pillar_overview` → the pillar's `reportData()` from
    `paidOverviewReport` / `earnedOverviewReport` / `socialOverviewReport` /
    `ownedOverviewReport` (grounding).
  - one **action** tool that produces and **persists** a real deliverable:

    | Persona | Action tool | Service | Persists |
    |---------|-------------|---------|----------|
    | owned | `generate_content_draft` | `contentDraft.generateDraft` | `content_drafts` |
    | shared | `generate_social_posts` | `social.generateBatch` | `social_batches` / `social_posts` |
    | paid | `generate_ad_creatives` | `adCreative.generateBatch` | `ad_creative_batches` / `ad_creatives` |
    | earned | `build_pitch_targets` | `prTarget.findTargets` | (returns a ranked list) |

Each action tool is offered **only** to its own persona, so a persona can't
reach another pillar's action. `analyst`/`strategist` tool sets are unchanged.

## Safety boundary

Every wired action is **internal / reversible** — it writes a draft/batch inside
OMI or returns an analysis. The agent is prompted, and only tooled, to stay
inside that line. The **external / irreversible** actions catalogued on each
pillar page (send an email to a journalist or client, publish a draft to the
live CMS, bulk-schedule or publish-now to live social accounts, enable the live
DM bot) are deliberately **not** exposed to the agent; it prepares and points the
AM at the button.

## Cost

Chat runs on the default Sonnet chat model; usage is logged per pillar as
`overview_chat_<pillar>` in `api_cost_events` (Settings → Costs & usage).

## Extending it

- **More actions per pillar.** Add a tool def + an `executeTool` case wired to
  an existing internal service (see the inventories in each pillar page). Keep
  the internal/reversible rule.
- **Give the Strategist action tools** so the Data hub can make things too, not
  just advise.

_Last verified: 2026-08-18._
