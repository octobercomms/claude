# Structured data (Schema.org / JSON-LD) methodology

Distilled from the MIT-licensed coreyhaines31/marketingskills `schema` skill.
Use as grounding for structured-data audits and JSON-LD generation.

## Principles
- **JSON-LD in a `<script type="application/ld+json">` is the only format Google
  recommends.** Microdata/RDFa are legacy; flag them as weak even when valid.
- **Mark up what's genuinely on the page.** Schema that describes content a user
  can't see is a spam signal and risks a manual action. Never invent reviews,
  ratings, prices, or FAQs that aren't present.
- **One primary type per page, plus supporting types.** A local service page is
  typically `LocalBusiness` (or a subtype) + `BreadcrumbList` + optionally
  `FAQPage`. A blog post is `Article`/`BlogPosting` + `BreadcrumbList`.
- **`@id` + `sameAs` build the entity graph.** A stable `@id` (the canonical URL
  + `#organization`) and `sameAs` links to social/Wikidata profiles help Google
  reconcile the brand as a known entity — important for both rich results and
  AI-answer citation.

## LocalBusiness essentials (the high-value miss for local SEO)
A complete `LocalBusiness` node should carry: `name`, `@id`, `url`, `telephone`,
`image`, `priceRange`, `address` (full `PostalAddress`), `geo` (`GeoCoordinates`),
`openingHoursSpecification`, `areaServed`, and `sameAs`. Pick the **most specific
subtype** that fits (`Dentist`, `Plumber`, `HomeAndConstructionBusiness`,
`Restaurant`, …) rather than bare `LocalBusiness` — specificity earns richer
treatment. Missing `LocalBusiness` on a local site is almost always the
highest-priority fix.

## Audit verdicts
- **useful** — present, valid, matches visible content, uses a specific type.
- **weak** — present but thin (missing recommended fields), too-generic type, or
  microdata where JSON-LD is expected.
- **broken** — invalid JSON, wrong/empty required fields, or describes content
  not on the page.

## Priorities for what's missing
- **high** — a primary type the page clearly warrants (LocalBusiness on a local
  page, Product on a product page, Article on a post) that is absent.
- **medium** — supporting types that unlock rich results (FAQPage, BreadcrumbList,
  Review/AggregateRating where genuine).
- **low** — nice-to-have enrichment (sameAs expansion, Organization logo).

## Output discipline
Generated JSON-LD must be valid, copy-paste-ready, and use placeholder values
(`"telephone": "{{PHONE}}"`) for anything not derivable from the page so the AM
fills real data rather than shipping a guess.
