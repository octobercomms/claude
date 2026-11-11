# Caro Communications on OMI

**Source:** Daniel's meeting with Caro Communications, scoped with him in
conversation on 11 November 2026. Two attachments informed it: Caro's current
monthly activity report (PDF) and a written description of their social
sign-off process. Neither is in the repository yet; see **Loose ends**.

**This file wins** over any implementation plan in `docs/omi/`. Where a plan
departs from it, the plan is wrong until Daniel says otherwise.

---

## Who, and what it replaces

Caro Communications is a communications agency in the built environment
sector. Daniel works there two days a week as Associate Consultant. OMI is
given to Caro at no charge; Caro carries its own running costs.

| tool | cost | notes |
|---|---|---|
| Sprout Social | **£9,210.66 / year** for 3 licences | Just renewed, so roughly 12 months of runway |
| Mailchimp | **~£6,000 / year** | Press release distribution, not marketing email. See below |

About £15,200 a year, but the cost is not the main fault. Three licences for a
team of about twenty means the tool is rationed, so most of the people who get
asked questions by clients cannot see the numbers that answer them.

Carolyn, the director, wants to see the team pitching rather than reporting.
That is the brief behind the brief. Every hour of manual reporting removed is
an hour of pitching returned.

---

## The priority: analytics first

Daniel, 11 November: "tiktok is not active for us at the moment, so lets bump
that to phase 2 or 3. i just need really good analytics because clients ask
lots of questions."

This reverses the first draft, which led with publishing. The reason the
reversal is right is commercial rather than technical: **analytics does not
need scheduling.** OMI can read Caro's accounts and produce reports while
Sprout carries on posting. That means parallel running instead of a cutover,
no risk to live client work, and value inside weeks. Sprout is cancelled at
renewal, not before it.

"Really good analytics" here does not mean more charts. A client asking why
August was worse than July needs stored history and a comparison that does not
reward tiny posts. OMI has neither yet, and both are foundations rather than
features.

---

## Deployment

- **Caro's own Hetzner server**, a separate deployment. Daniel: "no, i dont
  need to see their data from my login. in fact, i really shouldn't." One
  database per organisation, no cross-tenant query path, no row-level filter
  to get wrong.
- **Caro's own Claude API key and their own API spend.** `CLAUDE_API_KEY` is
  install-wide today, which suits this model exactly.
- **Promote by branch.** Caro deploys from a `caro` branch fast-forwarded from
  `main` when a feature is ready. October iterates on `main` and Caro never
  receives half-finished work. Daniel: "i'd love to iterate on my OMI and
  deploy when ready to theirs. not push half done work."
- **Module set chosen by toggles in Settings, not by environment variable.**
  Daniel, 11 November: "in the settings, can we have a way to turn on and off
  sections from the nav. so if caro dont want it all they dont have to." See
  the section below. Branding (logo, typefaces) by the settings table.
- Reached at `platform.octobercomms.com` for now.

`.github/workflows/platform-deploy.yml` pushes to a single `DEPLOY_HOST`. It
needs a second target keyed off the branch.

---

## The agency tier

OMI today has three roles, `admin`, `viewer`, `client`, and no tenant concept
at all (`middleware/auth.js`, `services/users.js`, `routes/users.js`). This is
new work.

| role | who | can |
|---|---|---|
| **Super administrator** | Daniel | configure the install, enable modules, see everything |
| **Administrator** | Caro | create and manage their own team logins, nothing about the install |
| **Team member** | ~20 Caro staff | the enabled modules, unrationed |

Unlimited team logins is a requirement, not a nicety. Rationing is the fault
being fixed.

**Caro's own clients never log in.** Magic link for sign-off, with the device
remembered so it is not a faff on every round. PDF reports by email. Daniel:
"magic link is probably ideal as passwords are a faff."

---

## Modules

**In:** dashboard, earned, shared, **paid**, biz dev, clients, database,
guide, settings.

**Out:** owned, convert, produce, accounts.

Produce is out because it is paused, not because Caro does not want it. When
it is ready it gets promoted like anything else.

**Paid is in, and paid social reporting lives in it.** Daniel, 11 November:
"paid social in paid actually so keep that." This revises the first pass,
which had Paid out and paid social folded into Shared. Meta only for now.

