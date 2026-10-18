# Reply catch-up

The backlog pass for replies that arrived while a mailbox went unread.
**Earned → Contact Cleanup → Reply catch-up.**

## Why it exists

`outreachReplies.pollReplies()` looks back **three days**. That window is right
for its job: stop a follow-up before the next one goes out. It is useless for a
backlog, and October had one.

Press releases went out with a reply-to of **press@** while the poll read
**hello@**. Months of replies were never matched. Worse, `looksLikeUnsubscribe()`
runs inside that same poll, so replies saying "remove me" were never actioned
and those journalists kept receiving follow-ups.

Migration 198 added press@ to the mailbox list, which fixed everything from
that moment on and nothing from before. This is the "and before" half.

## The shape

Two steps, and the split is the whole design.

| Step | What it does | What it writes |
|---|---|---|
| **scan** | Reads a window (default 180 days, up to 3 years) across every mailbox switched on for replies | Only `outreach_reply_catchup` |
| **apply** | A person presses go, per row or over a ticked set | `outreach_sends`, `outreach_contact_clients` |

Scanning marks no send, suppresses no contact and cancels no follow-up.

## Why there is no undo

Every other review queue in OMI has one. This one deliberately does not, and
the reason is the asymmetry of the two actions it proposes:

- Mark a send replied, and cancel its pending follow-ups.
- Record an opt-out.

Both only ever **stop** mail going out. Applying one wrongly costs a follow-up
you would have liked to send. Reversing an opt-out would **resume** mail to
someone who asked you to stop, which must never be one button press. The review
step guards the direction that can do harm; an undo would open the one that can.

## Things that must stay true

- **`replied_at` is the reply's own date, not now.** Stamping months of backlog
  with today's timestamp would tell the dashboard every journalist replied this
  afternoon, which is a worse lie than the gap being fixed.
- **Opt-out detection reuses the live poll's phrase list.** `UNSUB_PHRASES` is
  exported from `outreachReplies` for exactly this. A catch-up that read
  opt-outs differently from the live poll would be worse than no catch-up, so
  do not copy the list.
- **The matched phrase is shown on the card.** An opt-out applied on a bad match
  is the one mistake here that costs coverage, and "trust me, it's an opt-out"
  is not reviewable. `unsub_phrase` carries it.
- **Auto-replies are not replies.** The live poll marks them because it cannot
  tell, which is arguably its own bug. Repeating that across months would mark
  hundreds of out-of-office notices as engagement and cancel the follow-ups
  behind them. Those messages belong to the out-of-office feed
  (`docs/omi/ooo-contact-updates.md`), so the scan skips them unless they also
  carry an opt-out phrase.
- **No AI classification.** The live poll calls Claude for a reply summary,
  which is fine on a trickle and real money across months of mail. Opt-out
  detection here is the deterministic keyword pass, which is the
  compliance-critical half and has to be auditable anyway.
- **`message_key` dedupes across scans.** Same derivation as the out-of-office
  watermark, so widening the window and re-running is cheap and never proposes
  the same reply twice.
- **A re-scan refreshes rows that are still pending, and only those.** Nothing
  has been written on a pending row's behalf, so recomputing it is free, and it
  is the only route by which a reader improvement reaches proposals an earlier
  scan already raised. Applied and dismissed rows are decisions; the upsert
  carries `WHERE status = 'pending'` and `consider()` returns early for them.
  Removing either guard would let a re-read of the mailbox rewrite history.
- **The body is read through `mimeText.bodyText`, never a blank-line split.**
  See below.

## Reading the message

Until October 2026 both readers took "the body" to be everything after the
first blank line, stripped HTML tags off it and collapsed the whitespace. On a
single-part plain-text mail that is roughly right. Almost nothing a journalist
sends is single-part, and the failures were not cosmetic:

| What arrived | What was stored and scanned |
|---|---|
| `multipart/alternative` | The boundary line and the part's own headers, as the journalist's reply |
| A base64 part | Undecoded base64 — and the opt-out scan read that, so a "please remove me" typed into an Outlook message matched nothing and was never actioned |
| A `gb2312` part | Mojibake, read as UTF-8 |
| Our own quoted footer | Kept, because collapsing every newline left `replyBodyOnly`'s `>` filter nothing to match |

`services/mimeText.js` walks the MIME tree instead: prefers the `text/plain`
part of a `multipart/alternative`, skips attachments, decodes base64 and
quoted-printable, decodes the declared charset through `TextDecoder` (Node
ships full ICU), and keeps newlines so quote-stripping works. All three readers
go through it — the live poll, the catch-up scan and the out-of-office
extractor — so there is one definition of "what the message says".

Pass it the raw `Buffer` from imapflow where you have it. A string that has
already been decoded as UTF-8 has lost the bytes a `gb2312` part needs.

The subject line is taken from the IMAP envelope, which imapflow decodes, so
subject-matched opt-outs (One-Click among them) were never affected by any of
this.

## Saying what Apply does

Daniel, on the first live review screen: *"the apply button — i'm not sure what
i'm applying. is it going to unsubscribe from my database, the campaign, that
client?"* A fair question, because one button runs two actions with two
different scopes:

| Badge | What Apply does | Scope |
|---|---|---|
| Asked to be removed | Records the opt-out and cancels queued sends | **One client** — the one whose campaign they replied to. The contact stays in the library; other clients can still mail them |
| Replied | Stamps `replied_at` and cancels queued sends | **Everywhere** — any pending send to that contact, across campaigns and clients |

So each card now carries an "If you press Apply" notice built from its own
fields (`whatApplyDoes` in `ReplyCatchupPanel.jsx`), plus a recommendation.

The rule that keeps it honest: **never state a number the scan did not
count.** The scan stores `pending_all` and `pending_client` and sets
`counts_known`; where a count is missing the clause is omitted rather than
rendered as zero. A row raised before migration 201 says "Records that X
replied, against 5 sends" with no follow-up clause, which is true, instead of
"stops 0 follow-ups", which would be a confident wrong answer on the one screen
built to remove doubt. A re-scan fills the counts in.

The counts are a snapshot from the last scan, not a promise. `applied_note`
still reports what actually happened at the moment of applying.

## Known limits

- **An opt-out is recorded against one campaign's client.** `suppressForCampaign`
  is per client, and the scan records the most recent matching send's campaign.
  A journalist on campaigns for two clients who replies "remove me" is
  suppressed for one. This mirrors the live poll exactly rather than inventing
  different behaviour; if it should suppress everywhere, change both together.
- **Cancelling pending follow-ups is not scoped by client**, also mirroring the
  live poll. Applying a reply stops anything queued for that contact anywhere.

## Files

| File | What it is |
|---|---|
| `backend/migrations/199_reply_catchup.sql` | `outreach_reply_catchup` |
| `backend/migrations/201_reply_catchup_pending_counts.sql` | `pending_all`, `pending_client`, `counts_known` |
| `backend/src/services/replyCatchup.js` | scan, list, apply, dismiss |
| `backend/src/services/replyCatchup.test.js` | 37 checks on opt-out reading, the re-scan SQL guards and the Apply-notice counts. `node src/services/replyCatchup.test.js` |
| `backend/src/services/mimeText.js` | Readable text out of a raw RFC822 message |
| `backend/src/services/mimeText.test.js` | 28 checks, every case from a message that came out wrong. `node src/services/mimeText.test.js` |
| `backend/src/routes/outreach.js` | `/reply-catchup/*` |
| `frontend/src/components/ReplyCatchupPanel.jsx` | The review screen |
