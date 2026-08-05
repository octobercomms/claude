# Blog Autopilot — operator guide

How to run the Blog Autopilot capability of the **October Marketing Platform** plugin
(`dev/october-mi-wp`). This covers the standalone (own-key) flow; connected mode adds
central oversight and platform-run research once the OMI side is built
(`OMI-CONNECTION-BRIEF.md`).

## 1. Install & enable

1. Install/activate the plugin. A top-level **October Marketing** menu appears.
2. **Settings → Capabilities:** tick **Blog Autopilot**. (Untick anything you don't want —
   disabled capabilities add nothing.)
3. **Settings → Content engine (Claude):** choose **Use my own Claude API key** and paste
   it (stored encrypted, shown only as a mask afterwards). Optionally set a **Monthly cost
   cap (USD)** as a safety rail (0 = unlimited).

## 2. Teach it your business

**Blog Autopilot → Company knowledge → Learn my site.** It reads your own published pages
and posts and builds a profile: positioning, products, ICP, brand voice, themes, an
internal-link map, and author hints. Re-learn any time your site changes.

## 3. Plan topics (recommended)

**Content plan → Plan topics.** It builds a pillar/cluster plan of specific topics grounded
in what it learned (no invented search volumes). Autopilot works through this so the blog
builds topical authority instead of scattering one-off posts. "Add more topics" extends it.

## 4. Set the brief

**Content brief:** topics/focus, audience, tone of voice, the **attributed author** (a real
person — this is the E-E-A-T byline), cadence, target length, and publishing mode
(**draft for review** — recommended — or trusted auto-publish). Turn on **Autopilot** to
generate on the cadence automatically; the page shows the next run.

## 5. Generate

- **On demand:** **Create content → Generate a post now** (optionally type a topic; leave
  blank to take the next planned topic).
- **Autopilot:** with the toggle on, a scheduled run generates one post per cycle.

Either way the work runs in the background (nothing blocks your site), and each post lands
in the **Editorial queue** as a draft (unless you chose auto-publish), bylined to your
author, with meta description, tags, FAQ, and JSON-LD schema
(`BlogPosting` + `Person` author + `FAQPage`). Review and publish from the queue.

## Safety & cost

- Model HTML is sanitised (`wp_kses`) before it's saved — never trusted as raw HTML.
- The API key is encrypted at rest and never sent to the browser or logged.
- The **monthly cost cap** blocks all generation (manual and scheduled) once reached; a
  **rate limit** caps on-demand generation at 12/hour. Autopilot skips (and logs) a run if
  either would be exceeded.
- Settings shows this month's estimated spend and call count. Prices are estimates; set real
  rates via the `octobermi_model_prices` filter.

## Connected mode (later)

Tick **Settings → Platform connection** and pair with a token to let October oversee the
site centrally, use a **managed key** (never stored on the site, revocable from the
dashboard), and pull heavier research. Requires the platform-side endpoints in
`OMI-CONNECTION-BRIEF.md`.
