#!/usr/bin/env python3
"""
Falcon Enamelware — Dropbox Image Product Tagger
------------------------------------------------
Walks a Dropbox folder full of product photos, asks Claude which Falcon
Enamelware product(s) appear in each image, and records the result so you can
filter the folder by product type (e.g. "oval plate", "3 pint jug").

It writes tags to TWO places:
  1. A local CSV index  — the master, sortable/filterable list (one row per
     image, with its Dropbox path and the matched product tags). Open it in
     Excel/Google Sheets and filter the "tags" column.
  2. Native Dropbox tags — real tags on each file (e.g. `oval_plate`). On
     dropbox.com you can then filter/sort by Tags, or type the tag into the
     search box, and just those photos appear.

Safe to re-run: it remembers what it has already tagged (checkpoint.json) and
skips those files. Start with DRY_RUN=True to fill only the CSV and eyeball the
accuracy, then set DRY_RUN=False to also write the Dropbox tags.

SETUP: see docs/falcon-image-tagger/README-dropbox.md
"""

import argparse
import base64
import csv
import io
import json
import os
import re
import sys
import time

import anthropic
import dropbox
from dropbox.exceptions import ApiError, RateLimitError

# ============================ CONFIG ============================
CONFIG = {
    # The Dropbox folder to scan. Use "" for the whole Dropbox, or a path like
    # "/Falcon Enamelware/Photos" (leading slash, case-sensitive-ish).
    "FOLDER": "/Falcon Enamelware",

    # Scan sub-folders too?
    "RECURSIVE": True,

    # Which Claude model. Default is a good accuracy/cost balance.
    #   claude-sonnet-5   -> recommended default (great on tricky jug sizes)
    #   claude-haiku-4-5  -> cheapest & fastest, for very large folders
    #   claude-opus-4-8   -> highest accuracy, most expensive
    "MODEL": "claude-sonnet-5",

    # Dry run: only fill the CSV, do NOT change anything in Dropbox. Start True,
    # check the CSV, then set False to apply the changes below.
    "DRY_RUN": True,

    # Add native Dropbox tags to each file (filterable in the Dropbox web UI).
    "WRITE_TAGS": True,

    # Append the product name(s) into the FILENAME, e.g.
    #   "IMG_2043.jpg" -> "IMG_2043 {falcon: oval plate, 3 pint jug}.jpg".
    # Permanent, visible to everyone with folder access, and findable by ANY
    # search box (Dropbox web, desktop app, synced tools). Re-running updates
    # the marker rather than stacking a second one.
    "RENAME_FILES": False,

    # Where the master index and progress checkpoint are written (local files).
    "CSV_PATH": "falcon_tags.csv",
    "CHECKPOINT_PATH": "checkpoint.json",

    # Skip files larger than this before any resize (MB).
    "MAX_FILE_MB": 25,

    # Downscale long edge to this many px before sending to Claude (needs Pillow;
    # keeps vision accuracy high while cutting tokens/cost). Ignored if Pillow
    # isn't installed.
    "RESIZE_LONG_EDGE": 1568,

    # Gentle pacing between images (seconds).
    "SLEEP_BETWEEN": 0.15,

    # Save the checkpoint every N images.
    "CHECKPOINT_EVERY": 10,
}

# The product catalog — what Claude matches photos against. Edit to mirror your
# category page. `tag` must be lowercase letters/numbers/underscores, < 32 chars
# (a Dropbox tag rule). Seeded with Falcon's classic range.
PRODUCTS = [
    {"tag": "oval_plate",       "name": "Oval Plate",             "hints": "oblong/oval flat plate"},
    {"tag": "dinner_plate",     "name": "Dinner Plate",           "hints": "large round flat plate"},
    {"tag": "side_plate",       "name": "Side Plate",             "hints": "small round flat plate"},
    {"tag": "cereal_bowl",      "name": "Cereal Bowl",            "hints": "round bowl, medium depth"},
    {"tag": "pasta_bowl",       "name": "Pasta Bowl",             "hints": "wide shallow bowl"},
    {"tag": "serving_bowl",     "name": "Serving Bowl",           "hints": "large deep bowl"},
    {"tag": "tumbler",          "name": "Tumbler",                "hints": "straight-sided beaker, no handle"},
    {"tag": "mug",              "name": "Mug",                    "hints": "cup with a handle"},
    {"tag": "half_pint_jug",    "name": "Half Pint Jug",          "hints": "small jug, pouring lip and handle"},
    {"tag": "one_pint_jug",     "name": "1 Pint Jug",             "hints": "medium jug, pouring lip and handle"},
    {"tag": "two_pint_jug",     "name": "2 Pint Jug",             "hints": "large jug, pouring lip and handle"},
    {"tag": "three_pint_jug",   "name": "3 Pint Jug",             "hints": "extra-large jug, pouring lip and handle"},
    {"tag": "pie_dish",         "name": "Pie Dish",               "hints": "shallow round baking dish, sloped sides"},
    {"tag": "baking_tray",      "name": "Baking Tray / Bake Set", "hints": "rectangular oven tray"},
    {"tag": "serving_tray",     "name": "Serving Tray",           "hints": "flat rectangular tray with rim"},
    {"tag": "colander",         "name": "Colander",               "hints": "bowl with drainage holes"},
    {"tag": "teapot",           "name": "Teapot",                 "hints": "pot with spout, lid and handle"},
    {"tag": "storage_canister", "name": "Storage Canister",       "hints": "lidded cylindrical container"},
    {"tag": "bread_bin",        "name": "Bread Bin",              "hints": "large lidded box"},
    {"tag": "utensil_pot",      "name": "Utensil Pot",            "hints": "tall open cylinder for utensils"},
]
# ===============================================================

