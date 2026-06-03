#!/usr/bin/env python3
"""
LOLO costume character presentation deck generator.

Takes a folder of character subfolders (each containing 6 images: 1
reference/sketch + 5 renders) and produces a single, clean, minimal PDF
presentation deck:

  * Landscape A4 pages, white background.
  * A cover page with an editable project title and the LOLO logotype.
  * One page per character (alphabetical by folder name): character name
    as the header, the 6 images laid out in a 3-column x 2-row grid,
    and the LOLO logotype at the bottom of every page.

Usage:
    python generate_deck.py /path/to/characters
    python generate_deck.py /path/to/characters --title "Spring Collection 2026"
    python generate_deck.py /path/to/characters -o deck.pdf --logo lolo.png

Run `python generate_deck.py --help` for all options.
"""

import argparse
import sys
from pathlib import Path

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

# ---------------------------------------------------------------------------
# Configuration / layout constants
# ---------------------------------------------------------------------------

IMAGE_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tif", ".tiff", ".webp",
}

PAGE_SIZE = landscape(A4)          # (width, height) in points
PAGE_W, PAGE_H = PAGE_SIZE

MARGIN = 14 * mm                   # outer page margin
HEADER_HEIGHT = 16 * mm            # space reserved for the character name
FOOTER_HEIGHT = 12 * mm            # space reserved for the LOLO logotype
CELL_GAP = 6 * mm                  # gap between grid cells

GRID_COLS = 3
GRID_ROWS = 2
IMAGES_PER_PAGE = GRID_COLS * GRID_ROWS

# Filename markers that flag an image as the reference/sketch (case-insensitive,
# matched as substrings) when --reference-first is used.
DEFAULT_REF_KEYWORDS = ("reference", "ref", "sketch", "concept")

# Colours
INK = (0.10, 0.10, 0.10)          # near-black for type
MUTED = (0.55, 0.55, 0.55)        # placeholder / secondary text
HAIRLINE = (0.85, 0.85, 0.85)     # subtle placeholder frame

# Fonts (built-in, no external assets required)
HEADER_FONT = "Helvetica-Bold"
LOGO_FONT = "Helvetica-Bold"
TITLE_FONT = "Helvetica-Bold"


# ---------------------------------------------------------------------------
# Discovery helpers
# ---------------------------------------------------------------------------

def find_characters(input_dir: Path):
    """Return a list of (name, [image_paths]) tuples, alphabetical by folder.

    Each subfolder of *input_dir* is treated as one character. Images inside
    are sorted naturally by filename, so a leading reference/sketch named
    e.g. ``01-sketch.png`` lands first in the grid.
    """
    characters = []
    for sub in sorted(
        (p for p in input_dir.iterdir() if p.is_dir()),
        key=lambda p: p.name.lower(),
    ):
        images = sorted(
            (f for f in sub.iterdir()
             if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS),
            key=lambda f: f.name.lower(),
        )
        characters.append((sub.name, images))
    return characters


def humanise(folder_name: str) -> str:
    """Turn a folder name into a presentable character name.

    ``"03_red-queen"`` -> ``"Red Queen"``. Leading numeric ordering prefixes
    (``01-``, ``2_``, ``03 ``) are stripped so they don't show in the deck.
    """
    name = folder_name.strip()
    # Strip a leading numeric ordering prefix like "01-", "2_", "03 ".
    for i, ch in enumerate(name):
        if not (ch.isdigit() or ch in "-_. "):
            name = name[i:]
            break
    else:
        name = name  # all-digit name: keep as-is
    name = name.replace("_", " ").replace("-", " ")
    name = " ".join(name.split())
    return name.title() if name else folder_name


def _filename_signature(path: Path) -> str:
    """A rough 'name family' for an image: its leading non-digit text.

    ``"LOLO Beijing 14-07-15.png"`` -> ``"lolo beijing"`` and
    ``"theme-park-scaled.jpeg"`` -> ``"theme park scaled"``. Used to spot the
    odd-one-out (the reference) among a set of similarly-named renders.
    """
    chars = []
    for ch in path.stem.lower():
        if ch.isdigit():
            break
        chars.append(ch)
    sig = "".join(chars)
    return " ".join(sig.replace("_", " ").replace("-", " ").split())


def order_images(images, reference_first: bool, reference_keyword: str = None):
    """Return *images* reordered so the reference/sketch is first, if asked.

    With ``reference_first`` enabled the reference is located by, in order:
      1. an explicit ``reference_keyword`` substring in the filename, else
      2. one of the DEFAULT_REF_KEYWORDS, else
      3. the "odd one out" — the single image whose filename family differs
         from the majority (e.g. one ``theme-park`` shot among five
         ``LOLO Beijing`` renders).
    If none of these single one out, the original filename order is kept.
    """
    if not reference_first or len(images) < 2:
        return images

    keywords = [reference_keyword] if reference_keyword else list(DEFAULT_REF_KEYWORDS)
    for kw in keywords:
        if not kw:
            continue
        kw = kw.lower()
        for i, img in enumerate(images):
            if kw in img.name.lower():
                return [images[i]] + images[:i] + images[i + 1:]

    # Odd-one-out: the lone image not matching the dominant name family.
    from collections import Counter
    sigs = [_filename_signature(p) for p in images]
    counts = Counter(sigs)
    dominant, dom_count = counts.most_common(1)[0]
    if dom_count < len(images):  # not all identical -> there is an odd one
        for i, sig in enumerate(sigs):
            if sig != dominant:
                return [images[i]] + images[:i] + images[i + 1:]

    return images


