# Crew module: team tiers and the planning-team lifecycle

Status: scoping (build spec). Owner: Daniel. Plugin: `dev/october-events`.
Sits behind de-Jet (`DE-JET-MIGRATION.md`) in the build queue. Extends, and is
distinct from, the existing shift-based volunteer signups.

## 1. One People system, four involvement tiers

A festival's people sit on a spectrum of involvement. Model them as **one People /
Team record** with a `tier` field, switching capabilities on per tier. Only the two
tiers with real admin get automation; the governance tiers are display only.

| Tier | What it is | Plugin role | Capabilities on |
|---|---|---|---|
| Festival Volunteers | Day-of, shift-based (docents, meet and greet) | **Manage** (already built) | Shift signups |
| Planning Team | Year-long named roles with access and commitment | **Manage** (this module) | Role, login, agreement, role email, renewal |
| Council | Governance, recruited manually | **Display only** | Directory entry |
| Board | Governance, recruited manually | **Display only** | Directory entry |

Two payoffs from one data source:

- **Public "our team" page for free:** a default template renders the people table
  grouped by tier (the accordion pattern SDF uses). One template, all four groups.
- **One contact record:** board members, coordinators and day-of volunteers are all
  contacts in the CRM with a tier tag, so they segment and email like everything
  else. Council and Board carry no automation, but still exist as records.

Council and Board have no scheduling and no logins, so there is nothing to
automate. Do not build recruit/renewal machinery for them.

## 2. Distinction from existing volunteer signups

- **Event volunteers** (built): opportunity + shift + capacity + reminders, in
  `includes/Volunteers.php` / `VolunteerSignups.php`. Day-of, turn-up-on-the-day.
- **Planning team** (new): year-long named roles that run the festival, with
  logins, a commitment agreement, a role email, and a renewal cycle.

## 3. Planning-team lifecycle

| Stage | What happens | Reuse | Build | Catch |
|---|---|---|---|---|
| Recruit | Public "join the team" page lists open roles (title, owns, hours/month); applicant applies to a named role | Submission/approval engine; de-Jet forms | Role-application pipeline | Low |
| Offer | Accept an applicant into a role with start/end dates | Approval pipeline | Role assignment record | Low |
| Agree | Accept a role agreement (merged doc: name, role, dates, hours, code of conduct) with click-to-accept, timestamp | PDF rendering, email | Template + accept capture | **Legal, §5** |
| Provision login | Create a role-scoped account; send a set-password link | Account system | Custom roles/capabilities per function | Low-moderate. Never email a password |
| Provision email | Branded role address | Email platform | Alias/forwarder config | **Cost + design, §4** |
| Onboard | Welcome pack: role brief, login, brand assets, checklist | Email campaigns/templates | Onboarding sequence | Low |
| Serve the year | Work in their section; term start/end tracked | Cron, reminders | Term tracking | Low |
| Renew or offboard | Before term end, auto-ask to renew; accept extends, decline offboards and reopens the role | Cron, reminders | Renewal trigger + offboarding | Moderate. The admin-killer |

### The renewal loop (where the admin disappears)

1. Cron watches every role's end date.
2. At ~60 and ~30 days out, email the person with accept / decline buttons.
3. **Accept** extends the term, keeps login and role email. No admin.
4. **Decline or no response** offboards: revoke login and capabilities, remove or
   reassign the role email, thank-you, archive, and flip the role to **open** so
   the recruit page lists it again.

Offboarding is a security necessity, not a nicety: a departed coordinator must
lose access. Build the revoke step as carefully as the provision step.

## 4. Email: aliases not mailboxes, tied to the role not the person

- **Real mailboxes** mean a per-seat licence (~£5–12/user/month, so £60–140/month
  for twelve) plus an admin-API integration (Google Admin SDK / Microsoft Graph
  with per-tenant admin OAuth). Heavy and costly. Defer to an advanced, paid-for
  option.
- **Branded aliases/forwarders** (`program@festival.org` forwards to the person's
  own inbox) give the same professional look for near-zero cost, no licences.
  Free forwarders exist on most DNS hosts, including Cloudflare. This is v1.
- **Tie the address to the role, not the person.** Roles turn over yearly, so
  `emailcoordinator@festival.org` persists and access transfers to the next
  person. Person-based addresses break every renewal; role-based ones never do.
- **Never issue passwords.** Send a secure set-your-own-password link for logins;
  aliases have no password; full mailboxes use the provider's own flow.

## 5. Legal caution (flag to clients, not legal advice)

In the UK, giving a volunteer a signed contract, fixed hours, a login and a work
email can tip the relationship into worker/employment status, bringing
minimum-wage and employment-rights obligations. Use a **role agreement /
commitment letter** (mutual expectations + code of conduct, acknowledged, not an
enforceable contract with consideration). Keep the language non-contractual and
tell clients to take their own advice.

## 6. Build order

Behind de-Jet. Within the module:

1. The People record + tier field + the public team template (serves all four tiers,
   including Council/Board display).
2. Planning-team lifecycle: recruit, agreement-accept, role-scoped logins, renewal
   cron, offboarding, role-based aliases (the cheap 90%).
3. Deferred/optional: full mailbox provisioning (only when a client pays for it).

Festival Volunteers need no new work. Council and Board are the directory display
from step 1, nothing more.
