# The 31 October review: triage and direction

Sixty-one items across nine sections, from the account lead's page-by-page
pass. This is the triage before building, in the same shape as the Paid review
on 30 October: what each item is, what it costs, where I disagree, and the
order I propose.

Effort is per item, assuming it is built to the standard the Paid pass was
(verified in the browser, mutation-tested where there is a guard):

| | Meaning |
|---|---|
| **S** | Under an hour. A style, a label, a layout rule. |
| **M** | A few hours. A page reshaped, a field added, a route moved. |
| **L** | Most of a session. A new page, a new table, a new flow. |
| **XL** | Several sessions. A product in its own right. |

---

## Already done, today, without waiting

**A client's name was leaking to other clients.** Three placeholders named
real clients and a placeholder renders for anyone who opens the screen,
including a client login:

- `PressReleaseEditor.jsx` — "e.g. Forgeworks unveils House of Wood Shingle"
- `ClientPRPage.jsx` — the Google News query example
- `IgOutreachPanel.jsx` — "inviting them to exhibit at Atlanta Design Festival
  (Sept 26–Oct 4)", which the review did not catch

All three now use invented names. Code comments naming clients are left alone;
they are not rendered.

---

## Decisions taken, 31 October

Asked as four questions, answered by the account lead:

| Question | Decision |
|---|---|
| Nine setup scans | **Show the nine with their prices and run the ticked ones.** Setup stays cheap by default and says what each scan costs, the way the Paid Brief step now does. |
| The social report | **Downloadable first, covering OMI and connected accounts.** Meta and LinkedIn insights for connected accounts whoever published the posts, plus Claude's read on what worked. Scheduling follows once the content is right. |
| The video editor | **Scope the timeline properly before any build.** A spec saying what it does, what it costs in sessions, and what it replaces. No code until that is read. |
| Deletions | **Earned Measure: delete.** **Shared autopilot: delete.** **Hook vault: keep, on its own page, with a clear explanation and example content** — the problem is that it was never explained, not that it should not exist. *(Both deletions were revisited later the same day, once the explanations existed, and both answers changed. See "Decisions resolved" at the end.)* |

The hook vault answer is worth noting for the next agent: "I have never
understood it" was read here as a case for deletion, and the account lead's
call was the opposite. A feature nobody understands may be unexplained rather
than unwanted, and the cheap fix is to explain it.

## Group 1 — Bugs, not design

These are not preferences and do not need a decision. Four of the review's
items are the same root cause.

### 1.1 Expired provider media (L, and it is the same bug fixed this morning)

The review reports three symptoms:

- "The old avatar reels I made aren't showing anymore, they are blank videos
  and the open in new tab says access denied."
- Trending sounds: "clicking the sound opened a page access denied."
- Produce: "That clip is not on this server any more."

`heygen.js:332` stores HeyGen's own `video_url` on the row. Those are
presigned links that expire, so the record survives and the file does not.
Trending sounds store TikTok CDN links with the same lifetime. This is exactly
the fault fixed for ad creative in PR #1872, and `services/generatedMedia.js`
already does the work: fetch the bytes when the render completes, keep the
provider link in `source_url`.

**The rule this creates, now written in the agent guide:** if a provider
returns a URL, OMI stores the file. Anything else is a record that rots.

The clip message is the honest half of the same problem: the editor refuses a
source it cannot open rather than failing later. Once reels are stored, that
path mostly stops being reachable.

### 1.2 Biz dev → Leads: the "All leads" button goes to a blank page (S)

Reported with a URL, so reproducible. Likely the same class as the
`screenForPath` fault found on 30 October: a link generator that no longer
matches the route table.

### 1.3 Earned → Coverage: the sort control wraps (S)

The fix the review proposes (move search and sort to their own row) is the
right one.

### 1.4 Search misses most of the platform (M)

"I typed n8n and it found nothing."

Correct, and the reason is in `routes/search.js`: search covers eight record
tables plus the 91 screens from `nav/sections.js`. A settings field label like
n8n is neither. Nor are connector names, ad sizes, or anything else that lives
in a constant rather than a table.

Fix: index the settings catalogue, so every credential and connector is
findable by name and lands on its settings screen. That is where someone
typing "n8n" or "Moz" or "Stripe" is trying to get to.

### 1.5 Biz dev → Tenders: the list is empty (M to diagnose)

What the code does: free API feeds (TED, SAM.gov, CanadaBuys, UK portals)
ingest daily at 06:30; the one paid source, web search, runs Mondays at 06:35.
Notices already past their closing date are skipped at ingest, so nothing
accumulates.

An empty list is therefore either no matches against the CPV codes in
`tender/config.js`, or an ingest that is failing quietly. I cannot tell which
from here: it needs the production logs and a count on the table. One session
to diagnose and report, before any work on it.

