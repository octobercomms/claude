# Unified festival platform — architecture and build spec

Status: scoping. Owner: Daniel. Supersedes the delivery-model question in
`PRODUCTISATION-PLAN.md` (that doc's managed-install model remains the way to
earn now; this doc scopes the platform to build alongside and after it).

## 1. Product principle: one app, not a suite

The customer sees a single product. One website, one signup, one login, one
price, one experience. Events operations and marketing intelligence arrive
together, already joined. A buyer never purchases two things and wires them up.

This is a positioning decision first: the differentiator is that nobody else
offers the whole festival plus the marketing engine in one place at one price.
The competitive map (`COMPETITIVE-LANDSCAPE` notes) shows every incumbent selling
one slice. The unified product is the "why this and not five tools" answer.

## 2. What it merges

- **October Events** (`dev/october-events`): listings, submission and approval,
  ticketing, volunteers with shifts and reminders, membership, check-in, the
  self-serve organiser engine from `SELF-SERVE-PLATFORM-2027.md`.
- **OMI marketing tools** (from `dev/platform`): the marketing intelligence
  capability, lifted into this product as modules.

### How the merge is done (decided: composition, not fusion)

- **Two codebases, one composed product.** October Events and OMI stay as
  separate engines, each maintainable on its own. A **front-end app composes them
  into a single product** the customer experiences as one: one website, one
  signup, one login, one price. This suits running two engines that already work
  rather than surgically fusing them, and keeps each engine's roadmap independent.
- **The shared spine is the seam that matters.** A shared **identity, tenant and
  contact layer** both engines read from. If the marketing engine cannot see the
  events engine's contact record, the joined-up promise (and the segmentation
  being sold) breaks. This shared spine, not the front end alone, is what makes
  two codebases behave as one product.
- **Do not destabilise the live engines.** The existing OMI (`dev/platform`) keeps
  its own users and roadmap. Respect the `CLAUDE.md` rule keeping OMI and nvelope
  branding separate: the composed product carries neither brand by default, brand
  is per tenant.

## 3. Multi-tenancy and isolation (the critical line)

Multiple festivals share one platform. Tenant isolation is the single most
important property and the most likely failure mode.

- Every tenant has an id. **Every query is scoped to the tenant, enforced
  server-side**, never by client-supplied ids and never by UI hiding alone.
- No cross-tenant read or write path exists. A user in tenant A can never see or
  edit tenant B's events, contacts, registrations, or payments.
- Tenant resolution (subdomain or custom domain) is decided at the edge and
  carried through every request.
- Isolation is tested adversarially, not assumed because the happy path works.
  This is where an AI-written app most easily ships a confident IDOR.

Decision to record: **row-level tenancy in one shared database with a mandatory
tenant scope**, versus **a database per tenant**. Shared-DB is simpler to operate
and cheaper; DB-per-tenant is stronger isolation but heavier. Recommendation:
shared DB with enforced row scoping and a hard test suite proving isolation,
moving to DB-per-tenant only if a client's data-residency terms demand it.

## 4. Internal modules

One codebase, clear seams:

| Module | Responsibility |
|---|---|
| Tenancy + identity | Tenant resolution, accounts, roles, permissions |
| Listings + submission | Organiser self-serve create/edit/approve/publish |
| Ticketing | Orders, tickets, check-in, promo, waitlist |
| Volunteers | Opportunities, shifts, signups, reminders |
| Membership | Tiers, renewal, member rates, entitlement checks |
| Contacts (CRM spine) | One person record, tagged by role (section 6) |
| Marketing intelligence | The OMI capability, ported |
| Comms | Email and SMS sending through a provider pipe |
| Billing | October's subscription fee (section 5) |
| Admin + config | Per-tenant brand, module flags, settings |

A module is on or off per tenant (the flag-hardening already scoped in
`HOPE-SALONS-SCOPE.md`), so a tenant runs only what it needs.

## 5. Roles and payments

- **Roles per tenant.** The organiser, the volunteer lead, the events lead, the
  marketing lead each see their own section. Role-based access enforced
  server-side.
- **Their money on their Stripe.** Listing fees and ticket sales settle to the
  tenant's own Stripe account. The platform does not hold their funds, which
  keeps October out of payment-facilitator and marketplace liability.
