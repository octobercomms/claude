# Subreddit research → content angles

The "Reddit Claude" play, built into Social → **Capture → Subreddit research**.

Point it at the subreddit where a client's *buyers* gather (not their peers), pull
the top posts, and Claude surfaces the biggest repeated **pain point** with real
evidence — then turns it into shippable content: **blog topics**, **reel hooks**, a
full **reel script with a comment-keyword CTA**, and a **lead-magnet outline**.
The reel's comment keyword drops straight into the DM bot's comment-to-DM, so the
whole loop (research → reel → comment → auto-DM the lead magnet) uses parts OMI
already has.

## Flow

1. **Suggest** — Claude proposes buyer subreddits from the client profile (cheap, no scrape).
2. **Research** — Apify scrapes the subreddit's top posts + a few comments; Claude analyses.
3. Saved per run; the AM can reopen, "Use as brief" a topic/hook (jumps into Build), and copy the reel script.

## Pieces

- `connectors/apify.js` → `fetchSubredditPosts({ subreddit, sort, time, limit })` — normalises the actor output defensively (field names vary).
- `services/subredditResearch.js` → `suggest` / `run` (fetch + analyse + persist) / `list` / `get` / `remove`.
- migration `133_subreddit_research.sql` → `subreddit_research` (one JSONB snapshot per run).
- routes under `/api/social/clients/:id/subreddit-research*`.
- `components/SubredditResearchPanel.jsx` on the Capture rail beside Swipe file.

## Config / dependencies

- **`APIFY_API_TOKEN`** (Settings) — required; the scrape fails clearly without it.
- **`REDDIT_ACTOR`** (Settings, optional) — the Apify actor id, `owner~name` form.
  Defaults to `trudax~reddit-scraper-lite`; override here if Apify renames/retires
  it, without a deploy.
- The run is synchronous (Apify ≤180s + one Claude call), inside the `/api/` 300s
  window. Reddit is anecdotal — validate a lead magnet against the client's real
  experience before shipping it (the panel surfaces the analysis caveat).

## Later

- Generate the lead magnet as a branded PDF (reuse `pdfService`), and one-click
  set the reel's keyword as a DM-bot comment trigger.
