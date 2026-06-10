# Contacts intelligence — plan

Turning the contacts database from a filing cabinet into a **targeting engine**.
PRs live and die by list quality and how well pitches are targeted; this is where
AI earns its keep. Builds on the merged unified contacts model (`outreach_contacts`
with `kind` = media/industry/prospect, `beats`, `outlet_id` → `pr_outlets`), the
editorial log, `relationshipStrength`/"gone quiet" scoring, the coverage monitor,
and the thank-you engine.

## Principles

- **Heavy = overnight batch, light = instant.** Anything credit-heavy (enrichment,
  tiering, byline/archive sweeps) runs as a scheduled overnight job in chunks.
  Only light work runs live in the UI (the targeting chat = one query; opening a
  profile).
- **Cheap model for cheap work.** Classification/tagging/enrichment summaries use
  **Haiku**; the strong model is reserved for the targeting chat's reasoning.
- **Never run an LLM over all 16k.** Retrieval (candidate selection) is done with
  cheap SQL over `beats`/`tags`/coverage overlap; only the shortlist (~top 50)
  goes to Claude. (An embeddings "topic map" is an optional later upgrade — same
  shape, just better recall — but not required and not built first, since there's
  no vector store today.)
- **Ground every enrichment in real evidence.** Enrich from the coverage we
  already hold (their story titles) and, on demand, a fetch of their bylines —
  never "Claude, tell me about X" from nothing (that hallucinates for the long
  tail). Every enriched field carries a confidence + `last_enriched_at`.
- **Prioritise by tier; lazy on the tail.** Spend AI effort on tier 1/2 and
  contacts with real coverage; enrich the dead-weight tail on demand or never.
  Incremental — re-enrich only when new coverage arrives.

### Rough cost (16k contacts)
- One-time enrichment, Haiku, grounded in existing data, chunked overnight:
  order of **~$10–20 once**. Each targeting query: **a few cents**. Archive byline
  sweeps: only stale candidates, staggered → **~$1–2/run** (Serper ~$0.0003–0.001
  per search). Ongoing: pennies, because it's incremental.

## Data model

- `pr_outlets`: add `tier` (1/2/3, NULL = unset). Tier is a property of the
  **publication**; a contact inherits its outlet's tier (with optional override).
- `outreach_contacts`: already has `beats`. Add `topics` (JSONB, enriched
  interests), `enrichment_note` (one-line "what they cover"), `enrichment_conf`
  (0–1), `last_enriched_at`, `tier_override` (nullable), and reuse
  `availability_status` (`active`/`archived`/…) + `available_from` for archive.
- (Optional later) a `contact_embeddings` table if/when we add the topic map.

## Phases (the stacked PRs)

1. **Scope doc** (this).
2. **PR-page restructure** — Overview + 5 tabs (Overview · Coverage · Journalists ·
   Press releases · Reports); Monitor folds into Coverage, Thank-yous into
   Journalists. Buttons move **below the tab line, in-tab** (header is just
   "PR · client"). Pure front-end on existing data.
3. **Tiers** — `pr_outlets.tier` + inheritance; tier column in Journalists + a
   metric on Overview; set tiers in the Publications tab. Overnight seed proposes
   tiers from **content quality** (Claude reads a sample of the outlet's
   headlines/reputation) with **domain authority as a secondary prior**
   (`dataforseo.fetchDomainAuthority`); human-curated; static thereafter.
4. **Enrichment foundation** — overnight Haiku job: for each contact with
   coverage, derive `beats`/`topics` + a one-line note grounded in their story
   titles (extends `suggestBeats`); on-demand enrichment for the tail (fetch
   bylines). Confidence-flagged.
5. **Targeting chat** — "Who should I pitch this to?" in the **Journalists tab**.
   Paste a press-release URL (or topic); we fetch + extract the angle, select
   candidates by beats/topics/coverage overlap (+ tier, relationship strength,
   last-contacted, availability), and Claude returns a ranked shortlist with a
   reason per name. One query = one fetch + one Claude call over the shortlist.
6. **Archive / refresh** — overnight sweep of stale contacts (no coverage +
   "gone quiet"); a disambiguated Serper byline check (name + outlet/beat); clear
   "gone" → auto-archive (reversible `availability_status='archived'`), ambiguous
   → review queue. People move on; the list stays current.
7. **Engagement nudges** — monitor tier-1 + strong-relationship journalists'
   fresh bylines; surface "read this" and offer a Claude-drafted, **article-
   specific** warm note through the existing graduated-autonomy approval ramp
   (reuses the thank-you engine). Human-in-the-loop first; never templated.

## PR-page IA (phase 2 detail)

- **Overview** — at-a-glance: coverage secured (period + trend), pipeline
  (pitched/awaiting/confirmed), active relationships, tier mix; a "needs
  attention" strip (thank-yous waiting · monitor items to confirm · releases
  awaiting sign-off · key journalists gone quiet · report due), recent hits, and
  quick-action shortcuts that jump into the right tab.
- **Coverage** — editorial log + the monitor review queue. Actions in-tab.
- **Journalists** — relationship list (strength, hit-rate, tier, last contact,
  gone-quiet), profiles, the targeting chat, and thank-yous. Actions in-tab.
- **Press releases** — brief → draft → sign-off → pitch hand-off.
- **Reports** — client portal link + automated report cadence/alerts.

Convention: **no buttons above the tab line.** Each tab owns its actions.

## Build order / stacking
Each PR branches off the previous (`ci-1` → `ci-2` → … → `ci-7`); merge bottom-up.
Phases 3–7 each ship their overnight job behind the scheduler so nothing heavy
runs in a request.