---

## Turning sections on and off in Settings

Daniel, 11 November: "essentially, in the settings, can we have a way to turn
on and off sections from the nav. so if caro dont want it all they dont have
to."

This replaces the environment variable in the first draft and is the better
answer, because it generalises: any install can hide what it does not use, and
Caro's module set stops being a deployment detail.

**Where it hooks in.** `frontend/src/nav/sections.js` is already the single
source of truth, 833 lines, deliberately literal, guarded by
`tests/sectionPanel.test.mjs` both ways: every tab a page accepts has a row,
and every row names a tab that page accepts. It has eleven top-level sections
keyed by leaf:

| leaf | shown as | Caro |
|---|---|---|
| `dashboard` | Dashboard | on |
| `pr` | Earned | on |
| `social` | Shared | on |
| `ads` | Paid | on |
| `biz-dev` | Biz Dev | on |
| `database` | Database | on |
| `settings` | Settings | on |
| `seo` | Owned | **off** |
| `convert` | Convert | **off** |
| `produce` | Produce | **off** |
| `accounts` | Accounts | **off** |

It also already has the mechanism. Rows carry a `when` that "gates a row on
the viewer, for the handful that are role- or grant-dependent", and `navCtx(user)`
is "the one place the viewer is turned into a ctx". So the work is to widen
`navCtx` to carry the install's enabled sections and gate the section itself,
not to invent a gate.

**Three things that have to be true, and the file's own history says why.**

1. **Hiding the nav row is not access control.** `sections.js` was written
   after a screen existed with no row and was unreachable; the opposite
   failure is a row removed while the route still answers, so a bookmark or a
   typed URL walks straight in. An off section refuses its routes as well as
   hiding its rows.
2. **The backend has to agree.** A section switched off in the browser whose
   API still answers has only moved the problem. The toggle is read
   server-side too.
3. **Anything that reads across pillars has to respect it.** The Strategist
   briefing pulls every pillar's overview report; on Caro's install it would
   quietly report on Owned and Convert, which are off. Same for any
   cross-pillar dashboard tile.

**Who can toggle.** Super administrator only, in the first cut. An agency
administrator turning a module off mid-month hides work their own team is
doing, and the failure would look like data loss rather than a setting. If
Caro want it themselves later it is a permission change, not a rebuild.

**The guard this needs.** `sectionPanel.test.mjs` currently proves every row
has a page and every page has a row. It should also prove that a section
switched off appears in neither the panel, the phone screen picker, the
command palette, nor its own routes. The file's header records three separate
occasions when two places disagreed about one rule; a fourth is avoidable.

---

## The four measured analytics gaps

Measured against the shipped tree on 11 November 2026. Recorded so the next
session does not rediscover them, and so nobody repeats the claim that the
reporting engine is finished.

**What is already good.** `services/socialBaseline.js` scores each post
against the median of that client's other posts of the same platform and
format, excluding itself, and returns a multiple. It refuses a cohort median
under five comparable posts, says so when it falls back to the whole account,
and withholds engagement rate under 100 reach rather than printing a ratio a
client might quote back. That is the statistical honesty this project needs
and it should not be rewritten.

**1. The report does not use the baseline.** `services/socialReport.js:264`
ranks posts by `interactions / reach * 100` and takes the top five as "best".
`socialBaseline` is not imported into that file. Its own header describes this
exact bias: three likes on ten reach scores 30% and tops the list, while a
reel that reached 40,000 and took 900 interactions scores 2.3% and sits at the
bottom. **So the best post in a client report is currently decided by the
smallest post.** Highest value fix in the codebase, and small.

**2. Nothing is stored.** `socialReport.js:242` fetches the account feed live
at report time. `social_post_engagement` (migration 026) is the right design,
one row per post per fetch, but only ever holds posts OMI generated: both
`INSERT INTO social_posts` sites require a batch (`social.js:273`,
`socialPublisher.js:454`). `paidOverviewReport.js` says the same of ads,
"there is no stored snapshot". No stored history means no month on month, no
quarter comparison, no year view. Every trend question a client asks is
unanswerable, and the Graph API's own retention window is the memory.

