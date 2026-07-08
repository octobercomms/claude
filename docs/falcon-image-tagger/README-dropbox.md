# Falcon Enamelware — Dropbox Image Product Tagger

Tag a Dropbox folder full of product photos by **product type** so you can
filter it — "show me every photo with an oval plate", "every 3 pint jug", etc.

It uses **Claude** (vision) to look at each image, match it against a catalog of
your products, and record the result in up to three places (you choose):

1. **A local CSV index** (`falcon_tags.csv`) — one row per image with its
   Dropbox path and the matched product tags. Open it in Excel / Google Sheets
   and filter the *tags* column. Private to whoever runs the script.
2. **Native Dropbox tags** (`WRITE_TAGS`) — real tags on each file (e.g.
   `oval_plate`). On dropbox.com you can **filter/sort by Tags**, or type the tag
   into the search box.
3. **The filename** (`RENAME_FILES`) — appends the product name into the file's
   name, e.g. `IMG_2043.jpg` → `IMG_2043 {falcon: oval plate, 3 pint jug}.jpg`.

Code lives in `dev/falcon-image-tagger/` (`dropbox_tagger.py`).

## Who sees the results, and how permanent is it?

| Where | Visible to | Permanent? | Findable by |
|-------|-----------|-----------|-------------|
| CSV index | just you (local file) | until you delete it | opening the CSV |
| Dropbox tags | **everyone** with folder access | yes (in Dropbox) | Dropbox web filter / search |
| Filename | **everyone** with folder access | yes (it *is* the file) | **any** search — Dropbox web, desktop app, synced tools |

So the tags and the filename both work for the whole team, not just you. The
**filename** is the most bulletproof: it travels with the file everywhere and
any search box finds it. Turn on whichever you want (you can use both).

## Run once, then just re-run on new batches

The script records each file's stable Dropbox ID in `checkpoint.json`, so a later
run only processes **new** photos and skips everything already done. Renaming a
file doesn't reset this — the Dropbox ID stays the same across a rename. So the
workflow you want works out of the box: run it once over the whole folder, then
run it again whenever a new batch of photos lands.

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
     `files.content.read`, `files.metadata.write` (lets it add tags), and
     `files.content.write` (lets it rename files, if you use `RENAME_FILES`).
     Submit. If you change permissions after generating a token, regenerate the
     token so the new scopes take effect.
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

5. **Find your folder — no file editing needed.** List every folder in your
   Dropbox so you can copy the exact path:
   ```bash
   python dropbox_tagger.py list-folders
   ```
   Copy the one you want (e.g. `/Falcon Enamelware/Product Photos`); you'll pass
   it with `--folder "..."` when you run.

   *(Optional) tune the catalog:* the `PRODUCTS` list near the top of
   `dropbox_tagger.py` is pre-filled with Falcon's classic range, so you can skip
   this for a first run. To adjust it later, edit that list — tags must be
   lowercase letters/numbers/underscores, under 32 chars (a Dropbox rule), e.g.
   `oval_plate`, `three_pint_jug`. Open the file in a plain editor (VS Code, or
   Windows Notepad) — avoid TextEdit's "smart quotes".

---

## Running it

Everything is a command-line flag — no need to edit the file.

1. **First, a dry run** (changes nothing in Dropbox; just writes the CSV):
   ```bash
   python dropbox_tagger.py --folder "/Falcon Enamelware"
   ```
   It fills `falcon_tags.csv` (path + tags per image). **Spot-check the accuracy
   in the CSV** before going live.

2. **Go live** — add `--live`, and choose what to apply:
   ```bash
   # Dropbox tags only:
   python dropbox_tagger.py --folder "/Falcon Enamelware" --live
   # Tags + product name in the filename (recommended for team-wide search):
   python dropbox_tagger.py --folder "/Falcon Enamelware" --live --rename
   ```
   Other flags: `--model claude-haiku-4-5` (cheaper/faster), `--no-tags` (skip
   Dropbox tags, e.g. if you only want the filename change).

3. **Big folders / new batches.** Safe to leave running and safe to re-run: a
   `checkpoint.json` records what's been processed, so it never re-does work,
   picks up where it left off if interrupted, and later runs only touch new
   photos. Just re-run the same command whenever a new batch arrives.

### Filtering afterwards
- **In the CSV:** filter/sort the *tags* column, then find the file at its
  *path*.
- **In Dropbox (web):** open the folder → **Sort/filter by Tags**, or type a tag
  like `three_pint_jug` into the search box.
- **By filename (anywhere):** if you used `RENAME_FILES`, search any box for
  `oval plate` or `3 pint jug` — Dropbox web, the desktop app, or synced tools.

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
product tag **and** strip the `{falcon: ...}` marker back out of filenames. The
CSV is just a file you can delete.

---

## Why Claude here (vs Gemini for the Drive version)
The Drive tool is a zero-setup Google Apps Script paired with Gemini. Dropbox
needs a runnable script anyway, so it uses Claude — which is particularly good at
the fine visual distinctions (relative jug sizes, bowl vs plate). To switch this
script to Gemini instead, you'd swap the `classify()` call for a Gemini
`generateContent` request with the same catalog prompt; ask if you'd like that.
