# Caro resource meeting, 16 November 2026

Full read of the recorded call, checked against the OMI tree. Where the call
raised something, this says whether it exists, what it would take, and what the
people in the room actually said about it, because their words constrain the
build more than any plan does.

**In the room:** Carolyn Larkin (director), Anna Scott-Mearns, Anya
Cooklin-Lofting, Tejal Dave-Biyani, Daniel Nelson. Laura is named as the person
who started this, having seen OMI over Daniel's shoulder the week before.

**Source:** `resource-meeting-2026-11-16-transcript.md`, 1,462 lines.

---

## 1. The commercial picture has changed

The brief was written against two tools. The call named a third, and it is the
one the team defended hardest.

| Tool | Cost | Position in the room |
|---|---|---|
| Sprout Social | £9,210.66 / year, 3 licences | "obviously we're very reliant on Sprout" (Anya) |
| Mailchimp | ~£6,000 / year | "Mailchimp, I can imagine us working away from" (Tejal) |
| **Roxhill** | **£6,891.00 + VAT / year**, renews January | "I'd be a little bit worried if we got rid of it" (Anya) |

**£22,101.66 before VAT, £26,521.99 with it**, against about £4 a month of
running cost.

> **Roxhill confirmed at £6,891.00 + VAT on 25 November 2026** (Daniel), £441
> above the top of the £6,000–£6,450 range given in the room. The renewal date
> is the part that moves the plan: January is too close for the parallel run
> recommended below to have concluded, so Roxhill renews for another year
> whatever happens, and the comparison proves itself against **January 2028**.
> Mailchimp stays the first saving because it is tied to no renewal date.

Tejal's summary is the one to work from: *"Mailchimp and Roxhill are the two
biggies… Mailchimp, I can imagine us working away from, whereas Roxhill, I'd
say, is kind of pretty valuable across the team."*

So the order of attack is Mailchimp first, Roxhill last, and Roxhill only once
it can be shown rather than argued.

### Why Mailchimp is the easy one, in their terms

Daniel explained the economics in the call and they land better than any
feature list: **Mailchimp charges for holding contacts; OMI charges for
sending.** His own install holds 19,000 contacts at no cost, and Amazon SES
sends a thousand emails for about ten US cents.

Carolyn's immediate response was the right question and it is not about price:

> "How do you cope with spam? Because I'm finding that Mailchimp is going into
> spam quite a lot now."

That is a deliverability problem she already has, and it does not go away by
changing tool. Sending reputation attaches to the domain. The honest answer
given in the call, and the one to build on, is multiple sending domains so a
soft block on one does not stop a release, plus blacklist monitoring. Worth
treating as a feature rather than a caveat: **Caro have an existing pain that
OMI can measurably improve, separately from the saving.**

---

## 2. Roxhill: three of its four jobs already exist

This was the part I expected to be hardest and it is not, because the media
database work was built for October over the past year.

| What Roxhill is for | What OMI has today |
|---|---|
| **Finding new contacts** | `services/journalistScout.js` — researches the open web on a schedule for journalists covering a client's beats who are **not** already in the database, with provenance, into a review queue. A human approves every one before it becomes a contact. |
| **Keeping records true** | `services/pressMediaResearch.js` — checks each contact's recent bylines: still writing, moved outlet, or gone quiet. No byline in about six months flags for archiving; found at a new outlet proposes the move. |
| **Who do I pitch this to** | `services/journalistMatch.js` and `services/prTarget.js` — rank contacts against a specific release by beat, recent headlines and prior coverage of that client. |
| **Finding newly launched publications** | **Nothing.** `services/outletResolve.js` resolves publications already known; it does not watch for new ones. |

Tejal named Roxhill's real value precisely: *"journalists register themselves
onto it. So there's an element of like getting that most up to date data across
like global journals."* That is the freshness problem, and
`pressMediaResearch.js` attacks it from the other direction, by reading what
people actually publish rather than waiting for them to update a profile.

Anya named the gap just as precisely: *"it's really good for existing media
contacts in new media… you've got this niche magazine and a new territory."*
**New outlets in unfamiliar territories is the one job OMI cannot do today.**

Daniel's own answer in the call is the right shape: he already mines Instagram
daily for new accounts on a topic, and uses it to find architects by city for
new business. Pointing the same technique at new mastheads, new titles and
newly launched sites in Caro's sectors is a much smaller job than building a
journalist database, because the database exists.

