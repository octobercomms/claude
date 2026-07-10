# Brief — Falcon Enamelware Image Product Tagger

## Problem
A large Google Drive folder of Falcon Enamelware product photography with no way
to find images by product type. The team needs to answer "show me every photo
containing a 3 pint jug / oval plate / etc." without opening thousands of files.

## Goal
Tag every image in the folder with the product type(s) it contains, using the
company's category page as the source of truth for what products exist, and make
those tags filterable.

## Approach
A Google Apps Script that iterates the Drive folder, sends each image to a vision
model (Gemini) together with a product catalog derived from the category page,
and records the matched product tags to:
- a Google Sheet index (primary, sortable/filterable, with thumbnails + links);
- each file's Drive description as `FALCONTAG_<product>` tokens (so Drive's
  native search finds them); optionally the filename too.

Chosen Apps Script + Gemini because it needs zero infrastructure, runs inside
Google with native Drive access, and the free Gemini tier covers initial runs.

## Key decisions / knobs
- **Dry-run first** (`DRY_RUN`): populate the Sheet only, verify accuracy, then
  go live to stamp descriptions. Fully reversible (`clearAllDescriptions`).
- **Batch + auto-continue**: works around the ~6-min Apps Script limit; resumes
  automatically and skips already-tagged files.
- **Catalog is user-editable** (`PRODUCTS` array): seeded with Falcon's classic
  range; trim/extend to match the live category page.

## Open questions for the user
- Preferred filter surface: the Sheet index, in-Drive search tokens, filename
  prefixes — or all three? (Currently: Sheet always; descriptions when live;
  filename optional.)
- Gemini vs Claude/Python — Apps Script/Gemini shipped as the default; a Python +
  Claude variant is available on request for very large volumes.
- Exact product list and any SKU-level granularity (e.g. sizes/colourways)
  beyond the seeded catalog.

## Status
- **Google Drive** (v1): `dev/falcon-image-tagger/` (`Code.gs`,
  `appsscript.json`) — Apps Script + Gemini, native to Drive, zero setup. Usage
  in `docs/falcon-image-tagger/README.md`.
- **Dropbox** (v2): `dev/falcon-image-tagger/dropbox_tagger.py` — Python +
  Claude, writes native Dropbox tags + a CSV index. Same catalog/dry-run/resume
  design. Usage in `docs/falcon-image-tagger/README-dropbox.md`. (The client
  uses Dropbox because that is where the photos actually live.)
