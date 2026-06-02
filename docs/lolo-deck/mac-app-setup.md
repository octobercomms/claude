# LOLO Deck — drag-and-drop Mac app setup

Goal: an icon on your Desktop you **drop a folder onto** (e.g. `Hollywood`) and a
finished PDF appears on your Desktop. No Terminal, no typing.

There are two ways. The **Automator droplet** is recommended — it builds a real
app icon and, because *you* create it on your own Mac, macOS shows **no security
warning**.

---

## Recommended: build the droplet in Automator (one time, ~3 min)

### Step 1 — put the script where the app expects it
1. In your **Documents** folder, make a new folder named exactly: `LOLO Deck`
2. Put **`generate_deck.py`** inside it.
   (Final path: `~/Documents/LOLO Deck/generate_deck.py`)

### Step 2 — create the app
1. Open **Automator** (press ⌘-Space, type `Automator`, Return).
2. Click **New Document** → choose **Application** → **Choose**.
3. In the search box (top-left), type `Run Shell Script`. Double-click it — it
   appears on the right.
4. At the top of that action set **Shell** to `/bin/bash` and **Pass input** to
   **`as arguments`**.
5. Delete whatever text is in the box and **paste the contents of
   `automator-shell-snippet.sh`** in its place.
6. **File → Save**, name it **`LOLO Deck`**, and save it to your **Desktop**.

### Step 3 — use it forever
1. First, in Finder, right-click your `Hollywood` folder → **Make available
   offline** and wait for the downloads to finish (so the images aren't
   cloud-only placeholders).
2. **Drag the `Hollywood` folder onto the `LOLO Deck` icon.**
3. The first run pauses ~30 s to install two helper libraries; after that it's
   instant. The PDF lands on your **Desktop** (named after the folder) and opens
   automatically.

You can drop **several folders at once** — you'll get one PDF each.

---

## Alternative: the double-click `LOLO-Deck.command` file

If you'd rather not use Automator:
1. Keep **`LOLO-Deck.command`** and **`generate_deck.py`** together in the same
   folder.
2. **Double-click** `LOLO-Deck.command`.
   - First time, macOS may block it: **right-click → Open → Open**. If it still
     won't launch, open Terminal and run `chmod +x ` then drag the file in and
     press Return, once.
3. When the window appears, **drag your character folder into it** and press
   Return. The PDF saves to your Desktop and opens.

---

## Requirements
- **Python 3** must be installed. Check in Terminal with `python3 --version`;
  if missing, get it from <https://www.python.org/downloads/> (download, run the
  installer, click through).
- The two libraries (`reportlab`, `Pillow`) install themselves automatically on
  first run.

## Troubleshooting
- **Blank cells / blank pages** → the images were still cloud-only. Right-click
  the folder → *Make available offline*, wait, try again.
- **"Python 3 not found"** → install Python (see Requirements).
- **Nothing happens on drop** → make sure `generate_deck.py` is at
  `~/Documents/LOLO Deck/generate_deck.py` (for the Automator app).
