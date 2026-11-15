# A Festival Convenes (film)

A 108-second film made from the six-slide deck *A festival convenes. It does not produce.*
(Atlanta Design Festival, the twentieth year, prepared for Bernard by Daniel, October 2026), in the
Swiss Motion Graphics style of the Lemo-Opuscar library. No narration, type and music only, every
figure from the deck on screen.

- **Code**: `dev/adf-bernard-six-film/`
- **Treatment, shot list, cue map**: `TREATMENT.md` in this folder
- **Third-party assets and licences**: `CREDITS` in this folder
- **Renders**: not in the repo. `films/adf-bernard-six/` is gitignored and rebuilt by `build.sh`.

## What it is

The film performs the deck's own verb. A word is cut out of a sentence, three produced events are cut
out of the year, and an instrument leaves the band with each one, until only the bass is left. What
remains re-flows into two things that need no production and five decisions with dates on them. The
sentence returns at the end with the word still missing.

1920×1080, 24 fps, 108.000 s, −14.3 LUFS.

## Its relationship to the other ADF film

`dev/adf-2027-film/` is the earlier, longer film made from the eighteen-slide direction deck. That one
is additive: one grid, re-read four ways. This one is a subtraction. They share a typeface, a signal
colour and a tempo so they sit together, and share no structure, opening, signature shot or score
shape.

## Rebuilding it

```bash
LIB=~/lemo-opuscar sh dev/adf-bernard-six-film/build.sh
```

Needs the Lemo-Opuscar library (the `lemo-opuscar` skill installs it to `~/lemo-opuscar`), Node 20+,
Python 3.11+ and ffmpeg. `build.sh` uses the library's `mux.sh` where ffmpeg 7+ is present and the
local `master.sh` otherwise; see `docs/adf-2027-film/README.md` for why.

## Changing the content

Every figure and line of copy is in `dev/adf-bernard-six-film/data.js`. Section edges are the `S`
table at the top of `film.js`, and the score reads the same event times through `events.json`, so
moving a beat moves picture and sound together.

## One claim the film declines to make

The deck says two of the six revenue lines have ever been sold and does not say which two. The film
shows six marks with two filled rather than striking through four named lines, so it carries the claim
exactly as far as the deck does. If you want the real two named, that is a one-line change in
`data.js` and the strike-through can come back.