VALID_TAGS = {p["tag"] for p in PRODUCTS}
NAME_BY_TAG = {p["tag"]: p["name"] for p in PRODUCTS}
MARKER_RE = re.compile(r"\s*\{falcon:[^}]*\}")  # our filename marker, for idempotent re-runs
IMAGE_MIME = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".webp": "image/webp",
}

try:
    from PIL import Image
    HAVE_PIL = True
except ImportError:
    HAVE_PIL = False


def dropbox_client():
    """Build a Dropbox client from env vars (refresh token preferred)."""
    refresh = os.environ.get("DROPBOX_REFRESH_TOKEN")
    if refresh:
        return dropbox.Dropbox(
            oauth2_refresh_token=refresh,
            app_key=os.environ["DROPBOX_APP_KEY"],
            app_secret=os.environ["DROPBOX_APP_SECRET"],
        )
    token = os.environ.get("DROPBOX_ACCESS_TOKEN")
    if token:
        return dropbox.Dropbox(token)
    sys.exit("Set DROPBOX_REFRESH_TOKEN (+ APP_KEY/APP_SECRET) or DROPBOX_ACCESS_TOKEN.")


def iter_images(dbx):
    """Yield Dropbox FileMetadata for every image in the folder."""
    path = "" if CONFIG["FOLDER"] in ("", "/") else CONFIG["FOLDER"]
    res = _rl(lambda: dbx.files_list_folder(path, recursive=CONFIG["RECURSIVE"]))
    while True:
        for entry in res.entries:
            if isinstance(entry, dropbox.files.FileMetadata):
                ext = os.path.splitext(entry.name)[1].lower()
                if ext in IMAGE_MIME:
                    yield entry
        if not res.has_more:
            break
        res = _rl(lambda: dbx.files_list_folder_continue(res.cursor))


def _rl(fn, tries=5):
    """Call a Dropbox function, backing off on rate limits."""
    for attempt in range(tries):
        try:
            return fn()
        except RateLimitError as e:
            wait = getattr(e, "backoff", None) or (2 ** attempt)
            print(f"  rate-limited, waiting {wait:.0f}s")
            time.sleep(wait)
    raise RuntimeError("Dropbox rate limit: gave up after retries")


def prep_image(raw, ext):
    """Return (base64_data, media_type), downscaling with Pillow if available."""
    if HAVE_PIL:
        try:
            img = Image.open(io.BytesIO(raw))
            img = img.convert("RGB")
            long_edge = max(img.size)
            if long_edge > CONFIG["RESIZE_LONG_EDGE"]:
                scale = CONFIG["RESIZE_LONG_EDGE"] / long_edge
                img = img.resize((int(img.width * scale), int(img.height * scale)))
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85)
            return base64.standard_b64encode(buf.getvalue()).decode(), "image/jpeg"
        except Exception:
            pass  # fall through to sending the original bytes
    return base64.standard_b64encode(raw).decode(), IMAGE_MIME[ext]