**3. No follower or audience data.** `socialOverviewReport.js` states it in a
comment: "it does not do a live account fetch (follower counts aren't
stored)". Audience growth is the first thing every client asks about.

**4. Organic reading is Instagram only.** `connectors/meta.js:230`
`fetchInstagramMedia` pages the media edge properly with reach, interactions,
saves and shares, and it is wired into the report. There is no equivalent for
LinkedIn, which has publishing through `ugcPosts` but no read path, and none
for Facebook Pages beyond `fetchFacebookPostEngagement` for a single post.
Caro needs LinkedIn.

---

## Mailchimp is press distribution, and Earned already replaces it

Daniel, 11 November: "mailchimp - we have press releases - this is it." So the
~£6,000 is a press release sending tool, not an email marketing programme.
That resolves what the first pass left open, and it resolves it in Caro's
favour, because the capability is built.

Measured in the tree on 11 November:

| what the job needs | what OMI has |
|---|---|
| A real bulk sender, not a personal mailbox | `outreachSender.js` sends through **Amazon SES v2**, with the SES SMTP transport as fallback. Credentials come from `getSetting('SES_ACCESS_KEY_ID')`, the settings table, so Caro's deployment uses Caro's AWS account and Caro's send costs |
| One-click unsubscribe, which Gmail and Yahoo require of bulk senders | Built, with HMAC-signed stateless unsubscribe URLs. The signature encodes the client, so a journalist unsubscribing from one client stays on the others. 365-day expiry |
| Audiences within one release | `pressSegments.js`: several named audiences per release (Workplace, Retail, Residential), each with its own subject lines, intro and follow-ups, the body and hero shared. Membership keyed on `(campaign_id, contact_id)` so nobody lands in two audiences, and an overlapping list is reported for the operator to resolve rather than silently moved |
| Bounce and complaint hygiene | `bounceHandler.js`, fed by the SES SNS webhook. A hard bounce or complaint suppresses the contact globally and cancels pending sends across every client. Soft bounces are retried, not suppressed |
| Drafting and client sign-off | `prPress.js`: Claude drafts the release, and a token-gated link lets the client approve without a login |
| The rest | Journalist matching and scouting, coverage extraction, link checking, thank-yous, attribution: `journalistMatch.js`, `prCoverageExtract.js`, `prLinkCheck.js`, `prThanks.js`, `pressAttribution.js` |

Mailchimp does none of the last two rows. It is a newsletter tool being used
as a press tool.

**Commercially this is the better saving to take first.** SES costs about
$0.10 per thousand emails, so a release to 500 journalists is about five
cents, against £6,000 a year. And unlike Sprout, nothing has to be built: the
work is setup rather than development, so it runs as a parallel track in
phase 1 and does not compete with the analytics work.

Three setup steps, none of them development:

1. **Caro's own AWS account, with the sending domain verified** and SES moved
   out of its sandbox. A new SES account sends only 200 messages a day, to
   verified addresses only, until AWS grants production access. This is the
   one external dependency on the whole track.
2. **Domain warm-up.** Mailchimp's shared IPs carry their own sending
   reputation; a fresh domain does not. Volume has to build over a few weeks
   or the first large release lands in spam. This is the real risk, and it is
   a scheduling matter rather than a technical one.
3. **Journalist lists imported** from Mailchimp. `pressImport.js` exists.

Run both in parallel for one release cycle before cancelling Mailchimp, so a
deliverability problem surfaces while there is still another way to send.

---

## Phases

### Phase 1: store it and score it honestly

The foundation. Nothing client-facing changes, and everything afterwards is a
query.

- Nightly snapshot job writing the **whole account feed** into
  `social_post_engagement`, not only posts OMI made. `fetchInstagramMedia`
  already returns the right shape.
- Post rows for posts OMI did not create. Both existing insert paths require a
  batch; this needs a third.
- Follower and audience counts in a new table, snapshotted on the same
  schedule.
- LinkedIn organic read, to the same contract as the Instagram one.
- Wire `socialBaseline` into `socialReport`.

Sprout untouched throughout.

**In parallel, and independent of all of the above: the Mailchimp track.**
Caro's AWS account, domain verification, SES out of the sandbox, warm-up,
lists imported, one release sent both ways. No development, so it competes
with the analytics work for nobody's time but Daniel's. It is also where the
first cash saving lands: about £6,000 a year, available in weeks rather than
at Sprout's renewal.

