# ADF Platform — scope & stress test

**Status:** proposal for review (Daniel, Elayne, Ashleigh) · **Date:** 2026-06-10
**Decision taken:** the platform is a **friendly front-end on the WordPress plugin's data — no separate database, no sync.**

---

## 1. The problem (in your words)

> "We send Word docs to each other, have spreadsheets populated by forms and manual
> updates, and reports on spreadsheets of sales per week. Elayne manages all the
> conferences/events/locations and makes lots of documents with notes. I need a really
> ordered way to see that information, and when it's confirmed it goes green and I can
> go ahead — and it can't go green until all mandatory fields are completed. The main
> issue is we have no way of sharing all of the information. I tried Notion but Elayne
> didn't get her head around it. We also have tasks (only I use them) and an editorial
> log. Ashleigh manages volunteers and needs to confirm them for their location."

The recurring failure mode: **information lives in many private documents/sheets, and
the tools we've tried (Notion) are too open-ended for the team to adopt.** If the new
tool isn't dead-simple, nobody will use it and we're back to spreadsheets.

## 2. What the data actually is

From `ADF_Master_Database.xlsx` + `Tours_Atlanta_Revenue.xlsx`, ADF runs on **five
intake pipelines, a curation/planning layer, and revenue reporting**:

| Dataset | ~Rows | Today | Owner going forward |
|---|---|---|---|
| Tour Applications | 1,000 | form → sheet | plugin submission (public) |
| Event Submissions | 980 | form → sheet | plugin submission (public) |
| Brand Showcase | 1,000 | form → sheet | plugin submission (public) |
| Volunteers | 1,100 | form → sheet | plugin submission (public) |
| CEUs / Sponsors | ~100 | manual outreach | platform "pipeline" |
| Events 2025 (sessions, speakers, moderators) | 55 | Elayne's docs | platform "planning" |
| Tours revenue (weekly, YoY) | — | spreadsheet ex-EventBrite | plugin tickets + import |

The plugin's submission system **already replaces those public forms**, so the master
spreadsheet is a manual re-aggregation of data the plugin can own natively. The
planning/notes/confirmation layer on top is what's missing.

## 3. Architecture — front-end on WordPress (no sync)

`platform.atlantadesignfestival.net` is a clean, purpose-built web app that reads and
writes **directly to the ADF plugin's REST API**. WordPress (the plugin) remains the
**single source of truth**. There is **no second database and no sync to maintain.**

```
            public site (Elementor/JetEngine)         platform.atlantadesignfestival.net
                        ▲                                         ▲
                        │ confirmed events publish                │ reads/writes via REST + token
                        │                                         │
        ┌───────────────┴─────────────────────────────────────────┴───────────────┐
        │                ADF Festival plugin  (WordPress on 20i)                    │
        │  submissions · tickets/orders · ads · volunteers · NEW planning layer     │
        │  = the single source of truth for everything                              │
        └───────────────────────────────────────────────────────────────────────────┘
```

**Why this over a separate platform + sync:**
- A one-way sync can't carry the things we struggle with most — event planning, tasks,
  the editorial log, volunteer confirmations are *authored* in the planning layer; they
  don't originate on the public site, so there'd be nothing to "pull."
- One copy of the data ⇒ nothing to drift, no "which version is right," no sync to
  babysit. Fewer moving parts is the real adoption and longevity win.
- Confirmed events are already in WordPress, so they publish to the public site with no
  hand-off.
- Runs on the hosting we already have (20i); the platform is just static files.

**Trade-off accepted:** the platform depends on the WordPress site being up. For a small
team that's fine; if that ever changes we can revisit.

## 4. Source-of-truth map

| Data | Home | Public site needs it? |
|---|---|---|
| Tour / event / brand / volunteer **submissions** | plugin (public forms) | — |
| Ticket & ad **sales** | plugin | — |
| **Event planning** — sessions, speakers, notes, confirmation | plugin (new tables), edited on platform | ✅ once confirmed |
| **Tasks** | plugin (new), edited on platform | ❌ |
| **Editorial log** | plugin (new), edited on platform | ❌ |
| **Volunteer confirmations** (Ashleigh's extra fields) | plugin (new), edited on platform | ❌ |
| **CEU / sponsor pipeline** | plugin (new), edited on platform | ❌ |

Every field has exactly **one home** → no conflicts.

## 5. The headline feature: confirm → green

- Each record type has a **required-field set** (e.g. an event listing needs title, date,
  start time, location + lat/lng, image, description, organiser).
- Status ladder: **Draft → In progress → Confirmed (green)**.
- The **Confirm button stays disabled until every required field is complete**, and the
  card always shows a live checklist — *"5 of 7 done — still need: start time, image."*
  This teaches the user what's required with zero training (the exact gap where Notion
  lost Elayne).
- **Green ⇒ auto-publishes to the public site.** Can't go green ⇒ can't go live.
- Enforced **server-side** in the plugin, so the rule holds no matter how the data is
  edited.

## 6. Who uses it, and what they see

The antidote to the Notion failure is **one opinionated screen per person**, not a
flexible database:

- **Elayne — "Events".** A board of event cards, each with a completion meter and a
  Confirm button; green when done. Sessions/speakers/notes live inside each card. No
  databases, no views to configure, no navigation maze. Fill the card → it goes green →
  it's live.
