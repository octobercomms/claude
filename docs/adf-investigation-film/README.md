# Where the Year Goes (film)

A 3:12 film in the Lemo-Opuscar **Visual Investigation** style, with narration, arguing that
producing events is not merely unprofitable for the Atlanta Design Festival: it consumes the exact
months in which the festival has to be sold.

- **Code**: `dev/adf-investigation-film/`
- **Treatment, shot list, cue map**: `TREATMENT.md` in this folder
- **Every claim with its source and quoted wording**: `FACTS.md` in this folder
- **Third-party assets and licences**: `CREDITS` in this folder
- **Renders**: not in the repo. `films/adf-investigation/` is gitignored and rebuilt by `build.sh`.

## The argument

The two earlier ADF films show that the money is late and the structure is wrong. This one makes
the opportunity-cost case, which neither deck states as a calendar:

1. The selling year is thirteen weeks and 60% of it lands in the last one, so nothing can be forecast.
2. Drawn as a calendar, the three produced events occupy the same months as the selling window:
   sponsors are approached in Q1, chapters set programme budgets in the fall. **That overlap is the
   finding.**
3. Three consequences follow that never appear in an event budget: no free entry point so the
   audience cannot grow, one remarketed list so the channel cannot grow, and six revenue lines of
   which two have ever sold.

It ends on an evidence map where every source and every finding converges on the first quarter.

## Why this style needed different handling

Visual Investigation is an Edit & Documentary style: it is cut from real material and the style
sheet says to ask what material exists before sourcing anything. The client has no footage or
photographs available for this, so the film is built from the two decks as documents and the
figures inside them as data, which it states on screen ("no third source exists"). Where it draws
a conclusion the documents do not state — chiefly the production calendar — it marks the frame
`SCHEMATIC` and lists the inference in `FACTS.md`.

## Voice

Kokoro `am_michael`, run locally, 29 lines, 164 s of speech in 192.5 s of film. Subtitles are burned
in and exported as `where-the-year-goes.srt`; the text lives in `film.json` so the picture and the
`.srt` cannot drift apart.

**The speech-to-text check did not run.** The pipeline normally transcribes every generated line
back and compares it with the script, but the Whisper model host is unreachable from the build
environment. The script contains no digits or abbreviations, which is what that check mostly
guards against. Re-run `build.sh` anywhere with access to Hugging Face and it will run and report.

## Rebuilding it

```bash
LIB=~/lemo-opuscar sh dev/adf-investigation-film/build.sh
```

Needs the Lemo-Opuscar library with the **voice tier** installed
(`sh <skill>/scripts/setup.sh deps voice`), Node 20+, Python 3.11+, ffmpeg and `pdftoppm`.

The evidence frames are rendered from the client's own PDFs, which are not in the repo. Regenerate
them first:

```bash
sh dev/adf-investigation-film/tools_pages.sh ADF-2027-Direction.pdf ADF-Bernard-Six.pdf
```

## Cost note

At 192.5 s and 30 fps this is 5,775 frames, roughly double either earlier ADF film, and the mix
takes several minutes because the compressor runs per sample. It is the most expensive of the three
to rebuild.