### Phase 2: answer the questions

- Weekly and monthly PDFs built from stored data. Daniel wants both cadences.
- The monthly activity report automated. It is manual today.
- Natural-language querying over the stored numbers, so an account lead can
  answer a client in the meeting rather than afterwards. This is what "clients
  ask lots of questions" actually asks for, and the Claude plumbing exists.

### Phase 3: scheduling and sign-off

- The approval pipeline below, replacing the six-step process.
- Publishing to Instagram, LinkedIn and Facebook Pages. Facebook Pages is
  cheap: same `connectors/meta.js`, same token as the Instagram Graph
  credentials already held.
- **This is the Sprout cancellation point**, and it has about 12 months.

### Phase 4: TikTok

Parked at Daniel's request. Worth registering the TikTok developer app during
phase 3 anyway, because an unaudited app can only post to drafts and the audit
queue is the one item on this project nobody controls. Registering early costs
nothing.

---

## The activity report, anatomised

Source: a Caro monthly activity report supplied by Daniel on 11 November and
read page by page. Seven pages, Caro's mark top left, the client's marks top
right. Client names, journalist names and the month's figures are deliberately
left out of this file; what a future session needs is the report's shape, and
the shape is below. The live example is one client running **three Instagram
accounts**, reported in **EUR**, which is the euro client already noted.

Section names below are theirs, not invented. This is what phase 2 reproduces.

### Pages 1 to 2: the activity table

One table, section headers in Caro's sand colour, in two shapes.

**Four-column sections** — Publication, Journalist, Publication Date, Activity:

| section | what it holds |
|---|---|
| **Published** | Coverage that ran. Print is marked in the publication name itself, as a `(print)` suffix, so the same title appears twice in a month when a piece runs online and in print. The Activity cell carries the hyperlink on an online row and the same text unlinked on a print one. Dates are `DD.MM.YY` |
| **Forthcoming Coverage** | Expected pieces. Dates are loose on purpose: a month with the issue in brackets, or `TBC`. **This section already exists in their report**, which settles the Readly replacement: the forthcoming-coverage tracker in this brief is what they keep by hand today, not a new idea being sold to them |
| **Media conversations** | Live approaches with no commitment. Every date `TBC`. The Activity cell reads like "keeping the opportunity warm". **This is the hide-from-client case**: a conversation Caro want on their own record but not necessarily in front of the client |

**Single-column sections**, free text, one row per line, no columns at all:

| section | shape of a row |
|---|---|
| **Communications Activity** | What the team did. "Issued [X] press release with new installation imagery" |
| **Account Management** | Servicing rather than press. Monitoring a shared inbox, sharing a strategy document, answering the client's questions |
| **Client Meetings / Events** | Date-prefixed **inside the text**, not in a column: `05.10.26 Weekly Meeting` |

### Pages 3 to 7: Social Media Statistics

**Every one of these is a screenshot pasted out of Sprout.** That is the
manual labour this project removes, and it is why the social half of the
report cannot be searched, totalled or corrected.

**The KPI table** (page 3), one row per account, four columns:

| Account | Projection for KPIs at the end of [year] based on this month's average growth rate | Instagram budget spent | Cost per profile visit gained from paid activity |
|---|---|---|---|

The projection cell holds the annual target in brackets followed by the
projected figure. Budget is a cash amount in the client's own currency, and
cost per profile visit is that budget divided by profile visits gained.

**Audience Growth and Net Audience Growth**, per account, carrying their own
footnote: "Note that the 'Net Audience Growth' percentage is measured against
total net followers gained in the previous month." Each block shows a
Reporting Period against a Compare To period, with four numbers: audience,
percentage change, net new followers, and the percentage change in net new
against the previous month.

**Top Performing Posts**, three per account, as Sprout cards: thumbnail,
caption opening, posted-by, timestamp, then **Engagements** with Likes,
Comments, Shares and Saves beneath it.

### What the report settles that conversation did not

1. **The projection is impossible without stored followers.** A projection to
   year end from this month's average growth rate needs a follower series and
   a per-account annual target. OMI stores neither. That is gap 3 with a
   consequence attached, and it also means an account needs a **target**
   field, which exists nowhere in the schema.
