# Process Rails — make every page a stepped, action-clear process

Decision record + build spec for the "I'm overwhelmed / what do I do next?" sweep.
Turns the platform's flat sub-tab groups into ordered, self-tracking processes
without rewriting any panel content.

- Date: 2026-07-07
- Branch: `claude/peaceful-franklin-drpsew-2ppmnt`
- Status: **spec + first slice** (Paid → Advise ships as the proof)

---

## The problem (client's words)

> "There are so many pages in here, and a lot of amazing information. But what
> isn't clear to me is the action to take. If each page can feel like its own
> stepped process — so each step can be completed and tracked — but it's clear
> what to do. I'm so overwhelmed."

The **Build** flows already feel like a process — they use a linear `Stepper`
(Brief → Draft → … → Launch). Every *other* group is a flat strip of sub-tabs
with no sense of order, progress, or "am I done here":

| Suite | Groups that are flat sub-tabs today |
|---|---|
| Paid | **Advise** (Playbook · Briefing · Audiences · Competitors), Measure |
| Owned | Search, Optimise, Localise, Convert |
| Earned | the PR tabs (Coverage · Track · Journalists · …) |
| Shared | the social tabs |

## The pattern — "Process Rails"

A thin **navigation + status layer** over the existing panels. Nothing inside a
panel changes.

1. **A rail replaces the flat sub-tab strip** — the sub-tabs become ordered
   steps, rendered with the same `.stepper` styling the Build pipelines use, so
   it reads as a process.
2. **Derived-first status.** Each step knows whether it's done from *real data*,
   not a checkbox — Briefing is done when a Strategist report exists, Audiences
   when a segment exists, Competitors when any are added, etc. Honest and
   zero-friction. A `client_suite_progress` table backs a **manual "mark done"**
   fallback for the few steps with no data signal.
3. **"Do this next"** — the first incomplete, non-informational step is
   highlighted; each step carries a one-line *what/why*.
4. **Readiness at a glance** — each suite Overview gains an "N of M set up" bar
   built from the same signals.

### Status model

`GET /clients/:id/suite-progress/:suite` → `{ steps: { <key>: 'done' | 'todo' | 'info' } }`.

- **derived** — a per-suite SQL check (the default).
- **info** — reference steps with no completion (e.g. a Playbook); always
  reachable, never "todo", not counted in the readiness fraction.
- **manual** — overrides stored in `client_suite_progress (client_id, suite,
  step_key, done)`, merged over the derived value. Used only where nothing can
  be derived.

### The component

`ProcessRail` — a sibling of `Stepper` (not a replacement; the Build pipelines
keep their position-based `Stepper`). Driven by explicit per-step
`{ key, title, sub, status }` rather than a `current` index, so a later step can
be done while an earlier one isn't. Reuses the `.stepper` CSS for visual
consistency.

---

## Per-suite step maps

Derivation signals in parentheses.

**Paid → Advise** *(this slice)*
1. Playbook — *info*
2. Briefing — done when a completed `strategist_reports` row exists
3. Audiences — done when an `audience_segments` row exists
4. Competitors — done when `clients.competitor_domains` is non-empty **or** a
   `competitor_ad_runs` row exists

**Paid → Measure** — Connected (ad connectors active) → Reviewed (a Strategist
report in the last 30d).

**Owned → Search** — Keywords tracked → Search Console linked → AI visibility run.
**Owned → Optimise** — Site audit run → Content audit run → Quick wins reviewed.
**Owned → Localise** — GBP connected → competition gap run.

**Earned** — Contacts imported → pitched → coverage logged → thank-yous sent.

**Shared** — persona set → templates generated → published → engaging.

(Exact signals confirmed per slice against the real tables before wiring.)

---

## Rollout slices (each an independently mergeable PR)

0. ✅ **This doc** + the reusable pieces: `client_suite_progress` migration,
   `suiteProgress` service + route, and the `ProcessRail` component.
1. ✅ **Paid → Advise** — the proof, wired end-to-end with derived status.
2. **Paid → Measure** + the Paid Overview readiness bar.
3. **Owned** — Search, Optimise, Localise (the largest surface).
4. **Earned** + **Shared**.
5. **Overview readiness bars** across all suites.

Ship 0+1 together so there's a working example to feel; review the *feel* before
rolling out 2–5.

## Explicitly out of scope

- Rewriting any panel's internals — this is navigation + status only.
- The Build pipelines — they already are process rails (position-based
  `Stepper`); left as-is.
- Forcing a linear order — steps remain individually clickable; the rail
  *recommends* an order, it doesn't lock one.
