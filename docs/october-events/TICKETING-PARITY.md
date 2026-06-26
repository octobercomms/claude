# Ticketing parity — old "Event Tickets" (`oct_`) → October Events (`oe_`)

Audit of the retired **Event Tickets** plugin (`dev/october-event-tickets`, the
`oct_` / `wp_oct_*` system) against the **October Events** ticketing module
(`dev/october-events`, the `oe_` / `wp_oe_*` system), so we can guarantee feature
parity as the old plugin is switched off.

## At parity (already built in October Events)

| Area | Old | New |
|------|-----|-----|
| Events (CPT `events`, JetEngine) + ticket meta | `_oct_ticket_types`, `_oct_checkin_*` | `_oe_ticket_types`, `_oe_checkin_*` |
| Ticket types (price, sale price, capacity, group `qty_per_purchase`, sale windows) | ✓ | ✓ |
| Promo codes (`percent`/`fixed`, event-scoped, `max_uses`, expiry) | `wp_oct_promo_codes` | `wp_oe_promo_codes` |
| Orders + per-admission tickets (unique token) | `wp_oct_orders` / `wp_oct_tickets` | `wp_oe_orders` / `wp_oe_tickets` |
| Manual / comp orders, cancel, **Stripe** refund, CSV export | ✓ | ✓ (also account-linked, `source`) |
| Check-in PWA — PIN-gated, QR scan, venues/doors | `/oct-checkin/` route | `[oe_checkin]` shortcode |
| Check-in records | `wp_oct_checkins` | `wp_oe_checkins` |
| QR codes (token payload) | qrserver API | client-side `qrcode.min.js` on the ticket page |
| Confirmation email + daily sales-report email | ✓ | ✓ |
| Stripe checkout + webhook | ✓ | ✓ (`oe/v1`, `adf/v1` alias) |

## Gaps (to close)

1. **`[oct_checkout]` shortcode alias — DONE (1.41.2).** Live checkout pages use the
   old `[oct_checkout event_id="…"]`; October Events only aliased `adf_*`. Added
   `oct_checkout → oe_event_checkout` to `Compat::SHORTCODE_ALIASES`.
2. **Check-in Log admin screen — TODO.** Old plugin had a paginated *Check-in Log*
   (event filter, per-venue stats, who/when/where). New plugin records the same
   data (`wp_oe_checkins`, `CheckIn::stats()`) but exposes no admin screen — only
   in-PWA stats. Add an admin screen (Tickets → Check-in log).
3. **Waitlist — TODO (build fresh).** The repo copy of the old plugin (v1.0.0) has
   **no waitlist code**, though the live site shows a Waitlist menu — so the live
   build is newer than the repo. Needs building from scratch: join form/shortcode,
   capacity trigger, admin screen, promote-to-order flow. (If the newer old-plugin
   zip surfaces, match it exactly instead.)

## Minor / optional differences

- **PayPal** — old plugin had Stripe + PayPal; new is Stripe-only.
- **QR in email** — old embedded the QR image in the confirmation email; new links
  to the ticket page (which renders the QR). Could embed for parity.
- **Sales dashboard** — old had a dedicated *Ticket Sales Dashboard* with a 30-day
  chart; new surfaces sales stats on the main Dashboard but without the chart screen.
- **Pretty ticket URLs** — old used `/oct-ticket/{token}/`; new uses `?oe_ticket=token`.
  (Old tickets don't migrate — their tokens live in `wp_oct_*` — so old links can't
  be made to resolve regardless.)