**What it costs:** every tender run logs to `api_cost_events` under features
starting `tender_`. The real figure is on the Costs page filtered by feature,
and I would rather read it than estimate it.

---

## Group 2 — The design-system sweep

Twenty-one items that are all the same job: the house style exists, and these
screens predate it or drifted. Individually S, collectively most of a session,
and best done as one pass rather than one at a time.

| Where | Item |
|---|---|
| Earned → Coverage | Publication and journalist modals to 80% width |
| Earned → Monitor | RSS field wider, query field narrower, Add search aligned to the row |
| Earned → Releases | Writing standard into the drawer; All releases top-left with a back arrow; release title larger |
| Earned → Match | Find journalists button below both fields |
| Owned → Fix | Done and Skip buttons onto the house styles |
| Owned → Fix | CTR boost rewrite button onto the house styles |
| Produce → Record | Remember last-used settings; Import from Loom into the drawer; drop the client chip; rename as a pencil icon; Open as the yellow button |
| Settings → Connections | Drop the boxes and the collapse now that nothing is collapsed |
| Settings → Tools | Strategy templates full width, or 50/50 with the editor |
| Settings → Account | Security full width |
| Database → Journalists | Cleanup Centre into the drawer |
| Database → Publications | Same layout as Journalists |
| Search | Bigger search box |
| Earned → Campaigns | Backlink attribution as a row, like the Earned contribution line |
| Earned → Campaigns | "Set up & send" becomes "Build", beside "Back to campaigns", with "Results" next to it |
| Earned → Campaigns → Results | White backgrounds on the boxes; bentos like the Paid pages |
| Shared → Create | Brief field 100% wide, options beneath |

The last four are Campaigns, which the review calls "a really messy design".
They are listed here because each change is mechanical, but the page needs the
reshape in Group 3 to make sense.

---

## Group 3 — Naming and information architecture

These need decisions because they move or delete things.

### 3.1 Pages that should merge or move (M each)

- **Shared → Discover into Capture.** Agreed: it is a loose page.
- **Earned → Match above Find.** Agreed: you match before you search.
- **Earned → Contacts: thank-yous onto their own page after Campaigns.**
  Agreed.
- **Convert → CRO renamed Optimise.** Agreed, and the deeper point is the real
  one: funnel health says nothing useful for Falcon because it has too many
  sites, so the page needs a site selector before it needs a new name.
- **Settings → "Other".** The review's own rule applies: "if you can't name
  something, it shouldn't exist". Breaking it into individual pages is the
  right call. Space is not scarce in a left-hand nav.

### 3.2 Settings restructured (M)

Proposed, from the review: a **Costs** section above **Connections**, holding
Usage (renamed from Costs & usage) and Models; **AI** split into Models and
Connections. That is coherent: spend control in one place, credentials in
another.

### 3.3 Nav labels that disagree with the page (S)

Shared → Create is called Ideas in the nav and Create in the step rail. One
vocabulary, as `sections.js` already enforces for slugs. The review also asks
whether the first step is "Generate", which it effectively is.

### 3.4 Earned → Measure (M) — superseded; see "Decisions resolved" 

The review says: "I don't think we need this, it can be added to each campaign
results page."

I agree, with one caveat worth stating: a per-campaign results page answers
"how did this campaign do" and cannot answer "how is Earned doing for this
client this quarter". If that second question never gets asked, deleting is
right. If it does, it belongs in the client report rather than its own page.

### 3.5 Email as a section (M)

Convert → Email: "I'm not sure where to start and what I'm achieving here."
That is the real finding. The proposal (make Email a section with its steps in
the nav, and Find leads its own page) fixes the navigation but not the
confusion. The page needs what the Paid Brief step got on 30 October: a line
saying what comes out of it.

---

## Group 4 — Shared → Capture and Create

### 4.1 Reddit: subreddits first (M)

"Without knowing the subreddit, it's hard to know where to start." Right:
Suggest subreddits is the real first action, so it belongs in setup, and the
result should be a table with focus, window and research per row rather than
chips. Chips were the wrong shape for something you then configure.

### 4.2 Review: edit the text, and control what the client sees (M)

The same three fixes the Paid pass made, applied to Shared:

- Edit the text directly, not only through Claude. (`ConceptEditModal` already
  does this for Paid and can be reused.)
- The approval mockup should look like the platform, with chips to switch.
  (`AdPlatformPreview` already does this and can be reused.)
- Uncheck posts the client should not see, and have that filter the next step.
  (Migration 222 did this for Paid.)

Three of the four Shared → Review items are therefore cheap, because Paid paid
for them already.

### 4.3 Produce: the step is the wrong way round (L)

