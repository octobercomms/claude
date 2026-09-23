# Book a call

October's own booking widget for octobercomms.com. It looks like the site (black, yellow, lowercase Brockmann) and takes live availability from Daniel's Google Calendar. Each booking creates a Google Meet event, and Google sends the invite. The booking is written onto the pipeline lead (see `sales-pipeline.md`), so the call brief is ready before the call.

## Why build it rather than use Google's booking page

Google Calendar appointment schedules already show free times and attach a Meet link. On its own, that gives nothing extra. What the custom widget adds:

| Need | Google booking page | This widget |
|---|---|---|
| Looks like octobercomms.com | No, Google's styling | Yes |
| Booking lands on the OMI lead | No, needs manual matching | Yes, and a Snapshot run earlier links to the same lead |
| Call brief ready before the call | No | Yes, generated on booking |
| Qualifying questions (goal, budget, referral) | Limited, not in OMI | Yes, stored and shown in the alert |
| Attribution ("how did you hear") | Lost | Captured |

The cost is maintenance: time zones, double bookings, and moving or cancelling. Those are handled below and covered by tests. If this widget ever breaks, Google's page is the fallback, so keep an appointment schedule set up but unpublished.

## Flow

1. **Visitor picks a day and time.** Times show in the visitor's own zone. Availability is Daniel's working hours (Europe/London), minus Google Calendar busy blocks with a buffer either side, minus days already at the daily cap.
2. **Visitor fills in the form.** Name, work email, company and website are required. "What do you want more of?" is optional. A monthly budget band is required. "How did you hear about us?" is optional.
3. **OMI books it.** Under a database lock, OMI re-checks the slot against fresh calendar data, then creates the event with a Meet link and the prospect as a guest. Google emails the invite with its own reminders. The event description carries the visitor's answers and a link to move or cancel the booking (`/b/:token`).
4. **The pipeline updates.** OMI finds the lead: first the Snapshot the visitor ran (the token is passed through the booking page URL), then any lead with the same email, otherwise it creates a new lead from their website. It marks the call booked, adds the answers to the call notes and generates the call brief. If there was no Snapshot, it reads their site first.
5. **Daniel gets an alert.** It includes who, when, the goal, the budget, the referral and the Meet link. A budget below the Basic tier is flagged, so Daniel decides before the call whether to keep it.
6. **Moving or cancelling.** The prospect uses the manage link. The event moves or is cancelled in Google, which sends updated invites, and the lead updates. Daniel gets an alert either way. A cancellation alert suggests offering two specific times to rebook.

## Set-up

1. **Connect the calendar:** Settings → Biz dev → Booking → Connect Google Calendar.
   - Sign in with the account whose calendar should take bookings.
   - OMI asks for two calendar permissions: busy times only (never event details), and permission to create and manage events.
   - It uses OMI's existing Google OAuth app and redirect URI, so nothing new is registered with Google.
   - If the OAuth app is still in Google's "Testing" mode, the account must be a listed test user.
2. **Check availability on the same tab.** Defaults:
   - 30-minute calls
   - Monday to Friday, 09:30-12:30 and 13:30-17:00
   - 15-minute buffer either side
   - at least 12 hours' notice
   - bookable up to 21 days ahead
   - at most 3 calls a day

   Add a personal calendar ID to "also block time from" so personal plans block bookings too.
3. **Embed the widget.** Copy the snippet into an Elementor HTML widget on `octobercomms.com/book/`:
   ```html
   <script src="https://platform.octobercomms.com/api/public/booking/embed.js" data-theme="dark"></script>
   ```
   The Snapshot's "book your walkthrough" button already sends visitors to this page with `?snapshot=<token>`, and the loader passes it through.
4. **Other domains:** if the widget is ever embedded anywhere other than octobercomms.com, add the domain to `BOOKING_EMBED_ORIGINS`.

## Decisions for Daniel

- **Budget question.** It is required, and "Not sure yet" is an option. It is the cheapest qualifier available: at 1,800 a month minimum, a prospect with a £500 budget costs you 30 minutes plus the prep. It lowers form completion slightly and raises the quality of calls. The widget does not block low budgets; it flags them. If calls with low budgets start taking up the diary, gate them to a 15-minute fit check instead.
- **Call length.** 30 minutes is the default. The copy on the widget says 30, so change both together.

## Limits

- No reminder emails from OMI. Google's invite reminders cover it, and a second reminder system would double-message.
- A prospect can move a booking at most 3 times (configurable). After that the manage page tells them to reply to the invite.
- Availability is cached for 60 seconds for page loads. Booking always re-checks against fresh calendar data, so the cache can never cause a double booking.
- If the calendar disconnects (a revoked token), the widget shows "email us" rather than times, and the server logs the reason. Check Settings → Booking.

## Code map

- `dev/platform/backend/migrations/184_bookings.sql`: `booking_settings`, `bookings`
- `dev/platform/backend/src/services/googleCalendar.js`: OAuth, free/busy, Meet event create, move and cancel
- `dev/platform/backend/src/services/booking.js`: availability rules, time-zone maths, lock-guarded booking, lead linking
- `dev/platform/backend/src/routes/publicBooking.js`: public API, the widget and its loader
- `dev/platform/backend/src/routes/booking.js`: admin API
- `dev/platform/backend/src/routes/oauth.js`: `/auth/google/calendar/start`, plus a callback branch on `purpose=calendar`
- `dev/platform/frontend/src/pages/BookingSettingsPage.jsx` (Settings → Biz dev → Booking), `BookingManagePage.jsx` (`/b/:token`)
