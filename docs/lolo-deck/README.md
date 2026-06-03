# LOLO Deck Generator

A small command-line tool that turns a folder of costume-character image
folders into a single, clean presentation PDF for **LOLO**.

- **Code:** `dev/lolo-deck/`
- **Docs:** `docs/lolo-deck/` (this folder)

## What it produces

- **Landscape A4**, white background, minimal layout.
- A **cover page** with an editable project title and the LOLO logotype.
- **One page per character**, in **alphabetical order by folder name**:
  - the character name as the header (top-left),
  - the character's 6 images in a **3-column × 2-row** grid
    (aspect-ratio preserved, centred in each cell),
  - the **LOLO logotype** at the bottom of every page.

The LOLO mark is set in type by default (the bold "LOLO" wordmark with
letter-spacing), so no logo asset is required. Supply your own logo image
with `--logo` if you have one.

## Input layout

Point the tool at a parent folder containing one subfolder per character.
Each subfolder holds that character's 6 images (1 reference/sketch + 5
renders):

```
characters/
├── 01-mad-hatter/
│   ├── 00-sketch.png
│   ├── 01-render.png
│   └── … (6 images total)
├── 02-red-queen/
│   └── …
└── cheshire-cat/
    └── …
```

Notes:

- **Order** is alphabetical by subfolder name. A leading numeric prefix
  (`01-`, `2_`, `03 `) is used only for ordering — it is stripped from the
  name shown in the deck, and underscores/dashes become spaces and the name
  is title-cased (`02_red-queen` → "Red Queen").
- **Images within a character** are sorted by filename, so a leading
  `00-sketch.png` lands in the first grid cell.
- Supported image types: `.jpg .jpeg .png .gif .bmp .tif .tiff .webp`.
- If a folder has fewer than 6 images the remaining cells are left blank
  (with a subtle frame) and a notice is printed. More than 6 → only the
  first 6 are used.

## Install

```bash
cd dev/lolo-deck
python3 -m venv .venv && source .venv/bin/activate   # optional
pip install -r requirements.txt
```

## Usage

```bash
# Simplest form — writes ./<input-folder-name>.pdf
python generate_deck.py /path/to/characters

# Set the cover title and output path
python generate_deck.py /path/to/characters \
    --title "Alice in Wonderland — Costume Concepts" \
    --output alice-deck.pdf

# Use a custom LOLO logo image instead of the type wordmark
python generate_deck.py /path/to/characters --logo lolo-logo.png
```

| Option | Default | Description |
|--------|---------|-------------|
| `input` (positional) | — | Folder of character subfolders. |
| `-t`, `--title` | `Costume Character Presentation` | Cover page title (editable). |
| `-o`, `--output` | `<input-folder-name>.pdf` | Output PDF path. |
| `--logo` | _(type wordmark)_ | Optional logo image used on cover + footers. |
| `--reference-first` | off | Put each character's reference/sketch in the top-left cell. Found by keyword (`reference`/`ref`/`sketch`/`concept`) or as the odd-one-out by filename family (e.g. one `theme-park` shot among five `LOLO Beijing` renders). |
| `--reference-keyword TEXT` | — | Force the reference to be the image whose filename contains `TEXT` (implies `--reference-first`). |

> The bundled Mac wrappers (`mac/`) run with `--reference-first` enabled by
> default, so the reference shot lands top-left automatically.

## Implementation notes

- Pure Python, built on **reportlab** (drawing) and **Pillow** (broad image
  format support, incl. WebP). See `requirements.txt`.
- Layout constants (margins, grid gap, header/footer heights, colours, fonts)
  live near the top of `generate_deck.py` for easy tweaking.
