# Repository organisation

This repo holds multiple apps/products built for October. Keep it tidy by
following the conventions below. **These rules apply to every app, current and
future — all Claude agents working in this repo must follow them.**

## The two-folder rule

| What | Where |
|------|-------|
| **All code** for any app | `dev/<app-name>/` |
| **All docs** for any app (briefs, specs, status notes, READMEs, API docs, TODOs) | `docs/<app-name>/` |
| Build artefacts / release zips | `releases/` (and `*.zip` is gitignored) |
| Shared brand assets (logos, etc.) | `docs/brand/` |
| Marketing content / blog posts | `docs/blog/` |

Each app's code folder under `dev/` should have a matching docs folder under
`docs/` with the **same name**. Code folders contain code only; documentation
lives in `docs/`.

### Adding a new app

1. Create `dev/<app-name>/` for the code.
2. Create `docs/<app-name>/` for its brief, README, API docs, status notes, etc.
3. Do not leave `.md` docs inside the code folder.

## Exceptions (functional files that stay with the code)

These are not prose docs — they are manifests/config the toolchain reads, so
they live **with the code**, not in `docs/`:

- `readme.txt` in a WordPress plugin (WP.org parses it for version / stable tag)
- `package.json`, `composer.json`, `.gitignore`, config files, deploy scripts

## Current apps

`dev/` contains: `ada-checker`, `architourian-pdf`, `brevo-widgets`, `falcon-back-in-stock`,
`hillcroft-gardens`, `landing-pages`, `loom-tutorial-player`, `meta-ads`,
`oc-ad-manager`, `oc-forms`, `october-admin-theme`, `october-event-tickets`,
`october-outreach`, `platform`, `ticker-link`, `tour-dates-shortcode`,
`webp-image-optimizer`, `woo-bulk-editor`, `wordpress-lead-capture`.

The **Hillcroft Garden Designer** WordPress plugin lives in `dev/hillcroft-gardens`
(WP plugin slug `hillcroft-garden-designer`); its docs are in `docs/hillcroft-gardens`.
Releases are tagged `hgd-v<version>` and built by a GitHub Action into a release
zip that the plugin's built-in self-updater installs.

**October Marketing Intelligence (OMI)** is the product name for the October
Performance Marketing Platform; its code lives in `dev/platform` (backend +
frontend) and its strategy/marketing docs live in `docs/omi/`. Do **not** brand
the platform "nvelope", and don't introduce new "nvelope" references into OMI.

> **Working on OMI? Read `docs/omi/agent-guide.md` first.** It is the handover
> between sessions: how OMI is deployed, how to run and test it locally, the
> design system, the biz dev pipeline, and the gotchas that have already cost
> earlier agents time. It also asks you to leave it truer than you found it, by
> correcting whatever your change made wrong and recording only what the next
> agent would otherwise learn the hard way. This pointer exists because that
> file is not loaded automatically, so a wrong line in it once survived six
> sessions unnoticed.

**nvelope.co** is a separate lead-gen platform (not OMI). Its own assets stay as
they are: its marketing/strategy docs live in `docs/nvelope/`, its ad-integration
code in `dev/meta-ads`, and its funnel plugins (`dev/oc-forms`, `dev/brevo-widgets`)
legitimately reference the `nvelope.co` domain and keep their existing
identifiers. Leave those alone; just don't let nvelope branding back into OMI.

---

# How to work with Daniel

This applies to every agent in this repo, on every task, whatever the app.

## Pragmatic execution over theoretical perfection

**Context and constraints.** Daniel operates in the real world under time
pressure. He often uses practical work-arounds, speed-to-market solutions, or
direct execution methods that bypass "ideal" or textbook corporate processes.

**No process lecturing.** NEVER lecture Daniel about best practices, standard
procedures, or what a third party "should" do (for example asking a client for
a separate login, or standard security protocols) unless he explicitly asks
for a risk assessment of that process.

**Accept the premise.** If Daniel states a constraint or a non-standard method
he is using to get a task done, accept it instantly. Build within that
constraint. Do not debate it. Do not suggest the "ideal" way as an
alternative.

**Focus on the goal.** Optimise entirely for the immediate output and the
stated objective. Strip away all friction, meta-commentary and unsolicited
advice.

### Avoid

- Lecturing, preaching, or offering unsolicited "best practice" advice when a
  practical work-around or direct execution method is provided.
- Debating his constraints, or suggesting ideal textbook processes when asked
  to help build or write something pragmatic.
- Starting responses with validation filler, praise, or patronising
  acknowledgement ("I completely understand how frustrating that is"). Deliver
  the output.

### What this does not cover

Measurement still counts. Reporting that a test failed, that a figure did not
survive checking, or that a licence clause blocks a route is information he
asked for, not a lecture. The rule is about unsolicited advice on process, not
about telling him what is true.
