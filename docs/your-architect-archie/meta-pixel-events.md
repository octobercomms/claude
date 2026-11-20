# Archie — Meta Pixel events

Reference for the browser Meta Pixel events Archie sends, for the ads/retargeting
side. Implemented in `assets/js/archie.js` (chat funnel) and
`includes/class-yaa-portal.php` (Purchase). Added in plugin v0.7.40.

**Dataset / pixel:** `1089693123902587`. The base pixel is installed site-wide and
consent-gated by Complianz — the plugin does **not** load `fbevents.js`; it only
calls `fbq` when it already exists. No consent → `fbq` is undefined → every call is a
silent no-op (by design: under-reporting in proportion to the consent rate is correct;
there is no queue/replay).

## Events

| Event | Type | Fires when | Params |
|-------|------|------------|--------|
| `ArchieStart` | custom | The visitor submits their **first** answer in the chat (not on open/hover) | `page_path` |
| `ArchieProgress` | custom | Each **subsequent** answer | `step` (1-based int), `total` (int) |
| `ArchieComplete` | custom | Quote submitted (enquiry recorded server-side) | `value` (quote total), `currency: "GBP"` |
| `Lead` | standard | Same moment as `ArchieComplete` (kept for series continuity) | `content_name`, `value`, `currency: "GBP"` |
| `Purchase` | standard | Stripe payment confirmed (paid portal return, `redirect_status=succeeded`) | `value`, `currency: "GBP"`, `content_name` |

The submit conversion = `ArchieComplete` + `Lead`. That is the signal to optimise
campaigns against and to seed lookalikes from ("find more like the people who
submitted").

## Guarantees

- **`eventID` on every event** (a per-event UUID; Purchase uses a stable
  `yaa-purchase-<payment_intent>`). This is what lets server-side Conversions API be
  added later without double-counting — if/when CAPI is added, the server must send the
  **same** `eventID` for the matching event.
- **Once per session.** `ArchieStart`, `ArchieComplete`, `Lead`, `Purchase` fire at
  most once; `ArchieProgress` fires at most once per `step`. Guards live in
  `sessionStorage` (key `yaaFbFired`, plus `yaa_purchase_<pi>` for Purchase), so a
  reload mid-chat does not double-count. Re-answering an earlier step, or asking a
  clarifying question, does not advance `step` and so does not re-fire.
- **No personal data** in any parameter — values and step numbers only. No email,
  name, address or postcode.

## step / total

`step` and `total` come from the server (`YAA_Archie::progress()`, returned on every
`/message` response), computed from the questions that actually apply to this project
(`answer_summary()`): `total` = applicable questions, `step` = how many are answered.

Because Archie's flow is dynamic, **`total` grows during a session** — e.g. it's ~5
before a service is chosen and ~11 after a planning service adds its add-ons. That's
intentional (an honest, adaptive denominator), not a bug. Treat `step/total` as "how
far through" rather than a fixed N. Address + postcode count as one step
(one `answer_summary` row), so a session can legitimately show one fewer `ArchieProgress`
than raw messages sent.

## Why `Lead` only fired ~once in 28 days (the brief's question)

Not a wiring fault. `Lead` sits on submit success and is correctly consent-guarded.
Submission is simply the **rarest** point in the funnel: it's behind a chosen service
**and** a captured email **and** a postcode, at the very end, and most sessions abandon
earlier. So few submits → few Leads. The fix isn't to move `Lead`; it's the new
upper-funnel events (`ArchieStart`/`ArchieProgress`), which finally make the
engaged-but-unsubmitted majority visible and retargetable.

## Verifying

Events appear in Meta Events Manager → **Test Events** within seconds (the overview
lags up to 30 min — use Test Events). With cookies **accepted**, one full run should
produce: one `ArchieStart`, one `ArchieProgress` per answered question (correct
`step`/`total`), one `ArchieComplete` + one `Lead` at submit, and one `Purchase` on a
test payment. With cookies **declined**: nothing fires, the chat works, console is
clean. Reloading mid-chat and continuing must not produce a second `ArchieStart`.

## Explicitly out of scope (unchanged)

- Conversions API / server-side sending (the `eventID`s are in place for when it's added).
- Moving email capture earlier in the question set (that's the A/B test's job).
- Any change to the question set, pricing, or Stripe flow.
