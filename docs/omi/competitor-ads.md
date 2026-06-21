# Competitor Google Ads intelligence

Pull a competitor's **live Google ads** from the Google Ads Transparency Center
and have Claude read what they're testing + how to counter — in the Ads suite
(**Ads → Competitor ads**).

## Why SerpApi
Google has **no official API** for the Ads Transparency Center, and scraping it
is brittle + against Google's ToS. SerpApi's `google_ads_transparency_center`
engine is the reliable, maintainable route. **Inert until `SERPAPI_API_KEY` is
set** (Settings → Integrations → October Outreach). Paid per query, so it's a
run-on-demand-per-competitor tool, not a constant pull.

## How it works
- `services/competitorAds.js` — `fetchAds({ query, region })` calls SerpApi
  (region name → Google geo code), normalises the ad creatives (advertiser,
  format, target domain, first/last shown, image, link); `run()` then has Claude
  analyse them (overview, longest-running = likely winners, angles, counter-ad
  ideas) and stores the run (migration 103, `competitor_ad_runs`).
- `routes/competitorAds.js` at `/api/competitor-ads` — per-client get (config +
  run history), post (pull + analyse), delete. Access-controlled.
- `CompetitorAdsPanel` — search a competitor + region, see the analysis + the
  ad-creative gallery, with run history.

## Feeds
The counter-ad ideas + observed angles are designed to seed the existing **Ad
Creative generator** — a future tweak could one-click push them into a brief.
