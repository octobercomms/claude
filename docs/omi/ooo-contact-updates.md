# Contact updates from out-of-office replies

How OMI keeps the press list current from the auto-replies October's own
mailouts generate: a journalist names a stand-in, a mailbox stops being
monitored, someone moves masthead. Everything lands in one review queue under
**Earned → Contact Cleanup → Contact updates**, and nothing reaches a contact
record without a person pressing a button.

---

## 1. The decisive architectural point (read before changing anything)

**MailFlow does not need to do this, and should not be modified for it.**

MailFlow (`dev/oc-mail`) is a *window* onto Gmail and IMAP rather than a store
of its own. Its application source is not in this repo at all: it is upstream
`maathimself/mailflow` (AGPL-3.0), consumed as prebuilt Docker images, with
October's changes carried as a single patch in
`dev/oc-mail/fork/october-branding-and-cross-account-move.patch`.

OMI reads the same mailbox directly. `services/outreachReplies.js` has polled
the outreach inbox over IMAP on every scheduler cycle since long before this
feature; it used each message to mark a send replied and to catch unsubscribes,
then discarded the body. So an auto-reply naming three journalists was already
being read, recognised as a reply, and thrown away.

That is where the extraction now happens. The consequences are worth stating
because an agent reaching for the obvious design will get them backwards:

- No shared ingest token to provision for the normal path.
- No push contract between two services to keep in step.
- No growth of the AGPL fork patch, and no rebuild of MailFlow's images.
- No second copy of the mailbox credentials.

If a future change seems to need MailFlow to send OMI something, check first
whether OMI can simply read it. It almost certainly can.

---

## 2. The three doors

All three converge on `ooo_suggestions` and all three stop at the same gate.

| Door | Entry point | When it is used |
|---|---|---|
| **Inbox scan** (`origin: 'imap'`) | `services/oooMailScan.js`, called from `pollOneInbox()` | The normal path. Runs automatically on every reply poll, across every mailbox switched on for it. |
| **Inbox backfill** | `outreachReplies.backfillOoo({ days })` → `POST /api/outreach/ooo/backfill` | Catching up. The reply poll looks back three days; this reads up to two years, extracts out-of-office content only, and marks no sends replied and no unsubscribes. |
| **CSV upload** (`origin: 'csv'`) | `services/oooCsv.js` → `POST /api/outreach/ooo/import` | A MailFlow "contact updates" export, for a backlog MailFlow has already processed. |
| **MailFlow push** (`origin: 'mailflow'`) | `POST /api/ooo/suggestions`, token-gated | Pre-existing, still works. Needs `MAILFLOW_INGEST_TOKEN` set in Settings. Not required for any of the above. |

### Ids converge rather than duplicate

A suggestion's id is `sha256(lower(sender) | normalised subject | calendar day)`,
from `oooExtract.suggestionId()`. The subject has `Re:`, `[EXT]`-style tags and
the auto-reply prefix stripped first, so the CSV row
`"Automatic reply: Hotels spend seven figures"` and the IMAP message of the
same reply produce the **same** id. Running two doors over the same replies
updates one row instead of creating two.

It is deliberately **not** derived from the extracted addresses: when the
extractor improves and finds a fourth contact in a reply already queued, that
has to update the existing row, not open a second beside it.

A re-POST, re-upload or re-scan refreshes the upstream fields but never touches
a row a reviewer already applied or dismissed.

---

## 3. The safety model

October's inbox carries suppliers, accountants, clients and personal mail. An
auto-reply from any of them extracts exactly as cleanly as one from an editor,
and is worth nothing. Four things follow.

### Nothing auto-applies
There is no code path that writes to a contact without an explicit call to
`applySuggestion()` from an authenticated route. `applyBatch()` applies only the
ids the client sends; the server never selects the set. "Apply everything
pending" is the one operation this queue must not offer, and does not.

### Two review lists
`sender_known` records whether the sender matched a row in `outreach_contacts`.

- **In OMI** — the sender is already a contact. Press mail, in practice. Can be
  ticked and applied as a batch.
