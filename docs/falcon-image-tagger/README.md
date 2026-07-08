# Falcon Enamelware — Drive Image Product Tagger

Tag a Google Drive folder full of product photos by **product type** so you can
filter it — "show me every photo with an oval plate", "every 3 pint jug", etc.

It uses a vision AI model to look at each image, match it against a catalog of
your products, and record the result in two places:

1. **A Google Sheet index** — one row per image, with a thumbnail, a clickable
   link, and the matched product tags. This is your main filter surface: sort
   or filter the "Product tags" column and click straight through to the file.
2. **Each file's Drive description** — a searchable token per product, e.g.
   `FALCONTAG_oval-plate`. Type that token into Drive's own search box and it
   returns just those photos. (Optional: it can also prefix the product onto the
   file name.)

Code lives in `dev/falcon-image-tagger/`.

---

## How it works (the concept)

Google Drive can't natively "understand" what's in a photo. So the pipeline is:

```
Drive folder of photos ─▶ vision AI (per image) ─▶ product tags ─▶ Google Sheet + file description
                                                                         │
                                                                         ▼
                                              filter the Sheet / search Drive by product
```

Your **category-page screenshot** becomes the *product catalog* — the list the
AI matches against. Edit the `PRODUCTS` array in `Code.gs` so it mirrors your
category page (one entry per product type: oval plate, 3 pint jug, and so on).
The more the catalog matches your real range, the more accurate the tags.

This is built as a **Google Apps Script** because it runs *inside* Google — no
servers, no local install, direct access to your Drive. It uses the **Gemini
API** (free tier is plenty to start). A Claude alternative is described at the
bottom.

---

## Setup (about 10 minutes)

1. **Create the script.** Go to <https://script.google.com> → *New project*.
   - Paste the contents of `Code.gs` into the editor (replace the default file).
   - Click the ⚙ *Project Settings* → tick **"Show appsscript.json manifest"**,
     then open `appsscript.json` in the editor and paste this repo's version.

2. **Get a Gemini API key** (free): <https://aistudio.google.com/app/apikey>.

3. **Store the key** (don't hard-code it):
   - *Project Settings* → *Script Properties* → *Add property*
   - Name: `GEMINI_API_KEY`  ·  Value: your key.
   - (Or paste it into `setGeminiKey()`, run that once, then blank it out again.)

4. **Point it at your folder.** In `Code.gs`, set `CONFIG.FOLDER_ID` to your
   Drive folder's ID (the long string in the folder URL:
   `drive.google.com/drive/folders/`**`<THIS>`**). `RECURSIVE: true` scans
   sub-folders too.

5. **Edit the product catalog.** Update the `PRODUCTS` list to match your
   category page. Each entry:
   ```js
   { tag: 'oval-plate', name: 'Oval Plate', hints: 'oblong/oval flat plate' }
   ```
   `tag` is the slug used in the Sheet and the search token; `hints` help the
   model tell similar items apart (especially the jug sizes).

---

## Running it

1. **First, a dry run.** Leave `DRY_RUN: true`. In the editor, select
   `runTagging` from the function dropdown and click **Run**. Approve the
   permissions prompt (Drive + Sheets + external requests) the first time.
   - It creates a Google Sheet and logs its URL (check *Executions* / the log).
   - Open the Sheet: every image gets a row with a thumbnail and the tags the AI
     assigned. **Spot-check the accuracy here** before it touches anything.
   - Paste the new Sheet's ID into `CONFIG.SHEET_ID` so re-runs append to it.

2. **Go live.** Happy with the tags? Set `DRY_RUN: false` and run `runTagging`
   again. Now it also stamps `FALCONTAG_<product>` into each file's description.
   (Set `RENAME_FILES: true` too if you want the product in the filename.)

3. **Big folders.** Apps Script stops each run at ~6 minutes. The script
   processes a batch, then **auto-schedules itself to continue** ~30s later, and
   repeats until done. It remembers what it has already tagged, so it never
   re-does work and is safe to re-run. You can just let it churn through
   thousands of images across several automatic runs.

### Filtering afterwards
- **In the Sheet:** filter/sort the *Product tags* column → click the *Link*.
- **In Drive:** type e.g. `FALCONTAG_three-pint-jug` into the Drive search box.

---

## Handy maintenance functions
Run these from the editor's function dropdown:

| Function | What it does |
|---|---|
| `runTagging` | The main job. |
| `resetProgress` | Forget what's been processed so the next run re-tags everything (e.g. after you change the catalog). |
| `clearAllDescriptions` | Strip every `FALCONTAG_` token back out of file descriptions. |
| `setGeminiKey` | One-off way to store the API key. |

---

## Cost & accuracy notes
- **Cost:** Gemini Flash is cheap and has a free daily tier. A "massive" folder
  of tens of thousands of images may exceed free-tier daily limits — it'll just
  pause on rate-limit errors; re-run the next day, or add billing for a few
  dollars. Each image is ~1 quick request.
- **Accuracy:** dry-run first, always. Jug/bowl **sizes** are the hardest calls
  from a photo with no scale reference — good `hints` and a clean catalog help.
  For borderline items, the Sheet lets you correct tags by hand before going
  live.
- **Reversible:** tags live in the Sheet and (optionally) descriptions/names.
  `clearAllDescriptions` undoes the Drive-side stamps.

---

## Alternative: run it with Claude instead of Gemini
If you'd rather use Claude (e.g. you already have an Anthropic API key) or run it
locally in Python for speed on very large folders, the same design works:
- List images with the **Google Drive API**, download each blob.
- Send it to the **Claude Messages API** with an `image` content block plus the
  same catalog prompt (a good default model is `claude-haiku-4-5` for volume, or
  `claude-sonnet-5` for trickier size calls).
- Write results to a Sheet (Sheets API) and/or the file description (Drive API).

Ask and this can be provided as a ready-to-run Python script — the Apps Script
version above is the zero-setup option because it lives inside Drive.
