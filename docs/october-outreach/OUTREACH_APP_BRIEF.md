# October Outreach — Product Brief for Web App Integration

**Purpose of this document:** A new Claude Code session is integrating the October Outreach feature set into an existing standalone web app. This document describes the full product, every feature, all third-party integrations, the data model, and the journey so far — with enough detail to rebuild it faithfully outside WordPress.

**Client:** October Communications (octobercomms.com) — a PR and communications agency  
**Contact:** James / Daniel Nelson, dn@octobercomms.com  
**Brand colours:** Black `#000000` sidebar/nav, Yellow `#E7CD41` accent, buttons use large border-radius (pill shape)

---

## What This Product Is

October Outreach is an AI-powered email outreach platform for a PR/comms agency. It lets the team:

1. Define a campaign with a target audience in plain English
2. Use Claude AI to research and refine that audience into specific companies and job titles
3. Automatically find contact email addresses at those companies via Hunter.io and/or Icypeas
4. Have Claude AI write a personalised 3-email follow-up sequence
5. Launch the campaign and send emails via a transactional email provider (SES, Mailgun, SendGrid, SMTP)
6. Track sends, opens, and replies; automatically stop chasing contacts who reply

The primary use cases are:
- **Trade outreach** — reaching architects, interior designers, developers to pitch products or press coverage
- **Press outreach** — pitching journalists and editors at publications
- **Event outreach** — reaching firms to submit to tours, awards, exhibitions (e.g. ADF Architecture Tour)

---

## Core Concepts

### Campaign
A named outreach effort with a specific audience, from-address, and email sequence. A campaign has a status: `draft → active → complete`. It belongs to a brand (e.g. "October Comms" or "Render Magazine").

Campaign types:
- `outreach` — standard commercial outreach, optionally includes a coupon code
- `press_release` — pitching journalists, includes a press release URL

### Contact
A person with an email address. Contacts are stored globally (not per-campaign) and can be reused across campaigns. Key fields: first_name, last_name, email, company, type (architect / interior_designer / journalist / etc.), title, location, linkedin_url, source, status (active / unsubscribed / bounced / do_not_contact), notes.

### Sequence
A set of 3 email steps written by Claude. Each step has: step number, subject, body, delay_days. Delays are day 0, day 4, day 9 by default. Body uses `{{first_name}}`, `{{last_name}}`, `{{company}}` placeholders.

### Send
A single scheduled email from a campaign to a contact at a specific sequence step. Has a status: `pending → sent → replied / bounced`. When a contact replies, future sends to them should be suppressed.

### Campaign ↔ Contact relationship
Many-to-many via a junction table. A campaign has many contacts; a contact can be in many campaigns.

---

## The 5-Step Campaign Wizard

This is the main user journey. Every campaign is created through this wizard.

---

### Step 1 — Campaign Details

Fields collected:
- Campaign name (e.g. "ADF 2026 Tour Submissions")
- Brand (dropdown — "October Comms", "Render Magazine", etc.)
- Campaign type (`outreach` or `press_release`)
- From name (e.g. "James Nelson")
- From email address
- Reply-to email address
- If type = press_release: press release URL
- If type = outreach: optional coupon code

---

### Step 2 — Audience (AI-powered)

The user writes a plain-English description of who they want to reach (e.g. "small to mid-size architecture firms in Atlanta working on residential and commercial projects"). They can also add extra instructions.

**Claude AI call** (`refine_audience`):
- Input: campaign name, brand, type, audience description, extra instructions, list of domains already searched (to exclude)
- Output JSON:
  ```json
  {
    "refined_description": "2-3 sentence specific description",
    "domains": ["dezeen.com", "archdaily.com", ...],  // 20-30 company domains
    "job_titles": ["Principal Architect", "Design Director", ...],  // 5-8 titles
    "rationale": "Why this audience suits this campaign"
  }
  ```

The UI shows the refined description, rationale, and lets the user edit the domain list and job titles as removable tags. They can also manually add domains.

