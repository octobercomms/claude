# nvelope.co — Paid Advertising Strategy
**Platform:** Lead generation marketplace for architecture & design studios
**Channels:** Google Ads · Meta Ads · X (Twitter) Ads
**Updated:** March 2026

---

## Business Model Summary

nvelope.co operates a B2B2C model:
- **B2B supply side:** Architecture and design studios pay to be listed and receive leads
- **B2C demand side:** Homeowners and property developers discover studios via paid ads, complete a quiz flow, and submit a lead form on a dedicated studio landing page

**Core conversion event:** Quiz completion → Lead form submission on `/studio/[studio-slug]/`

**Why this matters for ads:**
- The quiz pre-qualifies intent — expect lower volume but higher-quality leads than a simple contact form
- Each studio page is a standalone conversion destination — campaigns can be studio-specific or platform-wide
- High-ticket service ($30K–$500K+ projects) justifies high CPLs

---

## Target Audience

### Primary — Active Project Seekers
- Homeowners planning a renovation, extension, or new build
- Property developers at feasibility/concept stage
- Age 30–60, household income £60K+ / $80K+
- Actively searching for "architect" or "interior designer" right now

### Secondary — Inspiration-Phase Homeowners
- Browsing design content, saving Pinterest/Instagram boards
- 3–12 months from pulling the trigger on a project
- Responsive to aspirational creative, not yet ready to fill in a form

### Tertiary — Commercial Clients
- Small business owners needing fit-out or office design
- Property investors needing design input on rental/HMO projects

---

## Platform Roles

| Platform | Funnel Role | Why It Works |
|----------|-------------|--------------|
| **Google Search** | Bottom of funnel — capture active demand | People search "residential architect London" → highest intent |
| **Meta (FB + IG)** | Mid/top funnel — generate demand, retarget | Visual platform perfect for architecture/design imagery; massive reach for homeowners |
| **X (Twitter)** | Top of funnel — brand + niche interest | Property, renovation, and interior design communities are active on X; lower CPMs |

---

## Platform Budget Split (Recommended)

Based on the Local Service + Real Estate benchmark hybrid for lead gen platforms:

| Platform | % of Budget | Role |
|----------|-------------|------|
| Google Ads | 50% | Primary — direct intent capture |
| Meta Ads | 35% | Secondary — demand gen + retargeting |
| X Ads | 15% | Testing — niche interest targeting |

Apply **70/20/10 rule** within each platform:
- 70% to proven campaign types (Search, Retargeting)
- 20% to scaling (broad match expansion, Lookalike audiences)
- 10% to experiments (new formats, creative angles)

---

## Minimum Viable Budgets per Client Studio

These are per-client monthly minimums to achieve statistical significance:

| Platform | Min Monthly (per studio) | Min Monthly (platform-wide) |
|----------|-------------------------|------------------------------|
| Google Ads | $800–$1,200 | $2,000+ across all studios |
| Meta Ads | $500–$800 | $1,500+ across all studios |
| X Ads | $300–$500 | $600+ |
| **Total** | **$1,600–$2,500** | **$4,100+ recommended** |

> **For per-studio campaigns:** Budget to target 15+ leads/month minimum (enough data to optimise).
> **For platform-wide campaigns:** Drive traffic to nvelope.co homepage or a "find a studio" landing page.

---

## Primary KPIs

| Metric | Target (Month 1–2) | Target (Month 3–6) |
|--------|--------------------|--------------------|
| Cost Per Lead (CPL) | $80–$150 | $50–$100 |
| Quiz Start Rate | Baseline | +20% vs baseline |
| Quiz Completion Rate | Baseline | 50%+ of starters |
| Lead Form Submit Rate | Baseline | 30%+ of quiz completers |
| Lead Quality Score | Baseline | Track via studio CRM |

> CPL targets are intentionally conservative for Month 1. Architecture leads that close are worth $5K–$50K+ in studio fees, so a $100 CPL is an excellent unit economics even at low close rates.

---

## Funnel Architecture

```
AD IMPRESSION
    │
    ▼
AD CLICK → /studio/[studio-slug]/
    │
    ▼
STUDIO LANDING PAGE (hero → portfolio → social proof)
    │
    ▼
QUIZ FLOW (project type → budget → timeline → location → contact)
    │
    ▼
LEAD FORM SUBMIT (name, email, phone, project brief)
    │
    ▼
STUDIO FOLLOW-UP (email/call within 24h)
    │
    ▼
CONSULTATION BOOKED → PROJECT WON
```

### Drop-off Points to Monitor
1. **Ad → Page click-through:** Optimise ad relevance and landing page match
2. **Page → Quiz start:** CTA prominence, page load speed, above-fold message
3. **Quiz → Completion:** Reduce friction (≤6 questions), progress indicator
4. **Quiz → Form submit:** Auto-fill where possible, clear value proposition at end

---

## Phase Roadmap

### Phase 1 — Foundation (Weeks 1–2)
- [ ] Install tracking across all platforms (Pixel, gtag, X Pixel)
- [ ] Set up server-side tracking for lead form submissions
- [ ] Define conversion events: quiz_start, quiz_complete, lead_submit
- [ ] Build first-party audiences from existing studio page visitors
- [ ] Produce initial creative assets (3–5 static images, 2 videos)

### Phase 2 — Launch (Weeks 3–4)
- [ ] Launch Google Search — 1 branded campaign + 1 non-brand per studio geo
- [ ] Launch Meta — 1 prospecting campaign + 1 retargeting campaign
- [ ] Launch X — 1 interest-targeting campaign
- [ ] Set conservative bids (Maximize Clicks on Google, Lowest Cost on Meta/X)
- [ ] Daily monitoring for first 7 days

### Phase 3 — Optimise (Weeks 5–8)
- [ ] Review CPL, quiz completion rate, and lead quality weekly
- [ ] Apply 3× Kill Rule: pause any ad set spending 3× target CPL with zero leads
- [ ] Switch Google to Target CPA once 15+ conversions accumulated
- [ ] Expand Meta Lookalike audiences based on lead submitters
- [ ] A/B test 2 creative angles per platform

### Phase 4 — Scale (Weeks 9–16)
- [ ] Apply 20% Rule: increase budget 20% on campaigns hitting CPL target
- [ ] Launch additional studio campaigns based on Phase 2–3 learnings
- [ ] Test Performance Max on Google for wider reach
- [ ] Build studio-specific retargeting sequences on Meta
- [ ] Monthly reporting to clients with CPL, lead quality, close rate

---

## Competitive Positioning

**Key differentiators to emphasise in ads:**
1. **Pre-qualification via quiz** — studios receive better leads than cold enquiries
2. **Studio-specific pages** — feels curated, not generic directory
3. **Portfolio showcase** — visual credibility before contact
4. **Speed** — homeowners can find and contact a studio in <5 minutes

**Ad messaging angles to test:**
- "Find an architect who gets your vision" (aspiration)
- "See their work before you call" (trust/proof)
- "Your project deserves the right designer" (quality positioning)
- "Tell us about your project — we'll match you with the perfect studio" (quiz-first angle)
