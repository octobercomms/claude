# The Quarter (film)

A 70-second title sequence in the Lemo-Opuscar **60s Spy Title Sequence** style, made to sell a
quarter of the Atlanta Design Festival's Industry Resources to a brand.

- **Code**: `dev/adf-spy-film/`
- **Treatment, shot list, cue map**: `TREATMENT.md` in this folder
- **Third-party assets and licences**: `CREDITS` in this folder
- **Subtitles**: `the-quarter.srt` in this folder
- **Renders**: not in the repo. `films/adf-spy/` is gitignored and rebuilt by `build.sh`.

## What it is

A courier carries one package through the four things a sponsor actually buys, each built out of
type: a column of names (8,911), the letter O of OPEN which becomes the inbox, three sites passed
in a lateral track, and the guide that stays standing after the quarter closes. The price stops
the music. Then the pieces fly back along the diagonal and assemble the title.

Unlike the three internal ADF films, this one is outward-facing: it argues nothing, carries six
figures and one price, and sends a brand to the page for the rest.

| | |
|---|---|
| Length | 70.000 s, 24 fps, 1920×1080 |
| Tempo | 144 BPM, so a beat is exactly 10 frames and every stab lands on a whole frame |
| Inks | ink `#17130F`, cream `#EFE3CC`, the festival's red `#D8432A`, mustard `#E0A32B` |
| Voice | six short briefing lines through a tape chain |
| Loudness | −14.2 LUFS, true peak −2.0 dBFS |

## Where the engine came from

This style ships a paper-cut engine with its demo, and the style sheet names it as the engine:
`paper.js` (scissor edges cached in local space, cut gaps, paper shadows, texture, the silhouette
layer), `glyph.js` (font outlines re-cut per letter) and `chars.js` (the silhouette rigs). Those
three are the library's, copied in as the technical base. Everything else is this film's: the
inks, the story, the sets, the staging, the score, the timing, and the title lettering in
`cuttitle.js`, which is drawn for this film rather than taken from the demo.

The demo's brass key is deliberately not carried over. Its courier chases a key; this one carries
the sponsor's package, which is the object the whole sequence is about.

## Rebuilding it

```bash
LIB=~/lemo-opuscar sh dev/adf-spy-film/build.sh
```

Needs the Lemo-Opuscar library with the **voice tier** installed, Node 20+, Python 3.11+ and
ffmpeg. `vendor/opentype.min.js` and the two fonts are in the repo, so there is nothing to fetch.

## Known limits

- The speech-to-text check on the generated voice could not run here: the Whisper model host is
  unreachable from the build environment. The lines contain no digits or abbreviations.
- The guide section is the quietest stretch: one layout for eight seconds with the arrows landing
  on beats. If it ever needs tightening, that is the section to cut.
