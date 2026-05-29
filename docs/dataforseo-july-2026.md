# DataForSEO — what to do on 1 July 2026

On **1 July 2026**, DataForSEO removes the $100/mo subscription on two APIs and both move to pay-as-you-go for every customer:

- **Backlinks API** — full backlink + referring-domain data per domain
- **LLM Mentions API** — how AI assistants (ChatGPT, Claude, Perplexity, Gemini, Copilot) mention a brand

We don't hold those subscriptions today, so the platform refuses to call those endpoints (see `services/dfsAvailability.js`). After 1 July the gate lifts automatically and we can start wiring features in.

This file is the checklist + plan. It's referenced from the SEO-tab banner — once it goes green ("now available"), open this file.

---

## 1. Day-of checklist (1 July 2026)

Run through this list on the day:

- [ ] **Log into DataForSEO** — confirm both Backlinks API and LLM Mentions API show "Pay-as-you-go enabled" on the dashboard. No commitment shown.
- [ ] **Confirm pricing per call** — the platform's connectors assume the 20% rate adjustment that DataForSEO announced for July 1 took effect.
- [ ] **Smoke-test one call to each** — easiest is via the platform itself: trigger any code path that hits `/backlinks/summary/live` or `/llm_mentions/...`. It should now succeed instead of throwing the gated error.
- [ ] **Decide cadence** — current scheduler runs SEO data every 3 days. With Backlinks added, consider whether to keep 3 or move to 4 to control cost. Edit `services/scheduler.js`.
- [ ] **Decide per-client opt-in** — some clients won't need Backlinks (small / new domains). Suggested: a `dataforseo_features` JSONB column on `clients` with sensible defaults, exposed in client setup.
- [ ] **Start the Phase E PRs** (see below).

---

## 2. Phase E build plan (post-July)

These are the PRs to write after 1 July. Each one is independent; ship in this order so the foundation is in place before the headline features.

### E1 — Backlinks raw data pull (per client, every 3 days)
**Endpoints:** `/backlinks/summary/live`, `/backlinks/referring_domains/live` (top 1000), `/backlinks/anchors/live`
**Storage:** new tables
- `dfs_backlinks_summary (client_id, captured_at, backlinks_total, referring_domains_total, dofollow_ratio, spam_score, rank, raw JSONB)`
- `dfs_referring_domains (client_id, captured_at, domain, rank, first_seen, last_seen, backlinks_count, dofollow, raw JSONB)`
- `dfs_anchors (client_id, captured_at, anchor, backlinks_count, referring_domains_count)`
**Scheduler:** add a `pullBacklinks(clientId)` function called from the existing 3-day SEO sweep.
**Cost:** ~$0.06 per client per cycle.

### E2 — Backlinks summary panel on the SEO tab
**UI:** new "Backlinks" sub-tab on `ClientSEOPage`. Headline cards: total BLs, total RDs, dofollow %, spam score. Sparkline of RD count over the last 90 days. Top-50 referring domains table with first/last seen dates.

### E3 — New / lost backlinks since last cycle
**Query:** diff today's `dfs_referring_domains` snapshot against the previous one.
**UI:** "New since last check" + "Lost since last check" panels on the Backlinks sub-tab. This is the natural feed for the AM to scan every Monday.

### E4 — Press release → backlink attribution (the killer feature)
**The PR ROI feature nobody else has.** For every `outreach_press_releases.sent_at`, look at the new RDs in the 21-day window after the send. Surface as:
- A panel on each press campaign's detail view: "14 new RDs in the 21 days after launch (9 dofollow, 5 from outlets you'd pitched)"
- A workspace-wide leaderboard: campaigns ranked by RDs earned per recipient
**Schema:** views over the existing tables; no new tables needed.

### E5 — LLM Mentions raw data pull
**Endpoints:** TBC by DataForSEO docs as of July (the LLM Mentions API surface may evolve). Expect a per-prompt-per-engine call shape: "for prompt X, what did engine Y answer?"
**Storage:**
- `ai_prompts (id, client_id, prompt, intent, active, created_at)` — the curated buyer-intent prompt library per client
- `ai_prompt_runs (id, prompt_id, engine, captured_at, answer_text, mentioned_brands JSONB, cited_urls JSONB, sentiment, raw JSONB)`
**Cadence:** every 3 days, all active prompts × 5 engines (ChatGPT, Claude, Perplexity, Google AIO, Copilot).

### E6 — AI Visibility tab on client SEO page
Following the Searchable.com shape:
- **Composite Visibility Score** — single number, week-on-week trend. Inputs: mention rate, citation rate, competitor share-of-voice, cross-engine breadth.
- **Per-engine breakdown** — 5 horizontal stripes showing strength on each engine.
- **Prompt library** — CRUD on `ai_prompts`. AM curates + Claude proposes new ones from the brand context.
- **Citation explorer** — every URL the AIs cited; sortable by frequency, content type, last seen.
- **Competitor leaderboard** — share-of-voice in AI answers. Auto-populates from `dataforseo_labs/google/competitors_domain` + manual additions.

### E7 — Press release → AI citation attribution
Cross-reference `outreach_press_releases.sent_at` against `ai_prompt_runs.cited_urls` in the 30-day window after the send. Surface alongside E4 on the press campaign detail: "ChatGPT now cites your release in 4/12 buyer prompts (was 1/12 pre-send)."

### E8 — Claude content-brief generator for AEO
Already trivial with our Claude wiring. New button on the press wizard / blog flow that asks Claude to draft a citation-optimised content brief: short authoritative answer at top, Q&A blocks, suggested schema markup, sourceable claims with link targets. Uses the AI Visibility tab's mention/citation data as input so the brief targets prompts the brand currently loses.

---

## 3. Pre-July reminders surfaced in the UI

- `ClientSEOPage` — yellow banner: "Coming 1 July 2026 — DataForSEO Backlinks & LLM Mentions" with the bulleted feature list. Hides itself automatically once the cutover is past.
- After 1 July the same banner flips green: "DataForSEO Backlinks + LLM Mentions are now available — open `docs/dataforseo-july-2026.md` for the implementation checklist." Carries a Dismiss button so it can be cleared once Phase E is in flight.

---

## 4. Cost model recap (per client, full Phase E on, every 3 days)

| Item | Approx $/mo per client |
|---|---|
| Backlinks summary + RDs + anchors | $2–3 |
| LLM Mentions (5 engines × 10 prompts) | $3–6 |
| **Total Phase E uplift** | **$5–9** |

At the post-July 20% rate adjustment. Moving the cadence from every 3 days to every 4 cuts call volume by ~25%.

---

## 5. Where the gating lives (for context)

- `platform/backend/src/services/dfsAvailability.js` — the date constant + gating helper. Edit `ENABLED_FROM` here if DataForSEO push the date back.
- `platform/backend/src/connectors/dataforseo.js` — axios request interceptor calls `assertUnlocked()` before any request. After 1 July this passes silently for the gated APIs.
- `platform/backend/src/routes/auth.js` — `/auth/me` returns `dataforseo_availability` so the frontend can render the banner.
- `platform/frontend/src/pages/ClientSEOPage.jsx` — `DfsAvailabilityBanner` reads `user.dataforseo_availability` and renders the appropriate state.

No code change needed for the cutover itself — when the system clock passes `ENABLED_FROM`, the gate lifts automatically.