def classify(client, b64, media_type):
    """Ask Claude which catalog products appear. Returns a list of tags."""
    catalog = "\n".join(
        f"- {p['tag']}: {p['name']}" + (f" ({p['hints']})" if p["hints"] else "")
        for p in PRODUCTS
    )
    prompt = (
        "You are tagging product photos for Falcon Enamelware. Decide which of "
        "these product types are the MAIN subject(s) of the photo.\n\n"
        "PRODUCT CATALOG (return the tag on the left):\n" + catalog + "\n\n"
        "Rules:\n"
        "- Only include a product that is clearly a featured item, not a tiny background prop.\n"
        "- A photo can contain more than one product type.\n"
        "- Judge jug sizes from relative proportions; if genuinely unclear, pick the closest.\n"
        "- If no catalog product is present, return an empty list.\n"
        "Return ONLY the matching tags."
    )
    schema = {
        "type": "object",
        "properties": {
            "tags": {"type": "array", "items": {"type": "string", "enum": sorted(VALID_TAGS)}}
        },
        "required": ["tags"],
        "additionalProperties": False,
    }
    resp = client.messages.create(
        model=CONFIG["MODEL"],
        max_tokens=1024,
        output_config={"format": {"type": "json_schema", "schema": schema}},
        messages=[{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
            ],
        }],
    )
    text = next((b.text for b in resp.content if b.type == "text"), "")
    if not text:
        return []
    tags = json.loads(text).get("tags", [])
    return [t for t in tags if t in VALID_TAGS]


def load_checkpoint():
    try:
        with open(CONFIG["CHECKPOINT_PATH"]) as f:
            return set(json.load(f))
    except (OSError, json.JSONDecodeError):
        return set()


def save_checkpoint(done):
    with open(CONFIG["CHECKPOINT_PATH"], "w") as f:
        json.dump(sorted(done), f)


def main():
    dbx = dropbox_client()
    client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY / ant profile
    done = load_checkpoint()

    csv_exists = os.path.exists(CONFIG["CSV_PATH"])
    csv_file = open(CONFIG["CSV_PATH"], "a", newline="", encoding="utf-8")
    writer = csv.writer(csv_file)
    if not csv_exists:
        writer.writerow(["name", "path", "tags", "file_id"])

    processed = tagged = skipped = 0
    for meta in iter_images(dbx):
        if meta.id in done:
            skipped += 1
            continue

        ext = os.path.splitext(meta.name)[1].lower()
        try:
            if meta.size > CONFIG["MAX_FILE_MB"] * 1024 * 1024:
                writer.writerow([meta.name, meta.path_display, "(skipped: too large)", meta.id])
                done.add(meta.id)
                skipped += 1
                continue

            _, resp = _rl(lambda: dbx.files_download(meta.path_lower))
            b64, media_type = prep_image(resp.content, ext)
            tags = classify(client, b64, media_type)

            final_name = meta.name
            if not CONFIG["DRY_RUN"]:
                if CONFIG["WRITE_TAGS"] and tags:
                    _apply_tags(dbx, meta.path_lower, tags)
                    tagged += 1
                if CONFIG["RENAME_FILES"]:
                    final_name = _rename_file(dbx, meta.path_lower, meta.name, tags)

            writer.writerow([final_name, meta.path_display, ", ".join(tags) or "(none)", meta.id])
            csv_file.flush()

            done.add(meta.id)
            processed += 1
            print(f"[{processed}] {meta.name} -> {', '.join(tags) or '(none)'}")

            if processed % CONFIG["CHECKPOINT_EVERY"] == 0:
                save_checkpoint(done)
            time.sleep(CONFIG["SLEEP_BETWEEN"])
        except Exception as e:  # noqa: BLE001 - keep going, record the failure
            print(f"  error on {meta.name}: {e}")
            writer.writerow([meta.name, meta.path_display, f"(error: {e})", meta.id])
            csv_file.flush()
            # not added to `done`, so it retries on the next run

    save_checkpoint(done)
    csv_file.close()
    mode = "DRY RUN (CSV only)" if CONFIG["DRY_RUN"] else "LIVE (CSV + Dropbox tags)"
    print(f"\nFinished [{mode}]. processed {processed}, tagged {tagged}, skipped {skipped}.")
    print(f"Index: {CONFIG['CSV_PATH']}")


def _apply_tags(dbx, path, tags):
    """Add the product tags to a Dropbox file (skips ones already present)."""
    try:
        existing = set()
        got = _rl(lambda: dbx.files_tags_get([path]))
        for entry in got.paths_to_tags:
            if entry.path == path:
                existing = {t.get_user_generated_tag().tag_text for t in entry.tags}
        for tag in tags:
            if tag not in existing:
                _rl(lambda t=tag: dbx.files_tags_add(path, t))
    except ApiError as e:
        print(f"  tag error on {path}: {e}")


