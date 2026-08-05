# Blog Autopilot — Build Plan

**A multi-site WordPress plugin that turns Claude into a per-client editorial team,
producing premium, SEO- and AI-optimised blog posts on a weekly cadence.**

> **Architecture note (updated):** Blog Autopilot ships as the **first module of the
> October Marketing Platform plugin** (`dev/october-mi-wp`), not a separate standalone
> plugin. The plugin is standalone-or-connected, modular, and uses Claude directly on the
> client site. See **`PLATFORM-PLUGIN-ARCHITECTURE.md`** for the authoritative architecture
> (module system, key/revocation model, OMI-side brief, security/speed posture). This
> document remains the reference for the **content pipeline and editorial method**; where
> it describes a standalone plugin scaffold, defer to the architecture doc.

Status: research complete; foundation built (v1.1.0). Content-pipeline increment next.

---

## 1. The core insight

The market is full of "autoblogging" plugins (AIomatic, GPT AI Power, AI Scribe).
They are cheap and they produce **generic content at scale** — which is exactly the
pattern Google's *Scaled Content Abuse* policy (March 2024) was written to punish, and
exactly what premium clients cannot be associated with.

Our differentiation is a hard line: **we do not ask the model to "write an article."**
We assemble researched, sourced, brand-voiced raw material, have Claude draft *within
tight constraints*, verify every hard claim, attribute the piece to a **real
accountable expert**, and gate it behind **human editorial review**. Claude is a fast
editorial assistant, not the publisher of record.

Premium quality comes from **four coupled systems**. Remove any one and the product
collapses back into generic autoblogging:

1. **Per-client knowledge + voice profile** — built by scraping the client's own site.
2. **Real-data research layer** — grounds topic selection and every factual claim in
   actual search/SERP/community data, not model guesses.
3. **Structure-for-extraction output** — chunked answer capsules, question headings,
   stats/quotes/citations, and valid Article + Author + FAQ schema, so both Google and
   AI answer-engines (AI Overviews, ChatGPT, Perplexity, Claude) pick it up and cite it.
4. **Verification + human-review gate** — fact-checking plus a named editor who can
   edit/reject before publish. This is simultaneously the accuracy backstop and the
   E-E-A-T signal.

---

## 2. We are not starting from zero

Two big head-starts already sit in this repo:

### 2a. The Hillcroft plugin is a proven scaffold
`dev/hillcroft-gardens/` is a mature October WordPress plugin whose plumbing is close
to drop-in reusable for this product:

| Hillcroft class | What we reuse it for |
|---|---|
| `class-hgd-claude.php` | Working Claude API client (auth, request, error handling) |
| `class-hgd-crypto.php` | Encrypts the API key **at rest** — essential across many client sites |
| `class-hgd-updater.php` | GitHub-release **self-updater**: push once, every client site pulls the update |
| `class-hgd-site-model.php` + `class-hgd-existing-extract.php` | **Already crawls a site and has Claude build a structured model of the business** — this is your "scrape the site to learn the company" feature, 80% built |
| `class-hgd-rate-limit.php` + `class-hgd-api-usage.php` | Per-site cost caps and usage tracking |
| `class-hgd-settings.php`, `class-hgd-log.php`, `class-hgd-activator.php` | Settings, logging, install lifecycle |
| `bin/build-zip.sh` + release GitHub Action | The tagged-release → zip → self-update pipeline (Hillcroft tags `hgd-v*`) |

We fork the scaffold, keep the plumbing, and replace the domain logic (garden design)
with the content engine.

### 2b. This repo already contains a premium content methodology as "skills"
The repo ships marketing skills that encode exactly the editorial thinking we need to
bake into prompts: `content-strategy`, `ai-seo`, `seo-audit`, `schema`, `copywriting`,
`copy-editing`, `programmatic-seo`, `customer-research`, `content-strategy`. These become
the **editorial brain** — we port their rubrics and checklists into the plugin's prompt
packs. No competitor plugin has this.

---

## 3. Prior art on GitHub — what to borrow (ranked)

Verified star counts as of 2026-08-05. Full notes in `docs/blog-autopilot/PRIOR-ART.md`.

**Tier 1 — closest to our exact build:**

