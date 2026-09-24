# AI spend controls

Three layers, smallest first. All are opt-in and all reset on the 1st.

| Layer | Where | What it stops |
|---|---|---|
| Per-feature model choice | Settings → AI models | The unit cost of every call. The biggest lever by far. |
| **Task budget** | Settings → AI models → Task budgets | One task, once it has used its monthly allowance. Nothing else is affected. |
| Global hard cap | Settings → AI models → Spend controls (`AI_MONTHLY_HARD_CAP_USD`) | Every AI feature in OMI. The outer wall, not the day-to-day control. |

## Why task budgets exist

The global cap is one number for all of OMI. A background research sweep that
runs away consumes it, and then chat, report narratives, snapshots and press
pitches all stop too. A cap meant as a backstop becomes an outage.

A task budget is an allowance for a named group of features. When the task
reaches it, that task stops and everything else keeps running. The next
calendar month it resumes by itself, because spend is always measured from
`date_trunc('month', now())` — nothing needs re-arming. That is what makes a
long background job (say, enriching 20,000 media contacts over several months)
safe to leave switched on.

## The tasks

Seeded by migration `185_ai_task_budgets.sql`, with no budget set, so nothing
changes until someone puts a number in.

| Task | Features it pays for |
|---|---|
| `media_research` | `media_db_research`, `press_beat_learn`, `press_byline_mining`, `press_outlet_resolve`, `contact_tidy` |
| `prospecting` | `outreach_research`, `snapshot_draft`, `snapshot_refine`, `lead_scoring`, `lead_scrape`, `hunter_domain_search`, `hunter_verify_email` |
| `press_outreach` | `press_pitch`, `press_followups`, `press_match`, `press_match_embed`, `press_audience` |

A feature should belong to at most one task. Overlapping feature lists
double-count spend, and nothing in the schema prevents it.

`press_outreach` is usually better left with no budget: it scales with how much
you send, and a budget there stops a large release part-way through.

## Adding a call site

Enforcement is not automatic. `callClaude` checks the **global** cap for
everything routed through it, but the media and prospecting researchers call
the Anthropic SDK directly — they need the `web_search` tool, which `callClaude`
does not expose — so they were invisible to the cap until each one was wired up
by hand. Any new direct-SDK caller has the same problem.

In a loop, stop cleanly rather than throwing, so completed work is kept and the
next run resumes from the queue:

```js
const budget = require('./budget');

for (const contact of rows) {
  if (await budget.taskCapReached('media_research')) { budgetStopped = true; break; }
  // … do the work, which bills …
}
```

After each billed call, tell the cache what was just spent:

```js
recordClaudeCost({ model, response: message, feature: 'media_db_research' });
budget.noteTaskSpend('media_research', claudeCostFromUsage(model, message.usage));
```

The month-to-date total is cached for 30 seconds. A sweep bills faster than
that, so without `noteTaskSpend` the budget is only noticed after the run is
already over.

Both `assertUnderTaskCap` and `taskCapReached` are no-ops for a task with no
row, no budget, or a missing table. Adding a call site never changes behaviour
on its own.

## Cost figures

`costLog.js` holds the price table. Two things to know:

- Haiku 4.5 was listed at $0.80/$4.00 per MTok until September 2026. It is
  $1.00/$5.00. Every Haiku figure OMI reported before that fix was 25% low.
- Anthropic's server-side `web_search` is billed per search on top of tokens.
  It is read off `usage.server_tool_use.web_search_requests` at
  `WEB_SEARCH_USD_PER_SEARCH`. For a search-heavy contact lookup the search fee
  is larger than the tokens, so leaving it out badly under-reports the
  researchers.

Check the list price against the current published rates before trusting either
number. A stale price table makes every budget in OMI a guess.

## Working estimates

Measured from the cost model, not from a live run. Replace these with real
numbers from Settings → AI models → Cost log once a sweep has run.

| Job | Per item |
|---|---|
| Outlet pass (masthead, media kit, contact pages), Haiku, ~2 searches | ~$0.035 |
| Contact desk check at an already-researched outlet | ~$0.015 |
| Freelancer research (live search, LinkedIn/Instagram/byline) | ~$0.06 |

Outlet work is front-loaded and cached: once an outlet is researched, every
contact at it drops to the cheaper row. Freelancers are the recurring cost
because each needs live searching with nothing to reuse.