**Domain exclusion:** A checkbox ("Exclude domains I've already searched") passes the user's previously searched domains back to Claude so it suggests fresh companies each time. This is important — without it, Claude suggests the same domains repeatedly.

**Contacts per domain selector:** 10 / 25 / 50 (how many contacts to request per domain from the contact-finding APIs)

---

### Step 3 — Find Contacts

Two modes, toggled by buttons:

#### Mode A: Find new contacts

Searches for contacts at the domains Claude suggested. Uses Hunter.io and Icypeas in parallel — both run on every batch, results are merged and deduplicated by email.

**Batching:** Searches run in batches of 8 domains at a time (to avoid server timeouts). The user can keep clicking "Search Next 8 Domains" to accumulate more contacts. Previously searched domains are tracked and excluded from future runs.

**Hunter.io search** (`GET /domain-search`):
- Pass domain + limit
- Returns named contacts: first_name, last_name, email, company, title, confidence score
- Free plan: 50 searches/month. Works best for larger companies with public email data.

**Icypeas search** (`POST /find-people`):
- Pass `currentCompanyWebsite` (domain), `currentJobTitle` array (job titles from Claude), pagination size
- Returns people from their lead database
- Auth: `Authorization: Bearer {api_key}`
- **Fallback 1:** If a person has no email in the response, try `POST /email-discovery` with first_name + last_name + domain
- **Fallback 2:** If find-people returns 0 contacts for a domain, try `POST /domain-search` (role-based address scan) which finds generic inboxes: contact@, info@, hello@. These are useful for small firms where the principal often reads the general inbox.
- Credits roll over and never expire. From $19/month for 1,000 credits.

**Known data coverage limitation:** Small boutique firms with < 10 staff and minimal web presence are frequently not indexed by either service. For hyper-local/niche campaigns (e.g. small Atlanta architecture studios), manual research + CSV import is more effective than automated search.

Results are displayed in a table. The user can deselect contacts they don't want before saving.

#### Mode B: Existing contacts

Filters the global contacts database by type and/or location keyword, excludes contacts already linked to this campaign, and lets the user select and add them. Useful for campaigns where you already have a list and want to reuse it.

---

### Step 4 — Write Emails (AI-powered)

**Claude AI call** (`write_sequence`):
- Input: campaign details, audience description, 3 sample contacts (for context), extra instructions
- System prompt: expert B2B email copywriter, concise, warm, non-salesy, under 150 words per email
- Output JSON array:
  ```json
  [
    {"step": 1, "subject": "...", "body": "...", "delay_days": 0},
    {"step": 2, "subject": "...", "body": "...", "delay_days": 4},
    {"step": 3, "subject": "...", "body": "...", "delay_days": 9}
  ]
  ```

The UI shows all 3 emails with editable subject and body fields. The user can regenerate or manually edit before proceeding.

---

### Step 5 — Launch

Shows a summary (campaign name, from address, contact count, sequence preview). On launch:
1. Creates a `send` record for every contact × step 1 (scheduled for now)
2. A background job processes these sends immediately
3. Subsequent steps are scheduled at delay_days after each successful send

---

## Email Sending Engine

After launch, a background job processor runs the sequence:

1. Query all pending sends where `scheduled_at <= now`, campaign is active, contact is not unsubscribed/bounced/do_not_contact
2. For each send: check if the contact has replied to any previous send in this campaign — if yes, skip all future sends for them
3. Personalise subject and body: replace `{{first_name}}`, `{{last_name}}`, `{{company}}`
4. Send via the configured email provider
5. Record `sent_at` and the provider's message ID
6. Schedule the next sequence step: create a new pending send with `scheduled_at = now + delay_days`
7. When a campaign has no more pending or future sends, mark it complete

**Email providers supported:**
- **Amazon SES** — AWS Signature V4 signed POST to SES v2 API (`email.{region}.amazonaws.com/v2/email/outbound-emails`). Needs Access Key ID, Secret Access Key, region.
- **Mailgun** — POST to `api.mailgun.net/v3/{domain}/messages` with Basic auth (api:key)
- **SendGrid** — POST to `api.sendgrid.com/v3/mail/send` with Bearer token
- **SMTP** — standard SMTP credentials (host, port, username, password, TLS/SSL/none)

