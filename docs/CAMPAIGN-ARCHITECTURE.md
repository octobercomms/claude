# nvelope.co — Campaign Architecture
**Platforms:** Google Ads · Meta Ads · X (Twitter) Ads
**Updated:** March 2026

---

## Naming Convention

```
[PLATFORM]_[OBJECTIVE]_[AUDIENCE-TYPE]_[GEO]_[STUDIO-OR-PLATFORM]_[YYYYMM]

Examples:
  GOOG_SRCH_NonBrand_London_ManoloDsgn_202604
  META_CONV_Prospecting_UK_Platform_202604
  X_AWARE_DesignInterest_UK_Platform_202604
```

---

## Google Ads Architecture

### Account Structure (per studio OR platform-wide)

```
Google Ads Account — nvelope.co
│
├── BRAND CAMPAIGNS (always-on)
│   └── GOOG_SRCH_Brand_[Geo]_nvelope_[YYYYMM]
│       └── Ad Group: nvelope brand terms
│           Keywords: [nvelope], [nvelope.co], [nvelope architects]
│           Bid: Target Impression Share 90%+ (top of page)
│
├── NON-BRAND — PER STUDIO
│   └── GOOG_SRCH_NonBrand_[City]_[StudioName]_[YYYYMM]
│       ├── Ad Group 1: "Find Architect [City]" (exact + phrase)
│       │   Keywords: [architect london], [residential architect london],
│       │             [find an architect london], [home architect near me]
│       ├── Ad Group 2: "Renovation / Extension" (project-type intent)
│       │   Keywords: [architect for house extension], [renovation architect],
│       │             [planning architect near me], [loft conversion architect]
│       └── Ad Group 3: "Interior Design [City]"
│           Keywords: [interior designer london], [interior design studio london],
│                     [hire interior designer], [home interior design service]
│
├── NON-BRAND — PLATFORM-WIDE (drive to homepage/directory)
│   └── GOOG_SRCH_NonBrand_[Country]_Platform_[YYYYMM]
│       ├── Ad Group 1: Broad architect search
│       ├── Ad Group 2: Interior design intent
│       └── Ad Group 3: Design studio intent
│
├── PERFORMANCE MAX (Month 3+ when conversion data exists)
│   └── GOOG_PMAX_AllNetworks_[Geo]_nvelope_[YYYYMM]
│       ├── Asset Group 1: Residential Architecture
│       ├── Asset Group 2: Interior Design
│       └── Asset Group 3: Commercial Design
│
└── REMARKETING
    └── GOOG_DISP_Retarget_[Geo]_PageVisitors_[YYYYMM]
        ├── Ad Group 1: Studio page visitors (7 days)
        └── Ad Group 2: Quiz starters (14 days, did not complete)
```

### Google RSA Template (per studio ad group)

**Headlines (write 10–12, use 8+ for Good/Excellent strength):**
```
[Studio Name] — [City] Architects        (30 chars max — pin to Position 1)
See Our Portfolio Before You Call        (pin to Position 2)
Architects for Home Renovations
Residential & Commercial Architecture
Award-Winning Design Studio
Projects from £[X]K — Get a Quote
Tell Us About Your Project Today
Find Your Perfect Architect
Trusted by [N] Homeowners in [City]
Extension · New Build · Renovation
Book a Free Consultation Today
Architecture That Fits Your Vision
```

**Descriptions (write 3–4):**
```
Discover [Studio Name]'s portfolio and start your project brief in under 5 minutes.
Complete our short quiz to help [Studio Name] understand your project needs.
From concept to planning permission — [Studio Name] handles it all. See their work.
Trusted architecture studio in [City]. View portfolio and submit your project brief today.
```

**Sitelinks (minimum 4, target 6):**
- View Portfolio | See completed projects
- How It Works | The 3-step process
- Project Types | Extensions, new builds, commercial
- About the Studio | Meet the team
- Get a Quote | Start your project brief
- Client Stories | See what others say

### Google Keywords — Negative List (apply at account level)

```
-jobs, -careers, -salary, -courses, -degree, -university, -software,
-free, -template, -autocad, -revit, -sketchup, -DIY, -planning application,
-architect definition, -what is an architect, -architect meaning
```

---

## Meta Ads Architecture

### Account Structure

```
Meta Ads Account — nvelope.co
│
├── PROSPECTING — BROAD (Top of Funnel)
│   └── META_CONV_Prospecting_[Geo]_Platform_[YYYYMM]
│       Budget: Advantage Campaign Budget (let Meta optimise)
│       ├── Ad Set 1: Broad — Homeowners (no interest targeting, let Advantage+ work)
│       │   Audience: Age 28–60, Homeowner signal, [Geo]
│       │   Placement: Advantage+ Placements
│       │   Creatives: 3–4 variants (image + video mix)
│       │
│       ├── Ad Set 2: Interest — Home Renovation + Design
│       │   Interests: Home improvement, Interior design, Architecture,
│       │              Houzz, Grand Designs, self-build
│       │   Age: 30–65
│       │
│       └── Ad Set 3: Lookalike — Lead Submitters (activate at 100+ leads)
│           Source: Lead form submitters from Pixel data
│           LAL: 1–3% similarity
│
├── RETARGETING (Mid/Bottom of Funnel)
│   └── META_CONV_Retarget_[Geo]_Platform_[YYYYMM]
│       ├── Ad Set 1: Studio page visitors — 7 days (did not submit lead)
│       │   Creative angle: "Still looking for an architect?"
│       ├── Ad Set 2: Quiz starters — 14 days (did not complete)
│       │   Creative angle: "You were close — finish your project brief"
│       └── Ad Set 3: All site visitors — 30 days (general nurture)
│           Creative angle: Social proof / testimonial
│
└── PER-STUDIO CAMPAIGNS (optional, for studios with own geo/audience)
    └── META_CONV_Studio_[City]_[StudioName]_[YYYYMM]
        └── Ad Set 1: Geo-targeted 15–25 mile radius around studio
            Audience: Homeowners + renovation interest
            Creative: Studio portfolio images + quiz CTA
```

