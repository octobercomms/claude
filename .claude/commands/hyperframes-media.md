# HyperFrames Media Preprocessing

Asset preprocessing for HyperFrames compositions with three CLI commands: `tts` (speech), `transcribe` (timestamps), and `remove-background` (transparent video).

## Text-to-Speech (`tts`)

Generate speech locally using Kokoro-82M without API keys. Supports 54 voices across multiple languages (American/British English, Spanish, French, Hindi, Italian, Japanese, Brazilian Portuguese, Mandarin).

**Voice selection by content:**
- Product demo: `af_heart`/`af_nova` (warm, professional)
- Tutorial: `am_adam`/`bf_emma` (neutral, clear)
- Marketing: `af_sky`/`am_michael` (energetic)
- Documentation: `bf_emma`/`bm_george` (formal)
- Casual: `af_heart`/`af_sky` (approachable)

Speed ranges from 0.7–1.5× (default 1.0). Requires Python 3.8+ with `kokoro-onnx` and `soundfile`. Model downloads (~338 MB total) cache in `~/.cache/hyperframes/tts/`.

## Transcription (`transcribe`)

Produces normalized `transcript.json` with word-level timestamps. Supports audio/video files, SRT/VTT imports, and OpenAI responses.

**Critical language rule:** "Never use `.en` models unless the user explicitly states the audio is English" — `.en` models translate non-English audio instead of transcribing. Default is `small` model, not `small.en`.

Model sizes: `tiny` (75 MB), `base` (142 MB), `small` (466 MB, default), `medium` (1.5 GB), `large-v3` (3.1 GB). Output is flat array of word objects with `id`, `text`, `start`, `end` fields.

## Background Removal (`remove-background`)

Extracts subjects (people, avatars) as transparent overlays using `u2net_human_seg`. Outputs `.webm` (VP9+alpha, default), `.mov` (ProRes 4444), or `.png` (single image).

**Quality presets** (VP9 encoder CRF only):
- `fast`: CRF 30
- `balanced`: CRF 18 (default)
- `best`: CRF 12

**Layer separation:** `--background-output` creates inverse-alpha plate (surroundings opaque, subject region transparent) for compositing text/graphics between layers.

**Compositing patterns:** Cutout over different scenes works best; cutout over source video shows faint color shift (use `--quality best` for masters). Text-behind-subject requires wrapping cutout in non-timed div and syncing both videos from t=0.

---

**Complete workflow:** Generate TTS → transcribe audio → extract word-level timestamps for captions automatically.
