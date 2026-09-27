# Warm-journalist alerts

## What went wrong

The interest watcher flagged a journalist "warm" at **3 opens or any click**,
and emailed one alert per journalist per campaign. On a 10,656-recipient
release that produced hundreds of emails in a few days.

They were not real. `open_count` increments on every fetch of the tracking
pixel, and **Apple Mail Privacy Protection and Gmail's image proxy pre-fetch
images without a human reading anything**, repeatedly, over days. A threshold
of three opens is one machines cross unaided. The counter moved; nobody was
interested.

This is the same effect that makes open-tracking useless for geolocation. It
was known and written down; nobody joined it to the warm threshold.

## What changed

**Opens no longer warm anyone by default.** `DEFAULT_CONFIG.min_opens` is `0`,
meaning off. A click is a deliberate human action image proxies do not
perform. Not spotless, since corporate link scanners do fetch URLs, but a
different order of noise. Set `min_opens` in `clients.press_warm_config` to
bring opens back per client.

**The email is batched and switchable.** `PRESS_WARM_ALERTS`:

| Mode | Behaviour |
|---|---|
| `digest` | **Default.** One email a day listing everyone who went warm |
| `each` | One email per journalist. The original behaviour |
| `off` | No email. The warm flag and dashboard still work |

Per-client override lives at `press_warm_config.alerts`.

**The flag and the email are now separate concerns.** In every mode the
journalist is still flagged warm and still appears on the coverage dashboard.
The complaint was about the inbox, not the intelligence.

## Details worth keeping

- **`min_opens: 0` needs an explicit guard.** A bare `opens >= cfg.min_opens`
  makes every contact with zero opens warm. The code tests for a positive
  threshold first. Get this wrong and the fix becomes the worse bug.
- **Existing rows were backfilled as already alerted** (migration 187), so
  switching the digest on does not immediately mail the backlog that caused
  the complaint.
- **Switching to `off` clears the pending queue**, so turning it back on later
  does not deliver everyone who went warm while it was off.
- **The digest marks rows sent only after the email succeeds**, so a mail
  failure retries tomorrow instead of silently swallowing a batch.
- Digest cron: 08:45 daily, in `scheduler.js`.

## Changing it

Settings → Connections → Email, or `PRESS_WARM_ALERTS` in platform settings.
`GET`/`PUT /settings/press-warm-alerts`; the GET also reports how many warm
journalists are pending for the next digest.

## Tests

24 assertions against Postgres, the load-bearing one being that **25 opens
with no click produces no alert and no warm flag**, which is the exact shape
of the flood. Also covers: a click warming, the old 3-open behaviour still
available per client, the `min_opens: 0` guard, mode resolution and fallback
for a nonsense value, one digest covering many journalists, a second digest
run sending nothing, and `off` flagging warm without emailing or leaving a
backlog.

A first run surfaced a scoping bug this change introduced, where the coverage
push referenced a variable that had moved inside a branch. It only logged a
warning because that function is currently a no-op, so it would have sat
unnoticed until someone wired it up.

## Code map

- `backend/migrations/187_press_warm_alert_mode.sql`
- `backend/src/services/pressInterest.js` — `DEFAULT_CONFIG`, `scoreAndReason`,
  `alertMode`, `sendWarmDigest`
- `backend/src/services/emailService.js` — `sendWarmJournalistDigest`
- `backend/src/services/scheduler.js` — the 08:45 digest cron
- `backend/src/routes/settings.js` — `/settings/press-warm-alerts`
