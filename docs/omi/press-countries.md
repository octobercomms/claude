# Country on a journalist, and country exclusions

Journalists carry a normalised `country`, derived from data OMI already holds with
no AI call. A release can exclude countries, and each release decides what happens
to journalists whose country is unknown.

## Why not just filter on `location`

`outreach_contacts.location` is free text written by the paste importer or a CSV
column. In practice it holds "London", "New York", "UK", "United Kingdom" or
nothing. Filtering a send on it would be the mistake `agent-guide.md` already
records: a query that looks like enforcement and is not. "UK" never matches
"United Kingdom", a city matches no country, and a blank is invisible, so the
exclusion would quietly let through the people it was meant to hold back.

So there is a separate `country`, plus `country_source` saying where the value came
from. A country inferred from an email TLD deserves less trust than one read off
the publication, and the operator needs to see which is which before relying on a
filter.

## How a country is derived

Ranked best-first. A later pass fills gaps and upgrades a weak value to a better
one; it never downgrades, and never overwrites a hand-typed country.

| Source | Where it comes from |
|---|---|
| `manual` | Typed by a person. Never overwritten. |
| `outlet` | The publication's `region` when that names a country, else its `domain`'s country TLD. Strongest derived signal: it describes the title, not one person's mailbox. |
| `location` | The contact's location text already names a country, including as the last part of "Brooklyn, New York, USA". |
| `city` | The location text names a city in the lookup. |
| `tld` | The contact's email has a country-code TLD. |

Unresolved stays `NULL`. That is a real answer: a guess would silently send a
release to someone the operator told it to hold back.

Deliberate omissions, because a wrong country is worse than a gap:

- `pr_outlets` has no `country` column. `region` is free text, so "EMEA" or
  "North" resolves to nothing rather than becoming a country.
- Ambiguous cities are absent. "Birmingham" (UK and Alabama) and "Cambridge" (UK
  and Massachusetts) resolve to nothing.
- `.co`, `.io`, `.ai`, `.me`, `.tv` and `.cc` are not treated as country codes.
  They are sold globally and say nothing about where anyone is.
- Contacts are matched to publications on email domain first, outlet name second,
  because a pasted company name is not reliably the outlet's canonical name.

## The backfill

`POST /press/countries/backfill`, admin only, or the "Resolve more countries"
button on the release's Countries panel. Free, no model call, idempotent.
`{"dry_run": true}` reports what it would change without writing.

It reads the publications once into a map and resolves contacts against it in
memory, paging through them 5,000 at a time with one batched write per page. The
obvious SQL (a LATERAL join matching the email domain against the outlet domain
with a trailing wildcard) measured **69 seconds** for 20,000 contacts against
3,000 outlets, which is long enough to be cut off by the web server before it
returns. The in-memory version is **0.7 seconds** for the same data, and it is
also more correct: a trailing-wildcard match claims "faketimes.co.uk" for the
outlet "thetimes.co.uk". Matching is exact on the email domain, then on the
domain with one subdomain label stripped, then on the company name.

It returns the coverage figure, which is the number that matters. Excluding the
United States on a library where 30% of contacts have a country means you have
filtered 30% of your list. The panel says so rather than implying the job is done.

## Exclusions

Set per release: `excluded_countries TEXT[]` and `unknown_country_policy`.

Unknown country is a first-class state, never a silent one:

- `send` (the default) holds back only journalists positively identified in an
  excluded country. Keeps reach.
- `hold` also holds back anyone not positively identified as outside the excluded
  countries. Safer, costs reach.

The panel shows the unknown count next to the choice, and when `hold` is selected
it says how many extra contacts that holds back.

An exclusion is stored in its canonical spelling, so typing "uk" matches contacts
stored as "United Kingdom".

### Seeing that it worked

Excluding a country changes three numbers, all of which come from the same rule:

- each audience's header, "2,331 to send · 1,402 held back by country"
- the Audiences panel total
- the per-audience send plan on Confirm

`pressSegments.list()` applies the country rules as well as counting them, and
reports `country_excluded_count` separately from the other suppressions, so
`member_count - suppressed_count` is always the number that will actually be
emailed.

The Countries panel sits below the Audiences panel on step 1: build the lists
first, then filter them. Its button is labelled **Save countries and refresh
audience counts**, and because the audience lines it changes are above it and
can be off-screen, it also prints the result beside the button ("0 will send
across 2 audiences, with 4 held back by country"). The Audiences panel owns its
own copy of the list, so saving bumps a reload token that makes it re-read
itself; without that the lines right above the button keep the old numbers,
which is the exact thing the count exists to show. Resolving more countries
refreshes it too, since a newly resolved country can match an exclusion that was
already set.

That wiring is the point rather than a nicety: the send was already correct
before it, because `memberIds` and the dispatch gate both applied the rules, but
the audience header counted only the other suppressions. So excluding a country
left "N to send" unchanged, which reads as having done nothing. A number that
does not move is worse than no number. `contact-country.test.js` asserts the
displayed sendable count equals what the send would queue, under both unknown
policies.

### Enforced at dispatch, not only in the pickers

The rule is applied in three places, all sharing one SQL fragment
(`contactCountry.excludedByCountrySql`) so they cannot disagree:

1. The tag audience picker (`GET /press/audience` with `release_id`), so the count
   shown is the count that sends.
2. `pressSegments.memberIds`, so an audience's send plan matches its send.
3. **`scheduler.js runOutreachSends()`**, which is the authoritative stop.

The third is the one that matters. `do_not_contact` was excluded by every picker
for months while the gate ignored it, so anyone opting out after a send was queued
still got the email. A country resolved or corrected between queueing and dispatch
is caught by the gate, and the test asserts exactly that case: a send queued
before the exclusion existed is cancelled at dispatch.

## Where it shows

- The audience picker and journalist search, with the source in the tooltip.
- The media library table in Settings, where a hand-typed country renders in full
  colour and a derived one in muted type.
- The contact edit modal, as an editable field. It saves through
  `PUT /press/contacts/:id/country` rather than as an ordinary field, so it is
  stamped `manual` and a later backfill leaves it alone.
- The release's Countries panel, which carries the coverage summary.

Not the journalist profile page at `/media/journalist/:id`. That page reads
`pr_contacts`, a different table from the `outreach_contacts` the press sends use,
so a country field there would be a second column to keep in sync. Correct a
country from the media library instead.

## Schema

Migration `192_contact_country.sql`:

- `outreach_contacts.country` and `.country_source`, with a partial index on
  country for media contacts.
- `outreach_press_releases.excluded_countries` and `.unknown_country_policy`, the
  latter with a CHECK constraint on `('send','hold')`.

## Tests

`backend/tests/contact-country.test.js`, 55 assertions against a real database and
no AI call. Covers normalisation, each derivation signal, the precedence order,
that ambiguous cities and non-country TLDs resolve to nothing, that a hand-typed
country survives a backfill, both unknown policies, the suppression breakdown, and
the dispatch-gate case above. Verified to fail when either the gate check or the
audience filter is removed.
