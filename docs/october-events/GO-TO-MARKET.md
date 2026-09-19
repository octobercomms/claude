# Go-to-market: product ladder, agency positioning, build order

Status: scoping. Owner: Daniel. Sits with `PRODUCTISATION-PLAN.md` (delivery)
and `PLATFORM-ARCHITECTURE.md` (the later platform). This doc is how it is
packaged, sold, and what gets built first.

## 1. Positioning

October Events is not a ticketing tool. It is **festival-in-a-box plus a
fractional festival team**. Eventbrite, Event Espresso and StellarWP are
software companies; they cannot design, build and run a festival, because they
do not do delivery. October can, and has, on ADF. That combination of software
plus agency is the moat no software competitor can copy.

Anchor line, tested against Eventbrite (the fee story):

> Eventbrite owns your audience and gives you a ticket button, at roughly 14% on
> a small ticket. Run it on ours: keep your attendees, your brand and your data,
> add volunteers, membership and marketing, pay a flat fee, no per-ticket cut.

Against Event Espresso the pitch is UX and the whole-festival bundle, not price
(EE's entry licence is ~$80, so "$500, no fees" is not a price win over EE; it is
a knockout only against Eventbrite's percentage).

## 2. Two ideal customers

- **Refugees.** Existing festivals on Eventbrite (absorbing large fees; ADF paid
  ~$11k/yr) or on a clunky plugin (Event Espresso / StellarWP, features but poor
  UX). They switch.
- **Greenfield founders.** People with the connections and the idea but no tech
  and no operator. October brings the entire stack and runs it. Best customer:
  zero switching cost, maximum dependence, stickiest and highest margin. No
  competitor is in that room.

Screen refugees for the profile where the wedge bites: paid tickets, real volume,
ideally many lower-priced tickets (Eventbrite's fixed per-ticket fee hurts most
there).

## 3. The product and pricing ladder

Cheap wedge to get them in; agency services where the margin is.

| Rung | Price (indicative) | For | Status |
|---|---|---|---|
| Plugin, no fees | $500/yr, self-serve | Refugees, UX sufferers | **Built (see build order)** |
| Premium (support + setup) | $1.5–2.5k/yr | Base users wanting help | Package it |
| Website design + build | $3–8k project | New or rebuilding festivals | October agency skill |
| Managed marketing + sales | £6–20k/yr | The few who want it run | October DNA; the margin |
| Hosted app (non-WordPress) | later | Squarespace/Wix/etc | The platform build, after demand |

Rules:

- **The $500 plugin is the acquisition product, not the revenue.** ~50 plugin
  customers to reach £20k would bury a solo operator in support. Price and design
  the ladder so a handful of customers *climb*, not so a crowd sits on $500. Under
  ten climbing relationships clears £20k.
- **Support is gated to premium.** The base tier is genuinely self-serve, or
  WordPress support load (hosting, themes, versions, conflicts) consumes the hours
  the profitable rungs need.
- **The real plugin competitor is StellarWP** (The Events Calendar + Event
  Tickets), not Event Espresso. Do not compete on ticketing features. Win on the
  bundle (volunteers, membership, marketing on one contact record) and the agency.

## 4. The agency layer: moat and ceiling

The managed service (design, build, run marketing and sales, systematised) is the
differentiator and the margin engine. It caps at one operator's hours, which is
acceptable because it is the high-value, low-count rung. Two disciplines keep it
from becoming a trap:

- **Systematise delivery** (AI-drafted newsletters and social, templated
  playbooks). That leverage raises how many managed festivals one person carries.
  The OMI tools plus AI content are that lever, so the systematised marketing
  playbook is product work, not a nicety.
- **Plugin scales, managed does not.** Plugin and premium are the volume; managed
  stays for the few who pay properly.

## 5. Build order (engineering)

1. **Self-contained plugin (priority one).** Remove the Jet / Crocoblock
   (JetEngine, JetFormBuilder, JetSmartFilters) and Elementor dependency so the
   plugin runs on a basic WordPress install with nothing else bought or
   configured. This is the make-or-break for the whole GTM and comes before the
   multi-tenant platform.
   - The transactional core is already plugin-owned (checkout, tickets, check-in
     PWA, dashboard, volunteer signup, REST API), so the refactor is bounded.
   - Work: register the events and volunteer CPTs itself; ship its own front-end
     for listings, destinations map, board and filters (blocks/shortcodes,
     extending the existing `[oe_design_map]` fallback); own the organiser
     create/edit forms (replacing JetFormBuilder and Profile Builder); fold the
     ads module back in (the `oc-ad-manager` merge scoped in `HOPE-SALONS-SCOPE.md`).
   - Result: "basic WordPress + this plugin = events, tickets, ads, volunteers,
     content, email", light-touch to deploy and manage.
2. **Package the ladder:** premium support tier, the website-build offer, the
   managed-service scope and the systematised marketing playbook.
3. **Hosted app / multi-tenant platform:** only after the plugin proves demand
   (`PLATFORM-ARCHITECTURE.md`).

## 6. Open items

1. Prospecting geography: US, UK, or both (sets where the call sheet is built).
2. Final ladder prices, once the plugin is packaged.
3. The managed-service systematised playbook contents (which marketing activities
   are productised: newsletter, social, ads, content).
