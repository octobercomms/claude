# The GTM Brain

> **Scoped with Daniel on 2 November 2026.** Phase 3 of the mission was chosen
> on 1 November over the video editor. This document is the answer to the four
> questions the roadmap said could not be inferred from the code, and it
> replaces "a per-client go-to-market intelligence layer" as the brief.

## The decision, in four lines

| Question | Answer |
|---|---|
| What is it? | **Close the loop on the Strategist.** Not a second product. |
| First client? | **Falcon.** |
| What may it do alone? | **Earn autonomy per action type**, on the thank-yous' pattern. |
| How would we know it worked? | **Stale crucial items trend down** across the book. |

## Why this is not a new product

The Strategist already does most of what "GTM Brain" described. Per client it
runs an expert pass over each PESO pillar on that pillar's own stored data,
then a synthesis pass that reads all four together, and it writes a single
prioritised, pillar-tagged queue. `strategist/queue.js` threads each item to
the one it continues, so an item keeps its identity and its age from week to
week; `strategist/attention.js` rolls every client's open crucial items into
one ranked list for the Clients page. That is read the state, produce a
strategy, recommend the next actions.

What is missing is the last word of the sentence: **and measure them.**

`strategist_briefing_recommendations` carries `done`, `done_at`, `done_by` and
`notes`. It records that somebody ticked a box. Nothing records what number
the item was about, what that number was when the item was raised, or what it
is now. So the queue can tell you an item has been open nineteen days, and it
cannot tell you that the last six things you did moved nothing.

**This has been promised three times.** Migration 041 said the next briefing
would grade follow-through. Migration 140 said it would ground recommendations
in what was actioned versus ignored. Migration 215 wired up the memory — age,
the carry chain, rationale — and stopped short of outcome, and its own comment
notes that the two before it never wired up what they claimed. Three attempts
died in the same place, which is the reason this one is specified before any
code: the part nobody decided is *what "it worked" means for a given item*,
and that is not a schema problem.

## The hard part, named

An item reads "Fix the Meta Pixel on Summer Sale". To measure it you need two
things the model does not currently produce:

1. **Which number this item is about.** Not a free-text metric name. A
   pillar-scoped enum the code can actually read back — ROAS or CPA on a named
   campaign, position for a named keyword, published count at a named outlet
   tier, engagement rate on a named network. An item whose metric cannot be
   named is a *qualitative* item, and those should be marked as such and
   excluded from the track record rather than guessed at.
2. **A window and a baseline.** The value at raise time, and how long after
   completion you are willing to wait before reading it again. Thirty days
   suits paid; earned coverage lands on a publication's schedule, not ours.

Attribution stays deliberately weak, and the brief should not pretend
otherwise. If a pixel is fixed on the same week a budget moves, both items
will claim the ROAS change. The track record is evidence, not proof, and the
honest presentation is "these items were open while this number moved", with
the overlap visible. Trying to isolate single-item causality here would be a
research project, not a feature, and it is the quickest way to make this the
fourth attempt that stalls.

## Shape of the build

**Phase 0 — capture the baseline before changing anything.** ✅ Done (PR #1945).
`strategist/baseline.js` + `gtm_baselines` table + weekly cron + Clients page
attention tile. Records stale crucial item counts per client per week.

**Phase 1 — the outcome columns and the metric enum.** ✅ Done (PR #1946).
Migration 233 adds metric_ref, baseline_value, baseline_at,
measurement_window_days, outcome_value, outcome_at, qualitative to
`strategist_briefing_recommendations`. `strategist/metrics.js` is the
pillar-scoped enum (22 refs across 5 pillars). `queue.js` line shape extended
with `{metric:ref}` / `{qualitative}`. Synthesis prompt requires a metric ref
on every queue item. 46 tests across queue + metrics.

**Phase 2 — read the numbers back.** ✅ Done (PR TBD).
`strategist/outcome.js`: daily cron at 03:30 that (a) captures baselines for
newly raised items with a metric ref but no baseline yet, and (b) reads
outcomes for completed items whose measurement window has elapsed. Reuses the
same pillar gatherers the briefing uses. Cross metrics (revenue/orders) go
through `dataCollector`. Routes: `POST /outcomes/read` (manual trigger),
`GET /clients/:clientId/outcomes`. 31 tests for the extractor function.

**Phase 3 — the track record, per action type.** Group outcomes by what kind
of action they were, not by client. This is what makes autonomy earnable: you
cannot sensibly let the Brain act on its own judgement until you can see that
its judgement on *that kind of thing* has been right.

**Phase 4 — graduated autonomy.** `prThanks.js` is the pattern and it is worth
copying exactly, including its restraint: three stages (assisted, supervised,
auto), a confidence threshold per stage, and **the human moves the stage**.
`trackRecord` there only counts approved, edited, rejected and auto-sent, and
the UI shows that count beside the picker with a line saying to switch
supervised on once approvals build up. Nothing auto-graduates. Keep it that
way here. Auto-graduation on a metric the system computes about its own
performance is the one design in this document that could quietly go wrong at
scale, and nobody has asked for it.

## What this does not do

- It does not spend money or send anything outside OMI. That was not the
  answer to the autonomy question and should not arrive by increment.
- It does not learn across clients. A cross-client brain was explicitly the
  third option and was not chosen; it also cannot work until the track record
  from Phase 3 exists to learn from. Revisit after, not during.
- It does not price actions before they are done. Expected return was the
  second option and was not chosen. If it is wanted later, Phase 3's track
  record is what would make an estimate credible rather than invented.

## Falcon, and why

The most-exercised client in the codebase: live Meta and Google spend, the
first real nine-item Strategist queue, backlink and ranking history, and the
client whose numbers have caught several wrong figures already. The most data
to measure against, and the fastest place for a wrong figure to be noticed.

The risk in choosing it is that paid is the easy pillar for measurement and
Falcon is paid-heavy, so the metric enum could end up fitting paid and
straining everywhere else. Build the enum with an earned case in it from the
start even though Falcon will not exercise it much — a tier-1 placement is the
case that breaks a naive design, and discovering that in Phase 4 would be
expensive.

## Still open

- The measurement window per pillar. Thirty days is the obvious paid default;
  earned and owned both need a longer one and nobody has said how long.
- Whether a qualitative item is marked as such by the model or by the AM. The
  model is cheaper and the AM is more honest.
- Whether the track record is visible to clients. It is a strong retention
  artefact and a bad look on a quarter where the numbers went the wrong way.
