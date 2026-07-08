# Falcon Enamelware — Dropbox Image Product Tagger

Tag a Dropbox folder full of product photos by **product type** so you can
filter it — "show me every photo with an oval plate", "every 3 pint jug", etc.

It uses **Claude** (vision) to look at each image, match it against a catalog of
your products, and record the result in two places:

1. **A local CSV index** (`falcon_tags.csv`) — one row per image with its
   Dropbox path and the matched product tags. Open it in Excel / Google Sheets
   and filter the *tags* column. This is your master, always-there list.
2. **Native Dropbox tags** — real tags on each file (e.g. `oval_plate`). On
   dropbox.com you can **filter/sort by Tags**, or type the tag into the search
   box, and just those photos appear.

Code lives in `dev/falcon-image-tagger/` (`dropbox_tagger.py`).

---

## How it works (the concept)

Dropbox can't natively "understand" what's in a photo. So the pipeline is:

```
Dropbox folder of photos ─▶ Claude vision (per image) ─▶ product tags ─▶ CSV + native Dropbox tags
                                                                              │
                                                                              ▼
                                                filter the CSV / filter Dropbox by tag
```

Your **category-page screenshot** becomes the *product catalog* — the list
Claude matches against. Edit the `PRODUCTS` list in `dropbox_tagger.py` so it
mirrors your category page (oval plate, 3 pint jug, …). The closer the catalog
matches your real range, the more accurate the tags.

Unlike the Google Drive version (a zero-setup Apps Script), Dropbox has no
"runs-inside-it" scripting layer — so this is a small **Python script you run**
on your computer (or any server / scheduled job).

---

## Setup (about 10 minutes)

1. **Install Python 3.9+**, then the dependencies:
   ```bash
   pip install -r dev/falcon-image-tagger/requirements.txt
   ```

2. **Get an Anthropic API key** and export it:
   ```bash
   export ANTHROPIC_API_KEY="sk-ant-..."
   ```
   (Key from <https://console.anthropic.com/>.)

3. **Create a Dropbox app** (for API access):
   - Go to <https://www.dropbox.com/developers/apps> → *Create app*
   - *Scoped access* → *Full Dropbox* (or *App folder* if your photos live in
     one) → name it.
   - On the app's **Permissions** tab, tick: `files.metadata.read`,
     `files.content.read`, and `files.metadata.write` (the last one lets it add
     tags). Submit.
   - On **Settings**, note the **App key** and **App secret**.

4. **Authorise the app** and get a durable refresh token (recommended for a big
   folder — a plain access token expires after ~4 hours). Easiest path:
   - On **Settings**, under *OAuth 2* → *Generated access token*, click
     **Generate** for a quick test token, or follow Dropbox's OAuth guide for a
     refresh token. Then export whichever you have:
   ```bash
   # Durable (recommended):
   export DROPBOX_REFRESH_TOKEN="..."
   export DROPBOX_APP_KEY="..."
   export DROPBOX_APP_SECRET="..."
   # …or quick test (expires in ~4h):
   export DROPBOX_ACCESS_TOKEN="..."
   ```

5. **Point it at your folder & tune the catalog.** In `dropbox_tagger.py`:
   - Set `CONFIG["FOLDER"]` to your Dropbox path, e.g. `"/Falcon Enamelware"`
     (use `""` for your whole Dropbox).
   - Edit the `PRODUCTS` list to match your category page. Tags must be
     lowercase letters/numbers/underscores, under 32 chars (a Dropbox rule) —
     e.g. `oval_plate`, `three_pint_jug`.

---

## Running it

1. **First, a dry run.** Leave `CONFIG["DRY_RUN"] = True` and run:
   ```bash
   python dev/falcon-image-tagger/dropbox_tagger.py
   ```
   - It fills `falcon_tags.csv` (path + tags per image) but touches nothing in
     Dropbox. **Spot-check the accuracy in the CSV** before going live.

2. **Go live.** Happy with the tags? Set `DRY_RUN = False` and run again — now it
   also writes the native Dropbox tags on each file.

3. **Big folders.** It's safe to leave running and safe to re-run: a
   `checkpoint.json` records what's been processed, so it never re-does work and
   picks up where it left off if interrupted (or rate-limited — it backs off and
   you just run it again).

### Filtering afterwards
- **In the CSV:** filter/sort the *tags* column, then find the file at its
  *path*.
- **In Dropbox (web):** open the folder → **Sort/filter by Tags**, or type a tag
  like `three_pint_jug` into the search box.

---

## Choosing the model & cost
`CONFIG["MODEL"]` picks the Claude model:

| Model | When |
|---|---|
| `claude-sonnet-5` *(default)* | Best balance — strong on tricky jug-size calls. |
| `claude-haiku-4-5` | Cheapest & fastest, for very large folders. |
| `claude-opus-4-8` | Highest accuracy, most expensive. |

Each image is one quick request. Pillow (installed via requirements) downsizes
images before sending, which keeps accuracy high while cutting token cost. For a
truly massive folder, start on Haiku, dry-run a sample, and step up if the
size/type calls aren't accurate enough.

## Undoing
Run `python dev/falcon-image-tagger/dropbox_tagger.py clear-tags` to remove every
product tag this tool applied. The CSV is just a file you can delete.

---

## Why Claude here (vs Gemini for the Drive version)
The Drive tool is a zero-setup Google Apps Script paired with Gemini. Dropbox
needs a runnable script anyway, so it uses Claude — which is particularly good at
the fine visual distinctions (relative jug sizes, bowl vs plate). To switch this
script to Gemini instead, you'd swap the `classify()` call for a Gemini
`generateContent` request with the same catalog prompt; ask if you'd like that.
