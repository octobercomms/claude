# Trinity Court Margate — Residents' Community Site: Scope

> **Status: SCOPING ONLY — development on hold.** This document captures the
> plan, decisions still to make, and a recommended build. Nothing has been
> built yet. Pick this up on a future day and turn the "Phasing" section into
> the build plan.

- **Live site:** https://trinitycourtmargate.co.uk/
- **Platform:** WordPress, Jupiter X theme, Elementor page builder (existing).
- **Building:** Trinity Court, Margate — 38 flats.
- **Audience size:** small — roughly 50 email addresses (some flats have 2+ residents).
- **Owner:** the leaseholders/residents (managed day-to-day via a management
  company / managing agent — see the important boundary below).

---

## 1. Purpose

Use the site to **build community** and give residents **one easy place to find
updates** about the building, discuss topics, and see what's being worked on.

The three jobs the site does:

1. **Inform** — post updates and a live "key projects" list (door repair, new
   lighting, CCTV, etc.) so people can see what's happening and its status.
2. **Discuss** — let residents raise topics and post requests/suggestions for
   discussion among neighbours.
3. **Keep in touch** — a regular (monthly) bulletin email summarising updates,
   sent to the resident list.

## 2. The important boundary (must be explicit on the site)

This site is **NOT** the official channel. Anything that must formally reach
the freeholder/managing agent (repairs, complaints, service-charge queries,
formal requests) still goes **directly to the managing agent** by their
official route.

Requests and discussion posted here are **community/informal only** — for
neighbours to talk things through and stay informed. This needs a clear,
repeated disclaimer (site footer, the requests/forum intro, and the welcome
email) so no one assumes "I posted it on the site" counts as reporting it
officially. This protects residents (their real issue actually gets logged) and
protects whoever runs the site (no implied duty to act on posts).

## 3. Goals & non-goals

**Goals**
- A single, low-effort hub residents actually check.
- Private to residents (a known, closed group of 38 flats).
- Cheap to run and simple to maintain by a non-technical volunteer.
- Works within the existing Jupiter X + Elementor stack.

**Non-goals (at least for v1)**
- Not a replacement for the managing agent or any official reporting.
- Not handling money (no service-charge payments, no accounts).
- Not a public/marketing website — this is an internal community tool.
- No mobile app — responsive web only.

## 4. Access & membership model (a key early decision)

Because the audience is a **known, closed group**, the recommendation is:

- **Private, login-gated site.** A minimal public landing/login page; everything
  of substance (updates, projects, documents, forum, requests) is visible only
  to logged-in residents.
- **Invite / approval-based registration**, not open self-signup. Options:
  - Admin creates accounts and sends each resident a set-password link, **or**
  - Residents self-register but each account needs **admin approval** before
    access (stops randoms and spam bots).
- **Roles:**
  - *Admin* — you / site maintainer.
  - *Committee / Editor* — can post updates, manage projects, moderate forum.
  - *Resident (member)* — can read everything, post in forum/requests, comment.
- One decision to confirm: **strictly residents-only, or also a public
  "about the building" front page?** Recommendation: keep it private for v1 to
  minimise GDPR exposure and keep discussion candid.

## 5. Feature scope

Each feature below lists what it is, a recommended approach on WordPress, and
rough effort. Plugin picks favour **free, well-maintained, lightweight** tools
suited to a 50-person audience.

### 5.1 Updates / News (core)
- **What:** short posts ("New bin store code", "Lift maintenance Tuesday").
- **How:** native WordPress posts, with a simple "News/Updates" category shown
  on the members' home page via an Elementor Posts widget or Jupiter X blog block.
- **Effort:** low. This is basically built-in.

### 5.2 Key Projects list (core, high value)
- **What:** a living list — Door repair, New lighting, CCTV, etc. — each with a
  **status** (Planned / In progress / On hold / Done), a short description, and
  last-updated date. This is the "keep people updated" feature.
- **How (recommended):** a custom post type **"Projects"** + a **status
  taxonomy**, displayed as a filterable list (Elementor loop / Jupiter X
  dynamic listing, or a lightweight table). Simple, structured, sortable.
- **Lighter alternative:** a single Elementor page with a status table, updated
  by hand. Cheaper to start; harder to keep tidy as it grows.
- **Effort:** low–medium (CPT + display) or low (manual page).

### 5.3 Events
- **What:** residents' AGM, works notices, social events, bin/collection dates.
- **How:** **The Events Calendar** (free) — mature, reliable, calendar + list
  views, integrates with Elementor. Jupiter X may bundle an events element; use
  whichever is simpler once building.
- **Effort:** low.

### 5.4 Document repository
- **What:** a place for shared docs — meeting minutes, notices, insurance
  summary, useful contacts, guidance. (Keep anything sensitive out; see §7.)
