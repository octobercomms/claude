# Multiple audiences on one press release

One release, several named audiences (Workplace, Retail, Residential…). Each is
built from an uploaded list plus tags, locked to snapshot who is in it, and given
its own subject lines, intro and follow-ups. The release body and hero image stay
shared, because it is one press release.

## Where it is

Earned → Build → Releases → open a release → **Create pitch campaign** → the
campaign's **Set up & send** tab, step 1 (Who). The **Audiences** panel sits below
the existing single-audience picker.

It is additive. A release with no audiences behaves exactly as it always has: one
pitch to the list built in step 1. Add audiences only when the same release needs a
different covering note per group.

## The flow

The five-step wizard is still the spine. Audiences do not add a step; each step
from 2 onwards is worked once per audience, with a selector bar at the top.

**1 · Who** defines the audiences: name one, fill it by ticking tags or dropping a
CSV on the panel, resolve any overlap (below), then lock it so later retagging
cannot move people. Repeat per audience.

**2 · What** writes the emails. The selector bar picks which audience you are
writing; the subject and body fields are the same ones as before, now scoped to
it, with the shared version shown as the placeholder so you can see what you are
overriding. Leave a field blank and that audience falls back to the shared
version, so you only write what differs. **Draft for \<audience\> with AI** writes
one intro and one set of follow-ups aimed at that audience's patch.

Release-level settings stay shared and are edited once: the embed toggle, the hero
image, the release link, the footer, and the follow-up delays. Delays are shared
because each audience sends separately and the delays run from its own send.

**3 · Test** sends a test of the selected audience, marked
`[TEST · <audience>]` so a round across four audiences does not land as four
identical-looking emails. The server picks one of that audience's own members to
personalise for.

**4 · Preview** renders that audience's email. An intro written for the wrong
patch is only visible here, so preview one from each audience you have tailored.

**5 · Confirm** keeps the release-level checks (sender, footer, subjects) and then
lists every audience with its own checklist and its own Send. Plus a row for
anyone on the release who is in no audience, who receives the shared pitch.

An earlier version put the copy editor and the send inside each audience's panel
on step 1. That was wrong: you set an audience's subject on step 1 and then step 2
showed you the shared subject with no sign of which one won.

## The dedupe

A contact can be in exactly one audience per release. This is not a report you run
before sending; it is a database constraint. Membership lives on
`outreach_campaign_contacts`, whose primary key is `(campaign_id, contact_id)`, so
a second membership row cannot exist.

Adding a list that overlaps an existing audience therefore moves nobody. The
overlap comes back immediately: *"14 already in Workplace. Move them to Retail, or
leave them where they are."* You choose, and the choice is recorded as membership.

Two consequences worth knowing:

- **It asks which audience, never which tag.** Tags live on the contact and are
  shared across every client, so retagging a journalist to resolve an overlap here
  would change them for every other client. The resolution sets where they send
  from on this release and leaves their library tags alone.
- **A sent audience is frozen.** Its membership, copy and the record of what it
  sent cannot change, and its members cannot be moved into another audience,
  because they have already had that audience's email.

### Why it is a constraint rather than a check

Without it, a contact in two audiences gets two send rows per step. The dispatch
gate's frequency cap allows one email per person per rolling 24 hours, and it
*reschedules* rather than drops, so the second pitch arrives a day later. The
journalist receives two different pitches for the same release, on consecutive
days. That reads as a mistake, because it is one. Making it unrepresentable is
cheaper than remembering to check.

## Holding specific people back

At the bottom of the Audiences panel, **Never send to** searches the whole media
library (not just this release) and holds individuals back, whichever audience
they are in. Two scopes, because they mean different things:

- **this release** — a one-off. "They already know, I told them on Tuesday."
- **always** — never emailed on this client's behalf, usually because the client
  handles that journalist directly. Applies to every release for the client.

