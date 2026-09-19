# Productising October Events for other festivals

Status: scoping. Owner: Daniel. Plugin: `dev/october-events` (October Events).

## 1. Premise

October Events is built, in production, and running multiple brands (ADF,
Architecture Tours, Hope Salons) from one codebase. This plan is not about
creating a product from scratch. It is about letting a small number of other
festivals pay to use what already exists, with the least new work and the least
new liability.

Ambition is deliberately modest: a few clients, a useful second revenue line for
the agency, not a venture-scale SaaS. The plan is sized to that.

## 2. Who this is for

The buyer is the **umbrella festival**: a city design week, art month, fringe or
open-studios programme that lists many partner events and **charges organisers to
be listed** (London Design Festival lists hundreds of events at ~£250 each;
Clerkenwell Design Week, Fuorisalone, 3daysofdesign, NYCxDesign, Melbourne Design
Week and city-scale art/food weeks work the same way).

Why this buyer and not a single small festival:

| | Single festival (e.g. ADF) | Umbrella festival (e.g. LDF) |
|---|---|---|
| Unit | £20–40 ticket | £250 listing |
| Volume | ~1,000 tickets | hundreds of events |
| Gross through platform | £20k–40k | £75k+ (300 × £250) |
| Platform economics | fees are noise | fees are real money |

At single-festival ticket scale the transaction economics collapse. At umbrella
listing scale they stand up. The core product is the **self-serve submission,
payment, approval and programme-publishing engine** already scoped in
`SELF-SERVE-PLATFORM-2027.md`, pointed at the buyer it actually fits.

Competition for this specific job is thin: most design weeks and fringes run on
bespoke WordPress and manual admin (the "Ronnie from HKS keeps emailing changes"
workload). The credible differentiator is that October has run one.

## 3. Delivery model: managed install per client

Do not hand over the plugin. Do not rebuild to a platform. **Host a separate
WordPress install per client and run it**, exactly as ADF runs today.

| Option | Engineering to start | Support / risk | Verdict |
|---|---|---|---|
| **Managed WP per client** | ~none | Isolation is free (separate DBs) | **Start here** |
| WP Multisite | Some | Shared tables, tenant-isolation risk | Only at scale not yet present |
| Give them the plugin | Remove Crocoblock dep, harden | Their hosting, heavy support | Later, if demand pulls it |
| Headless rebuild + connectors | Months | The big bet | Only if proven |

Separate installs remove the single biggest risk the security docs flag:
cross-tenant data leaks. Different databases mean one client physically cannot see
another's data. The Crocoblock dependency also stops being a blocker, because it
is bought and configured on installs October controls.

## 4. Payments: their Stripe, not ours

Use **the client's own Stripe account** for listing and ticket payments. Money
flows straight to them. October **invoices its platform fee separately** as a
normal service charge.

Consequence: October is not a payment facilitator, not a marketplace, holds no
one's money. No Stripe Connect, no KYC onboarding friction, no chargeback
exposure, no negative-balance risk. Connect is only needed if October later
chooses to take the listing money itself and split it, a liability taken on
deliberately when revenue justifies it, not at the start.

## 5. What exists vs the gap to first revenue

**Already built:** the plugin; multi-brand; Stripe; Brevo email and SMS; the
self-serve submission, approval and add-on engine; the GitHub self-updater;
per-site branding; ticketing, volunteers, membership rates.

**Gap to close, mostly not code:**

- **Onboarding runbook** — turn tacit setup into a repeatable checklist so each
  client takes days, not weeks.
- **Pricing sheet** — see section 6.
- **Contract + GDPR data-processing addendum** — October is the client's data
  processor once it hosts their data.
- **Flag-hardening** (already scoped in `HOPE-SALONS-SCOPE.md` P1) so each install
  runs only the modules a client needs. Do it around client one or two, not
  before.

## 6. Pricing (indicative)

- Setup: £1,500–3,000 per client (onboarding, brand, data import).
- Per cycle (annual festival): £3,000–8,000, or £300–600/mo.
- Listing/ticket fees go to the client's own Stripe; October does not touch them.
- Three clients ≈ £15k–30k/year plus setup. Low liability, supportable solo.

The value sold is revenue architecture executed by the platform (self-serve
listings, add-on upsells, membership as year-round revenue), not "festival
software". That is what justifies the contract and what a feature-copying
competitor cannot replicate.

## 7. Phased plan

1. **Package (2–4 weeks, mostly non-code).** Runbook, host choice, pricing sheet,
   contract + DPA, a one-page sales page on the listing-fee model and the
   "built by someone who has run one" positioning.
2. **First paying client.** One umbrella/design-week festival, hosted by October,
   on the client's own Stripe. Configure brand, Brevo, import events, go live,
   support one cycle. Goal: one reference client and real cost-to-run numbers.
3. **Make it repeatable (after client one works).** Flag-hardening, a clonable
   base install, a version-tracking sheet, clients two and three.
4. **Only if demand pulls it.** Self-serve organiser onboarding, a connector for
   clients on their own WordPress, or the headless rebuild, funded from revenue.

## 8. Legal and data minimum before taking money

- Service agreement per client.
- GDPR data-processing addendum (October as processor), retention rules, and the
  health-data care already noted in `HOPE-SALONS-SCOPE.md` for any dietary/access
  fields.
- Clear position that the attendee marketing relationship stays with the client
  unless separately agreed.

## 9. Risks

- **Onboarding drift.** Without the runbook, each client is a bespoke build and
  margin evaporates. The runbook is the control.
- **Support ceiling.** Solo capacity caps the client count. Price high and keep
  the count low rather than chasing volume.
- **Scope creep per client.** Anything that only one client needs sits behind a
  flag or a setting, never in the core (the rule already set in
  `HOPE-SALONS-SCOPE.md`).

## 10. Open items

1. **Three named prospect festivals** October can realistically get a meeting
   with. ADF is not the first client for this model (it does not charge partners
   to list), which is healthier: client zero is not October itself.
2. Typical listing volume and listing price for each named prospect, to size the
   platform fee against real numbers.
3. Host choice for the managed installs.
4. Whether any named prospect actually wants membership, before it is built as a
   promise rather than an option.
