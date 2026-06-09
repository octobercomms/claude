# Contacts merge — plan

**Goal:** one contacts system, not two. Today OMI has two unrelated people
databases:

- **Press** (`pr_contacts` + `pr_outlets`) — journalists & "industry" contacts,
  with beats, outlet, coverage history, availability, photo. Surfaced in each
  client's PR tab, the journalist/outlet profile pages, and the cross-client
  publication-dedup admin page (renamed **Press**).
- **Outreach** (`outreach_contacts` + `outreach_contact_clients`) — cold-email
  prospects, with email verification, bounce/unsubscribe state, per-client
  membership, and campaign engagement. Surfaced in **Settings → Contacts** and
  each client's Email tab.

They share no data, so the same person can exist in both, separately. We're
merging them into **one** table with a `kind` (prospect / media / industry).

**The current contact data is disposable** — the real source of truth is a
spreadsheet, and nothing in the platform's contacts has been used in anger. So
we **wipe and re-import** rather than carefully migrating: no dedupe, no
backfill, no provenance mapping. The merge is purely schema + code + a one-time
CSV re-import into the unified table.

## Canonical table: `outreach_contacts`

`outreach_contacts` becomes the single contacts table. Rationale: it carries the
much larger FK graph (campaigns, sequences, sends, replies, verification, bounce,
tasks, **and** the `outreach_contact_clients` many-to-many membership), and it
already models the "workspace-wide contact attachable to many clients" shape we
want. Only **three** columns reference `pr_contacts`
(`pr_editorial_log.contact_id`, `pr_sent_thanks.contact_id`,
`pr_thank_feedback.contact_id`), so migrating the PR graph *into*
`outreach_contacts` is far less invasive than the reverse.

`pr_outlets` stays as the **Publications** table; contacts link to it via a new
`outlet_id`.

## Phases

1. **Additive schema + rename (this PR — `077`).** Add the press fields to
   `outreach_contacts` (`kind`, `outlet_id`, `beats`, `availability_status`,
   `available_from`, `photo_url`, `bio_link`, `last_contacted`). Existing rows
   default to `kind='prospect'`. Non-breaking; nothing moved yet. Also renames
   the "Media DB" nav → **Press**.
2. **Wipe + repoint (next).** The contact data is disposable, so: clear the old
   press tables, repoint the three PR foreign keys
   (`pr_editorial_log.contact_id`, `pr_sent_thanks.contact_id`,
   `pr_thank_feedback.contact_id`) to reference `outreach_contacts`, and point
   the PR code (`pr.js` resolve/lookup/journalist analytics, `prAddon.js`,
   `prThanks.js`, `prReports.js`, profile endpoints) at the unified table,
   filtering press views by `kind IN ('media','industry')`. Drop `pr_contacts`.
   (`pr_outlets` stays as the Publications table.)
3. **UI consolidation + re-import.** One **Contacts** home with tabs — *Press*
   (journalists), *Publications*, *Prospects* — replacing the separate "Media DB"
   page and Settings → Contacts library; per-client tabs filter the same data.
   Then re-import the people from the spreadsheet via CSV into the unified table
   (one importer that sets `kind`).

## Import (phase 3)

A single CSV importer writes into `outreach_contacts`, setting `kind` from a
column (Press/Media → `media`, Industry → `industry`, otherwise `prospect`),
resolving `outlet_id` against `pr_outlets` (Publications) for media rows, and
attaching to clients via `outreach_contact_clients` where a client column is
given. This replaces both the old PR CSV importer and the outreach library
import with one path.

## Rollback

Phase 1 is purely additive (drop the added columns). Because the data is
disposable and re-imported from the spreadsheet, phases 2–3 don't need data
rollback — if anything goes wrong, re-run the wipe and re-import.
