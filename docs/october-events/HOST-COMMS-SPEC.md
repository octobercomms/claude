# Host contacts & info-pack comms

The people we deal with about each event or tour (homeowner, architect, realtor,
organiser…) stored on the event/tour, with an info pack and reminders sent to
them. Saves re-answering the same questions every year and looks slicker.

## Data model

- **Contacts** (`OE\Hosts\Contacts`) — post meta `_oe_host_contacts`, a JSON array
  of rows `{name, email, phone, role, role_label}`. Roles: homeowner, architect,
  realtor, designer, organiser, other (free-text label). Structured, not
  comma-separated, so emails address the right person and a send can target a
  role later.
- **Per-post PDF** — `_oe_host_pdf` (attachment id). Overrides the master pack.
- **Sent log** — `_oe_host_sent` = `{occasion: datetime}` so each occasion sends
  once (`info`, `r2w`, `r2d`).

## Which posts

`OE\Hosts\HostMailer::host_post_types()` = the event CPT (`events`) plus the tour
CPT (the site's `location` post type, from Settings → `location_post_type`). So
events live on the festival site, tours on the Architecture Tours site; the same
code serves both. `kind()` returns `event` or `tour` and switches the copy.

## Dates

- Event: `Ics::start_ts()` / `Ics::when_label()`.
- Tour: the meta key named by Settings → `location_date_field` on the tour post
  (numeric timestamp or a parseable string).

## Emails

`OE\Hosts\HostMailer` sends a branded email (via `Transactional::send('host_pack',
…)`, logged in Check & Log Email) to every mailable host contact, with the PDF
attached (per-post, else the master for the kind). Copy differs by kind:

- **Tour:** we provide signage; we organise and brief the volunteers who turn up
  to welcome guests and scan tickets; the pack covers preparing the home and the
  day.
- **Event:** be open for the times in the pack; recruit your own volunteers (the
  pack explains how), and we can brief them.

Occasions: `info` (manual, from the metabox button), `r2w` (2 weeks before) and
`r2d` (2 days before). Reminders are automatic from the hourly cron
(`run_due_reminders`), once each, only after the info pack has been sent and only
when the post has a date in the future.

## Settings (Host comms accordion)

- `host_pack_tour_pdf`, `host_pack_event_pdf` — master PDFs (attachment ids).
- `host_staff_contact_name`, `host_staff_contact_email` — the "your contact" line.
- `host_reminders_enabled` — master switch for the automatic reminders.

## Admin

"Hosts & info pack" metabox on each event/tour: the contact repeater, the PDF
picker (with master-fallback note), a "Send info pack now" button, a Preview, and
the date/sent status. Reminders need no action once the pack is sent.

## Not yet (future)

- Send to one role only.
- Editable email copy in Settings.
- A generated (rather than uploaded) PDF pack.