**Recommendation.** Do not propose dropping Roxhill. Build the new-publication
watch, run it alongside Roxhill for a quarter, and let Anya and Tejal judge
whether it finds what Roxhill finds. If it does, the saving makes itself. If it
does not, Caro keep Roxhill and have lost nothing.

---

## 3. The seven requirements from the call

### 3.1 Outlook, and reading conversations into the report

**The largest time saving named by anyone in the call.** Anna:

> "The most involved element of our reporting process is kind of re-going
> through the last month's worth of conversations really."

What exists: the mailbox machinery is built and running on October's install.
It reads connected inboxes, matches senders against the contact database,
catches up on replies, and already harvests new contacts out of out-of-office
replies. `services/mailboxOauth.js` is **Google only**; Microsoft Graph is a new
provider inside an existing system rather than new infrastructure.

What the call added:

- **Pull everything, choose what to include.** Daniel: *"we'd have to have it
  where it pulls everything and you can choose what to include."* Anna agreed it
  would need "a thorough sense check". So the output is a candidate list for a
  human, never an automatic insert.
- **Privacy inside the team was raised and settled.** Daniel asked whether
  pulling the full email body was too much. Anya: *"I don't think any of us feel
  too precious about keeping conversations with media private. Mostly our
  aliases are copied in, you know, client aliases. So there is visibility across
  the team in that way."* Build it reading full bodies, with internal mail
  ignored.

### 3.2 Logging calls and meetings, and what "warm" means

Anya made the sharpest product point in the call:

> "I wouldn't want a journalist to be considered like not warm in that ranking
> system, because they haven't responded directly to a press release… it might
> be that there's been a phone call or a coffee."

And then the one that makes it a feature rather than a field:

> "If Anna and Sylvie go and meet a great architect journalist, but it's
> actually relevant to a couple of the design clients… maybe there's a way of
> tagging a journalist to say that that conversation was relevant to XYZ
> clients."

So one logged interaction has to do three jobs: appear in **several** clients'
activity reports, update that journalist's **warmth**, and record who at Caro
had the conversation. She explicitly accepted manual entry for these: *"we're
very happy for those kind of things to be manual."*

This is new work, it is small, and it is the thing most likely to make the team
feel the tool was built for them.

### 3.3 Activity reports that are editable before they send

Daniel described the principle in the call and it should be the rule for the
whole product:

> "How much can I fill in and then leave it editable bits so that then if it's
> not perfect, you can still change it, but at least it's saved 80% of your
> time."

Today reports generate and send. Required: generate, hold in a draft state,
allow edits and added commentary, then send. A state change plus an editing
surface.

### 3.4 The drag-and-drop email builder

Daniel's own verdict while demonstrating, having opened the HTML editor:

> "That's not helpful. You want it as drag and drop because that's going to get
> messy quickly."

Tejal had asked directly, comparing to Mailchimp: *"we would click and drag text
boxes around."* This is the one item on the list that is a genuine build rather
than wiring, and it is table stakes for replacing Mailchimp with people who are
used to Mailchimp.

### 3.5 Three ways to start a campaign

Settled in the call: from a **URL**, from a **PDF or DOCX**, or **blank**. URL
and blank work today. Document upload is a parser in front of an existing path.
Every campaign then opens in the builder above.

### 3.6 The Google Sheet mirror

Anya's concern, and Carolyn's "in an age of cyber attacks" agreement:

> "If we put all of our eggs in the dashboard basket and then God forbid
> something happens to it… basically our entire kind of network of activity."

Daniel's answer, which is the specification:

> "Permanently syncing with a Google sheet that's sort of hidden away on a
> server so that we wouldn't access that, but it's there in case the website
> goes down."

**One-way export, several tabs, not a working surface and not two-way sync.**
Much simpler built that way and much worse built as sync. Contacts, coverage,
campaigns, activity.

Note that this is a *second* line of defence. The Hetzner server takes daily
backups, which is the actual recovery path. The sheet is for the case where
nobody can reach the app at all.

### 3.7 Maternity leave, and the database that maintains itself

Daniel raised it as something he wants and has not built: a contact on
maternity leave pauses for a year, then reactivates. Alongside the out-of-office
harvesting that already works, and the bounce suppression that already works,
this is the theme he named as the origin of the whole product:

> "How to make the PR job a bit easier, all the manual bits of it, so that then
> you could spend more time pitching and less time updating a database."

That sentence is the pitch for the whole project and it matches Carolyn's goal
exactly.

---