- **October's fee is a subscription** billed to the tenant on the platform's own
  Stripe. Stripe Connect is only introduced if October later chooses to take the
  tenant's transaction money and split it, a deliberate liability decision, not a
  launch requirement.

## 6. Data model spine: one contact, many roles

The unified contact record is the reason the product beats a stack of point
tools. A ticket buyer, a volunteer, and a member are **one record with tags and
history**, not three records in three systems. Marketing intelligence and comms
segment on that single record (ticket type, membership tier, volunteer history,
no-show rate). Design this first; everything else hangs off it.

## 7. Stack and hosting

- Standalone application (not a WordPress plugin), so it runs for any tenant
  regardless of the tenant's own website platform.
- Tenant surfaces served on a themed subdomain or custom domain; embeds available
  for pieces that must sit on the tenant's existing site.
- Hosting on a managed cloud (AWS or similar) with per-tenant config and one
  deploy pipeline.
- Comms sending through a provider (Brevo or Amazon SES); the platform owns the
  segmentation, the provider owns deliverability.

## 8. Security gate (non-negotiable)

Before the platform serves a single external tenant with real payments and real
attendee PII, an **independent adversarial security review** runs, covering at
minimum the four canonical threats in `october-security`: tenant isolation and
IDOR, authentication and session, rate limiting and abuse, and secrets and
headers. "It works" is not "it is safe". This gate does not move.

GDPR: October is the tenants' data processor. Data-processing terms, retention
rules, and special-category handling (dietary and access data, per
`HOPE-SALONS-SCOPE.md`) are in place before launch.

## 9. Migration off WordPress

Lift the events engine's logic and data model into the platform; import existing
tenant data. The current WordPress plugin keeps running the existing October
sites until the platform is proven, then those sites migrate the same way legacy
tools were retired (migrate, verify, cut over).

## 10. Financial target and what it implies

The stated target is **£20k/year**, framed as replacing ADF income if it stops
and walking away with a product to sell. These are two different goals with
different build implications.

| Goal | What it is | Needs the platform? |
|---|---|---|
| £20k/year income | A services *job*: delivered by October, income stops if work stops | No. 3–4 managed festivals hit it (`PRODUCTISATION-PLAN.md`) |
| A product to sell | An *asset*: recurring revenue, low-touch, runs without the founder | Yes, and realistically growth past £20k to be worth a sale |

Reaching £20k:

| Route | Clients | Each | Total |
|---|---|---|---|
| Managed | 4 | £5k/cycle | £20k |
| Managed | 3 | £6.7k/cycle | £20k |
| Turnkey | 2 | £10k/cycle | £20k |

Plus setup fees (£1.5–3k each) front-loading cash. £20k is reachable on the
managed WordPress model with no platform rebuild.

**Sequencing, not either/or:** earn the £20k as services first (replaces ADF,
proves demand), then use the cheap AI-assisted build to convert that proven book
into the low-touch, sellable asset. Cheap build is what makes the second step
rational at modest revenue.

The constraint on £20k is not build, it is **3–4 signed festivals**. No external
prospect is named yet (open decision 5). Building does not produce clients;
conversations do.

## 11. Build sequence

1. **Now, no platform needed:** land the first umbrella festival on the managed
   WordPress model (`PRODUCTISATION-PLAN.md`). Real revenue, real requirements.
2. **Spine first:** tenancy, identity, roles, and the one-contact data model, with
   the isolation test suite. Nothing else is safe to build until this holds.
3. **Core modules:** listings/submission, ticketing, volunteers, membership,
   comms. The MVP a festival can actually run on.
4. **Marketing intelligence:** port the OMI capability as modules.
5. **Security review, then open to market** with the first client already live as
   a reference.

Build against the first client's real needs, funded by the engagement, rather
than to a guess.

## 12. Open decisions

1. Tenancy model: shared DB with row scoping (recommended) vs DB-per-tenant.
2. The new product's name and its repo home (`dev/<name>` + `docs/<name>` per the
   two-folder rule).
3. Which OMI modules make the launch MVP vs a later phase.
4. Stack choice for the standalone app (language, framework, hosting).
5. The three named prospect festivals (still open from `PRODUCTISATION-PLAN.md`),
   which set the MVP module list.
