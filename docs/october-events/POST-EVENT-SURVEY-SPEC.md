# Post-event survey — spec

Status: spec (approved to build after review). Owner: Daniel.

> **Requirements input (ADF Conference, Daniel ↔ Elayne).** A planning chat set
> concrete asks: a 1–5 rating on each session with a comment box; "Why do you
> attend the Conference?" (choice); "Do you stay the entire day? If not, why?";
> three forward-looking open questions (content gaps, speakers/voices wanted,
> one format change); and a testimonial/quote ask ("leave a statement we can
> use"). Delivery could bundle the survey with the tour ticket, incentivised by
> a discount, and Daniel wants the trigger to be reusable across **all** events,
> set once and sent automatically. These are folded in below (§4a profiles, §5
> new types, §8a delivery, §14 worked example). The one real conflict — this
> list is ~2× the four-question pulse cap — is resolved by profiles, not by
> quietly dropping the cap; see §4a.

## 1. Why

Close the loop after an event. Get a small amount of honest, useful feedback the
day after, while it's fresh, from the people who actually attended. Two payoffs:

- **Improve the events** (the organiser and October learn what to change).
- **Keep the attendee relationship warm** (a short, well-made touch, plus a
  reason to come back via the incentive).

The bar is a form people finish in under a minute on their phone, and questions
worth answering. No vanity questions, no ten-field grid.

## 2. Goals and non-goals

**Goals**
- Per-event, opt-in survey: turn it on for the events worth surveying, leave it
  off for the rest.
- Very short, mobile-first, big-button form. Feels like a few taps.
- Sent automatically the day after the event, once, to the attendees we hold an
  email for.
- Claude drafts the questions (tuned for response quality), the admin edits.
- One capped incentive code per survey, revealed on completion.
- Responses stored, with per-question graphs and a CSV export.

**Non-goals (v1)**
- Not a general form builder. Fixed set of question types (§5).
- Not for link-out events — see §3.
- No cross-event benchmarking dashboard yet (single-event results first).
- No per-respondent unique codes in v1 (one capped code per survey — decided).

## 3. The hard constraint: who can be surveyed

A survey can only go to attendees whose email we hold, i.e. events **ticketed or
RSVP'd on October's platform**. Events that link out to Eventbrite give us no
attendee list, so they can't be surveyed. This is stated in the UI: the survey
box shows "N attendees can be emailed" (0 for link-out events, with a note).

This is also the commercial tie-in to the self-serve platform's "managed free
registration" tier: that tier exists partly to produce the attendee list a
survey needs.

## 4. Survey-design principles (what stops it being a feel-good form)

- **Length is capped by profile, not by taste.** Response rate falls off a cliff
  with length, so the default **Pulse** profile caps at four questions. A marquee
  annual event (the Conference) earns a longer **Flagship** profile because its
  audience is engaged and the planning value is high — capped at eight, with the
  builder showing the completion cost of each extra question. The cap is enforced
  server-side per profile; it is never unbounded. See §4a.
- **First question is one tap** (a 1–5 rating). Commitment before effort.
- **Every question maps to a decision.** If an answer wouldn't change anything
  the organiser or October does, the question is cut. The Claude prompt enforces
  this (§6).
- **One question per screen** on mobile, with progress dots. Big tap targets
  (min 48px), thumb-reachable.
- **One open-ended, last** ("What one thing would you change?"). Open text is
  where the real signal is; keep it to one, optional.
- **Finish to reveal.** The incentive shows on the thank-you screen and in a
  short follow-up email. Revealing on completion is the strongest finish driver.

## 4a. Survey profiles (how the four-question cap survives a real conference)

Elayne's Conference list is roughly eight distinct asks plus a rating per session.
Forced through a four-question cap it either loses most of what she needs or the
cap becomes a lie. The honest resolution is two profiles, picked per event:

| Profile | For | Question cap | Rationale |
|---------|-----|--------------|-----------|
| **Pulse** (default) | Most events, tours, one-off sessions | 4 | Highest completion. A tour attendee gives you a minute, no more. |
| **Flagship** | The annual Conference and events of that weight | 8 | Engaged, invested audience; the planning payoff justifies a longer form. Once a year, not every event. |

Rules that hold in both:

- The cap is real and enforced server-side. Flagship is eight, not "unlimited".
- The builder shows a live **completion estimate** that drops as questions are
  added (a plain "each extra question costs roughly 5–10% completion" line, so
  the choice to lengthen is deliberate).
- A **session-ratings block** (§5, `session_rating`) does **not** count against
  the cap. Rating six sessions is one screen and one decision for the attendee,
  not six questions. This is the specific mechanism that lets the Conference have
  per-session ratings *and* the planning questions inside eight.
- First live question is still a single rating (§4). One open-ended minimum stays
  the guidance; Flagship may run up to three open questions, but the builder warns
  that open text past two sharply cuts completion.

Profile is one field on the event (`_oe_survey_profile`: `pulse | flagship`,
default `pulse`). It only changes the cap and the builder's warnings; the form,
sending and results are identical.

## 5. Question types (fixed set)

| Type | UI | Stored |
|------|----|--------|
| `rating` | 1–5 big buttons (or stars), one tap | integer 1–5 |
| `choice` | single-select, big buttons | option key |
| `multi` | multi-select, big toggle buttons | array of option keys |
| `open` | one short free-text box | string (sanitised, length-capped) |
| `session_rating` | a compact list of named sessions, each a 1–5 tap row, with one optional comment box below the block | `{session_key: {rating, comment?}}` |
| `testimonial` | open text + a consent selector ("May we use this? — with my name / anonymously / no") | `{text, consent: named\|anon\|no}` |

`session_rating` exists for multi-session events (the Conference): it is one
screen and does not count against the profile cap (§4a). The session list is
edited in the builder (or, for a ticketed event with named sessions/ticket
types, pre-filled from them). `testimonial` is the "leave a quote we can use"
ask; its consent field governs whether the quote is ever surfaced publicly and,
if so, with or without a name (see §7a — a named, consented quote is the one
place identity is deliberately attached, and only with explicit permission).

No generic matrix/grid, no ranking, no file upload in v1. A survey is an ordered
list of these; the first live question must be `rating`; length is bounded by the
profile cap (§4a). `session_rating` and `testimonial` are each allowed at most
once per survey.

## 6. Claude question-writer

A "Suggest questions with Claude" button in the builder calls the existing
connector (`OE\AI\Assistant::ask()`), returns a draft the admin edits. The system
prompt bakes in the rules so the output is usable, not generic:

> You are designing a post-event survey for "{event name}" ({event type}, held
> {date}). Profile: {pulse|flagship}. Produce at most {4|8} questions for
> attendees to answer on their phone the day after. Rules: the first is a single
> 1–5 rating of the overall experience. Include at most {one|two} open-ended
> questions, each phrased as a specific decision ("What one thing would you
> change?"), placed last. For a multi-session event you may include one
> session-ratings block (does not count toward the cap). Every other question
> must be a single-select or multi-select whose answer would change a real
> decision the organiser makes (what to keep, drop, or fix). No double-barrelled
> questions (one idea each), no leading wording, no demographic questions unless
> they change programming, no questions asked only to look thorough. Return
> strict JSON: [{type,label,options?}]. Keep labels under 90 characters.

For a Flagship conference the prompt also seeds the known planning intents so the
draft is close to Elayne's list on the first pass: why they attend, whether they
stay the full day (and why not), content gaps for next year, speakers/voices
wanted, and one format change. The admin can regenerate, edit every field,
reorder, and delete. Nothing sends without a human saving it.

## 7. Data model

**Per-event config** (event meta, `_oe_` prefixed):

| Key | Meaning |
|-----|---------|
| `_oe_survey_enabled` | on/off for this event |
| `_oe_survey_profile` | `pulse` (default, cap 4) or `flagship` (cap 8) — §4a |
| `_oe_survey_questions` | JSON: `[{id,type,label,options?,sessions?}]` (`sessions` holds the named list for a `session_rating` block) |
| `_oe_survey_incentive_code` | promo code revealed on completion (optional) |
| `_oe_survey_send_days_after` | integer, default 1 |
| `_oe_survey_sent_at` | datetime the invite batch went out (send-once guard) |

**Responses** — new table `oe_survey_responses` (DB version bump):

```
id            BIGINT PK
event_id      BIGINT        KEY
token         VARCHAR(64)   UNIQUE per (event, attendee) — one response each
segment       VARCHAR(120)  snapshot of the attendee's ticket type at submit
answers       LONGTEXT      JSON {question_id: value}
submitted_at  DATETIME
KEY event_id, UNIQUE token
```

Tokenised links tie a response to an attendee (via the ticket token), so we get
one response per person and can split results by ticket type, without exposing
who said what in the open-text report. `segment` is captured at submit (from the
token → attendee → ticket type) so reporting can group by it without re-joining
or surfacing identity — see §7a.

## 7a. Anonymity, attribution and segmentation

The point the survey has to get right: **anonymous to read, attributable to
interpret.**

- **Anonymous in presentation.** Reports never show who said what. Open-text
  answers are listed de-identified. No name or email appears next to a rating or
  a comment. Respondents are told their feedback is anonymous, and from their
  side it is — they answer via an unguessable token, not a login.
- **Pseudonymous underneath.** The token links a response to the attendee, so the
  data is internally attributable. That link is used for two things only: one
  response per person, and **segmentation** — never to publish an individual's
  view against their name.
- **Why it matters (the student vs professional point).** A "too expensive" from
  a student concession ticket and from a full-price professional are different
  signals. The results view can split every question **by ticket type** (and any
  attribute we already hold, e.g. member vs non-member), so October reads
  feedback in context and weights it before acting. "Students rated price 2.1,
  professionals 3.9" is far more useful than a single blended average.
- **Snapshot, not live join.** The attendee's ticket type is copied into the
  response's `segment` at submit time, so a later ticket change doesn't rewrite
  history and the report needs no per-response identity lookup.
- **Guardrail.** Segments only render when a group has enough responses to stay
  non-identifying (e.g. a minimum of 4); below that the segment folds into
  "Other" so a one-person segment can't be de-anonymised.
- **Testimonials are the one deliberate exception.** The `testimonial` question
  (§5) is the only place a quote can be attached to a name, and only when the
  respondent picks "with my name". "Anonymously" surfaces the quote with no
  identifier; "no" keeps it internal, never shown publicly. Consent is stored
  with the quote and re-checked before anything is exported for marketing use, so
  a quote can never leak into a promo asset without an explicit yes. This does not
  weaken the rest: ratings and non-testimonial open text stay anonymous to read.

## 8. Timing and sending (Slice C)

- The existing **daily cron** looks for events whose (end) date was
  `send_days_after` days ago, with `survey_enabled` and no `survey_sent_at`.
- For each, it emails every attendee we hold an address for a branded invite
  with their tokenised survey link, then stamps `survey_sent_at` (send-once).
- Multi-day events survey the day after the **end** date.
- Reuses `Transactional::send` and the attendee list (`Orders::attendees_for_list`).
- A manual "Send now" button in the builder for testing / off-cycle sends.

## 8a. Delivery routes (day-after email is the default, not the only one)

The day-after email (§8) is the baseline. Elayne's chat raised a second route
worth supporting because it lifts response rate for events with a captive
audience:

- **Bundled with the ticket / confirmation.** The tokenised survey link (and the
  discount hook) can ride along in the booking confirmation or the event-reminder
  email for a tour or ticketed event, so the attendee already holds it. The
  survey still only *accepts* responses from the day after the event (the token is
  valid, the form says "opens after the event" until then), so early-sent links
  don't collect stale pre-event opinions.
- **On-site / at-close.** The same tokenised link works as a QR code shown at the
  end of a session — useful for the Conference, where a screen or a printed card
  gets a spike of responses while people are still in the room.
- **Default stays automatic.** Whatever extra routes are switched on, the
  day-after cron send (§8) still fires once so no attendee is missed. Routes are
  additive; the token dedupes (one response per person regardless of how many
  ways they received the link).

The trigger Daniel described — "set it up once, it sends for all events
automatically" — is exactly the cron in §8 plus the per-event `_oe_survey_enabled`
toggle: turn the survey on for an event and the day-after send is automatic, no
per-event scheduling. Bundled/on-site routes are opt-in extras on top.

## 9. Incentive (decided: one capped code per survey)

- One promo code per survey, reusing the existing promo system (`Promo`), with a
  **max-uses cap** so a shared code can't run away.
- Revealed on the thank-you screen and repeated in a short "thanks + here's your
  code" email.
- The builder lets the admin pick an existing code or shows the cap. No unique
  per-respondent codes in v1.

## 10. Results and graphs (Slice D)

A results view per event (under Tickets, next to the other reports):

- **Response rate**: responses / invites sent.
- **Rating questions**: average + a 1–5 distribution bar, NPS-style if it's a
  0–10 later.
- **Choice/multi**: a horizontal bar per option with counts and share.
- **Open text**: a readable list (paged), de-identified, with a one-click Claude
  summary of the themes (optional, reuses the connector).
- **Session ratings**: per-session average + distribution, so the weakest and
  strongest sessions are obvious at a glance; comments listed de-identified.
- **Testimonials**: shown separately with their consent state (named / anonymous
  / internal only), so what is safe to quote publicly is unambiguous. Only
  consented quotes are eligible for the (v1.1) reuse surface.
- **Split by ticket type** (§7a): a toggle that breaks every question down by
  segment, so e.g. price feedback from students vs professionals is read
  separately. Segments below the minimum-size guardrail fold into "Other".
- **CSV export** of raw responses (with the `segment`, without name/email).

Reuses the chart patterns already in the Tickets admin (conic-gradient pies,
bar rows), so it looks like the rest of the product.

## 11. Security

- Survey links are **unguessable tokens**; an invalid/expired token shows a
  neutral "survey closed" page, never an error revealing internals.
- **One response per token** (unique constraint + re-submit updates, not
  duplicates). A closed survey (past a window, e.g. 14 days) rejects new
  responses.
- Public submit endpoint is **rate-limited** and nonce/last-token validated; only
  the fixed question set is accepted (answers validated against the stored
  questions — no arbitrary keys).
- Open text is sanitised and length-capped; no HTML stored.
- Testimonial consent is stored with the quote and re-checked at export; a quote
  is never surfaced publicly, or attached to a name, beyond what the respondent
  chose (§7a). Absent or "no" consent = internal only.
- No attendee PII beyond the token is exposed to the front end; the admin results
  view is `manage_options` only.
- The data is **pseudonymous** (token-linked), presented anonymously (§7a):
  reports show groups and de-identified open text, never an individual's answers
  against their identity. The segment guardrail (min group size) stops small
  segments from re-identifying a respondent.

## 12. Phased build

| Slice | Deliverable | Acceptance |
|-------|-------------|------------|
| **A** | Survey builder metabox on the event (enable, profile, questions, "Suggest with Claude", incentive code + cap, send-days-after) + `oe_survey_responses` schema | Admin can configure and save a survey; profile sets the cap (4/8); questions validate (first is rating, `session_rating`/`testimonial` each ≤1, block excluded from cap); Claude button returns an editable draft |
| **B** | Mobile survey form (tokenised `[oe_survey]` / `/survey/{token}`), response storage, thank-you + code reveal. Renders all types incl. `session_rating` and `testimonial` (with the consent selector) | A tokenised link renders the branded one-per-screen form on mobile; the session block is one screen; testimonial captures consent; submitting stores one response; thank-you shows the code |
| **C** | Day-after cron send to attendees, once; manual "Send now" | On the day after the event, active surveys email attendees the tokenised link exactly once; `survey_sent_at` stamped |
| **D** | Results view + graphs + CSV + optional Claude theme summary | Per-event results show response rate, per-question graphs, open-text list, CSV export |

Ship A→B→C→D in order. A and B together are already usable (configure + collect
via a shared link) before the automated send exists.

## 13. Open decisions

1. **Survey window** — how long the link stays open (recommend 14 days after
   send, then "survey closed").
2. **Metabox vs Tickets sub-page** for the builder — recommend a metabox on the
   event edit screen (matches "in the event page we add survey questions"), with
   results under Tickets. Precedent: `GuidedTours\Metabox`.
3. **Rating scale** — 1–5 (recommended, fewer taps) vs 0–10 NPS. Can support both
   later; pick one for v1.
4. **Reminder send** — a single nudge to non-responders 3 days later? Lifts
   response rate; adds one more cron branch. Recommend v1.1, not v1.
5. **Flagship cap number** — eight is the working figure (§4a). If the Conference
   genuinely needs more, raise it here rather than removing the cap. Recommend
   holding at eight for v1 and letting real completion data argue for a change.
6. **Testimonial reuse workflow** — where consented, named quotes surface for
   marketing. v1 stores consent and shows them in results; an actual "approved
   quotes" export/library is a small v1.1 add. Recommend v1 = capture + consent,
   v1.1 = the reuse surface.

## 14. Worked example — the ADF Conference (Flagship profile)

Elayne's list, mapped to the spec so nothing is lost and the cap holds. Profile:
**Flagship** (cap 8). The session-ratings block does not count toward the cap
(§4a), so this is one block plus seven questions, inside eight.

| # | Question | Type | Notes |
|---|----------|------|-------|
| — | Rate each session (1–5) | `session_rating` | Sessions pre-filled from the programme; one optional comment box under the block. One screen, off the cap. |
| 1 | Overall, how was the Conference? (1–5) | `rating` | Required first question (§4). |
| 2 | Why do you attend the Conference? | `choice` (or `multi`) | Options from October's own read: network, learn, business, inspiration, specific speakers, other. |
| 3 | Do you stay the entire day? | `choice` | Yes / No. |
| 4 | If not, why did you leave early? | `open` | Short; shown only when Q3 = No (conditional display, v1 keeps it simple: always shown but optional). |
| 5 | What content or topics did we miss this year that you'd want next year? | `open` | Forward-looking, feeds programming. |
| 6 | Which speakers, voices or industries would you like to hear from next year? | `open` | Feeds speaker sourcing. |
| 7 | One thing we should change about the format or experience next year? | `open` | The single highest-signal question. |
| — | Anything you'd be happy for us to quote? | `testimonial` | Consent selector (name / anon / no). Does not count as a rating/decision question; capped at one. |

Notes for the build, not blockers:

- That is four open questions plus the testimonial — above the "two open max"
  guidance (§4a). For the annual Flagship this is a deliberate, one-a-year
  trade: the completion warning shows, Daniel accepts the hit. If completion
  disappoints, collapse Q5/Q6 into a single "content and speakers for next year"
  open question and drop to three opens.
- Q3/Q4 (stay-all-day + why) is the one natural conditional. v1 can show both
  and mark Q4 optional; a proper "show Q4 only if No" is a small enhancement, not
  required to ship.
- Incentive: one capped discount code revealed on completion (§9), matching the
  chat's "incentivise with a discount".
- Delivery: day-after email by default, optionally bundled with the tour ticket
  and shown as a QR at close (§8a).

This example is illustrative. The builder + Claude drafter (§6) produce the
starting set; the admin edits to taste before it goes live.
