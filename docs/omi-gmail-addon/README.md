# OMI for Gmail — setup guide

This is a little panel that appears **inside Gmail**, on the right-hand side.
When you open an email from a journalist, it instantly shows you who they are,
what they've written about your clients before, and lets you:

- **Log the email** to a client's coverage record, and
- **Save a new contact** (press or industry) without leaving your inbox.

You only have to set this up **once**. It takes about 15 minutes. You don't need
to be technical — just follow the steps in order. Every time you need to click
something, there's a link.

---

## Before you start

You need two things, and this guide shows you where to get both:

1. A **web address** and a **key** from your platform (Part 1 below).
2. A **Google account** — the same one you use for Gmail.

That's it. No software to install.

---

## Part 1 — Get your two connection codes

These come from your own platform.

1. Go to **[platform.octobercomms.com/settings](https://platform.octobercomms.com/settings)** and sign in.
2. Stay on the **General** tab and scroll down to the box titled **"PR · Gmail add-on."**
3. Click the **Generate key** button.
4. You'll now see two pieces of text. Keep this tab open — you'll copy them in Part 4:
   - **API base URL** (looks like `https://platform.octobercomms.com/api/pr-addon`)
   - **API key** (a long line of letters and numbers — click **Reveal** to see it)

> Think of these like a **website address** and a **password** that let Gmail
> talk to your platform. Don't share the key with anyone outside your team.

---

## Part 2 — Create the add-on (in your web browser)

You're going to create a tiny Google project and paste in two files. Don't
worry about what the code means — you're just copying and pasting.

1. Open **[script.google.com](https://script.google.com)** in your browser
   (sign in with your Gmail account if asked).
2. Click the **＋ New project** button (top-left).
3. A code editor opens with a file called **`Code.gs`** and the words
   `function myFunction() {}` in the middle.
   - Click anywhere in that middle area, select everything (**Ctrl + A** on
     Windows, **Cmd + A** on a Mac), and delete it.
   - Open the file **`dev/omi-gmail-addon/Code.gs`** from this project, copy
     **all** of its contents, and paste it into the empty editor.
4. Now add the settings file:
   - On the left, click the **gear icon ⚙️ ("Project Settings")**.
   - Tick the box that says **"Show `appsscript.json` manifest file in editor."**
   - Go back to the editor (the **`< >` Editor** icon on the left). You'll now
     see a second file, **`appsscript.json`**, in the file list.
   - Click it, delete everything inside, then copy **all** the contents of
     **`dev/omi-gmail-addon/appsscript.json`** from this project and paste it in.
5. At the top, name your project by clicking **"Untitled project"** and typing
   **OMI for Gmail**.
6. Click the **save icon 💾** (or **Ctrl/Cmd + S**).

---

## Part 3 — Turn it on for yourself

1. In the same editor, click the blue **Deploy** button (top-right) →
   **Test deployments**.
2. In the window that appears, click **Install**, then **Done**.
3. Google may ask you to **allow permissions** — click through, choose your
   Google account, then **Allow**. (You might see a "Google hasn't verified this
   app" screen because it's your own private add-on — click **Advanced**, then
   **"Go to OMI for Gmail (unsafe)."** This is safe; it only says that because
   the add-on is private to you.)

---

## Part 4 — Connect it to your platform

1. Open **[Gmail](https://mail.google.com)** and open **any email**.
2. On the far right, you'll see a small strip of icons. Click the new
   **OMI for Gmail** icon (a little megaphone). The panel opens.
3. The first time, it asks for your two codes. Go back to the platform tab from
   Part 1 and:
   - **Copy** the **API base URL** → paste it into the **API base URL** box.
   - **Copy** the **API key** → paste it into the **API key** box.
4. Click **Save**. Done — it's connected.

---

## Part 5 — Using it day to day

Open any email and click the **OMI for Gmail** icon on the right:

- **If the sender is a journalist you already track**, you'll see their profile:
  their publication, how strong your relationship is, how many times they've
  covered your clients, and their recent stories.
- **To log the email**, choose the **client** it relates to, pick a **status**
  (e.g. *Pitched*, *Published*), and click **Add to editorial log.**
- **If the sender is new**, you'll get a card to **add them** as a **press**
  contact or an **industry** contact, with a place for their publication and
  any tags.

---

## If something goes wrong

- **"Couldn't reach OMI"** — the web address or key was mistyped. Click the
  **Settings** link in the panel and paste them again carefully (no extra
  spaces).
- **The icon doesn't appear in Gmail** — refresh Gmail (reload the page). If
  it's still missing, repeat Part 3.
- **You think the key was leaked** — go back to the platform's **PR · Gmail
  add-on** box and click **Regenerate**. This makes a new key; paste the new one
  into the add-on (Part 4) and you're safe again.

---

## (Optional) Roll it out to your whole team

The steps above install it for **you**. If you'd like **everyone in your
organisation** to get it automatically, your Google Workspace administrator can
publish it once to your private company app store (the **Google Workspace
Marketplace**) and install it for everybody in one click. That's a one-time job
for an admin, described in Google's own guide here:
**[Publish a Google Workspace add-on](https://developers.google.com/workspace/marketplace/how-to-publish)**.
Share this README and the `dev/omi-gmail-addon` folder with whoever handles that.

---

## For developers (faster setup)

If you're comfortable with a terminal, you can skip Part 2 and push the code
with Google's `clasp` tool instead:

```bash
npm install -g @google/clasp
clasp login
cd dev/omi-gmail-addon
clasp create --type standalone --title "OMI for Gmail"
clasp push
```

`.clasp.json` is gitignored — copy `.clasp.json.example` and fill in your
script id. The add-on reads its two settings (`OMI_BASE`, `OMI_KEY`) from the
script's properties, set via the in-Gmail config card (Part 4).

The backend it talks to is `dev/platform/backend/src/routes/prAddon.js`, mounted
at `/api/pr-addon` and authenticated by the `X-OMI-Key` header against the key
in **Settings → PR · Gmail add-on**. Endpoints: `GET /lookup?email=…`,
`POST /contacts`, `POST /editorial-log`.