### Meta Ad Formats & Copy Templates

#### Format 1 — Static Image (Feed + Stories)
```
Primary Text (125 chars):
"Your home project deserves the right architect.
Browse [Studio Name]'s portfolio and start your brief in 5 minutes. →"

Headline (40 chars):
"Find Your Perfect Architect"

CTA Button: Learn More / Get Quote
Image: Portfolio project photo (4:5 for feed, 9:16 for Stories)
```

#### Format 2 — Carousel (Portfolio Showcase)
```
Card 1: Hero project image — "Kitchen Extension, London"
Card 2: Another project — "Full Renovation, Surrey"
Card 3: Before/After if available — "See the Transformation"
Card 4: Studio team / office — "Meet the Team"
Card 5 (final): CTA card — "Start Your Project Brief →"

Headline per card: Project name or feature
CTA: Each card links to same studio page URL
```

#### Format 3 — Video (Reels / Feed)
```
Hook (0–3s): "Finding the right architect is hard. Here's the easier way."
Body (3–20s): Quick clips of beautiful projects, quiz interface, happy client
CTA (20–30s): "Start your project brief at nvelope.co"

Subtitles: Required (85% watch without sound)
Safe zone: Keep key text in centre 1080×1300px, above bottom 35%
```

### Meta Audience Exclusions
- Existing leads (upload CRM list quarterly)
- Architecture students / professionals (exclude job title targeting)
- People who already submitted lead form (Pixel event exclusion)

---

## X (Twitter) Ads Architecture

### Account Structure

```
X Ads Account — nvelope.co
│
├── AWARENESS — INTEREST TARGETING
│   └── X_AWARE_DesignInterest_[Geo]_Platform_[YYYYMM]
│       ├── Ad Group 1: Home & Architecture Interests
│       │   Interests: Architecture, Interior design, Home renovation,
│       │              Property, Real estate, Grand Designs, self-build
│       │   Format: Promoted Posts (single image or video)
│       │
│       ├── Ad Group 2: Property & Lifestyle Follower Targeting
│       │   Follower Look-alikes of: @GrandDesignsCh, @architectsjournal,
│       │                            @dezeen, @ArchDaily, @SelfBuildWorld
│       │   Format: Promoted Posts
│       │
│       └── Ad Group 3: Keyword Targeting (conversation-level)
│           Keywords: "architect", "renovation", "house extension",
│                     "interior designer", "self build"
│           Format: Promoted Posts
│
└── RETARGETING
    └── X_CONV_Retarget_[Geo]_WebsiteVisitors_[YYYYMM]
        └── Ad Group 1: X Pixel website visitors — 30 days
            Creative: "Still searching for an architect?"
```

### X Ad Copy Templates

#### Promoted Post — Awareness
```
Tweet copy:
"Finding the right architect shouldn't take months of cold emails.

Browse vetted design studios, see their real work, and submit your
project brief in one place.

→ nvelope.co/studio/[slug]/ [link]

#architecture #homedesign #renovation"

Media: Single high-quality portfolio image (1200×628 or 1080×1080)
```

#### Promoted Post — Social Proof
```
Tweet copy:
"These are the architects other homeowners in [City] are working with.

Real portfolios. Real projects. No directory spam.

Find your studio → [link]"

Media: Collage of 2–3 project photos or short reel
```

#### Promoted Post — Quiz CTA
```
Tweet copy:
"What kind of architect do you actually need?

Answer 5 quick questions and we'll show you studios that match your
project, budget, and location.

Take the quiz → [link]"

Media: Animated GIF of quiz flow or simple graphic
```

---

## Cross-Platform Audience Strategy

### First-Party Data Layers (build progressively)

| Audience | Size Target | Source | Use |
|----------|-------------|--------|-----|
| Quiz starters | All | Pixel event | Retarget on all platforms |
| Lead submitters | All | Pixel event | Exclude from prospecting, create LAL |
| Studio page visitors (7d) | All | Pixel | Hot retargeting |
| Studio page visitors (30d) | All | Pixel | Warm nurture |
| Email list (existing) | Upload | CRM | Suppression + LAL seed |

### Attribution Model
- **Primary source of truth:** CRM data (which leads became clients)
- **Secondary:** GA4 last-click with UTM parameters on all ad links
- **Platform-reported:** Directional only — expect 20–40% overclaim
- **UTM structure:** `?utm_source=[google/meta/x]&utm_medium=paid&utm_campaign=[campaign-name]&utm_content=[ad-id]`
