# OpenCut for OMI — evaluation

_Status: exploration / not committed. Date: 2026-07-21._

## TL;DR

OpenCut is an MIT-licensed, browser-based (and desktop/mobile) open-source video
editor — a CapCut clone that runs client-side, so nothing is uploaded,
watermarked, or shared with a third party. It is **not** a competitor to OMI's
video stack; it's the one layer OMI's **Video Studio** doesn't have — a **human
timeline editor** — with a credible roadmap toward being a **headless render
engine** and an **MCP-drivable automation target**.

Recommendation: a small **tier-1 spike now** (embed as a manual-edit step; real
AM value, on-brand privacy), and **track the rewrite** for the headless/MCP
milestone before committing to the deeper tiers.

## What OpenCut is (verified 2026-07-21)

- **License:** MIT (can never be paywalled — the point of the project).
- **Stars:** ~77k (was ~55k when the trend started; still climbing).
- **Stack:** TypeScript (~97%) with a **Rust core** (~1%); classic app at
  `opencut.app`, in-progress rewrite at `new.opencut.app`.
- **Positioning:** privacy-first — runs on the user's machine; no uploads, no
  watermark, no data sharing (a reaction to CapCut paywalling basics and sharing
  data with ByteDance).
- **Rewrite roadmap (planned, NOT yet shipped):**
  - An **Editor API**
  - **First-class third-party plugins** (plugin-first architecture)
  - **Desktop, mobile, browser from one Rust core**
  - **MCP server (for AI agents)**
  - **Headless mode (automation, batch rendering)**
  - A **scripting tab** in the editor

## Where OMI is today (the gap it fills)

OMI already has a substantial video stack:

- **Video Studio** (`services/videoProjects.js`, `video_projects/clips/jobs`): a
  fully **automated** pipeline — `ingest → roughcut → caption → grade → export` —
  drained by a dedicated worker box, with a grade loop (re-edit if QA < 85) and
  an `outputTarget` (download / Instagram publish).
- **HeyGen** avatar / Digital-Twin reels (`HeygenReelsPanel`, `heygen.js`).
- **Remotion** rendering (`remotionRender.js`) — headless Chromium → MP4 for the
  A/C/G compositions.
- **Reel scripts** (`reelScript.js` → HeyGen) and the **swipe file**
  (reel → idea cards).

The missing piece: there is **no human-in-the-loop editor**. A generated cut is
take-it-or-leave-it (the grade loop refines, then it exports). An AM can't open a
timeline to trim, reorder, re-caption, or swap a clip before publishing. That is
exactly what OpenCut is.

Privacy bonus: OMI handles client footage. OpenCut runs client-side / self-hosted
under October's own infra, so nothing is shipped to CapCut/ByteDance — consistent
with October's data-handling stance.

## Integration options (tiered by effort and by what's actually shipped)

### Tier 1 — Manual editor layer (buildable today)
Self-host the current OpenCut and add an **"Edit manually"** action on a finished
Video Studio project: load the exported master + source clips into OpenCut (new
tab or embedded), let the AM refine, then bring the result back as the project's
master. Purely additive to Remotion; gives human control with zero third-party
data exposure. Best first bet — proves AM value cheaply.

### Tier 2 — Headless render engine (watch the roadmap)
When OpenCut's **headless/batch render + Editor API** land, prototype rendering an
OMI auto-edit's timeline (EDL) through OpenCut's Rust core and compare
**quality / speed / cost** against the current headless-Chromium Remotion path. A
Rust renderer is likely faster for timeline-style edits than a React/Chromium
render.

### Tier 3 — MCP autopilot (the reel's pitch)
If the **MCP server** matures, OMI's pipeline — or Claude directly — assembles a
timeline programmatically (clips + captions + music), and OpenCut renders it
headless. Aligns with OMI already being agent-oriented; the plugin-first
architecture would also let October ship its own brand-specific effects/captions.

## Risks & caveats

- **Roadmap ≠ shipped.** The API / MCP / headless features are planned; tiers 2–3
  can't be built until they exist. Don't plan a delivery date around them yet.
- **Mid-rewrite churn.** The classic app is being replaced by a Rust-core rewrite;
  anything embedded now may need rework.
- **Self-hosting undocumented.** Not officially covered — a spike must prove it
  deploys cleanly under October's infra before relying on it.
- **Sunk cost.** OMI already invested in Remotion + a worker pipeline; OpenCut
  should be justified as additive (the manual layer), not a rip-and-replace, until
  tier 2 proves out.
- **Licensing is clean.** MIT — no paywall risk, safe to build on. ✅

## Adjacent: a content angle for October's own channels (optional)

The reel's "angles to steal" also apply to October's *marketing*, independent of
the product:
- A "why we run client video **in-house and private** — no ByteDance, no
  watermark" narrative (privacy vs. the paid incumbents).
- A demo of OMI's upcoming automation (auto-edit pipeline + agent-driven render).
Kept separate from the product decision above; noted so it isn't lost.

## Suggested next step

Time-boxed **tier-1 spike**: stand up a self-hosted OpenCut instance, wire an
"Edit manually" entry point from a finished Video Studio project, and put it in
front of one or two AMs to gauge whether the manual layer earns its keep. In
parallel, watch the OpenCut rewrite for the headless/Editor-API milestone as the
trigger to evaluate tier 2.
