# OMI for Gmail — add-on

A Google Workspace Add-on that surfaces the **October Outreach PR module** inside
Gmail: open an email and see the sender's journalist profile and recent coverage,
log the thread to the editorial log, or add an unknown sender to the contacts
database — all via the plugin's REST API.

**Code:** `dev/oo-gmail-addon/` (`appsscript.json`, `Code.gs`).
**Backend:** the `oo/v1` REST API in the October Outreach plugin (v3.18+):
`GET /lookup`, `POST /editorial-log`, `POST /contacts`.

## What it does

- **Contextual sidebar** (`onGmailMessageOpen`): reads the sender's address, calls
  `GET /lookup?email=…`, and shows the matched journalist — outlet, beats,
  availability, relationship strength, recent coverage.
- **Log this thread**: posts to `POST /editorial-log` with the subject, sender and
  a chosen client + status.
- **Add unknown senders**: if not matched, offers **Add as press** (media) or
  **Add as industry** (commercial, with tags) → `POST /contacts`.

Only the open message's metadata is read — no full-mailbox access.

## One-time setup

1. **Get the API key**: in WordPress → **PR/Outreach → Settings → PR API**, copy
   the key and the base URL (`https://YOURSITE/wp-json/oo/v1`).
2. **Create the Apps Script project** and push the code with
   [`clasp`](https://github.com/google/clasp):
   ```bash
   npm install -g @google/clasp
   clasp login
   clasp create --type standalone --title "OMI for Gmail"   # writes .clasp.json
   clasp push                                                 # uploads appsscript.json + Code.gs
   ```
   (Or paste `Code.gs` and the manifest into a new project at script.google.com.)
3. **Connect it**: open the add-on (it shows a "Connect OMI" card on first run),
   paste the **API base URL** and **API key**, Save. These are stored in the
   script's properties.
4. **Deploy as a Workspace Add-on**: in the Apps Script editor → **Deploy → Test
   deployments** (install for yourself) or **Deploy → New deployment → Add-on**
   and publish to your Workspace.

## Notes

- The add-on authenticates to OMI with the `X-OO-Key` header — rotate the key in
  OMI Settings if it's ever exposed (the add-on just needs the new value pasted
  back into its config).
- Background "living link" status auto-advance (updating a thread's status without
  opening it) needs the heavier Gmail-API `users.watch` OAuth flow — out of scope
  here; this add-on updates when you open the thread.
