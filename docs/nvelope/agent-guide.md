# nvelope — agent guide

The handover between sessions for nvelope.co and the funnel plugin that is
meant to replace most of it. Written 23 November 2026, at the point where the
work was paused.

Read this before touching nvelope, `dev/nvelope-theme`, `dev/oc-forms` or the
plugin distribution in `dev/platform/backend/src/routes/integrations.js`.

Leave it truer than you found it: correct whatever your change made wrong, and
record only what the next session would otherwise learn the hard way.

---

## 1. What nvelope is, and why it exists in that shape

A lead-generation site holding a hidden landing page and an advice hub per
client. Traffic arrives from paid ads; the homepage deliberately says nothing.
WordPress, JupiterX, Crocoblock/JetEngine, and October Forms.

The neutral domain is a deliberate positioning decision, not an accident. A
prospect clicking an architect's ad should not land on something that looks
like an agency, or work out that their architect has a marketing funnel. That
only works while nvelope.co stays anonymous, so **do not brand it, and do not
move the public surface anywhere branded.**

Its own strategy docs are alongside this file: `ADS-STRATEGY.md`,
`BUDGET-PLAN.md`, `CAMPAIGN-ARCHITECTURE.md`, `CREATIVE-BRIEF.md`,
`TRACKING-SETUP.md`. Treat `TRACKING-SETUP.md` as intent rather than fact; see
section 4.

There were **no active clients as of 23 November 2026**, which is why several
findings below are recorded as debts rather than incidents.

---

## 2. The decision, which is settled

Not a merge of nvelope and OMI. A control plane and a render plane.

| | Where | What |
|---|---|---|
| Render plane | nvelope.co, or the client's own site | Serves the landing page and advice hub |
| Control plane | OMI | Configures a client, launches a site, generates PDFs, monitors ads, runs the loop |

And a direction split that matters more than it sounds:

- **Code** goes one way, git to site, by deployment. Two authoritative copies of
  the same code with no merge tool is what causes drift, so syncing it both
  ways makes the problem worse, not better.
- **Data** goes both ways, through a connector. Studios, meta, PDFs, hub
  assets, form config.

### The long-term shape

The funnel becomes **a plugin installed on the client's own website**. On their
domain the anonymity problem disappears entirely: the prospect sees the
architect, which is more credible than a neutral domain, not less.

nvelope.co then becomes what it is actually good for: a fast deploy for clients
with no site yet, or not on WordPress, so a project is not held up for months
of web design.

### What the plugin must not depend on

Decided after arguing it out, and worth not relitigating:

- **No Elementor, no JetEngine, no particular theme.** The plugin renders its
  own HTML from its own PHP templates, with scoped CSS and its own reset inside
  its own wrapper.
- Reasons: Elementor templates are rows in the database, so shipping them
  recreates the drift problem one level down and you cannot diff them. And
  "runs on any theme" would in practice mean "needs Elementor Pro and a
  JetEngine licence on every client site", which is not a one-click install. The
  CPT single-template binding nvelope.co relies on comes from JupiterX's Layout
  Builder, not from Elementor free.
- **Elementor stays, as the design tool.** Lay a layout out on nvelope.co, then
  implement it as plugin templates. It is not the runtime.
- Layout is fixed. Colours, fonts and logo are the variables, as CSS custom
  properties. On a client's own site most of that inherits from their site
  anyway, so the branding fields become optional overrides rather than
  requirements.

### Gated files

Serve them **through OMI**, with expiring signed URLs, never from the client's
uploads folder. `mediaStore` already has disk and R2 drivers behind one
interface and signed URLs. On twenty client sites, twenty public uploads
folders is twenty leaks; one signed endpoint is one implementation.

### PDFs

Generated on demand from `brand_assets`, one source document per guide, branded
at request time. Not 136 pre-branded files named `{n}-{CODE}-{title}.pdf` where
the prefix is the only thing deciding which client gets which file.

---

## 3. What shipped (23 November 2026)

