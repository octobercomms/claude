# LOLO Character Studio — Project Brief

> Working title. Codebase folder: `dev/lolo-design-image-plugin/` (named to match
> the branch). **Despite the "plugin" name, this is a standalone gated web app, not
> a WordPress plugin** — see [Architecture decision](#1-architecture-not-a-wordpress-plugin).

## 1. Summary

A password-gated web tool that lets the lolo.design team turn a **costume/character
sketch** into photoreal, brand-accurate images — and then place that character in any
number of scenarios. Its defining feature is a **circle-and-fix correction loop**: when
a detail is wrong, the user circles it, says (and optionally shows) what it should be,
and only that region is regenerated — so a good image never gets worse. Accurate
versions are **locked** and exported to **4K** on demand.

Every character, every reference, and every edit step is stored in a backend database
so the team can reopen any past character and keep refining it — including work
delivered for them — **without needing the developer**.

This replaces the current manual process (Figma Weave / Weavy flows + Gemini) with a
single bookmarkable page built around lolo's proven "recipe".

## 2. Goals & non-goals

**Goals**
- One bookmarkable URL, behind a login, that does the whole job end to end.
- Reproduce lolo's existing accuracy recipe as a repeatable, non-expert workflow.
- Make surgical corrections trivial, so accuracy is iterative rather than luck.
- Persist everything so any character is reopenable and revisable indefinitely.
- Deliver 4K finals ready for use.

**Non-goals (v1)**
- Not a public/self-serve SaaS — internal lolo team use only.
- Not a WordPress plugin (see §1 decision).
- Not a general image editor — scope is character generation + regional correction.
- No video, no animation, no print layout.

## 3. Confirmed decisions

These were agreed during scoping and are the spine of the build.

| Area | Decision |
|------|----------|
| **Hosting / platform** | Standalone gated web app (own subdomain, own DB, own login). Not a WordPress/Elementor/Jupiter X plugin. |
| **Auth** | Individual accounts per lolo user. |
| **Users** | Non-technical. UI must hide all AI/technical complexity. |
| **AI stack** | Multi-model (Nano Banana / Gemini for generation & scenarios; Flux Kontext for edits; a dedicated upscaler for 4K) **routed through a single aggregator** (e.g. fal.ai / Replicate) so it's **one API key / one signup / one bill**. |
| **Cost model** | **Pay-per-use, no subscriptions.** Real-money cost shown before every generation and export, plus a running total. Per-user/per-day caps as a backstop against runaway spend. |
| **New-character inputs** | Main sketch **plus** reference photos (close-ups), written notes & measurements, multiple sketch views, and colour/material swatches. |
| **Recipe / prompt** | Editable prompt per character (starts from lolo's default recipe). |
| **Generation output** | Configurable count (1–8) and orientation (portrait / landscape / square) per run. |
| **Scenarios** | Free-text scenario description each time. |
| **Correction input** | Circle the area + typed instruction, with an **optional** reference crop. |
| **Edit precision** | True inpainting — only the circled area changes; everything else stays pixel-identical (soft edge only where needed to avoid a seam). |
| **History** | Full step-by-step history per character; revertable and branchable. |
| **Library card** | Thumbnail + name, status badge, date + author, scenario/variant count. |
| **4K export** | Lock first, upscale on demand (4K only generated when Export is clicked). |
| **Visibility** | Whole team shares one library; author shown on each character; anyone can revise anyone's. |
| **Retention** | Keep everything until manually deleted. |
| **Waiting UX** | Inline live progress for single generations; queue-and-return for batches and 4K. |

## 4. The workflow (end to end)

```
Login gate
   │
   ▼
Library (all team characters)  ──►  [ + New Character ]
   │  click a card                        │
   ▼                                       ▼
Open character  ◄─────────────────  Create character
   │                                  (sketch + refs + notes
   │                                   + swatches + recipe)
   ▼
Studio / canvas
   ├─ Generate  (N variations, chosen orientation)  → pick best
   ├─ Scenario  (free-text scene)                    → new variant
   ├─ Correct   (circle → instruct → optional ref)   → inpaint region
   │     └─ repeat until accurate  (every step saved to history)
   ├─ Lock      (mark a version final)
   └─ Export    (upscale locked version → 4K download)
```

### Step 1 — Create a character
Inputs accepted: **main sketch** (required), **reference photos** (badge, collar,
stitching…), **written notes/measurements**, **multiple sketch views** (front/back/
detail), **colour/material swatches**. The character starts from lolo's **default
recipe prompt**, which the user can edit for this character.

### Step 2 — Generate
User sets **count (1–8)** and **orientation**, hits Generate, watches inline progress,
then picks the best variation to carry forward. Every variation is retained in history.

### Step 3 — Scenarios
User types a **free-text scene** ("kung-fu pose outside the temple, wide shot") to
place the locked/selected character there. Each scenario becomes its own variant with
its own correction history.

### Step 4 — Correct (the crown jewel)
On any image the user **circles/lassos** a region, types an instruction ("collar
underside should be red"), and optionally **drops a reference crop**. The tool builds a
mask and sends `base image + mask + instruction + optional reference` to the inpainting
model. **Only the masked region changes.** The result is a new step in history; the user
can revert or branch.

### Step 5 — Lock & export
When a version is accurate, the user **locks** it. Locking is cheap (no upscale).
When they want the deliverable, **Export** runs the upscaler to produce a **4K** file,
queued so they can leave the page. Batch export can 4K several locked scenarios at once.

### Step 6 — Reopen & revise later
Any character reopens from the library into the exact editable state — base images,
every reference, the full step history, locked versions. A missed detail can be fixed
months later with one more correction, re-locked, and re-exported. **No developer
involvement required.**

## 5. Data model (why "revise later" actually works)

The promise "come back and tweak a small part" only holds if we store **editable
state**, not flattened JPEGs. Core entities:

- **User** — individual login; author of characters/steps.
- **Character** — name, status (draft / in-progress / locked), author, timestamps,
  the **recipe prompt** text, and the input bundle (sketches, reference photos, notes,
  swatches).
- **Variant** — a scenario or take within a character (e.g. "temple wide", "park").
- **Step** — one node in the history tree: a generation or a correction. Stores the
  parent step (for branching), the image produced, and — for corrections — the **mask**,
  the **instruction**, and the **reference crop** used. This is what makes history
  revertable *and* branchable.
- **Export** — a locked step upscaled to 4K; stores the 4K asset + which step it came from.
- **Asset** — every image (inputs, generations, masks, references, 4K) in object storage.

Because each correction is stored as `(mask, instruction, reference)` against a parent
image, the tree is fully reconstructable and any point is re-editable.

## 6. Architecture

### 6.1 Not a WordPress plugin
lolo's site is on WordPress/Elementor/Jupiter X, but the tool's hard parts — a rich
interactive canvas, long-running async AI jobs, queues, retries, cost caps — are exactly
what PHP/WordPress handles badly. A standalone app avoids fighting the platform and
won't break when Jupiter X or Elementor updates. The team simply **bookmarks the URL**
and logs in.

### 6.2 Shape
- **Frontend** — a canvas-centric single-page app (React + a canvas layer for masking).
  Handles login, library, studio, circle/lasso masking, reference cropping, history tree.
- **Backend** — API service that:
  - holds all **API keys server-side** (never in the browser),
  - proxies to the generation, inpainting and upscaler providers,
  - runs a **job queue** for async generation / 4K,
  - enforces **usage caps** and logs spend,
  - persists the data model to the DB and images to object storage.
- **Database** — relational (users, characters, variants, steps, exports, usage).
- **Object storage** — images/assets (kept until deleted).

### 6.3 Model routing
| Task | Model role |
|------|-----------|
| Character generation & scenarios | Nano Banana / Gemini image (character consistency) |
| Circle-and-fix regional edits | Flux Kontext / inpainting (masked, surgical) |
| 4K export | Dedicated upscaler |

Providers are abstracted behind one interface so any can be swapped without touching the UI.

### 6.4 Fewest keys — single aggregator
lolo is **non-technical** and every provider account is another signup they have to do,
so we minimise keys. Rather than separate Google + Flux + upscaler accounts, route all
three model roles through **one aggregator platform** (e.g. **fal.ai** or **Replicate**)
that already hosts Nano Banana / Gemini, Flux Kontext and upscalers:

- **One signup, one API key, one bill** for lolo.
- **Pure pay-per-use** — no subscription.
- Published **per-call pricing** we can use to show real cost (see §6.5).

If a specific model we want isn't on the chosen aggregator, the provider-abstraction
layer (§6.3) lets us add exactly one more key later — but the target is **one**.

### 6.5 Cost transparency (like Weavy credits, but in real money)
lolo currently reads cost as credits per generation in Weavy. We translate that to
**actual currency** so a non-technical user always knows the spend before committing:

- **Before every action** (generate, scenario, correction, 4K export) show an estimate,
  e.g. *"Generate 4 portraits — ~£0.16"*, driven by the aggregator's per-call price ×
  count, with a small configurable markup if lolo wants to bill through.
- **Running total** per character and per user ("this character has cost £2.40 so far").
- **After each job**, record the actual cost against that step in history.
- Caps (§3) act as a silent backstop; the visible number is the primary control.

This makes cost a first-class, always-visible part of the UI rather than a surprise.

## 7. Flaw & risk register

Surfaced deliberately during scoping. Each has an owner decision or mitigation.

| # | Risk / flaw | Impact | Mitigation |
|---|-------------|--------|------------|
| R1 | **Character consistency drifts** across very different poses/scenes — no model guarantees an identical face/costume every time. | The core value (accuracy) wobbles at extremes. | The correction loop is the mitigation; keep a strong locked reference of the approved character and feed it into scenario generations. Set expectations: consistency is "very high + correctable", not "perfect first try". |
| R2 | **Editable prompt per character** (chosen for flexibility) lets a user weaken the accuracy recipe. | Someone edits the recipe and consistency degrades; hard to diagnose. | Keep lolo's **core accuracy rules as a locked, non-editable base**; expose only an *additional* editable section per character. "Reset to default recipe" button. (Recommend confirming this split.) |
| R3 | **Inpainting seams** — strict "only the circle changes" can leave a visible border. | Corrected images look patched. | Feather the mask edge slightly; allow the user to widen the selection and redo. Offer a one-click "blend edge" pass. |
| R4 | **Cost blow-out** — generation and especially 4K cost real money; configurable counts + batch export amplify it. | Surprise bills for a non-technical team. | **Real-money cost shown before every click** and as a running total (§6.5); pay-per-use only, no subscription; per-user/per-day caps as a silent backstop; 4K only on demand. |
| R5 | **Storage growth** — full branchable history + 4K per scenario, kept forever. | Object-storage cost climbs indefinitely. | Accepted for v1 (keep-until-deleted). Add per-character size display; revisit auto-archive of stale drafts if it becomes material. |
| R6 | **Async failure / partial charges** — a job can time out or fail after spending. | Wasted spend, confusing UX. | Transparent auto-retry; failed jobs don't count against caps; clear error state; queued jobs resumable. |
| R7 | **Free-text scenarios** can drift off-brand or produce inappropriate scenes. | Off-brand output, wasted spend. | Prepend brand/quality constraints to every scenario prompt; keep the recipe's negative constraints ("no branding", "no other characters") always applied. |
| R8 | **Sketch ambiguity** — a rough drawing underspecifies colour/material. | Model guesses wrong repeatedly. | Encourage reference photos + swatches + notes (all supported); these are fed as explicit conditioning, not just the sketch. |
| R9 | **Single shared library, anyone edits anyone's** — no per-user isolation. | Someone overwrites/derails another's character. | History is non-destructive + branchable, so nothing is truly lost; show author + last-editor; consider a soft "lock for editing" indicator. |
| R10 | **Auth / secret exposure** — it's a public URL holding valuable API keys. | Key theft, abuse, cost. | Keys strictly server-side; real session-based auth (not a shared secret in JS); rate limiting; standard security headers. Aligns with the repo's `october-security` posture. |
| R11 | **Provider/API change or outage** — models deprecate, prices change; a single aggregator concentrates that risk in one vendor. | Tool breaks or gets pricier; one point of failure. | Provider-abstraction layer (§6.3) so models — and the aggregator itself — are swappable with minimal work; monitor deprecations and price changes. |
| R12 | **Likeness/legal** — generated people. | Low (costumes/mascots, not real individuals) but worth noting. | Keep to costume/character design; avoid replicating identifiable real people. |
| R13 | **Non-technical users + editable prompt** — hand-editing the recipe (or free-text scenarios) can produce broken or off-brand results they can't diagnose. | Frustration, wasted spend, inconsistent output. | Reinforces R2 — hide the raw prompt; expose simple guided fields instead of freeform recipe text; keep brand constraints always-on; plain-language errors, never model/technical jargon. |

**Open recommendation:** R2/R13 — given the users are **non-technical**, I now more
strongly suggest **not** exposing a raw editable prompt. Instead: a **locked core
recipe** plus a few **simple guided fields/toggles** per character (e.g. colour notes,
"strict badge match", scene style). This keeps the flexibility you wanted without giving
a non-technical user a text box that can quietly break accuracy. Flagged for sign-off.

## 8. Suggested build phases

1. **Foundations** — app skeleton, auth (individual logins), DB + storage, provider
   abstraction, usage caps, library shell.
2. **Generator** — create character (all input types) → recipe → configurable
   generation → pick best. Inline progress.
3. **Scenarios** — free-text scene generation as variants.
4. **Correction loop** — canvas masking (circle/lasso), reference cropping, inpainting,
   history tree with revert/branch. *(Highest-value, highest-risk — prototype early.)*
5. **Lock & 4K** — locking, on-demand upscale, queue, batch export.
6. **Polish** — library cards (thumbnail/status/author/counts), spend dashboard,
   error/retry UX, security hardening.

## 9. Open items for sign-off

- [ ] R2/R13: confirm **locked recipe + simple guided fields** (vs a raw editable prompt).
- [ ] Confirm target subdomain (e.g. `tool.lolo.design` or a lolo-owned host).
- [ ] Choose the **aggregator** (fal.ai vs Replicate) and confirm it hosts the models we need — aim for a **single key**.
- [ ] Decide whether to add a **markup** on displayed costs (bill-through) or show raw cost.
- [ ] Set the initial **usage cap** values (per user / per day) and who tops up the account.
- [ ] Confirm the default **recipe prompt** text to seed from lolo's Weavy flow.

---

*Prepared as a scoping brief prior to build. Code will live in
`dev/lolo-design-image-plugin/`; this and future docs in `docs/lolo-design-image-plugin/`.*
