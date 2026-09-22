# MailFlow → OMI: out-of-office contact-change suggestions

MailFlow scans auto-reply / out-of-office messages, extracts a lasting contact
change (new address, new employer, an alternate contact), and POSTs each as a
reviewable suggestion. **OMI owns the review queue, the classification, and the
approve-and-apply decision.** Nothing touches a contact record until a person
approves it in OMI.

## Division of responsibility

| Concern | Owner |
|---|---|
| Detect OOO replies, extract the change, de-dupe by sender | MailFlow |
| Hold the review queue | OMI |
| Classify the contact (journalist / client / supplier / prospect / general) | OMI |
| Approve & apply the change to the contact record | OMI |
| Notify the person there's a queue to review | MailFlow (email) |

## Ingest endpoint (what OMI exposes)

```
POST /api/ooo/suggestions
Authorization: Bearer <shared token>
Content-Type: application/json

{ "user": "<identifier>", "suggestions": [ ...items... ] }
```

- **Auth:** a shared bearer token, no user credentials. Configured at both ends.
  In OMI it's the `MAILFLOW_INGEST_TOKEN` platform setting (env var of the same
  name as a fallback). If unset, the endpoint replies `503` (not configured).
- **Idempotent on `id`** (MailFlow's suggestion UUID): a re-POST updates the
  MailFlow-provided fields in place, never duplicates, and never resurrects a
  row a reviewer already applied or dismissed.
- **Per-item response** so MailFlow can mark its own rows pushed:
  `{ "results": [ { "id": "...", "accepted": true } ] }`. A bad item comes back
  `{ id, accepted: false, error }` without failing the batch.
- Sized for a few hundred items per batch (first full sweep ≈ 244 senders, then
  a handful/day). Hard cap 1000/batch.

### Payload item

```json
{
  "id": "b3f1c2a4-…",
  "category": "left_or_moved",            // or "mentions_alt_contact"
  "person": { "name": "Jane Doe", "current_email": "jane.doe@oldfirm.com",
              "new_email": "jane@newstudio.com", "new_company": "New Studio",
              "role": "Head of Communications" },
  "alt_contacts": [ { "name": "Tom Reed", "email": "tom@oldfirm.com",
                      "role": "Press enquiries", "company": "Old Firm" } ],
  "source": { "from_email": "jane.doe@oldfirm.com", "subject": "Automatic reply: …",
              "quote": "I have left Old Firm. Please contact me at jane@newstudio.com.",
              "message_date": "2026-03-14T09:26:00Z" },
  "confidence": 0.9,
  "detected_at": "2026-10-01T07:00:12Z"
}
```

- `current_email` / `source.from_email` is the address OMI matches to an
  existing contact. Every address is verbatim from the email — MailFlow never
  invents one.
- `confidence` is a sort key for review, not a filter.

## What OMI does with each suggestion

On ingest OMI **matches** the sender address to an existing contact and applies
its **taxonomy** (`journalist` / `client` / `supplier` / `prospect` / `general`,
or `unknown` when nothing matches), derived from the contact's `kind` /
`contact_type`. The review queue is ordered by that class weight, then
confidence — a journalist's new masthead or a client's new firm outranks a
general contact's away note.

## Review & apply (authenticated, in-OMI)

- `GET  /api/outreach/ooo/suggestions?status=pending|applied|dismissed|all`
- `POST /api/outreach/ooo/suggestions/:id/apply`  (`{ alt_indexes?: number[] }`)
- `POST /api/outreach/ooo/suggestions/:id/dismiss`

Apply behaviour:
- **left_or_moved** → update the matched contact's `email` / `company` / `role`
  (whichever the suggestion carries). No match → create a new library contact.
- **mentions_alt_contact** → create a library contact for each chosen alt entry.

## Storage

Table `ooo_suggestions` (migration `180`): the MailFlow fields plus OMI-owned
review state (`status`, `matched_contact_id`, `contact_class`, `applied_at`,
`applied_note`). `id` is the primary key / idempotency key.

## Privacy

Suggestions are proposals — nothing is applied until a person approves. Only the
extracted fields cross the boundary: no message bodies, credentials, or account
settings. The `quote` is a ≤200-char verbatim snippet for reviewer context.

## Setup checklist

1. Generate a shared token; set `MAILFLOW_INGEST_TOKEN` in OMI (platform setting
   or env) and give the same value to MailFlow.
2. Point MailFlow at `POST https://<omi-host>/api/ooo/suggestions`.
3. Review the queue in OMI (UI: forthcoming) and approve/apply.

## Later phases (not required for launch)

- A callback so MailFlow learns the outcome (applied / dismissed) and reflects
  it on its side.
