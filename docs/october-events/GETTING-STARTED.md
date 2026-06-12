# October Events — getting started

A short guide for the team. Two surfaces:

- **The platform** — `platform.atlantadesignfestival.net` — the friendly day-to-day
  tool (Dashboard, Events, Tasks, Volunteers, Email, Contacts).
- **wp-admin → October Events** — the full back office (approvals, tickets,
  settings, the email log, AI Stories).

They're the same data: the platform is a nicer front-end on the plugin.

---

## 1. Sign in to the platform

1. In WordPress: **Users → Profile → Application Passwords** → add one (name it
   "Platform"), copy the `xxxx xxxx xxxx xxxx` it shows.
2. Go to `platform.atlantadesignfestival.net`, enter the **Site URL**
   (`https://atlantadesignfestival.net`), your **WordPress username**, and that
   application password.
3. You need an **Editor or Admin** WordPress role to sign in.

> Running more than one site (e.g. Architecture Tours)? Use **+ Add a site** in the
> sidebar and switch between them.

Every page opens with a **"What you can do here"** guide — dismiss it with the ×,
bring it back with the small "ⓘ" link.

## 2. Get an event to green (Elayne)

**Events** board → open an event → fill the essentials (**title, dates & times,
price, location**) → the readiness meter fills → **Confirm — go green** publishes
it live. Add sessions and internal notes there too.

> If events already hold their data in JetEngine, map those fields once under
> **wp-admin → October Events → Settings → Event field mapping**, then click
> **Seed planning from existing fields** on Event Planning — your events will show
> their real readiness instead of 0%.

## 3. Run the team's work (everyone)

**Tasks** board → add a task (title + department), drag it across
**To do → In progress → Blocked → Done**, set an assignee and due date. It's the
same board as wp-admin → Tasks.

## 4. Staff the volunteers (Ashleigh)

Create a **volunteer opportunity** in wp-admin (Volunteer → Add new) and define
its **shifts** (label, start, end, capacity). Then in the platform's
**Volunteers** view: open an opportunity, confirm / decline / no-show each signup,
check people in on the day, or add someone to a shift manually. Confirmed
signups get email reminders (SMS too, once AWS SMS is connected).

## 5. Send a campaign (marketing)

**Email** → **New campaign** → set subject, preheader and **audience**
(all subscribers / SMS opt-in / by source). Then either:

- **Build it** block by block (heading / text / image / button / divider), picking
  images from the WordPress media library, **or**
- **Draft with AI** — brief the co-pilot in plain language ("September newsletter,
  lead with the opening party, include the confirmed tours, warm tone") and it
  writes it in the house voice, grounded in real confirmed events. Anything it
  can't verify becomes a visible `[TODO: confirm]`.

**Send test** to yourself, then **Send / schedule**. Every send carries an
unsubscribe link + open/click tracking.

> Contacts build themselves from accounts, ticket buyers, volunteers and
> submitters — no imports. To bring an existing list, use
> **wp-admin → Contacts → Import a CSV**.

---

## Admin: connect the services (one-time)

All optional — the system runs without them, and each switches on from Settings:

| Service | Where | Notes |
|---|---|---|
| **Stripe** | Settings → API keys | Payments for tickets/listings |
| **Claude** | `OE_CLAUDE_API_KEY` (wp-config) or Settings | Co-pilot + AI Stories |
| **Amazon SES** | Settings → Email sending | Enable + SMTP user/pass + region + verified from-address. Until then, email uses the site's current transport. |
| **SES bounces/complaints** | point an SNS topic at `…/wp-json/oe/v1/ses-sns` | Auto-suppresses bad addresses |
| **AWS SMS** | Settings → SMS | Access key/secret + region + origination number (US needs 10DLC) |
| **Chatwoot** | Settings → Live chat | Base URL + website token |
| **Branding** | Settings → Branding | Per-site colours, logos, and a font (upload a file or a stylesheet URL) |

### Make scheduled email reliable

The campaign sender drains on a per-minute schedule **plus** a traffic-driven
fallback, so a quiet site still sends. For best results add a real server cron so
WordPress's scheduler always runs on time:

```
* * * * * curl -s https://atlantadesignfestival.net/wp-cron.php?doing_wp_cron >/dev/null 2>&1
```

(Optionally set `define('DISABLE_WP_CRON', true);` in `wp-config.php` so only the
real cron fires it.)

### Deliverability (before your first big send)

- Authenticate the sending domain: **DKIM + SPF + DMARC**.
- Request **SES production access** (it starts in sandbox).
- Warm up gradually — start with transactional/engaged recipients, big blasts last.
- Keep bounces < 5% and complaints < 0.1% (the suppression list does this for you).

## Where things live

- **Public site** (listings, map, checkout, the volunteer sign-up widget) is
  rendered by Elementor/JetEngine using the plugin's shortcodes
  (`[oe_event_checkout]`, `[oe_volunteer_signup]`, …) — place these on the
  relevant pages.
- **Staff tools** are the platform + wp-admin.
- **Ads** are the separate `oc-ad-manager` plugin (cross-site), not this one.