All providers support setting a Reply-To address so all replies go to a single monitored inbox regardless of the from address.

---

## Contact Management (beyond the wizard)

### Global contacts list
- Search by name/email/company
- Filter by contact type
- Pagination (currently LIMIT 200 — needs proper pagination for large lists)
- Edit individual contacts
- Bulk delete selected contacts
- Export all contacts as CSV

### CSV Import
Users can import contacts from a spreadsheet. Accepts flexible column names:
- Required: `email`
- Optional: `first_name`, `last_name`, `company`, `type`, `title`, `location`, `linkedin_url`, `notes`
- Skips rows with invalid or duplicate emails
- Shows imported/skipped count after upload
- A template CSV is available for download

**This is important for niche campaigns** where automated search doesn't have coverage — users can research contacts manually (e.g. from AIA member directory) and import them.

---

## Settings

All configuration lives in a settings page:

| Setting | Purpose |
|---------|---------|
| License key | Plugin/app license validation |
| Claude API key | Anthropic API — powers audience refinement, email writing, reply classification |
| Hunter.io API key | Contact finder (optional) |
| Icypeas API key | Contact finder (optional, credits roll over) |
| Airtable PAT + Base ID | Optional sync of contacts to Airtable for external viewing/editing |
| Email provider | SES / Mailgun / SendGrid / SMTP |
| Provider credentials | Per-provider keys/secrets |
| Default reply-to | All campaign replies directed here |
| Sending domain | Used for SPF/DMARC health checks |

---

## Dashboard

The dashboard shows:
- Recent campaigns (name, status, sent/total counts, quick delete)
- Quick action: New Campaign
- System status panel: green/grey badges for each API connection, email provider config, and SPF/DMARC DNS records
- SPF/DMARC check: `dns_get_record()` against the configured sending domain, shows orange warning if records missing

---

## Reply Classification (partially implemented)

`Claude::classify_reply(reply_text, campaign_name)` exists and classifies replies as: `interested`, `not_now`, `not_relevant`, `unsubscribe`, `auto_reply`, `question` — plus a one-sentence summary.

**Not yet wired up:** There is no inbound email webhook to trigger classification. The intended flow is: email provider (e.g. SES via SNS) sends a webhook when a reply arrives → parse reply → call classify_reply → update send status to 'replied' → suppress future sends to that contact. Currently, suppressing a contact requires manually setting their status to Unsubscribed or Do Not Contact.

---

## DNS / Email Authentication

Help page includes plain-English guides for SPF, DKIM, and DMARC setup, with provider-specific SPF include values and a starter DMARC record. Dashboard shows live health check for the sending domain.

---

## Data Model

```
contacts
  id, first_name, last_name, email, company, type, title,
  location, linkedin_url, source, status, notes, created_at

campaigns
  id, name, brand, type, from_name, from_email, reply_to,
  coupon_code, press_release_url, status, created_at

sequences
  id, campaign_id, step (1/2/3), subject, body, delay_days

sends
  id, campaign_id, contact_id, sequence_id, step,
  status (pending/sent/replied/bounced),
  scheduled_at, sent_at, message_id, created_at

campaign_contacts  (junction)
  campaign_id, contact_id  [PRIMARY KEY (campaign_id, contact_id)]

coupons
  id, campaign_id, code, description

press_releases
  id, title, url, status, created_at
```

---

## API Integrations Summary

### Anthropic / Claude AI
- Model: `claude-sonnet-4-6`
- Auth: `x-api-key: {key}`, `anthropic-version: 2023-06-01`
- Endpoint: `POST https://api.anthropic.com/v1/messages`
- Used for: audience refinement, email sequence writing, reply classification, press pitch writing
- Responses often come wrapped in markdown code fences — strip ` ```json ``` ` before parsing
- Max tokens: 1024 for audience/classification, 2048 for email sequences