def _rename_file(dbx, path_lower, name, tags):
    """Append the product names into the filename. Idempotent across re-runs.

    "IMG_2043.jpg" + [oval_plate, three_pint_jug]
        -> "IMG_2043 {falcon: oval plate, 3 pint jug}.jpg"
    """
    base, ext = os.path.splitext(name)
    base = MARKER_RE.sub("", base).rstrip()  # strip any previous marker first
    if tags:
        names = ", ".join(NAME_BY_TAG[t] for t in tags)
        marker = f" {{falcon: {names}}}"
        # Dropbox caps a name component at 255 chars.
        budget = 255 - len(ext) - len(base)
        if len(marker) > budget:
            marker = marker[: max(0, budget - 1)].rstrip() + "}"
        new_name = base + marker + ext
    else:
        new_name = base + ext  # no products -> just strip any old marker

    if new_name == name:
        return name
    folder = os.path.dirname(path_lower)
    to_path = (folder + "/" if folder not in ("", "/") else "/") + new_name
    try:
        _rl(lambda: dbx.files_move_v2(path_lower, to_path, autorename=True))
        return new_name
    except ApiError as e:
        print(f"  rename error on {name}: {e}")
        return name


def clear_all_tags():
    """Utility: remove every product tag AND filename marker this tool applied."""
    dbx = dropbox_client()
    tags_removed = renamed = 0
    for meta in iter_images(dbx):
        try:
            got = _rl(lambda: dbx.files_tags_get([meta.path_lower]))
            for entry in got.paths_to_tags:
                for t in entry.tags:
                    text = t.get_user_generated_tag().tag_text
                    if text in VALID_TAGS:
                        _rl(lambda tx=text: dbx.files_tags_remove(meta.path_lower, tx))
                        tags_removed += 1
            if MARKER_RE.search(meta.name):
                base, ext = os.path.splitext(meta.name)
                clean = MARKER_RE.sub("", base).rstrip() + ext
                folder = os.path.dirname(meta.path_lower)
                to_path = (folder + "/" if folder not in ("", "/") else "/") + clean
                _rl(lambda: dbx.files_move_v2(meta.path_lower, to_path, autorename=True))
                renamed += 1
        except ApiError as e:
            print(f"  {meta.name}: {e}")
    print(f"Removed {tags_removed} product tags and cleaned {renamed} filenames.")


def list_folders(path=""):
    """Print the folders directly inside `path` (root by default), as they load.

    Fast because it only lists one level. To look inside a folder, pass it:
        python3 dropbox_tagger.py list-folders --folder "/Falcon Enamelware"
    """
    dbx = dropbox_client()
    path = "" if path in ("", "/") else path
    where = path or "your Dropbox (top level)"
    print(f"Scanning {where}...\n", flush=True)
    res = _rl(lambda: dbx.files_list_folder(path))  # not recursive -> quick
    count = 0
    while True:
        for e in res.entries:
            if isinstance(e, dropbox.files.FolderMetadata):
                print(e.path_display, flush=True)
                count += 1
        if not res.has_more:
            break
        res = _rl(lambda: dbx.files_list_folder_continue(res.cursor))
    print(f"\n{count} folders here.")
    print("Copy the one with your photos, then run (dry run, changes nothing):")
    print('  python3 dropbox_tagger.py --folder "/That Folder"')
    print('To look inside a folder instead: '
          'python3 dropbox_tagger.py list-folders --folder "/That Folder"')


def apply_overrides(args):
    """Let command-line flags / env vars override CONFIG — no file editing needed."""
    folder = args.folder or os.environ.get("FALCON_FOLDER")
    if folder is not None:
        CONFIG["FOLDER"] = folder
    if args.model:
        CONFIG["MODEL"] = args.model
    if args.live:
        CONFIG["DRY_RUN"] = False
    if args.rename:
        CONFIG["RENAME_FILES"] = True
    if args.no_tags:
        CONFIG["WRITE_TAGS"] = False


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Tag Falcon Enamelware photos in Dropbox.")
    ap.add_argument("command", nargs="?", default="run",
                    choices=["run", "list-folders", "clear-tags"],
                    help="run (default), list-folders (show your folders), or clear-tags (undo)")
    ap.add_argument("--folder", help='Dropbox folder path, e.g. "/Falcon Enamelware"')
    ap.add_argument("--model", help="Claude model (claude-sonnet-5 / claude-haiku-4-5 / claude-opus-4-8)")
    ap.add_argument("--live", action="store_true", help="Actually apply changes (off = dry run)")
    ap.add_argument("--rename", action="store_true", help="Also put the product name in the filename")
    ap.add_argument("--no-tags", action="store_true", help="Don't write Dropbox tags")
    args = ap.parse_args()

    apply_overrides(args)

    if args.command == "list-folders":
        list_folders(args.folder or os.environ.get("FALCON_FOLDER") or "")
    elif args.command == "clear-tags":
        clear_all_tags()
    else:
        main()