- **How:** an **access-controlled downloads plugin** — e.g. *Download Monitor*
  or *WP Document Revisions* — so files are visible to logged-in residents only
  and organised into categories. Avoid dumping files in the open media library
  (those URLs are public even if the page isn't).
- **Effort:** low–medium.

### 5.5 Monthly bulletin email (newsletter)
- **What:** a once-a-month digest of updates/projects/events, sent to ~50
  addresses. Wants to be automatable.
- **How (recommended):** **MailPoet** (free up to 1,000 subscribers) — manages
  the subscriber list with GDPR consent, has templates, scheduling, and can
  **auto-generate a "latest posts" digest** on a monthly schedule. Sends via
  SMTP.
- **Sending / SMTP:** route mail through a proper SMTP/transactional provider
  for deliverability (a plain WordPress/host `mail()` to 50 people will land in
  spam). **Brevo** is a good fit — free tier easily covers this volume, gives
  SMTP credentials, and October already uses Brevo elsewhere. Pair with the
  **WP Mail SMTP** plugin so *all* site email (including password resets) routes
  correctly.
- **Automation:** monthly schedule via MailPoet's automatic newsletter, or a
  manual "review and send" each month if you'd rather eyeball it first.
  Recommendation: **draft automatically, send manually** for the first few
  months, then switch to fully automated once the format settles.
- **Effort:** medium (list import + consent + first template + SMTP setup).

### 5.6 Forum / discussion (the "maybe")
- **What:** threaded discussion so residents can raise and talk through topics.
- **How:** **Asgaros Forum** (free, single plugin, lightweight) is ideal for a
  small private community — much simpler to run than BuddyPress/bbPress. Gate it
  to logged-in residents; enable moderation.
- **Requests board:** the "post requests for things" need can be **a dedicated
  forum category** ("Requests & Suggestions") rather than a separate system —
  simpler, and keeps the not-official disclaimer in one place.
- **Watch-outs:** a forum needs a **moderator** and a short **code of conduct**,
  or it goes stale/messy. For 38 flats this is light, but someone must own it.
  If no one will moderate, **defer the forum** and start with a simpler
  comments-on-updates model.
- **Effort:** medium (setup low; ongoing moderation is the real cost).

## 6. Recommended plugin stack (summary)

| Need | Recommended | Notes |
|------|-------------|-------|
| Access control / roles | *Members* (roles) + a content-restriction plugin, or Jupiter X's built-in gating | Keep it simple; residents-only |
| Registration approval | approval-on-register plugin, or admin-created accounts | Stops spam signups |
| Updates/News | Native WP posts | Built-in |
| Key projects | Custom post type + status taxonomy | Or manual Elementor table to start |
| Events | The Events Calendar (free) | Mature, Elementor-friendly |
| Documents | Download Monitor / WP Document Revisions | Logged-in only; not public media URLs |
| Newsletter | MailPoet (free) | List + consent + monthly digest |
| Email delivery | WP Mail SMTP + Brevo SMTP | Deliverability; routes all site mail |
| Forum (optional) | Asgaros Forum | Lightweight; needs a moderator |
| Spam/security | reCAPTCHA + limit-login + keep everything updated | Small but real target |

*(Confirm each against what Jupiter X already bundles before installing — the
theme may cover events/gating natively and save a plugin.)*

## 7. Privacy, GDPR & legal

Handling ~50 residents' personal data (names, emails, and their posts) brings
real, if light, obligations:

- **Lawful basis & consent** for the newsletter — explicit opt-in, with a
  visible unsubscribe in every send. MailPoet handles the mechanics.
- **Privacy notice** — a short page: what data is held, why, who can see it,
  how to be removed. Link it in the footer and the signup flow.
- **Keep sensitive material off the site** — no other residents' personal
  details, no service-charge/financial data, no anything that shouldn't sit in a
  WordPress DB. Documents repo is for general notices, not confidential files.
- **Moderation & liability** — the not-official disclaimer (§2) plus a code of
  conduct for the forum. Have a way to remove defamatory/abusive posts quickly.
- **Data location** — resident list lives in MailPoet/Brevo; understand where
  and keep it minimal.

## 8. Draft information architecture

```
Home (login) ─┬─ Welcome / what this is (+ not-official disclaimer)
              ├─ Updates (news posts)
              ├─ Key Projects (status list)          ← high value
              ├─ Events (calendar)
              ├─ Documents (residents-only downloads)
              ├─ Discussion / Forum ─┬─ General
              │                      └─ Requests & Suggestions
              ├─ Newsletter (subscribe / archive)
              └─ Contacts (managing agent official route made prominent)
```

## 9. Phasing (turn this into the build plan later)

**Phase 1 — MVP (get value fast, low risk)**
- Private login gating + resident accounts (invite/approval).
- Updates (posts) + Key Projects list.
- Documents repository (logged-in only).
- Not-official disclaimer + privacy notice + managing-agent contact page.
- Monthly bulletin set up (list imported with consent, SMTP via Brevo,
  draft-automatically/send-manually).

**Phase 2 — Community**
- Events calendar.
- Forum (only if a moderator is confirmed), starting with the Requests &
  Suggestions category.

**Phase 3 — Automate & polish**
- Fully automated monthly digest once the format is settled.
- Tidy design pass in Jupiter X/Elementor; onboarding email for new residents.

## 10. Open questions / decisions needed before build

1. **Public or fully private?** Recommendation: fully private for v1.
2. **Account creation:** admin-created accounts, or self-register + approval?
3. **Forum:** in or out for v1 — **is there a volunteer to moderate it?**
4. **SMTP/email provider:** confirm Brevo (vs the building's own Google
   Workspace / host SMTP).
5. **Who maintains it?** Which resident(s) will post updates, manage projects,
   moderate, and press "send" on the bulletin? The tool is only as good as the
   person keeping it fed.
6. **Consent for the current email list** — do we have opt-in to email these ~50
   addresses, or do we need a first "confirm you want in" send?
7. **Jupiter X built-ins** — check what the theme already covers (gating,
   events) so we install fewer plugins.

## 11. Rough effort (indicative, once we start)

- Phase 1: ~1–2 focused days of build + content setup (excludes writing the
  actual notices/documents).
- Phase 2: ~0.5–1 day for events + forum config.
- Ongoing: a few hours/month for someone to post updates and send the bulletin.

Hosting/plugin cost target: **£0–low** — all recommended tools have free tiers
adequate for 38 flats.

---

*Prepared as a scope. No development performed. Next step: answer §10, then
convert §9 Phase 1 into a build checklist.*