| PR | What |
|---|---|
| [#2107](https://github.com/octobercomms/claude/pull/2107) | October Forms: endings route by answer, conversions gated per ending, outcome stored and exposed on the API |
| [#2108](https://github.com/octobercomms/claude/pull/2108) | Merge gate requires every app's own checks |
| [#2109](https://github.com/octobercomms/claude/pull/2109) | Merge gate gated on its own guard |
| [#2111](https://github.com/octobercomms/claude/pull/2111) | Platform can distribute more than one WordPress plugin |

### #2107 in detail, because it is the foundation

The `endings` map had existed in the schema since 1.0 and was unreachable:
`OCF_Schema::sanitize()` rebuilt it from the `default` key alone, so a second
ending was deleted on save, and all five reads in the REST API were hardcoded to
`['default']`. A seven-step form asked about budget and timing and thanked
everyone identically.

Now: `OCF_Endings` sanitises the whole map in order and selects by rules through
`OCF_Logic`, the same evaluator as step visibility, running on answers
`filter_visible()` has already pruned. First match wins, order is behaviour,
`default` is the fallback and is never matched by rule.

Each ending carries a tracking name and an `is_conversion` flag. Completion
fires `sbm_{outcome}` always, and the platforms' standard `Lead` event **only**
where that flag is set. Ticking every ending puts spend back on volume while
the reporting says results improved.

The outcome is stored on the submission (`outcome`, `is_conversion` columns,
DB version 1.2.0) and exposed on the read-only API, so lead quality is readable
from outside WordPress.

Guards: `dev/oc-forms/tests/endings.test.php` (18) and
`tests/tracking.test.js` (9), run by `.github/workflows/oc-forms-checks.yml`.

---

## 4. What was found, that changes decisions

### The advice hub gate is not a gate

Worse than the audit reported, and with a different cause.

`assets/js/script.js` reads each asset's file URL out of the card's own DOM:

```js
var file = textFrom(card, '.js-asset-file') || textFrom(card, '.nvelope-asset-file') || …
```

`textFrom` returns `textContent`. And `style.css` hides those elements with
`display: none !important`. So **every PDF URL is in the HTML of every card, on
every hub page, before any email is given**, concealed only by CSS. No
sessionStorage to forge, nothing to guess. The `sessionStorage` flag set by
`?u=1` only chooses which `<div>` is displayed.

The audit blamed `data-asset-gated="{{hub_assets_fees_gated}}"` rendering as
literal text. That attribute appears **zero times** in `script.js`. The gate is
read from a CSS class:

```js
function gateFromWrapper(wrapper) {
  if (wrapper.classList.contains('nvelope-asset-free')) return 'free';
  return 'gated';
}
```

Nothing sets `.nvelope-asset-free`, which is why no card is ever free. The
gated value is emitted into the card twice (`data-asset-gated` and a
`.nvelope-asset-gated` element) and read from neither.

Do not patch this in the theme. Build it server-side in the plugin.

### A live Brevo key was published

`assets/remind-form.js` line 1 held a live Brevo v3 key, and `functions.php`
enqueues that file on **every** page load, not only where the shortcode
appears. It was readable with view-source and used client-side against
`/v3/contacts` and `/v3/smtp/email`.

Revoked 23 November 2026. The value is not in this repo; the committed copy
carries a placeholder and a comment.

Proportion: it was the Brevo account nvelope uses, which is separate from the
accounts behind October's other products, and nvelope had no active clients.
So the exposure was nvelope's own lead lists.

The replacement posts to WordPress with the key in `wp_options`, where
`oc-forms` already keeps its own (`ocf_brevo_api_key`, `ocf_brevo_event_key`).

### The conversion signal was almost nothing

Everything keyed off `?step=`, producing `sbm_{step}`. The only event with
evidence of firing was `sbm_landing`. No form-submit event reached any ad
platform; a completed form sent `lead_form_completed` to Brevo only.

Tags fire only when a studio resolves **and** its pixel field is populated. One
client had a Google Ads ID, one had a Meta pixel, the rest had neither. No GA4
measurement ID anywhere, so GA4 was not collecting on client pages.

#2107 fixes the event. **The pixel fields are still empty for five of seven
studios**, so there is nowhere for those events to land until somebody fills
them in.

### Qualification was collected and discarded

The form asks budget (step 5) and timing (step 4). It had one ending. The
`studio` post type carries `qualified_*`, `not_ready_*` and `out_of_scope_*`
copy fields, empty on every studio sampled. The method existed in the data
model and in the positioning, and not in the running system. #2107 makes the
routing possible; the endings still have to be configured per form.

### The content model

`studio` CPT, 7 published, with **91 meta fields** in standard `postmeta`. A
paired `learn` CPT with no meta at all, matched to its studio by slug, rendered
entirely by the Advice Hub Single template.

About 25 fields actually drive what renders. Roughly 30 are empty on every
studio sampled, with the visible copy coming from the template:
every `panel_*`, `about_text_*`, `how_we_work_*`, `project_*_heading`,
`project_*_text`, `call_to_action_*`, and the three outcome tabs. **Confirm
before deleting** — they may be optional overrides on template defaults.

Media fields store an attachment ID as a string, except `studio_intro_video`,
which stores a URL. `studio_organisations_logos` stores `"true"`/`"false"`
strings, not booleans. The Studio post type has **Delete metadata** switched on,
so removing a field definition destroys its stored data.

### Still unknown

Where the `hub_assets_*` repeater data lives. Four JetEngine listings declare a
repeater source; there is no repeater meta field, meta box, CCT or saved query
anywhere, and nothing in the theme reads it. The cards render real titles, so
it exists somewhere. It only matters for migrating the existing 136 PDFs: the
plugin will store its own assets.

---

## 5. The plan

| | Work | Blocked on |
|---|---|---|
| 1 | ~~Endings route by answer; conversions gated per ending~~ | Done, #2107 |
| 2 | ~~Platform distributes more than one plugin~~ | Done, #2111 |
| 3 | Plugin skeleton: post type, meta, settings, OMI pairing, brand CSS layer | Nothing. Start here |
| 4 | Own templates for landing page and advice hub, scoped CSS | 3 |
| 5 | Server-side gate: submit, OMI issues a signed expiring URL | 3, and OMI endpoint work |
| 6 | Install the plugin on nvelope.co; cut the child theme back to CSS | 4, 5 |
| 7 | On-demand branded PDFs from `brand_assets`, served signed | 5 |
| 8 | Two-way data connector, replacing today's read-only pull | 3 |
| 9 | Per-site health reporting into OMI | 3, 8 |
| 10 | Ad optimisation loop actuating on Meta | Meta App Review, plus real conversion data from 1 |

Step 3's brand CSS layer is mostly a port: `nvelope_studio_typography_head()`
in `dev/nvelope-theme/functions.php` already reads the studio's colours and
fonts and writes CSS. That becomes the custom-properties layer nearly as-is.

### Cutover, for step 6

The plugin must take over in the same change that the theme stops doing it.
Both active means double-fired pixels and inflated conversions; neither means a
window with no tracking. Ship the plugin with a guard that refuses to fire if
it detects the theme's `nvelope_output_studio_tracking_tags` still hooked, so
the overlap fails safe rather than silently doubling the numbers.

---

## 6. Open, and needing Daniel rather than a decision here

- **Keep `sbm_{step}` or start clean.** Existing Google Ads conversion actions
  and Meta custom conversions are built on those names. Keeping them is free;
  dropping them means rebuilding conversion actions.
- **Migrate the 136 PDFs, or leave them and have the plugin serve new ones.**
  Deciding this is what makes `hub_assets_*` worth finding, or not.
- **Fill the pixel fields** for the five studios that have none.
- **Tick which endings count as conversions**, per form, now the builder allows
  it.
- **Meta App Review** for `ads_management`. The long pole for step 10, and
  calendar time rather than work. `meta.js` currently requests `ads_read` and
  `read_insights` only.
- **Check `site:nvelope.co` in Google** for indexed `/wp-content/uploads/`
  PDFs. If they are indexed the gate is irrelevant until step 5 lands. Could
  not be checked from the session: the search tool ignores the `site:` operator
  and nvelope.co is not on the environment's host allowlist.

---

## 7. Traps that cost time, so they do not cost it again

**A guard that reads its expectations from the code under test.** Three
separate instances in one session:

- A scorer test iterated `EXCLUDE_TOP_DIRS` itself, so emptying the set ran the
  loop zero times and reported green.
- A coverage check discovered workflows by the filename pattern `-checks.yml`,
  which silently missed `automerge-gate.yml` — the one workflow where a gap
  mattered most — and the clause written to excuse it was dead code that could
  never have run.
- A navigation-exclusion test put the menu outside the scored root, so the
  exclusion it existed for was never exercised.

Narrowing a filter does not fail anything. It generates fewer assertions, and a
suite that checks less still reports `0 failed`. **Name the expectations
independently, and assert that the discovery found what it should.**

**Caches hide mutations.** `ensurePluginZip()` returns early when a zip exists
for the version, so archive assertions were checking an artefact built before
the change they were meant to catch. Clear the cache in the test.

**`auto-merge-gate.test.js` extracts the first `grep -qE '^(...)'` in
`auto-merge-claude.yml`** to compare against `platform-deploy.yml`'s paths. A
second alternation added anywhere above it becomes the thing it checks. Use
separate `grep -q` calls.

**WebFetch does not pick up host-allowlist changes** even once `curl` from the
session succeeds against the same host. Fetch with `curl` and parse locally
instead of retrying.

**Elementor does not resolve dynamic tags inside custom HTML attributes**,
which is why `data-asset-gated="{{…}}"` renders as literal text on every card.

---

## 8. Where things live

| | |
|---|---|
| `dev/nvelope-theme/` | The child theme as of 23 Nov 2026. A snapshot and a specification, not the thing to keep editing |
| `dev/oc-forms/` | October Forms, including `class-ocf-endings.php` |
| `docs/oc-forms/API.md` | The read-only API OMI consumes, including `outcome` |
| `docs/nvelope/platform-audit-2026-11-21.md` | The full admin audit. Accurate except where section 4 above corrects it |
| `docs/nvelope/platform-audit-brief.md` | The brief that produced it, for re-running |
| `dev/platform/backend/src/services/wpPluginPackage.js` | Plugin registry and zip builder |
| `dev/platform/backend/src/routes/integrations.js` | Distribution, legacy paths and slug-addressed |

The funnel plugin does not exist yet. When it does, `dev/nvelope-funnel/` with
`docs/nvelope-funnel/` pointing back here, per the repo's two-folder rule.