The review's reading is correct. Produce currently offers an avatar reel or a
schedule, with no way to take a post idea into production. The proposal, which
I would build as stated: the checked posts from Review appear on Produce with
the production options on them, the production options come off the Review
step, and "refine with Claude" on Review becomes the produce action on
Produce. New avatar reel becomes one option among several rather than a
separate button.

### 4.4 Schedule and autopilot (M)

**How autopilot works, since the review asks.** `scheduler.js:362` runs every
five minutes, picks up any plan whose `scheduled_at` has passed, and publishes
it to its target platforms (Meta today). At 08:00 it emails a digest of
yesterday's publishes. It is idempotent, so a failed row retries and a
published one is skipped.

The review has never used it. I think removing it is right, and the Paid
precedent is the argument: Launch stopped promising an API launch it did not
have and became a download. The same move here is download the assets and
schedule them yourself. What that loses is the only unattended path in the
platform, which matters to nobody who does not use it.

---

## Group 5 — The social report (XL)

Four of the review's items are one product:

- Shared → Measure → Review: "this would be amazing if it could pull in data…
  I'd love to build a social media report I can download and send to clients,
  or schedule and send to clients."
- Shared → Measure → Learn: "Claude analyses all posts that month, what data
  it can pull, what worked, what didn't, what to do more of… monitor social
  network news RSS so it can suggest things based on new features."
- Shared → Measure → Improve: "this is all the same report really."
- Shared → Measure → Compare: competitors in setup, trending sounds weekly,
  sounds playable inline with the search term to find them.

The review's own conclusion is the right one: Measure, Learn and Improve are
one live report, not three pages. That report is the biggest single thing in
this review and the most valuable, because it is the one item a client sees.

Two things have to be settled before it can be built, and both are questions
about data rather than design:

1. **Where the numbers come from for posts not published through OMI.** Meta
   and LinkedIn give page-level and post-level insights for accounts OMI is
   connected to, whoever published them, so that part is reachable. TikTok and
   Instagram organic are harder and in places impossible without the client's
   own login.
2. **Whether it is a download, a scheduled email, or both.** The existing
   report machinery already renders and sends, so reusing it is cheaper than a
   new path.

Hook vault: the review has never understood it. I would delete it rather than
explain it. A feature that needs explaining to its only user is not earning
its place.

---

## Group 6 — One-click setup

Nine items ask for a scan to run at setup: subreddits, competitors, AI SEO,
Local gap, schema, keyword sniper, business X-ray, GBP playbook, ranking
outliers.

**This is one decision, not nine, and it is a cost decision.** Today setup
seeds four worked examples and costs a few pence. Each of those scans is a
paid API call or a Claude run. Turning setup into nine scans means a new client
costs real money on the first click, with no way to tell which of the nine the
account lead actually wanted.

Three options:

| Option | What happens |
|---|---|
| **All nine in setup** | One click, everything populated, highest cost per client, some of it wasted |
| **Pick which** | Setup shows the nine with prices and runs the ticked ones |
| **Free ones only** | Site scans that cost nothing run automatically; paid ones stay on their page |

My recommendation is the middle one. It matches how the Paid Brief step now
names what each button costs, and it keeps the spend controls meaningful.

---

## Group 7 — Produce and the video editor

### 7.1 Make a reel becomes Video, and the page becomes an upload (M)

Agreed, including the reasoning: "See the same reel in six styles" needs
content before it can do anything, so the page should open with a drag-and-drop
that takes many clips at once. Those clips then feed everything else.

### 7.2 Edit, and the CapCut question (XL, and not with those repos)

The review asks whether an entire editing suite can be imported, and lists
four repositories. I checked all four:

| Repo | What it is | Usable here |
|---|---|---|
| WeftCut (294★) | Electron desktop app, MCP-driven | No. Desktop, not a browser component |
| free247editor (157★) | An agent skill; you type "edit this" in a terminal | No. There is no timeline UI |
| Kiwi-Edit (331★) | Python research model, instruction-guided editing | No. Needs GPUs, has no interface |
| storytold/filmcraft | Not discoverable through the API | Could not verify |

None of them is a drop-in web editor, and two are not editors at all in the
sense meant. A CapCut-like timeline inside OMI is a browser NLE: a canvas
timeline, frame-accurate seeking, and server-side rendering of the result.
That is weeks, not a session, and it is the single most expensive thing in this
review.

