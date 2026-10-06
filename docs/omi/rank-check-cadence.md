# Rank-check cadence, per client

**Settings → Connections → Costs & usage → DataForSEO keyword spend.**

Each client has its own `rank_check_days`. Set a client to daily while you are
working on them and monthly while you are not; the projected cost on the same
screen follows.

## Why it changed

Rank checks ran on one global cron every 4 days over every active keyword of
every active client: 861 keywords, 11 clients, about $59.90 a month. That rate
is right for a client in an active push and wasteful for one being kept warm,
and one number cannot be both.

## How it works

The cron now runs **daily at 06:00** and asks, per client, who is due. A
keyword is due when its last check is at least `rank_check_days` old. A keyword
with no history is always due, so a newly added one is picked up the next
night rather than waiting out its client's cadence.

`0` pauses that client's rank **and** AI Overview checks.

**AI Overview has its own floor of 7 days.** However active the client, an AI
Overview does not change day to day, so checking it more often buys nothing.
A client set slower than weekly keeps their own slower cadence.

## What each setting costs

Per keyword, per month, rank plus AI Overview:

| Cadence | Per keyword |
|---|---|
| Daily | $0.252 |
| Every 4 days | $0.070 |
| Twice a month | $0.020 |
| Monthly | $0.010 |

**Daily costs 25× monthly.** That is the number to keep in mind: it is easy to
undo a whole estate's saving by setting two clients to daily.

Across 861 keywords:

| | Monthly |
|---|---|
| All daily | $217.14 |
| All every 4 days (the old behaviour) | $59.90 |
| All twice a month | $17.47 |
| All monthly | $8.74 |

Mixed, assuming roughly 200 keywords sit on clients being actively worked:

| Active clients | Dormant clients | Monthly |
|---|---|---|
| Daily | Monthly | $57.14 |
| Every 4 days | Twice a month | $27.33 |
| **Every 4 days** | **Monthly** | **$20.62** |
| Every 4 days | Paused | $13.91 |

The recommendation is the bolded row. Daily is rarely worth 3.6× the cost of
every-4-days: rankings do not move enough day to day for the extra reads to
change a decision, and a client report covers a period rather than a day.

## Notes

- **The default is 4**, deliberately. The migration changes nothing on deploy;
  lowering a bill is an explicit act per client, taken where the cost of the
  choice is shown next to it.
- A `CHECK` constraint rejects negatives. A negative cadence would make every
  client permanently due and turn the daily cron into a daily full sweep,
  which is the exact opposite of the point.
- The suggested daily cap on the same panel is unchanged by cadence, and that
  is correct: cadence changes how *often* a full sweep lands, not how big one
  is. The cap is sized against the worst case of every client falling due on
  the same day.
- The projection is computed per client server-side and re-read after each
  save, so the figure on screen and the figure the scheduler will produce come
  from the same source.

## Tests

14 assertions against Postgres covering: each cadence coming due at the right
day; the exact boundary, so a 4-day client is checked on day 4 and not day 5;
paused clients, inactive clients and inactive keywords never being due;
brand-new keywords being due immediately; AI Overview holding its weekly floor
for a daily client while respecting a slower one; and the database rejecting a
negative cadence.

## Code map

- `backend/migrations/188_client_rank_cadence.sql`
- `backend/src/services/scheduler.js` — `runDailyRankChecks`, `runWeeklyAIOChecks`
- `backend/src/routes/settings.js` — `/settings/dataforseo-estimate`,
  `PUT /settings/clients/:clientId/rank-cadence`
- `frontend/src/pages/SettingsPage.jsx` — `KeywordSpendPanel`
