# External Integrations Plan — Camofox + claude-ads rubric

Decision record + build spec for integrating external projects into the
**October Marketing Intelligence** platform (nvelope.co). Reviewed five
candidates; three are worth the work. This doc covers **what** we integrate,
**where** it lives, and **how** it's sliced into mergeable PRs.

- Date: 2026-06-09
- Branch: `claude/inspiring-noether-09vc5l`
- Status: **spec — awaiting sign-off before build**

---

## Candidates reviewed

| Project | Verdict | Reason |
|---|---|---|
| [jo-inc/camofox-browser](https://github.com/jo-inc/camofox-browser) | ✅ **Integrate** (sidecar service) | Beats the WAF/JS challenges that break our existing `axios + cheerio` scrapers |
| [AgriciDaniel/claude-ads](https://github.com/AgriciDaniel/claude-ads) | ✅ **Integrate** (mine the MIT rubric) | 250+ weighted PPC checks map onto the Strategist's existing Meta+Google scorecard |
| [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | ✅ **Integrate** (mine the MIT methodologies) | 55 marketing skill methodologies map onto the platform's 17 Claude-backed services' system prompts |
| [cloudflare/agentic-inbox](https://github.com/cloudflare/agentic-inbox) | ❌ Skip | Cloudflare-Workers-only stack; can't run in our Node/Express/PM2 box. Useful only as design reference for an outreach auto-draft feature |
| [librechat](https://www.librechat.ai/) | ❌ Skip | A standalone product, not a component; overlaps existing client-chat at high maintenance cost |

The two skipped projects are documented here only so the decision isn't
re-litigated later.

---

## Integration 1 — Camofox stealth browser (shared scraping fallback)

### The problem it solves

Two services scrape with raw `axios + cheerio` and have no answer to bot
challenges:

- `dev/platform/backend/src/services/siteAudit.js` — crawls the client's own
  domain. Today a Cloudflare/Sucuri challenge comes back as a `401`/`403` with
  an HTML interstitial, and `classifyPageIssues()` files it as
  `fetch_failed` / `broken_link` — a false negative that pollutes the audit
  score.
- `dev/platform/backend/src/services/competitorPages.js` — scrapes competitor
  landing pages (sites we don't control). Same challenge problem, plus
  JS-rendered SPAs return an empty shell to `axios` so the diff sees nothing.

(Note: the **client's own WooCommerce** WAF problem is *not* solved here — that
is solved correctly by the `october-mi-wp` plugin reversing data direction.
Camofox is for pages we don't control: competitor pages, SERPs, landing pages,
AI-visibility checks.)

### What Camofox is

A stealth headless browser (Camoufox/Firefox, C++-level fingerprint spoofing)
exposed over a REST API. Beats Cloudflare/bot detection, returns rendered HTML
and token-efficient accessibility snapshots, ~40 MB idle with lazy
launch/shutdown, session isolation, optional proxy/GeoIP. Docker-deployable.

### Where it lives

**Infra — sibling PM2 process on the platform box.**
The platform is **PM2-on-a-VPS, not Docker** (`deploy.sh` / `update.sh` / PM2
`ecosystem.config.js`; the public Shopify app already runs as a sibling PM2
process). Camofox is a Node server, so it runs the same way — no Docker
required:
- Clone `jo-inc/camofox-browser` to `/opt/camofox-browser`, `npm install`,
  start under PM2 (`pm2 start … --name camofox`) bound to `127.0.0.1:3100`
  (internal only — never exposed publicly; nginx does not proxy it).
- Started with a bearer token; the same value goes in Settings as
  `CAMOFOX_API_KEY`, and `CAMOFOX_URL=http://127.0.0.1:3100`.
- `update.sh` gets a guarded block mirroring the Shopify app's: if
  `/opt/camofox-browser` exists, `git pull` + `npm install` + `pm2 reload
  camofox`. Absent dir → skipped, so the script stays safe on a box without it.
- (Docker remains an option via the upstream image, but PM2 matches the
  existing box and keeps one process manager.)

**Code — one thin client + one fallback wrapper.**
- `dev/platform/backend/src/services/camofox.js` — REST client **(built,
  slice 1)**. Exposes `isConfigured()`, `health()` (`GET /health`), tab
  helpers (`openTab`/`closeTab`), and `fetchSnapshot(url)` which opens a tab,
  navigates, returns the token-efficient accessibility snapshot, and always
  closes the tab. Reads `CAMOFOX_URL` + `CAMOFOX_API_KEY` via the existing
  `getSetting()` pattern. Degrades cleanly (no throw) when unconfigured.
  - **Open question for slice 2:** camofox-browser's documented content
    endpoint returns the a11y *snapshot*, not raw DOM HTML. `siteAudit`'s
    cheerio checks (meta tags, alt text, H1s) need real HTML; competitor
    diffing and AI-visibility can likely work off snapshot text. Slice 2 must
    confirm against a running instance whether a raw-HTML path exists (and add
    it to the client) or whether the snapshot suffices per scraper.
- `dev/platform/backend/src/utils/fetchHtml.js` — **the integration seam**.
  `fetchRenderedHtml(url, opts) → { html, status, via: 'axios' | 'camofox' }`:
  1. Try plain `axios` first (cheap, fast — unchanged behaviour for the ~90% of
     pages that aren't protected).
  2. **Detect a challenge / empty-shell response**: status `401/403` with an
     HTML body, or body matching known challenge markers (`Just a moment`,
     `Security Verification`, `cf-challenge`, `__cf`, Sucuri `sucuri_cloudproxy`,
     `Checking your browser`), or a near-empty `<body>` on a known-JS host.
  3. On detection, retry through `camofox.render()` and return that HTML.
  4. Always return which path served the response so callers can record it.

**Config — settings allowlist.**
- Add `CAMOFOX_URL`, `CAMOFOX_API_KEY` to `SETTINGS_KEYS` in
  `dev/platform/backend/src/routes/settings.js` (same mechanism as
  `APIFY_API_TOKEN` etc.). `loadSettingsFromDb()` already copies these into
  `process.env` on boot — no boot change needed.

### How the scrapers change

- **`competitorPages.js` `scrapePage()`** — swap the bare `axios.get` for
  `fetchRenderedHtml(url)`. **Keep the `assertPublicHttpUrl(url)` SSRF guard
  exactly as-is**, and run it *before* handing the URL to Camofox too. The
  `maxRedirects: 0` behaviour is preserved on the axios path; Camofox follows
  redirects itself (acceptable — these are public competitor pages).
- **`siteAudit.js` `fetchPage()`** — route through `fetchRenderedHtml`. Add a
  new issue category **`waf_blocked`** (severity `medium`) for the case where
  *even Camofox* can't get through, so a genuinely-protected page is visible as
  its own finding instead of being mis-filed as a broken link. The existing
  `responseMs` timing still comes from the axios attempt.

Apify (`apify.js`) stays as-is — it handles IG/TikTok social scraping, a
different job Camofox doesn't replace.

### Why a fallback, not a wholesale replacement

`axios` is faster and cheaper for the overwhelming majority of pages. Camofox is
the heavy hammer reserved for the minority that need it, and because it lazy
-launches it costs ~nothing when idle. This also means the change is low-risk:
if Camofox is down or unconfigured, `fetchRenderedHtml` degrades to exactly
today's behaviour.

### Health check

Add Camofox to the existing PM2 connector health check via `camofox.health()`
(`GET /health` on the sidecar) so an outage surfaces alongside the other
connector statuses rather than silently degrading scrapes.

### PR slices (each independently mergeable)

1. ✅ **Sidecar + client + config** (**done**) — `camofox.js` client
   (`isConfigured`/`health`/tab helpers/`fetchSnapshot`), `CAMOFOX_URL` +
   `CAMOFOX_API_KEY` in `SETTINGS_KEYS`, health ping folded into the daily
   connector health-check cron, PM2 run/deploy note above. No scraper touches
   yet; proven via the health ping. (The PM2 process itself is stood up on the
   box per the deploy note — an ops step, not a repo change.)
2. **`fetchRenderedHtml` wrapper** (~2 days) — the detection logic, unit-tested
   against saved challenge-page fixtures (Cloudflare "Just a moment", Sucuri,
   empty SPA shell). Pure function, no external calls in tests.
3. **Wire competitorPages + siteAudit** (~2 days) — route both scrapers through
   the wrapper, add the `waf_blocked` issue category, preserve the SSRF guard.

---

## Integration 2 — claude-ads audit rubric (into the Strategist)

### What we take and what we don't

claude-ads is a Claude Code *skill* (Python + Playwright, MIT). We do **not**
run its code — it's agent-orchestration that duplicates platforms we already
have live API connectors for. We lift the **MIT-licensed knowledge**: the
audit checks, their category weights, and the benchmarks. That's the durable,
valuable part, and it applies cleanly to the campaign data the Strategist
already pulls.

(Per decision: in-platform rubric only. We are **not** installing claude-ads as
a standalone Claude Code skill in this round.)

### Where it lives

**The rubric (data + attribution):**
- `docs/nvelope/ad-audit-rubric.md` — human-readable rubric: categories,
  checks, weights, benchmarks, with an MIT attribution header crediting
  AgriciDaniel/claude-ads.
- `dev/platform/backend/src/data/adAuditRubric.json` — machine-readable form
  the scorer consumes: `[{ category, weight, checks: [{ id, label, evaluate,
  benchmark }] }]`.

**The scorer:**
- `dev/platform/backend/src/services/adAudit.js` — `scoreSnapshot(snapshot) →
  { score, categories: [{ category, status, score, findings: [{ check, status,
  evidence }] }] }`. Takes the **same `current` snapshot object
  `strategistReport.js` already builds** (per-campaign Meta + Google rows +
  totals) and runs the deterministic checks where the data supports them, e.g.:
  - zero-conversion campaigns still spending (budget drain)
  - ROAS / CPA below a defensible retail benchmark
  - CTR below benchmark, CPM/frequency above threshold (creative fatigue)
  - spend concentration / no budget diversification
  - missing conversion signal (purchases = 0 across all campaigns with spend)

  Each check is deterministic and cites the number it fired on — no Claude call
  in the scorer itself.

### How the Strategist changes

In `dev/platform/backend/src/services/strategistReport.js`:
- After building `current`, call `adAudit.scoreSnapshot(current)`.
- Pass the structured result into `buildPrompt()`. The existing **"Summary
  Scorecard"** section (item 6 of the output shape) becomes grounded in the
  rubric: each row's Status comes from the scored findings rather than being
  free-form, and the Executive Summary gets a real **0–100 ad-health score**.
- Persist the structured audit alongside the report (reuse `data_snapshot`, or
  a dedicated column) so the score is queryable/trendable over time, not just
  prose.

The narrative stays Claude-written (`claude-sonnet-4-6`, unchanged); the rubric
gives it a deterministic skeleton so two runs on the same data produce a
consistent score and the AM can trust the scorecard.

### PR slices

1. ✅ **Rubric data + scorer** (**done**) — `docs/nvelope/ad-audit-rubric.md`,
   `src/data/adAuditRubric.json` (categories, weights, benchmarks + MIT
   attribution), `src/services/adAudit.js` with a pure `scoreSnapshot()`.
   Verified against good / drain / thin / empty fixtures (93 strong, 33 weak,
   86 low-confidence, null respectively). Self-contained, no Strategist
   changes.
2. **Wire into the Strategist** (~2 days) — call the scorer, feed it into the
   prompt, persist + surface the score. Keeps the existing thin-data
   short-circuit and recommendation-parsing intact.

---

## Integration 3 — marketingskills methodology library (into the Claude services)

### What we take and what we don't

[coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills)
is a set of **55 markdown marketing skills** (MIT) written for Claude
Code / Cursor / Codex — methodologies and best-practice frameworks for
copywriting, CRO, SEO, ads, cold email, competitor analysis, pricing, etc.

Same pattern as claude-ads: we do **not** install 55 Claude Code skills. The
platform already makes Claude calls from **17 services** with hand-written
system prompts. These skills are exactly the expert methodology those prompts
should be grounded in. We lift the **MIT methodology** of the subset that maps
to a live service and inject it as a reusable prompt fragment.

(Consistent with the claude-ads decision: in-platform only. Installing the raw
skills as team-usable Claude Code skills is noted as out of scope below.)

### Where it lives

- `dev/platform/backend/src/data/marketingPlaybooks/*.md` — curated methodology
  fragments lifted (with MIT attribution to coreyhaines31/marketingskills) from
  the relevant skills, one file per domain (`copywriting.md`, `cro.md`,
  `seo-audit.md`, `cold-email.md`, …). These are prompt *context*, trimmed to
  what's useful in a system prompt — not verbatim copies.
- `dev/platform/backend/src/services/playbooks.js` — a tiny cached loader:
  `getPlaybook(name) → string`. Read once, memoised. No DB, no Claude call.

Each Claude-backed service appends its relevant playbook to its existing system
prompt. Nothing else about those services changes — same model
(`claude-sonnet-4-6`), same output contract.

### Service → skill mapping (first batch)

| Platform service | marketingskills source | Effect |
|---|---|---|
| `contentDraft.js`, `socialCaptions.js` | `copywriting`, `copy-editing`, `content-strategy` | Drafts follow proven copy structure, not generic prose |
| `strategistReport.js` | `ads`, `ad-creative`, `analytics`, `ab-testing` | Strategist recommendations grounded in PPC methodology (pairs with the claude-ads rubric in Integration 2) |
| `siteAudit.js` (recommendations), `ctrBoost.js` | `cro`, `popups`, `signup` | CRO findings framed against real conversion frameworks |
| `seoFanout.js`, `contentAudit.js`, `programmaticBriefs.js`, `urlGap.js`, `aiVisibility.js` | `seo-audit`, `ai-seo`, `programmatic-seo`, `schema`, `site-architecture` | SEO outputs follow current best practice incl. AI-search |
| `outreachAi.js`, `backlinkProspect.js` | `cold-email`, `prospecting`, `emails` | Outreach copy + sequencing follow cold-email methodology |
| `brandVoice.js` | `product-marketing`, `marketing-psychology` | Voice analysis anchored to positioning frameworks |

Start with the **first two rows** (content + strategist) as the proof slice —
highest volume, easiest to eyeball quality lift — then extend.

### Why mine, not install

The skills are static markdown methodology; installing them as Claude Code
skills would only help a human operator in an editor, not the platform's
automated pipeline that actually generates client deliverables. Injecting the
methodology into the existing prompts improves every automated run for every
client, which is where the leverage is.

### PR slices

1. ✅ **Playbook library + loader** (**done**) — `src/services/playbooks.js`
   (`getPlaybook`/`getPlaybooks`/`list`, cached, path-traversal-guarded,
   returns `''` for missing so it's always safe to append) + first-batch
   fragments in `src/data/marketingPlaybooks/` (copywriting, content-strategy,
   ads, cro, cold-email, seo-audit), each distilled from the MIT skills with
   attribution + a README. No service changes. (The full skills are already
   committed at `.claude/skills/` for editor use; these are the trimmed runtime
   fragments.)
2. **Wire content + strategist** (~1 day) — inject playbooks into
   `contentDraft.js` / `socialCaptions.js` / `strategistReport.js`. Eyeball
   before/after on a real client.
3. **Wire remaining services** (~2 days) — CRO, SEO, outreach, brand voice rows.

---

## Suggested build order

1. **Camofox slice 1** (sidecar + client) — stands up infra, lowest risk,
   unblocks the rest.
2. **claude-ads slice 1** (rubric + scorer) — pure logic, parallelisable, no
   infra dependency.
3. **marketingskills slice 1** (playbook library + loader) — pure data + a
   loader, also parallelisable.
4. **Camofox slices 2–3** (wrapper + wire scrapers) — retires the
   false-negative WAF findings.
5. **claude-ads slice 2** (wire Strategist) — ships the scored scorecard.
6. **marketingskills slices 2–3** (wire services) — content + strategist first,
   then CRO/SEO/outreach/brand voice.

Total ~16 working days across 8 PRs, each independently mergeable against
`main`. Integrations 2 and 3 reinforce each other in the Strategist: the
claude-ads rubric supplies the *score*, the marketingskills playbook supplies
the *methodology* behind the recommendations.

## Explicitly out of scope (this round)

- claude-ads as a standalone Claude Code skill (in-platform rubric only).
- marketingskills installed as raw Claude Code skills for the team (in-platform
  methodology mining only) — and the ~30 of the 55 skills with no matching live
  service (e.g. `pricing`, `referrals`, `revops`, `co-marketing`,
  `directory-submissions`) are deferred until a service exists to use them.
- Pointing Camofox at the client's own WooCommerce — the WP plugin owns that.
- An outreach auto-draft feature inspired by agentic-inbox (noted as a future
  idea only).
- Camofox proxy/GeoIP rotation — default single egress until a blocked-by-geo
  case actually appears.
