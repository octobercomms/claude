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
| `backend/src/services/replyCatchup.js` | scan, list, apply, dismiss |
| `backend/src/services/replyCatchup.test.js` | 16 checks on opt-out reading. `node src/services/replyCatchup.test.js` |
| `backend/src/routes/outreach.js` | `/reply-catchup/*` |
| `frontend/src/components/ReplyCatchupPanel.jsx` | The review screen |