1. **[TheCraigHewitt/seomachine](https://github.com/TheCraigHewitt/seomachine)** (~7.3k★) —
   **our #1 blueprint.** A Claude workspace that researches → writes → optimises →
   publishes long-form SEO content to WordPress. Steal:
   - Its **phase pipeline** (research → write → optimise → analyse/rewrite).
   - Its **10 specialised sub-agents** (Content Analyzer, SEO Optimizer, Meta Creator,
     Internal Linker, Keyword Mapper, Editor/"de-robotize", Headline Generator) → map to
     discrete Claude calls.
   - Its **`/context/` brand pack** (`brand-voice.md`, `writing-examples.md`,
     `style-guide.md`, `seo-guidelines.md`, `target-keywords.md`, `internal-links-map.md`)
     — this *is* our per-client context-pack pattern.
   - Its **SEO quality rubric** (word count, keyword placement, internal/external links,
     meta lengths, reading level, heading hierarchy) — adopt near-verbatim.
   - Its **WP REST publisher** with Yoast field exposure — reference for our write path.
2. **[ericosiu/ai-marketing-skills](https://github.com/ericosiu/ai-marketing-skills)** (~3.3k★) — Claude-native SKILL.md content/SEO skills; model for packaging "weekly blog post" as a self-contained skill.
3. **[gooseworks-ai/goose-skills](https://github.com/gooseworks-ai/goose-skills)** (~1.1k★) — pattern of pairing a content skill with a **live data API** (don't rely on the model alone).
4. **[rampstackco/claude-skills](https://github.com/rampstackco/claude-skills)** (~520★) — content + "audit/optimise existing content" skills for the **refresh** side of the cadence.

**Tier 2 — grounded research → outline → cited draft (the anti-slop engine):**

5. **[stanford-oval/storm](https://github.com/stanford-oval/storm)** (~30.8k★) — research-grade pre-writing pipeline: perspective-guided questions → retrieval → outline → section-by-section drafting **with citations**. Adopt its outline-first, cite-as-you-go structure.
6. **[assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher)** (~28.8k★) — planner→executor research agent; adaptable prompts for building content briefs and gathering source material. Has an MCP server we could wire in as a research tool.

**Tier 3 — Claude patterns & packaging:**

7. **[anthropics/claude-cookbooks](https://github.com/anthropics/claude-cookbooks)** (~51k★) — **sub-agent (Haiku-draft / Opus-polish)**, **prompt caching**, and **automated-eval** recipes — the economics of a high-volume, multi-site weekly cadence.
8. **[anthropics/claude-quickstarts](https://github.com/anthropics/claude-quickstarts)** (~17.4k★) — canonical tool-use loop / streaming / orchestration.
9. **[anthropics/skills](https://github.com/anthropics/skills)** (~166k★) — the SKILL.md spec if we package the writing logic as a portable Skill.
10. **Awesome indexes:** [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) (~72k★), [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) (~52k★), [serpapi/awesome-seo-tools](https://github.com/serpapi/awesome-seo-tools) for SERP/keyword APIs.

**Tier 4 — WordPress + AI integration layer (study the transport):**

11. **[WP-Autoplugin/wp-autoplugin](https://github.com/WP-Autoplugin/wp-autoplugin)** (~390★) — best-maintained OSS WP plugin that already integrates the **Claude API**; reference for multi-provider client + key storage. Same org's `hub2wp` shows a GitHub self-updater.
12. **[OpaceDigitalAgency/ai-scribe](https://github.com/OpaceDigitalAgency/ai-scribe-chat-gpt-content-creator)** (~51★) — closest feature-match (SEO posts + images inside WP); study its WP-field mapping. (It's the kind of "humanised autoblog" we're deliberately out-classing.)
13. **[grumpyp/blogging-with-ai](https://github.com/grumpyp/blogging-with-ai)** (~62★) — minimal Python → WP-REST publish loop, if we go headless-backend.

**Tier 5 — SEO mechanics (idea sources, low adoption):** `HasData/python-for-seo`
(keyword/SERP/intent snippets), `ALwrity/ALwrity` (end-to-end architecture),
`Juliusolsson05/openSEO` (**block-structured** generation — plan blocks, fill each —
worth copying for editable output).

---

## 4. The content-quality pipeline (the product)

Each weekly post moves through six stages. Stages 1–2 run periodically per client;
3–6 run per post.

### Stage 0 — Onboarding: build the client Context Pack (once, refreshed quarterly)
Crawl the client's own site (extending Hillcroft's site-model/existing-extract) and have
Claude distil a **structured, persistent profile** stored per site:

- **Positioning & messaging** — one-line value prop, category, differentiators.
- **Products/services** — names, features, use cases (for accurate references + CTAs).
- **ICP / audience** — roles, industries, pains (inferred from copy + case studies).
- **Brand voice** (see §6) — machine-readable behavioural rules, preferred/banned lexicon,
  sentence/reading-level targets, POV — plus **2–3 of the client's own best posts as
  few-shot exemplars**.
- **Internal-link map** — inventory of existing URLs + topics, so every new post links to
  relevant existing pages and future posts back-link automatically (a concrete SEO win
  human bloggers routinely skip).
- **Author roster** — real people who can be attributed (name, bio, credentials, photo,
  `sameAs` profiles) for E-E-A-T.

Tooling option: Firecrawl (has a branding/style-guide extraction call — colours,
typography) → clean markdown → Claude → structured JSON. Cache the pack and reuse it in
every call via **prompt caching** to control cost.

### Stage 1 — Strategy: pillars & clusters (once, then maintained)
Use the **pillar + cluster** model (topical authority). Seed from products + ICP, expand
with **real query data**, map to search intent, cluster around pillars, and lay out the
internal-link graph up front. Each week's post becomes one cluster node advancing a
defined pillar — this maps perfectly to a weekly engine and is what Google's topical-
authority signals reward.

> **Hard rule:** never let the LLM invent search volumes or PAA questions — it hallucinates
> them and will build clusters on fake numbers. Volumes and questions come from a data API.

### Stage 2 — Topic & brief generation (per post)
For the next scheduled slot, select the highest-value cluster node (intent × business
value × difficulty) and build a **content brief**: target query + real PAA/related
questions, intent, target word count benchmarked against the current SERP, required
sub-topics, internal links to include, external authority sources to cite, and the
originality asset the post must carry (a stat, a named example, an expert quote, or a POV).

### Stage 3 — Grounded draft (STORM/gpt-researcher pattern)
Outline-first, cite-as-you-go. Retrieve real sources, draft **section by section** against
the brief, and attach a source URL to every statistic/claim **at generation time**. Draft
economically (Haiku), reserving Opus for the polish pass. Structure for extraction from the
start (see §5).

### Stage 4 — Optimise & enforce (multi-pass, seomachine rubric)
Discrete passes, each a focused Claude call or lint step:
- **SEO pass** — keyword placement (H1 + first 100 words + 2–3 H2s), internal/external
  links, meta title (50–60 chars) + description (150–160), heading hierarchy.
- **AEO/GEO pass** — add a 50–60-word **answer capsule** under each question heading,
  convert prose to lists/tables where apt, ensure stats/quotes/citations are present.
- **Voice pass** — enforce brand profile; **lint out AI-tell phrases** ("industry-leading",
  "seamless", "in today's fast-paced world", "unlock", "elevate", "best-in-class").
- **De-robotise / editor pass** (Opus) — vary rhythm, tighten, add the human texture.
- **Schema pass** — generate Article/BlogPosting + Person (author) + FAQPage (validated
  against real PAA only) + HowTo where relevant.

### Stage 5 — Verify (fact-check gate)
Auto-classify statements by risk (stats, dates, names, quotes = high) and **verify high-risk
claims against their captured sources** before anything reaches a human. Run a
similarity/duplication scan against the client's existing posts (anti-cannibalisation) and a
readability/voice-match score. Frontier models still hallucinate ~15–20% of citation-style
facts (much higher on niche/recent topics) — this gate is non-negotiable for premium.

### Stage 6 — Human review & publish
The post lands as a **WordPress draft** in an editorial queue with its brief, sources, and
QA scores attached. A named editor approves/edits/rejects. On approval it publishes,
attributed to the real author, with schema, images, internal links, and `datePublished` /
`dateModified` set. **We never fully auto-publish for premium clients** (see §9 on the
"autopilot vs. review" tension).

---

## 5. Structure for both Google *and* AI answer-engines (AEO/GEO)

Evidence-backed tactics to encode into every post (Princeton/Georgia Tech GEO study +
2025 field data):

- **Statistics, quotes, and inline citations** are the three highest-leverage edits for AI
  citation — and the thing generic AI content lacks. Every post must carry real data with
  sources.
- **Chunked answer capsules** — self-contained 50–60-word blocks answering one question
  each, directly under a question-phrased heading (AI retrieval works on passages, not
  whole pages).
- **Question-based headings** with the **answer first** (BLUF / inverted pyramid).
- **Lists & tables** — ~25% of AI citations come from listicle-format content.
- **Semantic URLs** and clear entity definitions (disambiguate the brand for models).
- **Schema, highest value first:** `Article`/`BlogPosting` (author, datePublished,
  dateModified, publisher) → **`Person` author schema** with credentials + `sameAs` (the
  "chain of accountability" AI models use) → `FAQPage` (real PAA only) → `HowTo`.
- **`llms.txt`:** ship a minimal one as cheap insurance, but **don't over-invest** —
  adoption is ~10%, Google has said it won't support it, and studies show no measurable
  citation effect today. Put the effort into schema + chunking + on-page structure.

---

## 6. Brand voice, programmatically

A human guide ("our tone is confident") is useless to an LLM. Convert voice into a
machine-readable `BRAND_VOICE` profile per client:

- **Behavioural rules, not adjectives** — "Active voice. Lead with the verb. Claims backed
  by evidence, not adjectives."
- **Preferred lexicon** (product naming, on-brand terms) + **banned lexicon** (AI-tells).
- **Structural constraints** — sentence/paragraph length, reading level, POV, punctuation.
- **Contrastive definition** — "we sound like X, *not* Y" beats vague descriptors.
- **Few-shot exemplars** — the client's own best posts, mined in Stage 0.

Enforced in three layers: (1) injected into the generation system prompt, (2) a validation
pass that lints against the rules, (3) governance so per-post tone flexes but core voice
holds.

---

## 7. E-E-A-T & real-author attribution

Google does **not** penalise AI content per se — it penalises the *pattern* of low-value
content at scale. To stay firmly on the right side:

- **Every post is attributed to a real, accountable human** with a real bio, credentials,
  photo, and a persistent author page. AI cannot supply first-hand "Experience"; the human
  byline does. The plugin manages an **author roster** per client and writes `Person`
  author schema with `sameAs` links to real profiles.
- **Editorial process as a signal** — the mandatory human-review gate is itself the
  E-E-A-T signal Google rewards; sites with genuine human review were unharmed by the
  March-2024 update.
- **Trust infrastructure** — visible bios, an editorial/corrections policy, publish +
  "last updated" dates, sourced claims. The plugin ships helpers for these.
- **Originality quota** — each post must contain something a generic autoblogger can't:
  proprietary data, a named example, an expert quote (captured at intake), or an original
  framework. Enforced in the brief (Stage 2) and checked in QA (Stage 5).

---

## 8. Images

- AI images are acceptable to Google **if human-curated and quality-meeting**; the premium
  risk is genericness/uncanniness, not the technique.
- Prefer **Adobe Firefly** (licensed training data + commercial indemnification) to remove
  legal risk that matters to premium clients; use brand-palette style presets (palette
  extractable in Stage 0).
- **Unique images outrank stock** in Google Images and AI visual surfaces — always generate
  bespoke over reusing stock.
- **Alt text:** 80–140 chars, context-over-literal (why the image is on the page, matched to
  the post's query), keyword natural where honest. Tiered workflow: AI-draft alt text for
  all → human reviews hero/high-priority.
- Standard hygiene: descriptive filenames, WebP, explicit dimensions, lazy-load. (We already
  have `dev/webp-image-optimizer` in the repo to lean on.)

---

## 9. Architecture — the decisions that shape everything

Three strategic forks. My recommendations below; these are the things worth your call
before we build (see §12).

### 9a. Self-contained plugin vs. central backend + thin plugin — **recommend: hybrid**
- **Self-contained** (like Hillcroft): each client site holds the plugin and calls Claude
  directly. Simple to deploy; no infra to run. But prompt/skill updates ride the
  self-updater, editorial review is per-site, and every site needs a key.
- **Central backend + thin plugin:** a October-run service does research, generation, QA,
  and holds one editorial queue across all clients; the WP plugin just receives approved
  drafts and publishes. Best control, centralised prompt/skill iteration, cross-client
  editorial dashboard, cleanest cost control — but it's a SaaS to run and secure.
- **Recommended hybrid:** ship a **self-contained plugin** (fast to market, uses the
  Hillcroft scaffold + self-updater) that is **backend-ready** — the generation/QA logic
  sits behind an interface so we can move it server-side later without re-shipping to
  clients. Start where Hillcroft already is; graduate to central when the client count
  justifies it.

### 9b. API key & billing — **recommend: October holds one key, bills clients a retainer**
Centralised key = we control model choice, caching, and cost caps, and clients never touch
Anthropic. This fits a premium managed-service retainer better than "client brings their own
key." (BYO-key stays an option for enterprise clients who insist.) `class-hgd-crypto.php`
already encrypts keys at rest either way.

### 9c. "Autopilot" vs. review gate — **recommend: autopilot *to draft*, human *to publish***
The research is unambiguous: fully auto-publishing mass AI content is the exact behaviour
Google's scaled-content-abuse policy targets, and unreviewed output *will* ship factual
errors. Resolve the tension by making the **autopilot** the part clients love — topic
research, brief, draft, optimise, QA, image, schema, all hands-off on a schedule — and
keeping a fast **one-click editorial approval** as the last step. For premium brands that
is a feature, not friction. (A per-client "trusted auto-publish" toggle can exist, off by
default, for lower-stakes clients.)

---

## 10. Proposed plugin structure (forking the Hillcroft scaffold)

```
dev/blog-autopilot/
  blog-autopilot.php            # bootstrap, constants, requires
  readme.txt                    # WP.org-style manifest (stays with code)
  uninstall.php
  bin/build-zip.sh              # release zip builder (reuse Hillcroft's)
  includes/
    class-ba-claude.php         # Claude client            (from hgd-claude)
    class-ba-crypto.php         # key encryption            (from hgd-crypto)
    class-ba-updater.php        # GitHub self-updater       (from hgd-updater)
    class-ba-settings.php
    class-ba-log.php
    class-ba-rate-limit.php     # + api-usage cost caps
    class-ba-site-crawler.php   # site scrape (from hgd-site-model/existing-extract)
    class-ba-context-pack.php   # per-client profile store (positioning/ICP/voice/links/authors)
    class-ba-strategy.php       # pillars & clusters
    class-ba-keyword-api.php    # DataForSEO / SERP / PAA client
    class-ba-brief.php          # content brief builder
    class-ba-writer.php         # grounded draft (outline-first, cited)
    class-ba-optimizer.php      # SEO/AEO/voice/de-robotise passes
    class-ba-factcheck.php      # claim triage + verification
    class-ba-schema.php         # Article/Person/FAQ/HowTo JSON-LD
    class-ba-images.php         # Firefly/gen + alt text + webp
    class-ba-publisher.php      # WP draft/publish, author, meta, links
    class-ba-scheduler.php      # weekly WP-Cron pipeline
    class-ba-author.php         # author roster + Person schema
  admin/
    views/ (dashboard, editorial-queue, brief-review, context-pack, authors, settings)
  prompts/                      # versioned prompt packs (ported from repo skills)
docs/blog-autopilot/            # this plan, prior-art, prompt specs, client playbook
```

**Cost model:** Haiku for drafting + Opus for the polish/editor pass;
**prompt-cache the client Context Pack** so it isn't re-billed every call; per-site cost
caps via the rate-limit class; auto-eval recipe from the cookbook for self-QA.

---

## 11. Phased roadmap

- **Phase 0 — Foundation (fork & plumb).** Fork Hillcroft scaffold → `blog-autopilot`;
  Claude client, encrypted keys, settings, self-updater, release Action, logging, cost caps.
- **Phase 1 — Context Pack.** Site crawler + Claude distillation → stored per-client
  positioning/ICP/voice/internal-link-map/author roster, with a review UI. *(This is the
  "scrape the site to learn the company" feature — highest-signal to demo first.)*
- **Phase 2 — Strategy & briefs.** Keyword/SERP/PAA API integration; pillar/cluster map;
  brief builder.
- **Phase 3 — Generation & QA.** Grounded writer → optimise passes → fact-check gate →
  schema → images. Output lands as a WP draft with brief + sources + QA scores.
- **Phase 4 — Editorial queue & schedule.** Weekly WP-Cron; one-click approve/publish;
  author attribution; dashboard.
- **Phase 5 — Refresh & measure.** Auto-detect decaying posts and propose refreshes
  (rampstackco pattern); wire GA4/Search Console read for reporting.

MVP that demos the wow-factor = **Phase 1 + a single end-to-end post through Phase 3** on a
real client site.

---

## 12. Open decisions for October (need your call before Phase 0)

1. **Architecture** — confirm the **hybrid** (self-contained now, backend-ready) vs.
   going straight to a central backend.
2. **Billing/key model** — confirm **October-holds-key + retainer** vs. BYO-key.
3. **Publish policy** — confirm **auto-to-draft + human-approve** as the default.
4. **Keyword data provider** — DataForSEO is the recommended cost-effective raw-data
   layer; confirm budget/appetite for a paid API vs. starting with free
   autocomplete/PAA scraping.
5. **Product/brand name** — folder is `blog-autopilot`; the client-facing plugin name is
   TBD (white-label per client, or one October product brand?).

---

## 13. Risks & guardrails (summary)

- **Scaled-content-abuse penalty** → real authors, human review, originality quota,
  anti-cannibalisation scan, user-need-first topic selection.
- **Hallucinated facts** → grounding + claim-triage fact-check + human gate.
- **Generic "AI voice"** → machine-readable voice profile + AI-tell lint + few-shot
  exemplars + Opus de-robotise pass.
- **Cost blowout across many sites** → Haiku/Opus split, prompt caching, per-site caps.
- **Key leakage across client sites** → encrypted at rest; central-key option removes keys
  from client sites entirely.
- **Fake keyword data** → never LLM-generated; always from a data API.
