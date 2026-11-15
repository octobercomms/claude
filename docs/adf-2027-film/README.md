# ADF 2027 — Direction (film)

A 105-second explainer made from the Atlanta Design Festival 2027 direction deck, in the
Swiss Motion Graphics style of the Lemo-Opuscar library. Internal film for Elayne and Bernard:
no narration, type and music only, every figure from the deck on screen.

- **Code**: `dev/adf-2027-film/`
- **Treatment, shot list, cue map**: `TREATMENT.md` in this folder
- **Third-party assets and licences**: `CREDITS` in this folder
- **Renders**: not in the repo. `films/adf-2027-direction/` is gitignored, because the build
  writes 2,520 frames, a 30 MB WAV and the cut itself, all reproducible from the source.

## What it is

One 12-column grid, read four ways, each reading a step of the deck's argument:

1. thirteen selling weeks, nine of which produced $1,420 of the year's $14,685;
2. four structural reasons, none of them effort;
3. seventeen institutions snapping into the empty modules around ADF;
4. twelve months of a year-round organisation.

It ends on the two directions and the December deadline. 1920×1080, 24 fps, −14.5 LUFS.

## Rebuilding it

Needs the Lemo-Opuscar library (the `lemo-opuscar` skill installs it to `~/lemo-opuscar` on
first use), Node 20+, Python 3.11+ and ffmpeg.

```bash
LIB=~/lemo-opuscar sh dev/adf-2027-film/build.sh
```

That renders the picture, writes the score and foley, masters to −14 LUFS and writes
`adf-2027-direction.mp4` beside the script.

## The ffmpeg note

The library's own `core/render/mux.sh` requires ffmpeg 7+ and refuses to run on older builds:
6.x under-reports audio length through the `loudnorm` filter, so `mux.sh` reads the finished
mix as truncated. The cloud container this was built in has ffmpeg 6.1.1, so the project
carries `master.sh`, which measures loudness with `loudnorm` but applies the correction as a
linear gain plus a look-ahead limiter, verifying the result on the encoded file and correcting
until it lands. `build.sh` picks `mux.sh` when ffmpeg 7+ is present and `master.sh` otherwise,
so on a machine with a current ffmpeg the library path is used and `master.sh` is never called.

## Changing the content

Every figure, name and line of copy is in `dev/adf-2027-film/data.js`. Timings live in `S` and
the per-section functions at the top of `film.js`; the music reads the same event times through
`events.json`, so a change to a beat moves the picture and the sound together.
