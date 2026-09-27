# Post-event survey — spec

Status: spec (approved to build after review). Owner: Daniel.

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

- **Four questions, hard cap.** Response rate falls off a cliff with length. The
  builder will not let more than four go live.
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

## 5. Question types (fixed set)

| Type | UI | Stored |
|------|----|--------|
| `rating` | 1–5 big buttons (or stars), one tap | integer 1–5 |
| `choice` | single-select, big buttons | option key |
| `multi` | multi-select, big toggle buttons | array of option keys |
| `open` | one short free-text box | string (sanitised, length-capped) |

No matrix/grid, no ranking, no file upload in v1. A survey is an ordered list of
these, max four, first must be `rating`.

## 6. Claude question-writer

A "Suggest questions with Claude" button in the builder calls the existing
connector (`OE\AI\Assistant::ask()`), returns a draft the admin edits. The system
prompt bakes in the rules so the output is usable, not generic:

> You are designing a post-event survey for "{event name}" ({event type}, held
> {date}). Produce at most four questions for attendees to answer on their phone
> the day after. Rules: the first is a single 1–5 rating of the overall
> experience. Include at most one open-ended question, last, phrased as a
> specific decision ("What one thing would you change?"). Every other question
> must be a single-select or multi-select whose answer would change a real
> decision the organiser makes (what to keep, drop, or fix). No double-barrelled
> questions (one idea each), no leading wording, no demographic questions unless
> they change programming, no questions asked only to look thorough. Return
> strict JSON: [{type,label,options?}]. Keep labels under 90 characters.

The admin can regenerate, edit every field, reorder, and delete. Nothing sends
without a human saving it.

## 7. Data model

**Per-event config** (event meta, `_oe_` prefixed):

| Key | Meaning |
|-----|---------|
| `_oe_survey_enabled` | on/off for this event |
| `_oe_survey_questions` | JSON: `[{id,type,label,options?}]` |
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

## 8. Timing and sending (Slice C)

- The existing **daily cron** looks for events whose (end) date was
  `send_days_after` days ago, with `survey_enabled` and no `survey_sent_at`.
- For each, it emails every attendee we hold an address for a branded invite
  with their tokenised survey link, then stamps `survey_sent_at` (send-once).
- Multi-day events survey the day after the **end** date.
- Reuses `Transactional::send` and the attendee list (`Orders::attendees_for_list`).
- A manual "Send now" button in the builder for testing / off-cycle sends.

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
- No attendee PII beyond the token is exposed to the front end; the admin results
  view is `manage_options` only.
- The data is **pseudonymous** (token-linked), presented anonymously (§7a):
  reports show groups and de-identified open text, never an individual's answers
  against their identity. The segment guardrail (min group size) stops small
  segments from re-identifying a respondent.

## 12. Phased build

| Slice | Deliverable | Acceptance |
|-------|-------------|------------|
| **A** | Survey builder metabox on the event (enable, questions, "Suggest with Claude", incentive code + cap, send-days-after) + `oe_survey_responses` schema | Admin can configure and save a survey on an event; questions validate (max 4, first is rating); Claude button returns an editable draft |
| **B** | Mobile survey form (tokenised `[oe_survey]` / `/survey/{token}`), response storage, thank-you + code reveal | A tokenised link renders the branded one-per-screen form on mobile; submitting stores one response; thank-you shows the code |
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