- **Ashleigh — "Volunteers".** Signups (pulled from the public form) grouped by
  event/shift, with confirm toggles and her own fields (role assigned, briefed,
  t-shirt size, arrival time). Mobile-friendly for event day.
- **Daniel — everything** + **Tasks** + the **sales dashboard** (weekly tour revenue,
  YoY against the spreadsheet's Week-0 / Week-1 cohorts).
- **Contributors** (optional) — a read-only or single-pipeline view (e.g. press/editorial).

Cross-cutting ease-of-use commitments:
- **Magic-link login** (click a link in an email — no password to forget).
- **Email nudges via Brevo** ("Blueprints & BBQ is 5 days out and missing 2 fields") so
  nobody has to remember to log in and check.
- **Mobile-first**, because the team is on-site during the festival.
- **Day one isn't empty** — existing spreadsheet data is imported first.

## 7. Technical shape

- **Backend:** the ADF plugin gains a **planning layer** — new tables + REST endpoints
  for event sessions/speakers/notes, tasks, editorial log, volunteer-management fields,
  and the CEU/sponsor pipeline, plus the **confirm-gating engine**. (This is "continue
  building the plugin" and is useful even before any platform UI exists.)
- **Front-end:** a lightweight single-page app (static files) served at the subdomain,
  talking to the plugin's REST API. No second server; sits alongside the existing 20i
  hosting.
- **Auth:** platform users authenticate to WordPress via magic-link → short-lived token;
  REST calls are token-authenticated. Re-uses the auth/secret patterns already in the
  plugin (1.3.0 added at-rest encryption + REST hardening).
- **Roles:** view scoping per person (Elayne ≠ press PII; Ashleigh = volunteers only;
  Daniel = all).

## 8. Importers (so it's not empty)

- One-time import of the master spreadsheet tabs (Tour Applications, Event Submissions,
  Brand Showcase, Volunteers, Events 2025 sessions, CEUs/Sponsors) into the plugin,
  **de-duped** on email + festival year (the Volunteer and Brand Showcase tabs contain
  repeats across years).
- One-time import of the **revenue history** (2016–2024, ex-EventBrite) so the dashboard
  can show year-over-year; 2025+ comes from the plugin's own ticket sales.

## 9. Reporting / dashboard

- Weekly tour-ticket revenue using the spreadsheet's **relative-week cohorts**
  (Week 0 = event week, Week -1, …) with avg ticket price, quantity, cumulative, and
  **YoY comparison**.
- Pulls live from the plugin's `adf_orders`; historical years from the imported sheet.

## 10. Stress test (where this breaks — and the fix)

1. **Adoption — the #1 killer.** *Risk:* another tool people ignore.
   *Fix:* one screen per role; the self-teaching completion checklist; magic-link login;
   email nudges instead of expecting check-ins; import so day one isn't empty. Win Elayne
   first — if she adopts it, the rest follows.
2. **Double data entry.** *Risk:* the platform becomes "another spreadsheet to update."
   *Fix:* it reads the plugin's existing submissions; staff *curate*, they don't re-key.
3. **Single source of truth.** *Risk:* drift between systems. *Fix:* removed by design —
   one database (the plugin); the platform is a view/edit layer.
4. **Hosting on 20i.** *Risk:* shared PHP host won't run a Node server well. *Fix:* the
   backend is the existing plugin; the platform is static files — no second server.
5. **PII & access.** ~3,000 applicant/press emails + phones. *Fix:* role-scoped views;
   at-rest encryption + REST auth already shipped (1.3.0); least-privilege per user.
6. **YoY reporting gap.** Pre-2025 revenue was in EventBrite. *Fix:* one-time revenue
   import; 2025+ native.
7. **Migration & duplicates.** Volunteer (1,137) / Brand Showcase repeats across years.
   *Fix:* importer de-dupes on email + year.
8. **Maintenance / bus factor.** One (agentic) developer. *Fix:* boring stack, few moving
   parts — reinforced by the no-sync choice.
9. **Performance.** 1,000-row pipelines over REST. *Fix:* server-side pagination, search,
   and filtering in the new endpoints from the start.
10. **Confirmation gaming.** Someone marks an event "confirmed" without real readiness.
    *Fix:* server-enforced required-field gate; "confirmed" is a data fact, not a click.

## 11. Phased roadmap

1. **Plugin planning layer + confirm-gating** (backend; useful immediately in wp-admin).
2. **Importers** (master spreadsheet + revenue history, de-duped).
3. **Platform v1 — Elayne's Events board** with green-gating. Ship to her first.
4. **Volunteers view (Ashleigh)** + **sales dashboard**.
5. **Editorial log**, **Tasks**, **CEU/sponsor pipeline**, Brevo nudges.

## 12. Non-goals (for now)

- No separate platform database or sync engine.
- No general-purpose, configurable database (that's the Notion trap).
- No replacement of Elementor/JetEngine for the public site.
- No multi-festival / white-label support yet.

## 13. Open decisions before build

- **Required-field sets** per record type — needs Elayne's input on what genuinely makes
  an event "ready" (the gating rules are only as good as this list).
- **Roles & who-sees-what** — confirm Elayne/Ashleigh/Daniel scopes and whether
  contributors get logins.
- **Editorial log fields** — Daniel's current platform schema to mirror.
- **Magic-link vs existing WordPress logins** for the three core users.
- **Domain/SSL** for `platform.atlantadesignfestival.net` on 20i.