## 4. Anna's question, which is the most valuable thing in the call

> "It's kind of not unusual for clients to ask in what way we would use AI… in
> their contract they want really clear parameters around our use of AI to
> protect their sensitive information. Is it drawn from an open model?"

Daniel's instinct in the room was right and under-sold:

> "It's quite nice anyway to almost explain it because it makes us look like
> we're really… it can go into contracts or even proposals."

Anna finished the sentence: *"experts."*

**This is not a compliance chore. It is the most differentiating thing either
agency has.** Most PR agencies either use AI and say nothing, or ban it and say
nothing. An agency that can hand a client a plain-English document saying
exactly which tasks touch a model, which never do, where the data goes and what
is contractually prohibited is doing something almost nobody in the sector is
doing.

Written up separately as `docs/omi/ai-data-policy.md`, because it serves both
October and Caro and because it needs to be good enough to put in front of a
client.

### What already exists to build it on

`services/aiModels.js` is further along than the call suggested. It carries a
per-feature routing map where **every feature is flagged `sensitive: true` or
`false`**, and DeepSeek is labelled in the code itself: *"Data is sent to
DeepSeek — avoid for client data."* Report narratives, executive summaries,
strategist briefings, strategy tailoring and client briefing research are all
flagged sensitive. Social captions, social planner, social audit and ad creative
are not.

So the mechanism exists. What is missing is the document, and one feature
Daniel named in the call:

> "What maybe needs to be added in is a way to restrict a particular client if
> they don't want, so to turn off AI features on a client."

**A per-client AI switch.** Small, and it is what converts the policy from a
description into a promise that can be kept.

---

## 5. Things said in the call that constrain the build

Collected because they are easy to lose and expensive to rediscover.

| Said by | What it constrains |
|---|---|
| **Daniel** | *"Make this feel quicker than spreadsheets and it will get people off spreadsheets. Rather than being like, you've got to use that."* Adoption rule for the whole product. |
| **Daniel** | *"If everyone is like, oh, could it just do this? Then the answer is usually yes, which is what all these other tools can't say, because they've got their own roadmap."* The actual competitive advantage over Sprout, Mailchimp and Roxhill. |
| **Carolyn** | *"We should be the people that are ahead of the game."* Why the AI policy matters commercially. |
| **Tejal** | Press lists live in Google Sheets and are continuously populated. She wants them migrated and tagged, *"something that's a bit more of a CRM like piece"*. Overlaps the Roxhill work; `services/pressImport.js` exists. |
| **Anya** | *"TMI"* on client logins — confirms clients get coverage reports and social, never the platform. |
| **Daniel** | The hide-from-client flag's real purpose: *"if you started to have a conversation and then the client gets a bit overexcited about seeing a name on that list and you're like, it's just early days."* Not secrecy, expectation management. |
| **Anya** | Readly is used across the team. Confirmed scrapped for automation in the call on its terms; manual logging stays. |
| **Tejal** | Mailchimp is used for *"a bigger press release moment or a larger campaign or invitations distribution"*; pitching happens separately in Outlook. Two workflows, and the call's enthusiasm was for OMI blending them. |

---

## 6. What the call did not settle

1. **The six sign-off specifics** from the brief are still open. Not discussed.
2. **Which networks beyond Instagram.** Not discussed.
3. **Whether Caro want the Google Sheet mirror read-only**, as described, or
   something more. Worth one sentence from Anya to confirm.
4. **Roxhill contract timing.** Daniel said he would speak to Cheryl. When it
   renews decides how much runway the new-publication watch has.
**Carolyn's spam and deliverability problem is out of scope.** Daniel, 17
November: "ignore carolyn's deliverability issue." It was listed here as worth
its own look; it is not part of this project and should not be raised again.
Her remark stays recorded above because it is what she said in the call, not
because anything follows from it.

---

## 7. What changes in the plan

- The brief's two-tool saving becomes three tools, about **£21,200 before VAT**.
- **Roxhill moves from "not considered" to a staged, provable replacement**,
  with the new-publication watch as its one piece of new work.
- **Outlook and conversation capture move up.** Anna named it as the biggest
  single time saving, and it feeds the activity report, which is the thing
  Carolyn wants to stop the team doing.
- **The AI data policy becomes a deliverable in its own right**, for October as
  well as Caro.
- Seven requirements join the brief: the builder, the three campaign starts, the
  editable report, Outlook capture, interaction logging, the Sheet mirror, and
  the per-client AI switch.
