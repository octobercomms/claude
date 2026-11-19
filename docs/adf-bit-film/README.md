# The Desk (film)

A 58-second film in the Lemo-Opuscar **1-bit Dither** style, selling a quarter of ADF's Industry
Resources to a brand. The second outward-facing ADF film, and a remake of `adf-spy-film` against a
tighter brief: lead with the hook, go faster, pack it with information.

- **Code**: `dev/adf-bit-film/`
- **Treatment, shot list, cue map**: `TREATMENT.md` in this folder
- **Third-party assets and licences**: `CREDITS` in this folder
- **Renders**: not in the repo. `films/adf-bit/` is gitignored and rebuilt by `build.sh`.

## What it is

One desk under one hard lamp, in exactly two inks. Everything a sponsor buys arrives on the desk as
a physical printed object and is cut to on the beat: the list on a screen printing a row at a time,
the edition coming out of a printer line by line, three banner cards, three posts, the guide, the
calendar, the price. It ends by pulling back from the desk to the field of desks it reaches.

The hook is the first thing on screen and the last: **your brand in front of the people who specify
and buy, one quarter of the year, Atlanta and the Southeast.**

| | |
|---|---|
| Length | 58.000 s, 30 fps, 1920×1080 (960×540 internal, nearest-neighbour up) |
| Inks | ink `#15110F`, paper `#EFE3D2`. No third colour anywhere, including the end card |
| Tempo | 120 BPM; a beat is exactly 15 frames |
| Narration | None |
| Figures on screen | 18 |

## Against the spy version

| | `adf-spy-film` | this |
|---|---|---|
| Opens with | A courier and a package | The hook, stamped, in the first second |
| Running time | 70 s | 58 s |
| Figures carried | 6 | 18 |
| Voice | Tape briefing | None |

No narration is a deliberate choice, not an omission. The style puts every word on an object in the
world and forbids overlay captions, and for a brief that asks for density a stamp lands in two
frames where the same line spoken costs four seconds.

## The encoding, which matters here

A 1-bit picture has no greys to lose, so every lossy generation smears the dot edges into exactly
the grey the medium does not have. The usual pipeline (JPEG frames into x264, then another encode
at the mux) is three generations. This film uses the style's own lossless renderer instead:
PNG frames → an FFV1 master → **one** H.264 encode at CRF 14 with `-tune animation` and
`aq-mode=0`. `encode.sh` does that encode and the loudness pass together.

The cost is render time and disk: the lossless master runs to a few gigabytes and is local only.

## Rebuilding it

```bash
LIB=~/lemo-opuscar sh dev/adf-bit-film/build.sh
```

Needs Node 20+, Python 3.11+, ffmpeg with FFV1, and three.js from the library's `node_modules`.
It wants a GPU: this was built on software WebGL (`LEMO_ANGLE=swiftshader`) at roughly 0.45 s a
frame, which is about fifteen minutes for the picture.

## Where the engine came from

`pipe.js` (the three-pass 1-bit pipeline), `kit.js` (printed-paper and halftone materials, text
canvases) and `tools/render.mjs` (the lossless renderer) are the library's, which is what this
style ships them for. The world, inks, shots, cameras, printed surfaces, score and timing are this
film's own.
