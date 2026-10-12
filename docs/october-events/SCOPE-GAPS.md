# Scope gaps: sell-to-others plumbing (PARKED)

Status: **parked**. Owner: Daniel. Plugin: `dev/october-events`.

These are the gaps between "October Events runs the reference festival well" and
"a stranger can buy it, run it, and October can charge for it and support it."
None of them block the current goal, which is getting the plugin working natively
for the reference tenant (ADF), refining it, and ironing out the detail. They are
recorded here so the list is not rediscovered later, and so build decisions made
now (tenant-awareness, the entitlements flag) do not paint the product into a
corner.

**Do not start these yet.** Revisit when the reference tenant is fully native off
JetEngine, stable across a full festival cycle, and the owner opens the
"available for others to buy" project. The build plan for the work that comes
first is [`BUILD-PLAN.md`](BUILD-PLAN.md).

Business and operating decisions already taken (managed WordPress per client,
client's own Stripe, pricing ladder, isolation-is-free, October as data
processor) live in [`PRODUCTISATION-PLAN.md`](PRODUCTISATION-PLAN.md) and
[`GO-TO-MARKET.md`](GO-TO-MARKET.md). This doc is only the **unscoped** work those
decisions still depend on.

---

## A. Code that blocks a second tenant going live

### A1. The migrator as a tool, not a map
[`FIELD-MAPPING.md`](FIELD-MAPPING.md) is the mapping. The tool that runs it is
de-Jet Phase A at headline level only. To onboard a real tenant it needs:
dry-run with a diff report, idempotent re-runs, old-key to `_oe_*` rewrite, the
data cleanups baked in (city trim, hardcoded 2025 volunteer dates, Day 1 / Day 2
schedule normalization), tour-location import from the theme-owned `portfolio`
type, Tours to Locations relation reconstruction from the city + year taxonomy
terms, and a rollback. Partly pulled forward into the ADF build (the ADF migrate
step), but the **generalized, any-tenant** migrator is phase-two.

### A2. Entitlements and licensing
Nothing gates editions or packs per install, or stops the plugin walking. Needed:
a per-install license/entitlement record, a pack-tier flag the plugin reads, a
kill switch, and (if ever sold as "give them the plugin") update-channel
authentication. **Cheap to stub now, expensive to retrofit** — the ADF build
puts the flag in (see BUILD-PLAN), the enforcement and licensing server are
phase-two.

### A3. Ticketing hardening beyond parity
[`TICKETING-PARITY.md`](TICKETING-PARITY.md) proves feature parity for the
reference tenant. Selling to strangers raises the bar: refunds, tax/VAT on
tickets, compliant receipts, the known QR issues, and where each tenant's Stripe
keys live and how they are encrypted at rest. A bug here is a client's money.

### A4. Theming / branding contract
"Host multiple sites, different designs" needs a defined way for a client to
brand listings and archives without touching code. De-Jet Phase C ships default
templates; it does not define the override surface (tokens, template parts,
settings-driven brand colors/logo/type). Scope the contract before the second
tenant, or every client becomes a bespoke theme job.

---

## B. Business / ops that blocks taking money and keeping clients

### B1. Provisioning runbook
"Managed WordPress per client" is the decision; there is no step list. Write it
once by standing up the second tenant (the tours site is the free test): spin up
site, install plugin, set `adoption_mode`, run migrator, switch on packs, seed
config, hand over logins. **Until it is written and timed, the true cost-to-serve
is unknown**, and that number is what the whole earn model rests on.

### B2. Billing the client
The client's own Stripe handles their ticket sales. Separate and unscoped: how
October collects the platform fee (£500 base / £1.5–2.5k premium). Recurring
invoice vs card on file vs annual up front. Affects churn and cashflow.

### B3. Backups, uptime, incident response
Solo operator, client data, festival-day criticality. One corrupted database with
no restore path ends the reference relationship and its referrals. Needs a stated
backup cadence, a restore test, and a "site down on festival morning" plan.

---

## C. Scale and risk that bites at three or more clients

### C1. Email deliverability
Native SES send is built; deliverability is not. Per-tenant sending subdomain,
SPF/DKIM/DMARC, warm-up, bounce and complaint handling, suppression lists. (The
dedicated-subdomain piece is already carried in the brief's Messaging stack as
unbuilt.) Get it wrong and ticket confirmations land in spam, which for an events
product is the whole job.

### C2. AI cost metering
"AI the organizer pays for" needs a per-tenant cap or meter so one client's usage
cannot eat the margin on their fee. Ties to A2 (entitlements).

### C3. Update governance
Rolling a plugin update to N live client sites without breaking one. Adoption mode
helps; there is no release channel, backwards-compat policy, or staged-rollout
rule.

---

## What the ADF-first build should do now so this stays cheap later

Pulled into [`BUILD-PLAN.md`](BUILD-PLAN.md) because retrofitting them is the
expensive path:

- **Tenant-awareness** in every new feature (data self-contained per entity).
- **The entitlements flag** stubbed in Phase 0, read but not enforced.
- **Settings-driven branding hooks** left in the Phase C templates, even if only
  the reference tenant's values are set.
- **Per-tenant sending identity** considered in any email work, even if only one
  identity exists today.
