<!-- Distilled from coreyhaines31/marketingskills · seo-audit (MIT). -->
## SEO audit methodology

Audit in priority order — fix what stops Google ranking the page before polishing what's already fine.

1. **Crawlability & indexation** — robots.txt not blocking important pages; XML sitemap exists, accessible, only canonical/indexable URLs; no accidental `noindex` on key pages; canonicals point the right way (self-referencing on unique pages); no redirect chains/loops or soft 404s; important pages within ~3 clicks of the homepage; no orphan pages.
2. **Technical foundations** — Core Web Vitals (LCP < 2.5s, INP < 200ms, CLS < 0.1), TTFB, image optimisation, HTTPS, mobile-friendliness, www/non-www and trailing-slash consistency.
3. **On-page** — one clear `<title>` (≈30–60 chars) and meta description (≈70–160) per page, single H1, descriptive headings mirroring search patterns, keyword in title/H1/first paragraph/URL, descriptive alt text, internal links with meaningful anchors.
4. **Content quality** — does the page deserve to rank? Intent match, comprehensive coverage, freshness, E-E-A-T signals; flag thin or unfocused pages.
5. **Authority & links** — internal linking structure and credible external references.

**Tooling caveat** — a static HTML fetch (axios/curl/`web_fetch`) **cannot see JS-injected schema/JSON-LD** (Yoast, RankMath, AIOSEO inject it client-side). Never report "no schema found" from a static fetch alone — verify with a rendering tool. (This is exactly the gap the Camofox stealth-renderer closes for our scrapers.)

Report findings as prioritised, specific actions with the evidence — not a generic checklist.
