# Upgrading ffmpeg on the platform box

**Why:** the box runs ffmpeg 4.4 (libavformat 58.76). `-cues_to_front` arrived
in ffmpeg 6.0, so every WebM remux on that box writes its seek index at the
tail. Measured on a 5-minute capture: with the flag the Cues element sits at
byte 465, without it at byte 16,329,148. A viewer dragging the scrubber then
costs a range request to the end of the file.

Three recordings are still in that state, because the remux ran before the
version was known:

| id | title |
|----|-------|
| `13464815` | Adding Captions to Blog post images |
| `1b82dce3` | Falcon Asset Bank |
| `b7f3d0c4` | Your Architect Tutorial |

`services/recordingRemux.js` now probes the binary and drops the flag when it
is unsupported, so nothing fails any more. That is the floor, not the fix: on
4.4 those files get no usable index at all.

## What this changes, and what it does not

ffmpeg is used by eleven services: remux, export, the editor, swipe import,
captions, scenes, example reels, b-roll, silence cut, social captions and
transcription. Until this change only four of them honoured `FFMPEG_PATH`; the
rest spawned the bare name. They all read `services/ffmpegBin.js` now, so one
variable moves the whole backend and `tests/ffmpeg-bin.test.js` fails if a new
service goes back to spawning `'ffmpeg'`.

That matters here because it makes the switch a single reversible line rather
than a system-wide package change. **Nothing is replaced on the box.** The new
build lives in `/opt`, the system's 4.4 stays exactly where it is, and the
switch is two lines in `backend/.env` plus a reload. Rolling back is deleting
those two lines.

It also means no `pm2 kill`: `pm2 reload october-platform --update-env` picks
up the new env with no downtime, and `october-mi-shopify` is never touched. (It
does not use ffmpeg at all.)

**The real risk is not the download, it is eleven services jumping three major
versions.** Between 4.4 and 7.x, filter defaults change, filters get renamed,
and a static build may be compiled without libass (captions) or libmp3lame
(transcription and swipe audio). None of that fails at startup. It fails later,
in a background render, where the only symptom is a job that never finishes.
That is what `scripts/ffmpeg-check.js` is for, and why step 2 is not optional.

## 1. Install a build, changing nothing live

Prefer a **pinned 7.x GPL build**, not a master snapshot. GPL builds are the
ones that include libass, libfreetype, libmp3lame, libvpx, libopus and x264.

List what is published, then take the newest `n7.` GPL tarball:

```bash
curl -sL https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/tags/latest \
  | grep -o '"browser_download_url": *"[^"]*linux64-gpl[^"]*\.tar\.xz"' \
  | cut -d'"' -f4
```

Pick the one whose name carries a version (`ffmpeg-n7.1...-linux64-gpl-7.1.tar.xz`)
over `ffmpeg-master-latest-...`, then:

```bash
cd /tmp
curl -LO "<the URL you picked>"
tar xf ffmpeg-n7*.tar.xz
sudo mkdir -p /opt/ffmpeg
sudo cp ffmpeg-n7*/bin/ffmpeg ffmpeg-n7*/bin/ffprobe /opt/ffmpeg/
sudo chmod +x /opt/ffmpeg/ffmpeg /opt/ffmpeg/ffprobe
/opt/ffmpeg/ffmpeg -version | head -1
/usr/bin/ffmpeg -version | head -1      # still 4.4, untouched
```

If GitHub is unreachable from the box, `https://johnvansickle.com/ffmpeg/`
publishes amd64 static releases in the same shape. Either source is fine: step
2 decides, not the source's reputation.

## 2. Prove it before the platform uses it

```bash
cd /opt/october-source/dev/platform/backend
FFMPEG_PATH=/opt/ffmpeg/ffmpeg FFPROBE_PATH=/opt/ffmpeg/ffprobe \
  node scripts/ffmpeg-check.js
```

Nine checks. It only reads and writes temporary files, so it is safe to run
against production at any time, and it exercises the binary with the services'
own argument builders:

- both binaries run, and are the same build
- `-cues_to_front` is supported
- a real WebM remux lands Cues **before** the first Cluster (walking the EBML
  structure, not grepping for the id, which finds the SeekHead pointer at byte
  ~102 and reports success on a file indexed at the tail)
- an MP4 export lands `moov` before `mdat`
- libass burns a caption using the platform's own fonts directory
- all 14 filters the video services build are present
- a `zoompan` + `xfade` graph actually renders, because listing a filter is not
  running one
- an mp3 extract works (libmp3lame)
- ffprobe reads a duration back

Run it with no env first for a baseline. On the current 4.4 the two Cues checks
fail, which is the whole reason for this upgrade. **If anything else fails on
the candidate, stop here.** Nothing has changed yet.

## 3. Switch

```bash
cd /opt/october-source/dev/platform/backend
printf 'FFMPEG_PATH=/opt/ffmpeg/ffmpeg\nFFPROBE_PATH=/opt/ffmpeg/ffprobe\n' >> .env
grep -c '^FFMPEG_PATH\|^FFPROBE_PATH' .env     # expect 2
pm2 reload october-platform --update-env
pm2 logs october-platform --lines 20           # no startup errors
```

`.env` is gitignored and survives `git reset --hard`, so a deploy will not undo
this. The reload is what matters: `recordingRemux` caches its capability probe
for the life of the process, so a running backend keeps the old answer until it
restarts.

Then confirm the running process agrees:

```bash
node scripts/ffmpeg-check.js    # no env now: reads .env, so it should pass 9 of 9
```

## 4. Redo the three recordings

```bash
node scripts/remux-backfill.js --commit --force
node scripts/media-store-status.js       # 8 of 8 playback copies
```

`--force` is needed because those three already have a `play_key`; without it
they are skipped as done. Then open one of the three in the platform and drag
the scrubber: that is the only check that proves the point.

## Rolling back

```bash
cd /opt/october-source/dev/platform/backend
sed -i '/^FFMPEG_PATH=/d;/^FFPROBE_PATH=/d' .env
pm2 reload october-platform --update-env
```

Back on 4.4 in seconds, with the system package never having been altered. The
remuxed files stay valid either way: 4.4 reads a progressive WebM perfectly
well, it just cannot write one.

## Optional, later: put it on PATH

`yt-dlp` runs ffmpeg itself for swipe audio extraction.
`services/swipeProcessor.js` passes `--ffmpeg-location` when `FFMPEG_PATH` is
set, so that path is covered. Anything else on the box that calls ffmpeg from a
shell still gets 4.4. If that becomes a problem:

```bash
sudo ln -sf /opt/ffmpeg/ffmpeg /usr/local/bin/ffmpeg
sudo ln -sf /opt/ffmpeg/ffprobe /usr/local/bin/ffprobe
hash -r && which ffmpeg
```

Do this only after the platform has run on the new build for a while. A symlink
in `/usr/local/bin` is a system-wide change you have to remember to remove,
where the `.env` lines are not.