- **Not in OMI** — everyone else. Listed separately, **never pre-ticked**, each
  one an explicit approve or decline.

### Every apply is reversible
`applySuggestion()` runs in one transaction and, before the write lands, records
the prior values of each field it overwrites into `before_state`:

```json
{ "contact_id": "…", "fields": { "email": "…", "company": "…", "role": "…" },
  "created_contact_ids": ["…"] }
```

`undoSuggestion()` replays it. Field updates restore exactly. Contacts the apply
created are deleted **only when nothing has been sent to them since** — once a
contact has an `outreach_sends` row, deleting it would take the send history
with it, so those are left in place and named in the note. A partial undo
reported honestly beats a clean-looking one that quietly destroys history.

Without `before_state` an apply is irreversible, which is the entire risk of
letting an automatic feed touch the contact list. Do not remove it.

### Flags, not silent drops
A row the importer distrusts is still queued, unticked, with the reason shown
and overrulable. A dropped row is invisible; an unticked one is a decision.

---

## 4. The gates

`oooExtract.gate()` returns `[{code, detail}]`. An alternate carrying any flag
starts unticked in the UI.

| Code | Means |
|---|---|
| `no_email` | A person was named with no address. Nothing to add. |
| `invalid_email` | No valid TLD, e.g. `sabine.weinmann@luther-lawfirm`. Must never reach a sending list. |
| `functional_mailbox` | `jobs@`, `cv@`, `newsdesk@`, `advertising@`, `hearst@subscription.co.uk`. A correct extraction of a useless press contact; costs deliverability and returns nothing. |
| `unsupported_email` | The address is neither in the quoted sentence nor a match for the name, so nothing evidences the pairing. |
| `stale` | The reply is older than 18 months (`staleMonths`, configurable per import). |
| `no_new_address` | A "moved" row whose new address equals the one on file. The real change is the employer. |
| `name_inferred` | The name was read off a `first.last@` address, not stated in the reply. |
| `name_unverified` | The sentence names someone but nothing ties that name to this address. Read the quote and set the name by hand. |
| `possible_departure` | A phrase like "I have now left" or "this mailbox is no longer monitored". The sender's **own** record needs checking; the suggestion only proposes the stand-ins. |

---

## 5. Why extraction is deterministic, not a model call

`services/oooExtract.js` is regex and position. No AI. Three reasons, in order
of weight:

1. **A model that invents a plausible address is the one failure the review
   queue cannot catch.** A fabricated address looks identical to a real one on
   the card. Every candidate here carries the sentence it came from, so the
   reviewer checks the claim instead of trusting a score.
2. It runs on every message in the inbox, most of which is not press. A
   per-message model call is real money for no return.
3. It has to be auditable and testable. `oooExtract.test.js` is 63 checks over
   sentences taken verbatim from October's own auto-replies.

### The name trap, and why the address arbitrates

The nearest capitalised word before an address is usually not the person. In

> "Please contact Hannah Wintle for Sleeper / Starboard at h.wintle@mondiale.co.uk"

the nearest run is **Starboard**, a magazine. Taking it writes a publication's
name into a contact's name field, and the review card shows a plausible row with
no sign anything is wrong. That is precisely the bug that must not ship.

So the address arbitrates: of the capitalised runs in the sentence, take the one
the local part corroborates (`nameMatchesEmail`). Journalists' addresses are
built from their names almost without exception, which makes this a strong test.
When nothing corroborates, the name is left **blank** rather than guessed, and
the quote is on the card for the reviewer to read.

Two related traps already fixed, both covered by tests:

- A lowercase connector must not end the backward walk. "email Alexis Muellner
  **at** amuellner@…" returned nothing until `CONNECTORS` was added.
- `Auto-Submitted` must be read **by value**, not by a negative lookahead after
  `\s*`. `\s*` backtracks to zero width, the lookahead lands on the space rather
  than the value, and `Auto-Submitted: no` — which conforming senders put on
  ordinary mail — reads as an auto-reply. Every message qualified.

---

## 6. What the file October exported actually contained

Measured against `ooo-contact-updates-2026-10-13.csv` (128 rows, 2017-03-20 to
2026-10-12), and worth knowing before trusting a future export:

