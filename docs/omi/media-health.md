# Media database health

**Settings → Database → Library → Health.**

What is actually in the press database, counted rather than estimated.
Read-only, free (plain aggregates, no AI), safe to open as often as you like.

## Why it exists

The enrichment programme (countries, desks, freelancer research) was being
planned against guessed volumes, which produces guessed costs. Every figure
quoted before this screen came from a cost model, not a count. This reads the
real numbers so the schedule and the budget come from the database.

## What it shows

**Scale.** Live media contacts, how many have an email, how many publications,
how many contacts are linked to one. Merged-away duplicates are excluded
everywhere: they are tombstones pointing at a surviving row, and counting them
inflates every number on the screen.

**Feed coverage — the number that decides the cost.** A journalist whose byline
already appears in an ingested RSS feed stays current for nothing: activity,
beat, market and format all fall out of real article titles. One with no feed
needs paid search. The ratio between the two is the whole cost of the plan. If
this is high, most of what we want is reachable for pennies. If it is low, feed
and outlet coverage is the first job, not contact enrichment.

**What your sends already told you.** Every open, reply and piece of coverage,
gathered free over years of sending, and until now read by nothing. Replies and
coverage are ground truth. Opens are reported separately because Apple Mail
Privacy Protection fires them without a human reading anything.

**Field coverage.** Which fields are filled, so the enrichment order comes from
the gaps rather than from assumption.

**Off limits.** Unsubscribed, do-not-contact, bounced, excluded. These do not
sum to a total: one journalist can be several at once.

**What enriching this would cost.** The counts turned into money and months at
$30, $50 and $100 a month.

## The cost projection is an estimate, and says so

Unit costs live in `UNIT_COSTS` in `services/mediaHealth.js`:

| Job | Estimate |
|---|---|
| Publication pass (masthead, media kit, contact pages, ~2 searches, Haiku) | $0.035 |
| Journalist at an already-researched publication | $0.015 |
| Unattached: freelancer or unresolved, needs live search | $0.06 |

The split matters more than the numbers. A contact anchored to a publication is
cheap, because the expensive attributes (market, type, desk) belong to the
publication and are shared by everyone at it. A contact with no publication is
the expensive kind.

`projection.basis` reads `estimated`. After the first real pass, read the true
figure from Settings → Connections → Spend → Cost log, replace `UNIT_COSTS`,
and set it to `measured`. **Do not quote these numbers as fact until that has
happened.**

## Reading it

- **Feed coverage high** → lean on the byline stream. Cheap, self-refreshing,
  and evidence rather than claim.
- **Feed coverage low** → outlet and feed discovery first. Enriching contacts
  at publications we cannot follow means paying again in six months.
- **Many unattached contacts** → resolving them to publications is the highest
  leverage move available, because it moves them from the $0.06 row to the
  $0.015 row.
- **Large never-sent population** → no engagement signal either way. Judge
  those on beat and publication, not on silence.

## Notes for whoever changes this

- Every section is wrapped in `safely()` and returns null on failure, so one
  broken query blanks its own card instead of taking the page down. `partial`
  goes true and the screen says so.
- `LIVE_MEDIA` (`kind = 'media' AND merged_into IS NULL`) is applied everywhere.
  Leaving it off any query silently inflates that figure.
- Verified by 32 assertions against a database seeded so every number is known
  by construction, including the traps: merged tombstones, wrong `kind`, empty
  strings that are not null, unattributed articles, and queued-not-sent rows.
  An empty database returns zeroes rather than crashing.
- The test truncates before seeding. Without that a second run doubles every
  count, which looks exactly like a broken query.

## Code map

- `backend/src/services/mediaHealth.js`
- `backend/src/routes/settings.js` — `GET /settings/media-health`
- `frontend/src/pages/SettingsPage.jsx` — `MediaHealthPanel`