# ---------------------------------------------------------------------------
# Drawing helpers
# ---------------------------------------------------------------------------

def draw_logotype(c: canvas.Canvas, cx: float, cy: float, size: float,
                  logo_img: ImageReader = None):
    """Draw the LOLO logotype centred horizontally at (cx baseline, cy).

    If *logo_img* is provided it is drawn as an image (centred on cx, with its
    top region around cy); otherwise the wordmark "LOLO" is set in bold caps
    with generous letter-spacing for a clean logotype feel.
    """
    if logo_img is not None:
        iw, ih = logo_img.getSize()
        h = size
        w = h * (iw / ih)
        c.drawImage(logo_img, cx - w / 2.0, cy, width=w, height=h,
                    preserveAspectRatio=True, mask="auto")
        return

    text = "LOLO"
    tracking = size * 0.18  # extra space between glyphs
    c.setFont(LOGO_FONT, size)
    # Total width including tracking, to centre the wordmark.
    widths = [c.stringWidth(ch, LOGO_FONT, size) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = cx - total / 2.0
    c.setFillColorRGB(*INK)
    for ch, w in zip(text, widths):
        c.drawString(x, cy, ch)
        x += w + tracking


def draw_footer(c: canvas.Canvas, logo_img: ImageReader = None):
    """Draw the LOLO logotype at the bottom of the current page."""
    draw_logotype(c, PAGE_W / 2.0, MARGIN * 0.6, size=7 * mm,
                  logo_img=logo_img)


def draw_image_in_cell(c: canvas.Canvas, img_path: Path,
                       x: float, y: float, w: float, h: float):
    """Draw an image fitted (aspect-preserved, centred) inside a cell box."""
    try:
        reader = ImageReader(str(img_path))
        iw, ih = reader.getSize()
    except Exception as exc:  # unreadable / corrupt image -> placeholder
        _draw_placeholder(c, x, y, w, h, f"[{img_path.name}]")
        print(f"  ! could not read {img_path.name}: {exc}", file=sys.stderr)
        return

    if iw <= 0 or ih <= 0:
        _draw_placeholder(c, x, y, w, h, f"[{img_path.name}]")
        return

    scale = min(w / iw, h / ih)
    dw, dh = iw * scale, ih * scale
    dx = x + (w - dw) / 2.0
    dy = y + (h - dh) / 2.0
    c.drawImage(reader, dx, dy, width=dw, height=dh,
                preserveAspectRatio=True, mask="auto")


def _draw_placeholder(c: canvas.Canvas, x, y, w, h, label):
    """Draw a subtle empty-cell placeholder."""
    c.setStrokeColorRGB(*HAIRLINE)
    c.setLineWidth(0.6)
    c.rect(x, y, w, h, stroke=1, fill=0)
    c.setFillColorRGB(*MUTED)
    c.setFont("Helvetica", 8)
    c.drawCentredString(x + w / 2.0, y + h / 2.0 - 3, label)


# ---------------------------------------------------------------------------
# Page builders
# ---------------------------------------------------------------------------

def draw_cover(c: canvas.Canvas, title: str, logo_img: ImageReader = None):
    """A simple, centred title page: project title + LOLO logotype."""
    c.setFillColorRGB(1, 1, 1)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)

    # Project title, centred slightly above the middle.
    c.setFillColorRGB(*INK)
    title_size = 30
    c.setFont(TITLE_FONT, title_size)
    # Wrap the title across lines if it is very long.
    lines = _wrap(c, title, TITLE_FONT, title_size, PAGE_W - 2 * MARGIN)
    line_h = title_size * 1.25
    block_h = line_h * len(lines)
    y = PAGE_H / 2.0 + block_h / 2.0 - title_size
    for line in lines:
        c.drawCentredString(PAGE_W / 2.0, y, line)
        y -= line_h

    # Thin rule under the title.
    rule_w = 40 * mm
    c.setStrokeColorRGB(*INK)
    c.setLineWidth(1)
    ry = PAGE_H / 2.0 - block_h / 2.0 - 6 * mm
    c.line(PAGE_W / 2.0 - rule_w / 2.0, ry, PAGE_W / 2.0 + rule_w / 2.0, ry)

    # LOLO logotype, lower portion of the page.
    draw_logotype(c, PAGE_W / 2.0, PAGE_H * 0.16, size=12 * mm,
                  logo_img=logo_img)
    c.showPage()