The honest alternative, and what I would do instead: the current Edit page
fails because it does not say what to do. The review's own account describes
it exactly ("there is only a render button… it just generated the exact same
video"). Making the existing trim-and-assemble flow legible is a session.
Building a timeline is a project to scope separately, if at all.

### 7.3 The other two links (S to answer)

`freeapihub.com` Stable Video Diffusion and the `JustRin` mirror: Stable Video
Diffusion generates short clips from a still. OMI already does that through
Replicate on the Paid video path, with cost logging and a known provider. A
third-party aggregator fronting the same model adds a dependency and a bill
nobody can audit, for a capability already present.

`lucasmarkes/hairline` for carousel graphics could not be verified either.
Carousels are worth building; the Resize engine already composes images at
fixed sizes and is the natural base.

### 7.4 Library (M)

Missing items that Design has, and offering "cut pauses" or "plan B-roll" from
the wrong place. Both are real; the second is a good feature filed under the
wrong noun.

---

## Group 8 — Owned, and the smaller answers

- **Authority fetch timing.** The review asks whether it fetches monthly on
  the last day, ready for the report on the 1st. It should, and making that
  explicit is S.
- **Local, Gap, Schema and the rest** are the Group 6 decision.
- **Database → Publications**: the review asks how "find websites and feeds"
  works and whether it needs a selection. Answering that in the UI is the fix:
  a button whose behaviour has to be guessed is a button that does not say
  what it does.
- **Earned → Find**: the review asks whether it adds to the main database or
  only the client. It writes to the shared contact tables and links the
  contact to the client through `outreach_contact_clients`, so the answer is
  both, and the screen should say so.
- **Earned → Contacts** should get the database's own find, sort and edit.
  Agreed, and it is the same components either way.

---

## Proposed order

1. **Group 1, the bugs.** Expired media first, because it is live breakage on
   work already paid for, and the service to fix it already exists.
2. **Group 2, the design sweep.** One pass, cheap per item, and it makes every
   screen in the review look deliberate.
3. **Groups 3 and 4, naming and Shared.** Three of the four Shared → Review
   items reuse what Paid already built.
4. **Group 6 decided, then applied.** One cost decision unblocks nine items.
5. **Group 5, the social report.** The most valuable, and the one that needs
   its data questions settled first.
6. **Group 7.2, the editor.** Scoped separately or not at all.

Groups 1 to 4 are roughly three sessions. Group 5 is two or three on its own.
Group 7.2 is weeks and I would not start it on this evidence.

---

## Decisions resolved, 31 October (end of the build session)

Three items were put back to the account lead with the explanations they had
been decided without. Two are now answered and built; the third is still open.

### 1 · The Shared autopilot — **kept, off by default**

The 31 October table recorded "delete", but that answer was given before the
answer to "how does it work?" existed. With the explanation in front of him —
a cron every five minutes, ~3 Claude calls per plan at publish time, the
client's Meta and LinkedIn credentials, media reaching Meta through a signed
URL on OMI's own domain on a 24-hour TTL, ~1,030 lines across
`socialPublisher.js`, `socialPlanner.js` and `socialDrive.js` plus two tables
— the call changed: **keep it, and let no client be on it unless that is a
deliberate choice for that client.**

Built. `clients.social_autopilot_paused` defaulted to `false`, which is to say
live, so every client created since migration 046 was on a cron that posts to
Instagram, Facebook and LinkedIn without anybody clicking go. Migration 227
flips the default to `true` and pauses every existing client. Nothing that was
deliberately live was switched off: the autopilot has never been run. The
screen stopped treating off as a fault — a warning callout on every client by
default trains people to ignore callouts — and the toggle now says what it
will do ("Let it post automatically") rather than "resume".
`tests/autopilot-off.test.js` is in CI and holds the default, the publisher's
filter, and the screen's wording.

The batch download (PR #1881) remains the way Shared is actually worked, and
the Schedule step says so.

### 2 · Earned → Measure — **the total folded into Coverage, the screen gone**

The 31 October table recorded "delete", which would have lost the one number
only that screen held: backlink value **across** campaigns. The call was to
fold it in rather than lose it.

Built. `PrBacklinkTotal` puts three tiles at the top of Coverage, where Earned
opens: outlets that linked back, outlets approached, hit rate, with one line
saying what counts and that per-campaign detail is on each campaign's Results.
The Measure group, its Reports row and `PrBacklinkRoi` are deleted. The figure
is `pitched_rds` — a domain matching an outlet the campaign emailed, first
backlink within 21 days — and the drive asserts the whole-site domain count
(the old headline, which once read 939 for one release) is not on the tiles.

### 3 · The Shared Create row names — **still open**

Every row in the Create group is named differently from the step it opens:

| Nav row | Opens |
|---|---|
| Ideas | 1 · Create — *Brief & generate* |
| Brief | 2 · Review — *Refine your posts* |
| Workbench | 3 · Produce — *Make the assets* |
| Schedule | 4 · Schedule |

Only Schedule agrees, and "Brief" names a row while also being half of a
different row's subtitle. That is why the review asked "is this first step
Generate?" — it is; step 1 is "Brief & generate".

Naming the rows after their steps fixes it, **except** step 2 is called Review
and Measure already has a row called Review at slug `review`. Two screens in
one section both legitimately called Review is the real problem, and choosing
the replacement names is a product decision. Not one to make on inference.
