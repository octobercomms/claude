# OMI "Render" — Image Studio Module (Implementation Brief)

> **Status:** Ready for implementation by the main OMI session.
> **Working name:** **Render** (verb, Workspace-level page). This is the ONE
> thing still open — see [§2](#2-the-one-open-decision-the-name). Everything
> else in this brief is a settled decision from a detailed scoping conversation.
> If the name changes, it's a find-replace of "Render" → new verb.
>
> **Codebase:** `dev/platform` (OMI backend + frontend). **This is a new module
> inside OMI, not a standalone app and not a WordPress plugin.**
>
> **Docs home:** `docs/omi/` (this file), per the repo's two-folder rule.

---

## 0. How to read this brief (please read first)

This spec exists because the decisions below were reached through a long
back-and-forth, and we do **not** want them silently reinterpreted. Treat it as
authoritative:

- **"MUST" / "settled"** items are decisions, not suggestions. If one looks
  wrong, raise it — don't quietly build something else.
- **"VERIFY"** items are things I couldn't confirm from the codebase and the
  implementer must check before coding (e.g. exact fal.ai model slugs).
- **"OPEN"** items need a human decision and are listed in [§18](#18-open-decisions--sign-off).
- There is a **[§19 Do-NOT list](#19-do-not-interpretation-guardrails)** of specific
  misreadings to avoid. Read it.

If anything here conflicts with an assumption you'd otherwise make about OMI
conventions, **this brief loses** — follow OMI's existing patterns and flag the
conflict. The goal is a module that looks like it was always part of OMI.

---

## 1. What we're building, in one paragraph

A **generic image generation + surgical refinement studio** inside OMI, exposed
as a new Workspace page called **Render**. A user uploads a sketch / reference
image(s), picks a **preset** (a saved "recipe" for their vertical), and generates
photoreal images. When a detail is wrong, they **circle the exact area, say (and
optionally show) what it should be, and only that region is regenerated** — so an
image that's 90% right never gets worse. Correct → **lock** → export a faithful
**4K** version. Every project, reference, and edit step is stored per client and
fully reopenable, so anyone can revise a "finished" image later without the
developer. lolo.design's costume-character workflow is **the first preset**;
architects, interior/product designers etc. are additional presets on the **same
engine**.

---

## 2. The one open decision: the name

Page/tab actions in OMI are verbs (Create, Render, Brief, Approve, Launch…). The
working name is **Render** because the target verticals already use it
(architectural *render*, "render the character"). Alternatives considered:
**Visualise**, **Create** (already used as a Social sub-tab, so overloaded).
Note Paid has a "Render" *step* — different level, but a namesake. **Confirm the
final verb before build; it's used as the route segment, nav label, and table
prefix.** This brief uses `Render` / `render_*` throughout as placeholders.

---

## 3. Background & why this shape (context so intent is clear)

- lolo.design asked October to generate branded costume-character imagery. The
  current process is a **Figma Weave / Weavy** node graph + Gemini "Nano Banana":
  sketch + reference photos → a fixed "recipe" prompt (photoreal editorial, match
  colour/material exactly, no branding, full body, red collar underside, badge
  reads NAME…) → character → same character in scenarios (park, temple, kung-fu
  pose). Accuracy is the whole game.
- We are **replacing that manual graph with a product** — and generalising it,
  because the underlying loop (reference → generate → *fix the wrong bit* →
  perfect → deliver) is identical for architects, designers, and any visual pro.
- We chose to build it **inside OMI** rather than as a standalone app because OMI
  already provides — verified in the codebase — the expensive foundations:
  multi-tenancy, auth, per-client cost logging, image-gen connectors, a React
  design system, Postgres, and hosting. See [§16 reuse map](#16-what-is-reused-vs-net-new).

---

## 4. Settled product decisions

Every row here is a decision. Do not re-litigate; implement.

| # | Decision | Notes |
|---|----------|-------|
| D1 | **Module lives inside OMI** (`dev/platform`), as a new Workspace page. | Not a standalone app; not a WP plugin. |
| D2 | **Generic engine + presets.** Entities are vertical-neutral: **Project, Variant, Step, Export, Preset.** | "Character" is lolo's *preset*, not a core noun. |
| D3 | **Auth/tenancy reuse OMI's** clients + users + `clientAccess`. lolo is an existing client. | See [§6](#6-users-roles--access--read-this-carefully) for the read-only gotcha. |
| D4 | **fal.ai is the primary media aggregator**, one key, to consolidate accounts. | Retires Ideogram + the Flux/Replicate image path; possibly ElevenLabs. See [§12](#12-falai-integration--key-consolidation). |
| D5 | **Multi-model best-of, all via fal:** generate/scenario, masked inpaint for edits, faithful upscaler for 4K. | Specific slugs in [§11](#11-ai-model-routing). |
| D6 | **Pay-per-use, no subscriptions. Real-money cost shown before every action** and as a running total. | Reuse `api_cost_events`; see [§13](#13-cost-transparency--credits). |
| D7 | **Inputs:** main sketch + reference photos (close-ups) + written notes/measurements + multiple sketch views + colour/material swatches. | All optional except one primary image. |
| D8 | **Recipe = locked core + simple guided fields**, NOT a raw editable prompt. | Users are non-technical; see [§10](#10-presets--recipes). Supersedes an earlier "editable prompt" idea. |
| D9 | **Generation:** configurable count (1–8) and orientation (portrait/landscape/square) per run. | |
| D10 | **Scenarios:** free-text scene description per generation. | Brand/quality constraints always auto-prepended. |
| D11 | **Correction input:** circle/lasso the region + typed instruction + **optional** reference crop. | |
| D12 | **Edit precision: true masked inpainting** — only the circled area changes; rest stays pixel-identical (soft edge only to avoid a seam). | The core promise. |
| D13 | **History:** full step tree per project — **revertable and branchable**. | Every generation and every fix is a Step. |
| D14 | **Lock, then 4K on demand** (upscale only when Export is clicked). | 4K is the costliest step. |
| D15 | **Library:** all of a client's projects; card shows thumbnail + name, status badge, date + author, variant/scenario count. | |
| D16 | **Whole team (agency + that client) shares the client's project library**; author shown; anyone may revise anyone's. | |
| D17 | **Retention:** keep everything until manually deleted. | |
| D18 | **Waiting UX:** inline live progress for single generations; queue-and-return for batches and 4K. | |
| D19 | **Image storage follows OMI's existing pattern**: files on local disk per client, served through an authed route; metadata rows in Postgres. | NOT S3/R2 — match `brandAssets`. See [§15](#15-backend-design). |

---

## 5. Where it lives in OMI (IA & routing)

- **New Workspace-level page**, sibling to Data/Paid/Earned/Shared/Owned in the
  `Layout.jsx` client sub-nav. Route: **`/clients/:id/render`**.
- Page component: `pages/ClientRenderPage.jsx` (mirrors `ClientBrandPage.jsx`
  etc.), registered in `App.jsx`, linked in `Layout.jsx` under the `clientId`
  sub-nav block.
- Internally the page has two primary views (via `?tab=` like the rest of OMI):
  - `?tab=library` (default) — the project grid.
  - `?tab=studio&project=<id>` — the canvas/studio for one project.
- **Why a Workspace page and not a tab under Brand/Paid:** it's channel-agnostic
  and flagship, with its own library + studio. Brand is an admin/config tab; Paid
  is channel-specific. (If the OMI session strongly prefers a tab under an
  existing page, that's an [OPEN](#18-open-decisions--sign-off) call — but default to a page.)

---

## 6. Users, roles & access — READ THIS CAREFULLY

**Gotcha that will otherwise break the module:** OMI's **client role is
read-only**. In `Layout.jsx`, `readOnly = user?.role === 'client'`, and there's a
site-wide "Read-only view… nothing on your account can be changed" banner
(migration `115_client_role.sql`). **lolo log in as a client, so with today's
rules they physically cannot create or edit anything in Render.**

Requirement: **Render MUST allow the client role to perform Render actions**
(create projects, generate, correct, lock, export) even though clients remain
read-only everywhere else in OMI. Recommended approach:

- Introduce a per-module **capability** (e.g. a `can_use_render` flag on the user
  or client, or a small capabilities set) that grants write access **scoped to
  Render only**. Do **not** make clients globally writable.
- The read-only banner and `readOnly` guards elsewhere stay as-is; Render checks
  its own capability instead of `role !== 'client'`.

Access scoping otherwise reuses `clientAccess.js` exactly: every Render route is
`authenticate` → `loadVisibleClientIds` → `requireClientAccess`. A user only ever
sees/edits projects for clients in their `visibleClientIds`. lolo (one client)
sees only their own workspace, which is the desired "locked down" behaviour.
Agency/admin users see all clients as normal. This is [OPEN D-A1](#18-open-decisions--sign-off).

---

## 7. Core concepts & glossary (precise — do not rename in code without noting)

- **Project** — one subject being developed (lolo: a character; architect: a
  building). Holds inputs, the chosen preset, guided-field values, and the step
  tree. (User-facing label can be per-preset, e.g. "Character" for lolo, but the
  table/entity is `render_projects`.)
- **Input** — an uploaded reference belonging to a Project: `sketch`,
  `reference_photo`, `note` (text), `swatch`, or `sketch_view`.
- **Preset** — a saved recipe: locked core prompt + guided fields + defaults +
  model routing. Vertical-specific. lolo's costume recipe is preset #1.
- **Variant** — a branch of the Project representing one scenario/context (e.g.
  "temple wide", "park"). A Project has ≥1 Variant. Each Variant has its own step
  sub-tree.
- **Step** — one node in a Variant's history: either a **generation** or a
  **correction**. Immutable once created. Stores the produced image and, for
  corrections, the **mask + instruction + optional reference crop**. Steps form a
  tree (a Step has a `parent_step_id`) → this is what makes history revertable
  **and** branchable (D13).
- **Lock** — marking a specific Step as the approved image for a Variant. Cheap;
  no upscale.
- **Export** — a locked Step run through the upscaler → a 4K asset. Records which
  Step it came from and the cost.

---

## 8. End-to-end workflow (the happy path, in detail)

1. **Library** (`/clients/:id/render?tab=library`) — grid of the client's
   Projects (D15). `+ New` starts a Project.
2. **Create Project** — name it; pick a **Preset**; upload inputs (D7: sketch +
   any of reference photos, notes/measurements, multiple sketch views, swatches);
   fill the preset's **guided fields** (D8). No raw prompt box.
3. **Generate** (D9) — choose count (1–8) + orientation; hit Generate. Inline
   live progress (D18). Model = preset's generate model ([§11](#11-ai-model-routing)).
   Cost shown before the click and logged after (D6). All variations retained as
   sibling Steps; user picks one to carry forward (sets it as the active Step).
4. **Scenario** (D10) — type a free-text scene → creates a new **Variant** seeded
   from the chosen character/base, generating it in that scene. Brand/quality
   constraints from the preset are auto-prepended (never shown as editable).
5. **Correct — the loop** (D11, D12) — on the active image, circle/lasso a region,
   type the instruction, optionally drop a reference crop → masked inpaint → a new
   child **Step** whose image differs *only inside the mask*. Repeat. Revert to any
   prior Step or branch a new direction (D13). Full detail in [§9](#9-the-correction-loop-the-crown-jewel).
6. **Lock** (D14) — mark the accurate Step as the Variant's approved image.
7. **Export 4K** (D14) — upscale the locked Step on demand; queued, leave-and-return
   (D18). Batch export can 4K several locked Variants at once. Faithful upscaler
   only ([§11](#11-ai-model-routing)).
8. **Reopen later** — any Project reopens into full editable state (inputs, preset,
   entire step tree, locks, exports). A missed detail can be corrected months
   later, re-locked, re-exported — no developer needed (D17).

---

## 9. The correction loop (the crown jewel — build this precisely)

This is the differentiator; most of the frontend effort is here.

**UI (studio canvas):**
- Render the active Step's image on an HTML canvas.
- User draws a **circle or freehand lasso** → rasterise to a **binary mask PNG**
  (white = change, black = keep), same dimensions as the image.
- User types a short **instruction** ("collar underside should be red").
- User may attach an **optional reference crop** (drag an image, or crop from an
  existing input/reference).
- Show a cost estimate; on confirm, submit the edit job.

**Backend (inpaint):**
- Send `{ base_image, mask, instruction, optional reference_image }` to the
  preset's **inpaint model** (masked inpainting — [§11](#11-ai-model-routing)).
- **D12 precision requirement:** only masked pixels may change; everything outside
  the mask must stay pixel-identical. If the chosen model can't guarantee this,
  composite: run the edit, then paste the result back **only inside the mask**
  (with a small feather to avoid a hard seam) over the original. This composite
  step is REQUIRED unless the model natively guarantees region-locking.
- Persist the result as a new **Step** with `parent_step_id = active step`, storing
  the mask, instruction, and reference used. Log cost.

**History semantics:**
- Steps are immutable and form a tree. "Revert" = set the active pointer to an
  earlier Step. "Branch" = create a new Step from a non-leaf Step. Nothing is ever
  destroyed (D13, D17), so a bad edit is always recoverable.

---

## 10. Presets & recipes

A **Preset** is how one engine serves many verticals (D2). Contents:

- `locked_core_prompt` — the non-editable accuracy/brand rules (lolo's: photoreal
  editorial, match colour/material exactly, full body, no branding, red collar
  underside, badge legibility, negative constraints, etc.). **Never shown as an
  editable text box** (D8).
- `guided_fields` — a small schema of simple inputs the non-technical user *does*
  fill (e.g. dropdowns/toggles/short text: "strict badge match", primary colours,
  scene style). These are merged into the final prompt server-side.
- `input_slots` — which Input kinds this preset expects and their labels (lolo:
  "Costume sketch", "Badge close-up"…; architect: "Elevation", "Site photo"…).
- `model_routing` — which fal models to use for generate / scenario / inpaint /
  upscale for this preset (defaults in [§11](#11-ai-model-routing)).
- `scope` — shared (all clients) or client-specific.

**Preset #1 — lolo "Costume Character"**: encodes the exact Weavy recipe. The
final prompt text should be captured verbatim from lolo's current flow — see
[OPEN D-A2](#18-open-decisions--sign-off) (we need the exact wording).

**Further presets** (later): "Architectural Render", "Product/Interior Render".
Same engine; only preset content differs. Presets are data, so adding a vertical
is configuration, not code.

---

## 11. AI model routing

All via **fal.ai** (one key). **VERIFY every slug against fal.ai's current
catalogue before coding — do not hardcode a guessed slug.** Representative choices:

| Job | Model (representative) | Requirement |
|-----|------------------------|-------------|
| Generate + scenario (character consistency, badge/text fidelity) | Google **Nano Banana** (Gemini image) on fal; **challenger: Seedream 4** | Best reference-guided consistency + text. Support a reference image + preset prompt. |
| **Circle-and-fix inpaint** | **Flux Fill / Flux inpainting** on fal | Mask-based; region-locked (D12). Kontext-style instruct-edit as a secondary path when no mask is drawn. |
| **4K upscale** | A **faithful** upscaler (e.g. clarity-upscaler at **low creativity**, or a crisp/ESRGAN-type) | MUST sharpen without inventing detail. ⚠️ Do **not** use high-creativity "magnific"-style upscalers — they hallucinate and corrupt the locked image. |

Notes:
- Nano Banana **re-renders** at higher resolution rather than upscaling — so it is
  NOT an acceptable substitute for the faithful-upscaler step on a *locked* image
  (it would discard the correction work). This was explicitly decided.
- Model choice per job is stored on the **Preset** (`model_routing`) so verticals
  can differ and we can swap models without touching the UI.
- Recommend a quick bake-off (Nano Banana vs Seedream; Flux Fill vs Kontext) on a
  real lolo character before locking defaults.

---

## 12. fal.ai integration & key consolidation

**New connector:** `connectors/fal.js`, shaped like the existing
`connectors/replicate.js` (key via `getSetting('FAL_KEY')`, async submit-then-poll,
returns output URL(s), calls `costLog.recordApiCost({ provider: 'fal', feature,
costUsd, clientId, meta })`). Expose `generate`, `inpaint`, `upscale` (and keep it
generic enough to call any fal model by slug).

**Key/account consolidation (D4)** — fal hosts equivalents of several current
standalone accounts, so we can reduce the number of API signups:

| Current OMI connector | fal replacement? | Action |
|---|---|---|
| `ideogram.js` (image) | Yes — Ideogram models on fal | Migrate image gen to fal; retire Ideogram account. **VERIFY** parity for any text-in-image use. |
| `replicate.js` image path (Flux 1.1 Pro) | Yes — Flux family on fal | Route Render + existing image gen via fal. |
| `replicate.js` video (Seedance/Wan) | Partial — some video models on fal | **VERIFY**; migrate only if parity. Otherwise leave on Replicate. |
| `elevenlabs.js` (voice) | Maybe — TTS models on fal | **VERIFY** voice quality/parity before retiring. Out of scope for Render itself. |
| `adobe.js` (Firefly/PS) | No | Keep. |
| Non-media (Shopify, Meta, GA4, DataForSEO…) | No | Keep — unrelated. |

**Do not rip out working connectors blind.** Add `fal.js`, point Render at it, and
migrate the image path first; retire an account only after verifying parity. Store
`FAL_KEY` in Settings (server-side), like every other OMI key — **clients never
supply keys** (this is a core benefit of the platform model).

---

## 13. Cost transparency & credits

- **Reuse `services/costLog.js` → `api_cost_events`** (`provider, feature,
  cost_usd, client_id, meta`). Every Render generation/inpaint/upscale logs a row
  with `feature` like `render_generate` / `render_inpaint` / `render_upscale` and
  the `client_id`.
- **Show real money before every action** and a running total per Project and per
  client (D6) — translate fal's per-call price × count into currency, like Weavy's
  credits but in £/$. A small config markup is allowed if billing through.
- **Per-user/per-day caps** as a silent backstop against runaway spend.
- **Credits/monthly billing (reseller model) is a later extension, not v1:** the
  *cost* ledger exists; a **credit balance + markup + top-up** layer sits on top of
  `api_cost_events` when we onboard client #2. Keep manual top-ups until then.
  Design the schema so this layer can be added without migration pain, but do not
  build Stripe now. [OPEN D-A3](#18-open-decisions--sign-off).

---

## 14. Data model (new tables — match OMI conventions)

Postgres, snake_case, `client_id` FK everywhere, `created_at timestamptz default
now()`, `jsonb` for flexible metadata, ids consistent with existing tables
(**VERIFY** whether OMI uses serial or uuid ids — `brand_assets` is the reference;
follow the prevailing convention). New migration file, next number after the
current max (currently ~`115`, so e.g. `116_render_studio.sql` — **VERIFY** the
latest number at build time).

```
render_presets
  id, scope ('shared'|'client'), client_id (nullable for shared),
  name, locked_core_prompt (text), guided_fields (jsonb schema),
  input_slots (jsonb), model_routing (jsonb), created_by, created_at

render_projects
  id, client_id, preset_id, name, status ('draft'|'in_progress'|'locked'),
  guided_values (jsonb), created_by, created_at, updated_at

render_inputs
  id, project_id, kind ('sketch'|'reference_photo'|'note'|'swatch'|'sketch_view'),
  url (nullable for note), text (nullable), metadata (jsonb), created_at

render_variants
  id, project_id, name (scenario label), scene_prompt (text, free-text scenario),
  active_step_id (nullable), created_by, created_at

render_steps
  id, variant_id, parent_step_id (nullable),
  kind ('generation'|'correction'),
  image_url,
  -- correction-only:
  mask_url (nullable), instruction (nullable), reference_crop_url (nullable),
  -- generation-only:
  gen_params (jsonb: count index, orientation, model, seed),
  cost_usd, created_by, created_at

render_exports
  id, variant_id, step_id, image_url_4k, cost_usd, created_by, created_at
```

Storage (D19): image/mask/reference files on **local disk per client**, mirroring
`brandAssets` (`uploads/<client_id>/…`), served via an **authed route** with the
same path-traversal + `nosniff` protections. Rows above store the served URL.

---

## 15. Backend design

- **Routes:** `routes/render.js`, mounted like other client routes; every handler
  `authenticate` → `loadVisibleClientIds` → `requireClientAccess` (+ the Render
  capability check from [§6](#6-users-roles--access--read-this-carefully)).
  Endpoints (indicative): CRUD for projects/inputs/variants; `POST
  .../generate`, `POST .../variants` (scenario), `POST .../steps/inpaint`, `POST
  .../lock`, `POST .../export`, plus preset read.
- **Services:** `services/render.js` (orchestration), calling `connectors/fal.js`.
  Reuse `costLog`. Reuse the brandAssets-style file storage helper (extract a
  shared util if cleaner).
- **Async jobs (D18):** single generations can use fal's inline-wait like the
  Replicate connector does (`Prefer: wait`), with poll fallback. Batches and 4K
  exports should run as background jobs the user can leave — reuse OMI's existing
  worker/queue pattern (see `routes/videoWorker.js` / `node-cron` usage) rather
  than inventing a new one. **VERIFY** the existing async pattern and match it.
- **Security:** keys server-side only; file serving mirrors brandAssets' hardening
  (path-traversal blocks, `X-Content-Type-Options: nosniff`, SVG sanitisation if
  SVG inputs allowed); enforce per-user/day caps; rate-limit generation endpoints
  (`express-rate-limit` is already a dependency).

---

## 16. What is reused vs net-new

**Reused from OMI (already verified in the codebase — do not rebuild):**
- Multi-tenancy & access: `middleware/clientAccess.js`, `services/users`.
- Auth: JWT + bcrypt, `routes/auth.js`, `context/AuthContext.jsx`.
- Cost logging: `services/costLog.js` → `api_cost_events`.
- Aggregator pattern & async shape: `connectors/replicate.js` (fal.js mirrors it).
- File storage pattern: `routes/brandAssets.js` (local disk per client + authed serve).
- Frontend shell & design system: `Layout.jsx`, `components/ui/*`, panels/pages
  conventions, `?tab=` routing, `ClientSwitcher`.
- DB + migrations pipeline; PM2 deploy; existing hosting (**it just runs where OMI
  runs — no new host, no `image.octobercomms.com`**).

**Net-new (the actual build):**
1. `connectors/fal.js` + key consolidation ([§12](#12-falai-integration--key-consolidation)).
2. Migration `1NN_render_studio.sql` (the [§14](#14-data-model-new-tables--match-omi-conventions) tables) + preset seed for lolo.
3. `routes/render.js` + `services/render.js`.
4. `pages/ClientRenderPage.jsx` + studio canvas components (library grid, create
   flow, **the circle-and-fix canvas**, history tree, lock/export).
5. Nav wiring in `App.jsx` + `Layout.jsx`.
6. The Render **capability** for client-role write access ([§6](#6-users-roles--access--read-this-carefully)).

---

## 17. Build phases (suggested sequence)

1. **Foundations:** `fal.js` connector (+ Settings key), migration & tables, lolo
   preset seed, Render capability, empty page + nav.
2. **Generate:** create Project (inputs + guided fields) → configurable generation
   → pick best. Inline progress + cost display.
3. **Scenarios:** free-text Variant generation.
4. **Correction loop:** the masking canvas + inpaint + branchable step tree.
   *(Highest value/risk — prototype early.)*
5. **Lock & 4K:** lock, on-demand faithful upscale, queue, batch export.
6. **Polish:** library cards, spend view, error/retry UX, caps, security pass
   (reuse `october-security` posture).

---

## 18. Open decisions / sign-off

- **D-A0 — Name:** confirm the verb (**Render** proposed). Threads through route,
  nav, tables.
- **D-A1 — Client write access:** approve the "Render capability grants write to
  clients, scoped to Render only" approach (vs some other gating).
- **D-A2 — lolo recipe text:** obtain the **exact** locked-core prompt wording from
  lolo's current Weavy flow to seed preset #1 faithfully.
- **D-A3 — Credits/billing:** confirm v1 = cost logging + manual top-ups only;
  Stripe/credit-marketplace deferred to client #2.
- **D-A4 — fal migration extent:** confirm which accounts to actually retire
  (Ideogram yes; Replicate video + ElevenLabs pending parity checks).
- **D-A5 — Placement:** confirm Workspace **page** (default) vs a tab under an
  existing page.

---

## 19. Do-NOT (interpretation guardrails)

- **Do NOT** build a standalone app / subdomain / WordPress plugin. It's an OMI
  module. Hosting is wherever OMI already runs.
- **Do NOT** name core entities after "character." The engine is generic;
  character is lolo's **preset**.
- **Do NOT** expose a raw editable prompt to users. Locked core + guided fields
  only (D8).
- **Do NOT** let corrections change anything outside the circled mask. Composite
  back if the model won't guarantee it (D12).
- **Do NOT** use Nano Banana's "4K re-render" as the export path for a locked
  image, and **do NOT** use a high-creativity upscaler — both alter approved
  detail (D14, [§11](#11-ai-model-routing)).
- **Do NOT** assume clients are read-only and therefore can't use Render — that's
  the [§6](#6-users-roles--access--read-this-carefully) gotcha; grant the scoped Render capability.
- **Do NOT** put images in S3/R2 or a new store — follow OMI's local-disk-per-client
  pattern (D19) unless the OMI session deliberately standardises storage elsewhere.
- **Do NOT** hardcode fal model slugs without verifying them against fal's current
  catalogue.
- **Do NOT** rip out the Ideogram/Replicate/ElevenLabs connectors before verifying
  fal parity; add `fal.js`, migrate, then retire.
- **Do NOT** build Stripe/credits now; just log real cost and show it (D6, [§13](#13-cost-transparency--credits)).

---

*Prepared by the scoping session for hand-off to the main OMI session. Questions
or conflicts with OMI conventions → resolve in favour of OMI's patterns and flag
back.*