Both already existed server-side (`outreach_press_releases.excluded_contacts` and
`outreach_contact_clients.excluded_at`, migration 186) and were already enforced
in the dispatch gate. What was missing was a way to set them from the release, and
counting them: `pressSegments.list()` and `memberIds` ignored the per-release list,
so naming someone left "N to send" unchanged. The audience header now reads
"1 to send · 1 held back by name", and excluding someone already queued cancels
their pending sends immediately rather than leaving the gate to stop them later.

The search button is labelled **Find to exclude** rather than "Search", because
step 1 already has a journalist search above it that *adds* people. Two identical
buttons doing opposite things on one screen is a good way to send a release to
someone you meant to hold back.

## Where the copy lives, and why not on sequences

The obvious design is `outreach_sequences.segment_id`: one sequence set per
audience. It is the wrong one here.

`outreach_sequences` has 46 call sites, 20 of them in the cold-email system, which
has nothing to do with press audiences. More importantly the send queue does
`CROSS JOIN outreach_sequences s WHERE s.campaign_id = $1`, so per-audience
sequence rows would hand every recipient *every* audience's emails unless all 46
sites were audited first.

So `outreach_sequences` is untouched and stays the shared skeleton: how many
emails, how many days apart, the default subject. Each audience carries its own
copy on its own row and overlays it at render time:

| Column | What it overrides |
|---|---|
| `subjects` | `{"1": "…", "2": "…"}` keyed by step, beating the shared sequence subject |
| `intro` | the first email's body for everyone in this audience |
| `followups` | `[{subject, body}, …]` in step order from step 2 |

All three are nullable. An audience you have not tailored sends the release's
shared pitch, so a half-finished split still works.

`services/outreachSender.js` resolves the recipient's audience once per dispatch
(`pressSegments.copyForContact`) and prefers its copy at each render point. A
campaign with no audiences resolves to `null` and every path behaves as before.

The preview and the test go through the same overlay rather than reimplementing
it: `pressSegments.overlayRelease(release, copy)` returns the release as that
audience will send it, so what you check is what the recipient gets. Both accept
an explicit `segment_id` (the wizard's "this audience"), and the preview falls
back to the contact's own audience when none is given, so previewing a journalist
from a list shows the email they will actually receive.

That also fixed a pre-existing bug: `sendPressTest` always generated a
per-recipient AI pitch, so a test on a "one email for everyone" release showed an
email no journalist would receive and billed for it. It now renders the shared
copy, with merge tags filled, exactly as the sender does.

## Cost

An audience intro is shared copy, so it takes the same no-AI path as "one email
for everyone": **one draft per audience, not one per journalist.** Five audiences
cost about five drafts, roughly $0.15 total.

An audience with no intro falls back to per-recipient personalisation, which is
about $0.03 per journalist. The send plan for an untailored audience quotes that
figure before you send; a tailored one quotes zero. Drafts bill against the
`press_outreach` task budget through `press_pitch` and `press_followups`.

## Schema

Migration `191_press_audiences.sql`:

- `outreach_campaign_segments`: the audience: `name`, `position`, `tags`
  (provenance, not a live filter), `locked_at`, `sent_at`, and the three copy
  columns above. Unique on `(campaign_id, lower(name))`, because an ambiguous name
  in the dedupe prompt is a trap.
- `outreach_campaign_contacts.segment_id`: membership. `NULL` means attached to
  the release but in no audience, which is every pre-existing campaign.

Deleting an unsent audience sets its members' `segment_id` to `NULL` rather than
detaching them, so nobody is lost by deleting an audience.

## Tests

- `backend/tests/press-segments.test.js`: 46 assertions against a real database:
  creation, naming, filing, the overlap report, both resolutions, the invariant
  that no contact has two membership rows, counts and suppression, per-audience
  copy resolution, locking, freezing, and deletion. Also asserts the sender is
  wired to the audience copy at each render point, and that migration 191 never
  touches `outreach_sequences`.
- `backend/tests/press-audience-routes.test.js`: the routes over HTTP: the
  `:segId` cross-tenant guard, and that queueing one audience produces exactly one
  send row per recipient per step.

Both need a database. Neither calls an AI endpoint, so both are free to run.