- **126 rows "mentioned contact", 2 "moved / new address", and zero
  unsubscribes.** The export does not carry opt-outs at all. OMI handles those
  separately in `routes/unsubscribe.js` and `services/bounceHandler.js`.
- **109 of 128 rows sit at confidence 0.95**, including 36 whose address never
  appears in its own quote and 22 department mailboxes. Confidence is a sort
  key, not a gate, and the code treats it that way.
- The two "moved" rows point in **opposite directions**. For Alison Cole the old
  address is in `source_sender` and the new one in `email`. For Anna Highfield
  both are the same and the real change is her employer. The importer therefore
  reads `source_sender` as the person to match and `email` as the proposed new
  value, and skips the write when they are equal. Reversed, an apply overwrites
  the wrong record.
- 83 suggestions from 128 rows; 92 of 126 proposed contacts carry no flag.

### One signal the CSV cannot express

Ten rows come from a reply saying `editorial@theintermediary.co.uk` is no longer
monitored. The export records the ten replacement addresses and says nothing
about retiring the sender. The inbox scan catches this as
`possible_departure`, but **retiring the sender is still a manual step** — there
is no "mark this contact dead" action yet. That is the obvious next piece of
work.

---

## 7. Setting it up

1. **Settings → Outreach → Mailboxes OMI reads**: add every address
   journalists might reply to. The old single `OUTREACH_IMAP_*` setting is
   imported into that list automatically, once. Without any mailbox the inbox
   scan reports that it is not configured and the other doors still work.
2. **Earned → Contact Cleanup → Contact updates → Scan inbox**, 90 days, to
   catch up. Re-running is cheap: `ooo_scanned_messages` is a per-message
   watermark keyed on Message-Id.
3. Work the **In OMI** list, then **Not in OMI**.
4. Optional: `MAILFLOW_INGEST_TOKEN` in Settings if the MailFlow push door is
   wanted as well. Not needed for the automatic path.

---

## 8. Files

| File | What it is |
|---|---|
| `backend/migrations/197_ooo_contact_updates.sql` | `origin`, `sender_known`, `flags`, `before_state`, audit columns; `id` widened to TEXT for hashed ids; `ooo_scanned_messages` watermark |
| `backend/src/services/oooExtract.js` | Auto-reply detection, contact extraction, the gates, id derivation. Pure, no DB |
| `backend/src/services/oooExtract.test.js` | 63 checks. `node src/services/oooExtract.test.js` |
| `backend/src/services/oooMailScan.js` | One message in, one suggestion out. Watermark, departure detection |
| `backend/src/services/oooCsv.js` | CSV parse, grouping, the move-direction mapping |
| `backend/src/services/oooSuggestions.js` | The queue: upsert, list by bucket, apply, undo, batch, dismiss |
| `backend/src/services/outreachReplies.js` | `pollReplies()` calls the scanner; `backfillOoo()` is the wider read |
| `backend/src/routes/outreach.js` | `/ooo/*` review endpoints |
| `backend/src/routes/oooSuggestions.js` | The token-gated MailFlow push door |
| `frontend/src/components/OooReviewPanel.jsx` | The two lists, flags, batch apply, undo, upload |

## 8a. The watermark, and reading a message twice

`ooo_scanned_messages` records every message key the scanner has seen, and
`ingestMessage` returns early on a repeat. That is right for not proposing the
same stand-in twice, and wrong the moment the reader itself improves.