2. **So does the Compare To.** Every audience figure is stated against the
   previous month. Gap 2, concretely.
3. **Sprout's "Engagements" is exactly OMI's `interactions`.** Likes,
   comments, shares and saves, which is `interactionsOf` in
   `socialBaseline.js` verbatim. Figures stay comparable across the migration
   rather than needing an explanation, which matters when a client has twelve
   months of Sprout numbers in their inbox.
4. **Top posts are ranked by raw engagement count.** On one page that puts a
   small account's best post, in the low hundreds, beside a large account's,
   in the low thousands, as though the two were comparable. `socialBaseline`
   is the fix: "3.4x this account's own baseline" is both defensible and more
   use to a client who knows their own numbers and nobody else's.
5. **One client, several social accounts**, each with its own target and its
   own baseline. OMI's model runs client to posts. That has to be settled
   before phase 1 stores anything, because retrofitting an account dimension
   to a populated time series is far worse than starting with one.
6. **Paid and organic are already joined.** Cost per profile visit divides
   Instagram ad budget by an organic metric, in one cell. That is why paid
   social belongs beside the social reporting even though the module is Paid.

---

## Several social accounts per client

**Decided 11 November.** Daniel: "each client can have multiple social
accounts." This is settled, and it has to land before phase 1 stores a row,
because adding an account dimension to a populated time series is far worse
than starting with one.

### What exists today

- `connectors` has **no unique constraint** on `(client_id, connector_type)`
  and carries a `store_label`, so several connectors of one type per client
  already work. That is how a client with six Shopify stores is handled, as
  migration 216 records.
- **Instagram does not use that.** One Meta grant legitimately covers several
  Pages and their IG business accounts, and `preferredIgId`, a value in the
  connector's `config`, picks exactly **one**.
  `meta.js:407 pickPublishingTargets` throws if the saved selection is not
  found among them.

So the gap is at the account level, not the connector level. Duplicating
connector rows would duplicate one OAuth grant's credentials and triple the
token-refresh problem for no gain.

### The shape

A `social_accounts` table, one row per account, hanging off the connector that
authorises it:

```
social_accounts
  id            uuid
  client_id     uuid  -> clients
  connector_id  uuid  -> connectors        (which grant reaches it)
  platform      text                       instagram | linkedin | facebook | tiktok
  external_id   text                       IG business id, LinkedIn org urn
  handle        text                       the @name as the client knows it
  display_name  text                       what the report calls it
  is_default    bool                       replaces preferredIgId
  archived_at   timestamptz                an account they stop running
  UNIQUE (platform, external_id)
```

Then `social_posts` gains `account_id`. `social_post_engagement` is unchanged,
because it already hangs off the post. Follower history gets its own table
keyed on the account, which is also what makes the year-end projection
possible.

### The part that is easy to miss

**`socialBaseline` cohorts have to become `account|platform|kind`.** Today:

```js
const cohortKey = (post) => `${post.platform || '?'}|${post.kind || '?'}`;
```

With three Instagram accounts under one client, that pools every one of them
into a single baseline, so an account with tens of thousands of followers sets
the bar for one with a thousand, and the small account's posts read as
permanent failures. That is precisely the failure `socialBaseline.js` was
written to stop, arriving from a new direction: its own header says a post is
scored against "the median of the client's OTHER posts of the same platform
and format" because that is "the only comparison that survives an account with
800 followers sitting next to one with 80,000". Three accounts under one
client is that sentence again, inside a single client.

One line, and it must change in the same commit as the account dimension
rather than after it, or every baseline computed in between is wrong and
nothing says so.

---

## KPIs and targets

Daniel, 11 November: "maybe we add kpis?" then "yes to the targets table."
**Decided: `social_account_targets`, one metric to start.**

