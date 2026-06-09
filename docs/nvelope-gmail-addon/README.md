# nvelope PR for Gmail

A Google Workspace (Gmail) add-on that puts the nvelope PR module in the inbox
sidebar. Open an email and it shows the sender's **journalist profile** (outlet,
relationship strength, published coverage, beats, availability) and **recent
coverage**, with one-tap actions to:

- **Log this thread** to a client's editorial log (pick the client + status), and
- **Capture an unknown sender** as a **press** (media) or **industry**
  (commercial) contact.

It talks to the platform's externally-authenticated PR add-on API
(`/api/pr-addon`) using an `X-OMI-Key` shared secret — no platform login needed
in Gmail.

Code lives in `dev/nvelope-gmail-addon` (Apps Script). This folder holds the
docs.

---

## How it works

| Piece | Where |
|-------|-------|
| Apps Script add-on | `dev/nvelope-gmail-addon/Code.gs` + `appsscript.json` |
| Backend API | `dev/platform/backend/src/routes/prAddon.js`, mounted at `/api/pr-addon` |
| Auth | `X-OMI-Key` header, checked against the key in **Settings → PR · Gmail add-on** |

Endpoints the add-on calls:

- `GET /api/pr-addon/lookup?email=…` → `{ matched, name, outlet, segment, beats, strength, strength_label, published, last_featured, availability, recent[], clients[] }`
- `POST /api/pr-addon/contacts` → `{ name, email, segment: 'media'|'commercial', publication, tags }`
- `POST /api/pr-addon/editorial-log` → `{ client_id, story_title, press_contact, email, status, notes_outcome }`

`clients[]` (active clients) is returned on every `lookup` so the sidebar's
"Log this thread" card can show a client dropdown — the platform logs against a
client **id**, not a free-text name.

---

## 1. Get the API key

In the platform: **Settings → (General) → PR · Gmail add-on**.

1. Click **Generate key** (admins only). Copy the **API key**.
2. Copy the **API base URL** shown there — e.g. `https://platform.octobercomms.com/api/pr-addon`.

Rotate any time with **Regenerate** (the old key stops working immediately; update
the add-on afterwards).

## 2. Create the Apps Script project

```bash
npm install -g @google/clasp
clasp login
cd dev/nvelope-gmail-addon
clasp create --type standalone --title "nvelope PR for Gmail"   # writes .clasp.json
clasp push                                                       # uploads appsscript.json + Code.gs
```

(If you prefer, create the project at script.google.com and paste `Code.gs` +
the `appsscript.json` manifest by hand. `.clasp.json` is gitignored — copy
`.clasp.json.example` and fill in the script id.)

## 3. Connect it

Open the add-on (its homepage/config card) and paste the **API base URL** and
**API key** from step 1, then **Save**. These are stored in the script's
properties (`OMI_BASE`, `OMI_KEY`).

## 4. Install it

**Just for you (fastest):** in the Apps Script editor → **Deploy → Test
deployments → Install**. The add-on appears in your Gmail right-hand sidebar.

**One-click for the whole team:** publish it **privately to your Google
Workspace Marketplace** (unlisted), then a Workspace admin does a **domain-wide
install** so it appears for everyone automatically. This is a one-time setup:
create a GCP project, enable the **Google Workspace Marketplace SDK**, configure
the **OAuth consent screen**, and point an app configuration at this Apps Script
deployment. After that, installing is a single click for each user (or
domain-wide by the admin).

> There is no true one-click public button without going through Google's
> deployment flow — that's a Google platform requirement, not ours.

---

## Notes

- **Segments:** "Add as press" creates a `media` contact (resolves/creates the
  publication as an outlet); "Add as industry" creates a `commercial` contact.
  An existing contact with the same real email is reused (no duplicates).
- **Placeholder emails:** senders captured without a usable email get a
  synthetic `noemail+<hash>@import.local` address, matching the platform's
  import convention, so they never collide on a blank email.
- **Logged threads** are stored with `source = 'gmail'` so they're
  distinguishable from manual/CSV/monitor entries.
- **Security:** the key is the only credential; treat it like a password and
  rotate it if it leaks. The API is read/write to PR contacts + the editorial
  log only — it can't reach anything else in the platform.
