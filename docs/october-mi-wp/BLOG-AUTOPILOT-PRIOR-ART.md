# Blog Autopilot — Prior Art (GitHub repos & frameworks)

Research snapshot 2026-08-05. Star counts approximate, verified via GitHub API.
Ranked by usefulness to our build: Claude API → premium SEO/AEO weekly posts → WordPress.
See `BUILD-PLAN.md` for how each feeds the design.

## Tier 1 — directly reusable, closest to our use case

| Repo | ★ | Why it matters / what to steal |
|---|---|---|
| [TheCraigHewitt/seomachine](https://github.com/TheCraigHewitt/seomachine) | ~7.3k | **Primary blueprint.** Claude workspace: research→write→optimise→publish to WP. Steal its phase pipeline, 10 sub-agents (Content Analyzer, SEO Optimizer, Meta Creator, Internal Linker, Keyword Mapper, Editor/de-robotize, Headline Gen), `/context/` brand pack, SEO quality rubric, and WP-REST+Yoast publisher. Python scoring modules: `seo_quality_rater.py`, `readability_scorer.py`, `keyword_analyzer.py`, `content_length_comparator.py`. |
| [ericosiu/ai-marketing-skills](https://github.com/ericosiu/ai-marketing-skills) | ~3.3k | Claude-native SKILL.md content/SEO skills. Model for packaging "weekly blog post" as a self-contained skill with instructions + rubric. |
| [gooseworks-ai/goose-skills](https://github.com/gooseworks-ai/goose-skills) | ~1.1k | Growth/GTM skills paired with **live data APIs** — the pattern of grounding a content skill in real keyword/SERP data, not the model alone. |
| [rampstackco/claude-skills](https://github.com/rampstackco/claude-skills) | ~520 | Full website-lifecycle skills incl. content + SEO + **audit/optimise existing content** — for the refresh side of a weekly cadence. |

## Tier 2 — grounded research → outline → cited draft (the anti-slop engine)

| Repo | ★ | Why it matters |
|---|---|---|
| [stanford-oval/storm](https://github.com/stanford-oval/storm) | ~30.8k | Research-grade pre-writing: perspective-guided questions → retrieval → outline → section drafting **with citations**. Adopt outline-first, cite-as-you-go. `STORMWikiRunner` is a clean staged-generation template. |
| [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher) | ~28.8k | Planner→executor research agent, parallel scraping, cited reports. Adapt `gpt_researcher/prompts.py` for brief-building + source gathering. Has an **MCP server** to wire in as a research tool. |

## Tier 3 — Claude-specific patterns, packaging, discovery

| Repo | ★ | Why it matters |
|---|---|---|
| [anthropics/claude-cookbooks](https://github.com/anthropics/claude-cookbooks) | ~51k | **Sub-agent (Haiku-draft/Opus-polish)**, **prompt caching**, **automated-evals** — the economics + self-QA for a high-volume multi-site cadence. |
| [anthropics/claude-quickstarts](https://github.com/anthropics/claude-quickstarts) | ~17.4k | Canonical tool-use loop, streaming, orchestration, error handling. |
| [anthropics/skills](https://github.com/anthropics/skills) | ~166k | SKILL.md spec + template if we package writing logic as a portable Skill. |
| [langgptai/awesome-claude-prompts](https://github.com/langgptai/awesome-claude-prompts) | ~5.4k | Writing/editing/persona prompt patterns; Claude XML-tag conventions. |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | ~72k | Largest index of published Claude Skills — search for content/SEO/writing skills to fork. |
| [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) | ~52k | Commands, skills, workflows, tooling. |
| [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) | ~24k | 100+ subagent definitions — patterns for a writer/editor/SEO split. |
| [serpapi/awesome-seo-tools](https://github.com/serpapi/awesome-seo-tools) | ~1k | Best-maintained SEO-tools index (SERP/keyword APIs to integrate). |

## Tier 4 — WordPress + AI integration layer (study the transport)

| Repo | ★ | Why it matters |
|---|---|---|
| [WP-Autoplugin/wp-autoplugin](https://github.com/WP-Autoplugin/wp-autoplugin) | ~390 | Best-maintained OSS WP plugin that already integrates the **Claude API**. Reference for multi-provider client + wp-admin key storage. Same org's `hub2wp` = GitHub self-updater pattern. |
| [OpaceDigitalAgency/ai-scribe](https://github.com/OpaceDigitalAgency/ai-scribe-chat-gpt-content-creator) | ~51 | Closest feature-match (SEO posts + images in WP). Study WP-field/meta mapping. Represents the "humanised autoblog" tier we out-class. |
| [grumpyp/blogging-with-ai](https://github.com/grumpyp/blogging-with-ai) | ~62 | Minimal Python → WP-REST publish loop; reference for a headless/scheduled backend. |
| [wujiit/wp-ai-chat](https://github.com/wujiit/wp-ai-chat) | ~137 | Maintained multi-model config + key management in WP (secondary ref). |

## Tier 5 — SEO pipeline mechanics (idea sources, low adoption)

| Repo | ★ | Idea to borrow |
|---|---|---|
| [HasData/python-for-seo](https://github.com/HasData/python-for-seo) | ~2 | Snippets: keyword research, SERP analysis, content-gap, intent classification. |
| [ALwrity/ALwrity](https://github.com/ALwrity/ALwrity) | ~1.1k | End-to-end AI-marketing architecture (content strategy + AI-SEO + publishing) to skim. |
| [gregorym/agent-writer](https://github.com/gregorym/agent-writer) | ~9 | TS SEO agent with **scheduling** + publishing — relevant to weekly cadence. |
| [Juliusolsson05/openSEO](https://github.com/Juliusolsson05/openSEO) | ~3 | **Block-structured** generation (plan blocks, fill each) instead of one markdown blob — cleaner, editable output. |

## Data / API layer (not repos — integration targets)

- **DataForSEO** — most complete programmatic stack: Google Autocomplete, People-Also-Ask +
  organic SERP, Related Keywords, Keyword Data (volume/CPC/competition/**intent**, batch
  ~700 kw/req), plus an AI-search-volume metric. Recommended raw-data layer.
- **Firecrawl** — LLM-oriented crawl/extract incl. a **branding/style-guide** call
  (colours, typography) for Stage 0 Context Pack.
- Alternatives: SerpApi, Semrush/Ahrefs APIs, Keywords Everywhere, ScrapingBee/Browse.ai.

## Five takeaways

1. **seomachine** is the primary blueprint — clone its command/agent/context structure + SEO rubric.
2. **STORM + gpt-researcher** provide the grounded research→outline→cited-draft engine that beats generic AI.
3. **wp-autoplugin** is the reference for Claude-API-inside-WordPress.
4. The **per-client "context pack"** (voice + examples + keyword map + internal-link map + authors) is the single most important scalability pattern — build the plugin around it, cached per call.
5. Adopt Anthropic's **SKILL.md packaging** + the cookbook's **Haiku-draft/Opus-polish + prompt-caching + auto-eval** for an economical, self-QA'd multi-site weekly cadence.