**Nothing exists today.** There is no KPI or target storage anywhere in the
schema. `kpis` appears twice and neither is this: a JSONB column on proposal
method templates holding prose commitments ("Two active initiatives a
quarter"), and a JavaScript object name in revenue reporting. Nothing holds a
number, for a client, against a date.

**What the report actually needs is one figure.** A follower target per
account per year, which is what "Projection for KPIs at the end of [year]" is
measured against. Cost per profile visit, the other number on that page, is
derived from spend and visits rather than set by anyone.

So the scope is one metric, in a table rather than a column on
`social_accounts`, because it costs three fields more and turns "add an
engagement-rate target" into a row instead of a migration:

```
social_account_targets
  id            uuid
  account_id    uuid  -> social_accounts
  metric        text          'followers' to start
  period_start  date
  period_end    date
  target_value  numeric
  set_by        uuid  -> users
  set_at        timestamptz
  UNIQUE (account_id, metric, period_start, period_end)
```

`set_by` and `set_at` are there because a target is a claim somebody made.
When a projection says an account will miss its year end by 1,700 followers,
the next question is who set 45,800 and when, and an unattributed number
invites the client to argue with the target instead of the work.

**Scope held at one metric.** A general KPI framework is the thing every
agency tool grows and nobody maintains, because targets that no report reads
go stale within two quarters and then mislead. One metric a report quotes
every month stays true. Add the second when a client asks, not in
anticipation.

---

## The social sign-off pipeline

**There is no written process to copy.** Daniel, 11 November: "i dont have the
step by step guide written up." So the account below is this file's record of
what he described, and it stands as the working version until corrected. It is
marked rather than presented as sourced, because the fault this folder exists
to prevent is a reconstruction quietly hardening into a brief.

**A document is not what is missing.** The shape of the six steps is known.
What cannot be inferred from it is six specifics, and each one changes what
gets built:

1. **Who does which step.** Account executive, designer, you. The OMI record
   needs to know whose turn it is, and a surface that does not say reads as
   a shared inbox.
2. **What the client is shown at once.** A month of posts, a week, or one at a
   time. This decides whether sign-off is a page or a queue.
3. **What "change this" does.** Back to the designer for a new visual, or the
   account executive edits the caption in place. One is a revision loop with
   states; the other is an edit.
4. **How many rounds a month normally takes.** Under two, version history is
   overhead. Over three, its absence is the complaint.
5. **Whether approval is per post or per month.** Their report runs monthly
   and Sprout schedules individually, so the practice sits somewhere between
   and only they know where.
6. **What happens when a client changes their mind after approval but before
   the post goes out.** This is the one that will happen in week one and the
   one a generic approval flow handles worst.

Ten minutes of answers beats a written process, and it should happen before
the pipeline is built rather than after.

Today it crosses six tools: planning in Google Sheets, visuals in Photoshop,
assets passed through Dropbox, captions in Google Docs, client sign-off by
email and document comments, then scheduling in Sprout. Each handover is a
place where the approved version and the posted version can differ, and
nobody can prove which the client agreed to.

In OMI it is one surface:

1. Plan the month against the client, in OMI.
2. Attach the visual. Produce is out for now, so assets are uploaded.
3. Caption and hashtags on the same record as the asset.
4. Send for client sign-off by magic link, device remembered.
5. Client approves, comments, or requests a change. Approval is **unlockable**,
   not binding; Daniel: "i think it can be unlocked."
6. Scheduled from the approved record, so the thing posted is the thing signed
   off.

**Reels take general comments in v1**, not timestamped ones. Daniel: "its ok if
its just general comments on the reels for v1."

---

## The coverage and activity tracker

The other half of the monthly report, and new work rather than a port.

One row per piece of activity or coverage, with a **hide from client**
checkbox per row. Daniel: "sometimes they want to record for themselves, but
not show a client they are in conversation." Note that `social_posts` already
carries a `show_to_client` flag (migration 229); the same idea, a different
table.

It also absorbs the Readly replacement. Rather than monitoring print, OMI
tracks **forthcoming coverage**: the expected outlet and issue date, and a
nudge to the account lead when that issue should have landed. A human then
checks Readly by hand. Daniel: "at the very least, i'd love an alert that a
piece is in print. that is the big win."

Caro currently relies on Google Alerts and someone noticing print by chance.

---

## Reports

- Both weekly and monthly.
- Emailed as PDF, with a link to an online version and a download option, in
  the shape of the existing press coverage report.
- **Each figure keeps the currency it was spent in.** One client is in EUR;
  everything else is GBP. No silent conversion anywhere.

---

## Decided against, with the reason

Recorded so these are not reopened without new information.

**Readly: scrapped.** Consumer terms restrict use to consumers for private,
non-commercial purposes (1.4), permit personal use only with no distribution
(9.5), and prohibit reproduction and distribution outright (9.2). Readly
**Pro** is no better: Article 6 bans use of "automated systems, robots, or
scraping processes to extract data from it for commercial purposes", and
Article 2 states "The Platform does not, in itself, constitute the Readly
Service: it is the administration tool for it", so there is no content API to
read even if the clause allowed it. Displaying rather than storing a PDF does
not change what the clause prohibits. Replaced by the forthcoming-coverage
tracker above. Caro may hold an NLA Media Access licence; Daniel is checking,
and that would cover cuttings but is a separate question from Readly.

**Postiz: no.** AGPL-3.0 is network copyleft, so incorporating its code would
force OMI open. Running it alongside behind a button recreates the split this
project exists to close: a second system, a second login, the Docs and Sprout
problem under new names. OMI already holds the analytics normalisation Caro's
reports need. Build the capability natively; do not take the code. (Earlier in
the conversation this was stated both ways; the position is the one here.)

**The eight public repositories assessed on 11 November: none adopted.** Four
were university or MITx coursework. One was a React dashboard shell with three
commits. One was a Reddit and X listening CLI, wrong networks and wrong job.
`cbsshekhawat18-lab/social-stats-social-media-manager` (MIT) is the right
shape and the wrong stack, Django against OMI's Node, no TikTok and no earned
side; worth reading its Meta and LinkedIn OAuth setup notes, nothing more.
`Matthew-Selvam/Open-Dispatch` (MIT) has TikTok and Facebook adapters on its
**roadmap**, not built, and its 318 tests run with no network access and no
real credentials. `ndesv21/socialclaw` is a client for a hosted service, so
the credentials would not be Caro's.

The general lesson, since more of these will turn up: scheduling is the easy
half, which is why 156 repositories carry that topic tag. None of them shorten
a platform audit, and a dependency in the publishing path that has never made
a real API call is a liability rather than a saving.

---

## Constraints that are settled

- One-off build, not a product line, for now.
- Caro pays their own running costs.
- Daniel cannot see Caro's data from his own login, by design.
- Caro's clients get magic links and emailed PDFs, never logins.
- Paid social is Meta only for now.
- Approval is unlockable.
- Currencies are never converted.

---

## Loose ends

1. **The sign-off specifics.** Six questions, listed in full in the pipeline
   section above. Not a document, six answers.

2. **Which networks beyond the four.** Instagram, LinkedIn, Facebook and
   TikTok are named. The example report is Instagram only. TikTok is phase 4.

3. **Caro's AWS account for SES.** **Not blocking, long lead.** It blocks
   sending a press release from OMI, which is the end of the Mailchimp track,
   and nothing before it. It is listed only because SES production access is
   a request with a queue in front of it rather than a setting, so it is the
   one item on that track running on somebody else's clock. Start it early for
   that reason alone.

   **Why their own account rather than October's SES.** Not cost: at $0.10 per
   thousand emails the money is pennies and "they pay their own costs" does
   not decide it. Reputation isolation does. AWS judges bounce and complaint
   rates per account and puts accounts with poor rates under review, so a
   press list that has not been cleaned in years should not be able to put
   October's own outreach at risk. Verifying Caro's domain inside October's
   SES would skip the sandbox wait and is the fallback if their own account
   stalls, at that cost.

### Closed, and why

**The NLA licence does not matter to this build.** It was listed as an open
question on 11 November and should not have been. Readly is scrapped, and the
forthcoming-coverage tracker that replaces it stores a publication name, a
journalist, an expected date and a note. None of that is copyrighted content:
OMI never holds, copies or distributes a cutting, so no reproduction right is
engaged.

The licence governs what Caro do outside OMI, which is photographing or
scanning a print cutting and sending it to a client. That is their existing
practice and their existing position, unchanged by anything here.

It becomes a live question again only if OMI is ever asked to **store cutting
images or PDFs**, at which point it is a hard blocker rather than a loose end.
Recorded here so the reasoning is on file when somebody proposes that feature.