def draw_character_page(c: canvas.Canvas, name: str, images,
                        logo_img: ImageReader = None):
    """One character page: header + 3x2 image grid + footer logotype."""
    c.setFillColorRGB(1, 1, 1)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)

    # Header — character name.
    c.setFillColorRGB(*INK)
    c.setFont(HEADER_FONT, 20)
    header_baseline = PAGE_H - MARGIN - 12
    c.drawString(MARGIN, header_baseline, name)

    # Grid area bounds.
    grid_top = PAGE_H - MARGIN - HEADER_HEIGHT
    grid_bottom = MARGIN + FOOTER_HEIGHT
    grid_left = MARGIN
    grid_right = PAGE_W - MARGIN

    grid_w = grid_right - grid_left
    grid_h = grid_top - grid_bottom

    cell_w = (grid_w - CELL_GAP * (GRID_COLS - 1)) / GRID_COLS
    cell_h = (grid_h - CELL_GAP * (GRID_ROWS - 1)) / GRID_ROWS

    cells = images[:IMAGES_PER_PAGE]
    for idx in range(IMAGES_PER_PAGE):
        row = idx // GRID_COLS
        col = idx % GRID_COLS
        x = grid_left + col * (cell_w + CELL_GAP)
        # Row 0 is the top row.
        y = grid_top - cell_h - row * (cell_h + CELL_GAP)
        if idx < len(cells):
            draw_image_in_cell(c, cells[idx], x, y, cell_w, cell_h)
        else:
            _draw_placeholder(c, x, y, cell_w, cell_h, "")

    draw_footer(c, logo_img=logo_img)
    c.showPage()


def _wrap(c, text, font, size, max_width):
    """Greedy word-wrap a string to fit *max_width*."""
    words = text.split()
    if not words:
        return [""]
    lines, cur = [], words[0]
    for word in words[1:]:
        trial = cur + " " + word
        if c.stringWidth(trial, font, size) <= max_width:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    lines.append(cur)
    return lines


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def build_deck(input_dir: Path, output: Path, title: str,
               logo_path: Path = None, reference_first: bool = False,
               reference_keyword: str = None) -> int:
    characters = find_characters(input_dir)
    if not characters:
        print(f"No character subfolders found in {input_dir}", file=sys.stderr)
        return 1

    logo_img = None
    if logo_path is not None:
        if not logo_path.is_file():
            print(f"Logo not found: {logo_path}", file=sys.stderr)
            return 1
        logo_img = ImageReader(str(logo_path))

    c = canvas.Canvas(str(output), pagesize=PAGE_SIZE)
    c.setTitle(title)

    draw_cover(c, title, logo_img=logo_img)

    for folder_name, images in characters:
        display = humanise(folder_name)
        images = order_images(images, reference_first, reference_keyword)
        count = len(images)
        note = ""
        if count != IMAGES_PER_PAGE:
            note = f"  (found {count} image{'s' if count != 1 else ''}, " \
                   f"expected {IMAGES_PER_PAGE})"
        print(f"  - {display}{note}")
        draw_character_page(c, display, images, logo_img=logo_img)

    c.save()
    print(f"\nWrote {output}  ({len(characters)} character"
          f"{'s' if len(characters) != 1 else ''} + cover)")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Generate a LOLO costume character presentation PDF deck.")
    parser.add_argument(
        "input", type=Path,
        help="Folder containing one subfolder per character (6 images each).")
    parser.add_argument(
        "-t", "--title", default="Costume Character Presentation",
        help="Project title shown on the cover page.")
    parser.add_argument(
        "-o", "--output", type=Path, default=None,
        help="Output PDF path (default: <input-folder-name>.pdf).")
    parser.add_argument(
        "--logo", type=Path, default=None,
        help="Optional LOLO logo image; if omitted the LOLO wordmark is set "
             "in type.")
    parser.add_argument(
        "--reference-first", action="store_true",
        help="Place each character's reference/sketch image in the first "
             "(top-left) grid cell. The reference is found by keyword "
             "(reference/ref/sketch/concept) or as the odd-one-out by "
             "filename.")
    parser.add_argument(
        "--reference-keyword", default=None,
        help="Override the reference detection: the image whose filename "
             "contains this text goes first (implies --reference-first).")
    args = parser.parse_args(argv)

    input_dir = args.input
    if not input_dir.is_dir():
        print(f"Input folder does not exist: {input_dir}", file=sys.stderr)
        return 1

    output = args.output or Path(f"{input_dir.resolve().name}.pdf")

    reference_first = args.reference_first or bool(args.reference_keyword)

    print(f"Building deck from: {input_dir}")
    return build_deck(input_dir, output, args.title, args.logo,
                      reference_first=reference_first,
                      reference_keyword=args.reference_keyword)


if __name__ == "__main__":
    sys.exit(main())