It improved on 18 Oct 2026 (`mimeText`, PR #1695). Before that "the body" was
everything after the first blank line, so an auto-reply in the usual
`multipart/alternative` shape handed the extractor a boundary line and part
headers, and where the part was base64, nothing readable at all. The extractor
found no contacts and the message was filed as `was_auto_reply = TRUE,
suggestion_id = NULL` — which on screen is indistinguishable from a plain
"I'm away until Monday". Some of those were a failed read, and the stand-ins
named in them were silently lost.

So the reader is versioned. `READER_VERSION` in `oooMailScan.js` is stamped on
every row; a message scanned by an older reader is eligible to be read again.
The next reader improvement bumps the constant and costs nothing else.

**A message is re-read only when all three hold** (`needsReread`):

| Condition | Why |
|---|---|
| `reader_version < READER_VERSION` | Otherwise the live poll re-extracts the same messages every 15 minutes forever. A re-read that still finds nothing stamps the current version, so it settles. |
| `suggestion_id IS NULL` | A row with a suggestion is on a screen and may have been applied or declined. Re-reading it could resurrect a decision someone already made. |
| `was_auto_reply = TRUE` | That verdict comes from the subject and headers, which `mimeText` did not change. Re-reading every ordinary email ever seen is a great deal of work for a guaranteed identical answer. |

Migration 202 back-fills version 2 onto rows that already carry a suggestion
and onto non-auto-replies, so the eligible set is only ever "read the body,
found nothing".

The backfill reports `recovered`: suggestions that came from messages an
earlier reader had written off. The panel says so in words, because "N queued"
alone cannot tell you whether re-reading achieved anything, and finding out
was the point.

## 9. Known gaps

- **Retiring a dead sender** is flagged, not actionable. See §6.
- **A departure does not update the sender's own record.** The reply rarely
  gives their new address, so guessing one is the wrong trade. Flagged for
  manual handling.
- **The CSV door cannot carry unsubscribes** because MailFlow does not export
  them. Confirm at the MailFlow end whether a change type exists.
- **Company is left blank on inbox-scanned contacts.** The reply gives a domain,
  not a company name, and turning `@mondiale.co.uk` into "Mondiale" is a guess
  that would read as fact on the record.

---

## 10. Several mailboxes (migration 198)

`outreach_inboxes` is the list of mailboxes OMI reads. It replaced the single
`OUTREACH_IMAP_*` setting, and the reason is worth recording because it cost
real money: October sends press releases with a reply-to of **press@** while the
poll read **hello@**. Every reply to press@ was invisible. Because
`looksLikeUnsubscribe()` runs inside that same poll, journalists who replied
"remove me" to press@ were never suppressed and kept receiving follow-ups. The
0% reply figure on the dashboard was the symptom; mailing people who had asked
you to stop was the cost.

Each row carries its credentials (encrypted with `utils/encryption`, the same
treatment `outreach_mailboxes` gives SMTP passwords) and the state of its own
last poll, so "when did press@ last work?" is answerable per mailbox.

Three switches per mailbox:

| Switch | Effect |
|---|---|
| `poll_replies` | Feeds reply matching and unsubscribe detection. |
| `scan_ooo` | Feeds the contact-update queue above. |
| `known_senders_only` | Only raises a contact update when the sender is already in OMI. |

That last one is the thing that makes several mailboxes usable rather than
noisy. One outreach inbox produces a workable queue. A personal or finance
account produces auto-replies all day from suppliers and services who will
never be press contacts, each extracting perfectly well and worth nothing. With
the switch on, such a mailbox still catches "my colleague has taken over" for
someone you already track, without burying the queue.

### Things that must stay true

- **`List-Unsubscribe` must name a mailbox that is actually polled.**
  `outreachSender.listUnsubscribeHeaders()` picks from the live list, preferring
  the campaign's own reply-to. Advertising the header against an address nobody
  reads is worse than omitting it: the recipient's mail client reports the
  opt-out as done and it never happened.
- **The reply-to check is against a set, not a value.** `pollState()` returns
  `addresses`, and `press.js /reply-status` asks whether the campaign's reply-to
  is one of them. Comparing against a single inbox is exactly what let press@ go
  unread while the banner reported polling as healthy on hello@.
- **One bad mailbox must not stop the others.** `pollReplies()` catches per
  mailbox and records the error against that row. Before the split, one expired
  password took reply and unsubscribe handling down for everything.
- **The legacy import runs once.** `importLegacyOnce()` copies the old settings
  into a row and records `OUTREACH_INBOX_IMPORTED`. Reading the settings as a
  fallback only while the table is empty would silently drop that mailbox the
  moment a second one was added, which is the exact failure this feature exists
  to stop.
