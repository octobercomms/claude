# CTR Boosters (SEO suite → Performance)

The white-hat answer to "behavioural SEO" / CTR-manipulation services
(BrowserBlast by Indexsy and the cheaper copycats).

## Why we don't resell BrowserBlast

Those services try to move rankings by injecting traffic that fakes the click
signals Google's **NavBoost** system measures. NavBoost is real — confirmed
under oath by Pandu Nayak in the *US v. Google* DOJ antitrust trial and
documented in the March/May 2024 Content Warehouse API leak (`goodClicks`,
`badClicks`, `lastLongestClicks`). But the same evidence documents the
defences:

- Raw vs normalised (`unsquashed` vs squashed) click counts exist specifically
  to flag anomalous click volume.
- Signals are sliced by **geography + device** and cross-referenced with
  **Chrome** behaviour, so a burst of injected sessions is a low-confidence
  pattern — and Eric Lehman testified low-confidence signals get *discounted*,
  not trusted.
- NavBoost works on a **~13-month rolling window**, so any bought lift decays
  once you stop paying (rented ranking, not earned).

Net: it conflicts with the suite's white-hat positioning, it's a short-term
spike that decays, and at scale it risks the signals being squashed or the site
flagged. Their own copy steers it at disposable *parasite* pages — not client
money sites.

## What we built instead

NavBoost rewards results people actually click and stay on. So we **earn** the
same signals honestly:

1. Pull live Search Console data (query × page) for the client.
2. Compare each page's actual CTR to a position-based baseline curve.
3. Surface pages that **rank well but are under-clicked** — a title/meta gap,
   not a ranking gap — ranked by estimated missed clicks over the window.
4. "Rewrite" drafts a new title tag + meta description in the client's brand
   voice (Claude), framed to win the click and match intent so visitors don't
   pogo-stick back (which is exactly a `badClick`).

No new traffic, no new data source, no manipulation — just better snippets on
pages that already rank.

## Implementation

- **Backend service:** `dev/platform/backend/src/services/ctrBoost.js`
  - `expectedCtr(position)` — blended desktop+mobile CTR-by-position baseline.
  - `scoreOpportunities(rows, opts)` — pure function over GSC `query`+`page`
    rows → ranked opportunities (defaults: min 50 impressions, position ≤ 20,
    flag when actual CTR < 70% of expected).
  - `rewrite(clientId, opp)` — Claude generates `meta_title` / `alt_title` /
    `meta_description` / `rationale` in the active brand voice.
- **Routes** (in `src/routes/seoSuite.js`):
  - `GET  /seo/clients/:clientId/ctr-opportunities?days=`
  - `POST /seo/clients/:clientId/ctr-opportunities/rewrite`
- **Frontend:** `dev/platform/frontend/src/components/organic/CtrBoostPanel.jsx`,
  wired as the **CTR boosters** sub-tab under Performance in
  `pages/ClientSEOPage.jsx`.

## Requires

An active Google Search Console connector for the client (same one the Search
Console tab uses). Without it the panel shows a 404 "no connector" message.

## Possible follow-ups

- Persist accepted rewrites + measure CTR lift after the change (before/after
  on the same GSC window).
- Pull the live `<title>`/meta from the page so the rewrite starts from real
  copy instead of an inferred guess.
- Hand a chosen rewrite straight into the Pipeline → Publish step.
