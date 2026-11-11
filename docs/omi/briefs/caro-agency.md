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
- Module set chosen by environment variable. Branding (logo, typefaces) by
  environment or the settings table.
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

## The social sign-off pipeline

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

1. **The two source attachments are not in the repository, and this is the
   one thing blocking the next step.** Needed:
   - **Caro's monthly activity report**, the one produced by hand today, as
     the PDF or a link to the live document. Phase 2 automates this report,
     and automating it means reproducing its sections, its order and the
     figures it quotes. Without the artefact that is guesswork.
   - **The written sign-off process**, so the six steps are canonical rather
     than reconstructed from conversation, which is what the list below them
     currently is.

   Both should land in `docs/omi/briefs/` beside this file, for the reason
   this folder exists: a conversation attachment is invisible to the session
   after the one that saw it.

2. **The NLA licence.** Daniel to confirm what Caro holds. It covers cuttings
   and is a separate question from Readly.

3. **Which networks beyond the four.** Instagram, LinkedIn, Facebook and
   TikTok are named. Daniel asked for the options explained before deciding;
   TikTok is now phase 4.

4. **Caro's AWS account for SES.** See Mailchimp above. Needed before any
   press release sends from OMI, and the only item on that track with an
   external dependency.