### Hunter.io
- Auth: query param `api_key={key}`
- Domain search: `GET https://api.hunter.io/v2/domain-search?domain={domain}&limit={n}&api_key={key}`
- Returns: `data.emails[]` — each has `first_name`, `last_name`, `value` (email), `position`, `confidence`
- Free plan: 50 searches/month
- Error format: `errors[0].details`

### Icypeas
- Base URL: `https://app.icypeas.com/api`
- Auth: `Authorization: Bearer {api_key}`
- **Find people:** `POST /find-people` — body: `{ "query": { "currentCompanyWebsite": { "include": ["domain.com"] }, "currentJobTitle": { "include": ["Director"] } }, "pagination": { "size": 25 } }`
- **Email discovery:** `POST /email-discovery` — body: `{ "firstname": "John", "lastname": "Doe", "domainOrCompany": "company.com" }`
- **Domain scan:** `POST /domain-search` — body: `{ "domainOrCompany": "company.com" }` — returns role-based addresses (contact@, info@)
- Response field names vary — handle both camelCase and snake_case variants
- **⚠ Possible async behaviour:** Icypeas has a "Fetch results" section in their docs, suggesting some endpoints may queue searches and return a job ID. If `/find-people` is async, the current synchronous implementation won't work and a polling mechanism (`GET /results/{id}`) would be needed. This has not yet been fully confirmed in production — 0 results may be due to async, small firm data coverage, or both.
- Pricing: from $19/month, credits roll over indefinitely

### Airtable (optional)
- Auth: `Authorization: Bearer {personal_access_token}`
- Syncs contacts to a configured Airtable base
- Optional feature — not required for core functionality

---

## What Works Confirmed

- Campaign wizard end-to-end (all 5 steps)
- Claude audience refinement with domain exclusion
- Claude email sequence writing
- Hunter.io domain search and contact saving
- CSV import with flexible column mapping
- CSV export
- Bulk delete contacts
- Dashboard with live DNS status checks
- Email provider configuration (SES/Mailgun/SendGrid/SMTP)
- Airtable optional sync
- Campaign deletion
- Existing contacts tab in wizard
- Contact type/location filtering

## What Needs Verification / Is Incomplete

1. **Icypeas `/find-people` producing results** — may be async; needs testing with a large, well-known company domain to confirm whether results come back synchronously
2. **Icypeas domain-scan fallback** — implemented but not confirmed returning role-based addresses in production
3. **Email sending engine** — code is complete but has not been tested with a live campaign sending real emails
4. **Reply webhook** — classify_reply() exists but no inbound endpoint wired up; replies don't automatically suppress sequences
5. **AIA directory scraper** — user wants to scrape `aia.org/find-an-architect` for architecture firm contacts filtered by state/city; not yet built
6. **Contacts list pagination** — currently hard-limited to 200 rows

---

## Journey Notes (Why Things Were Built This Way)

- **Press releases merged into campaigns** — originally a separate entity, simplified into a campaign type with a URL field
- **Airtable made optional** — user asked why contacts weren't appearing in Airtable; we clarified contacts live in the app DB and Airtable is a view layer; moved sync to a button on the contacts page
- **Icypeas chosen over Hunter subscription** — Hunter is $49/month subscription; Icypeas credits roll over (never expire), from $19/month, genuinely PAYG-like. Both are now configured independently and run in parallel, with results merged.
- **Batched domain search** — originally sent all domains at once; caused server timeouts; now batches 8 at a time
- **Domain exclusion for Claude** — Claude was suggesting the same domains repeatedly on re-runs; fixed by passing already-searched domains back to Claude in the prompt
- **Small firm data gap** — architecture boutiques with < 10 staff are not indexed by Hunter or Icypeas; this is an inherent limitation of web-crawled email databases, not a bug. Solution for niche campaigns is CSV import.
- **CSV import** — added specifically because the AIA/architecture niche required manual research; accepted flexible column names to accommodate various spreadsheet formats
