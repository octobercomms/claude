# October Outreach — Plugin Status & Handover Notes

**Plugin version:** 2.7.0  
**Git branch:** `claude/email-outreach-app-2MPpx`  
**Repo:** `octobercomms/claude`  
**Plugin directory:** `october-outreach/`  
**Latest zip:** `october-outreach-v2.7.zip`  
**Live site:** `octobercomms.com` (WordPress)

---

## What This Plugin Does

October Outreach is a WordPress plugin that provides a full AI-powered email outreach platform:

1. **Campaign Wizard** (5-step): Create campaign → Claude refines audience → find contacts via Hunter.io/Icypeas → Claude writes email sequence → launch
2. **Contact management**: Find, import, filter, export, bulk-delete contacts
3. **Email sending engine**: Multi-provider (SES, Mailgun, SendGrid, SMTP) with Action Scheduler
4. **Reply tracking**: Classifies inbound replies via Claude (interested, not_now, unsubscribe, etc.)
5. **DNS health checks**: SPF/DMARC validation for the sending domain

---

## Architecture

### Plugin entry point
`october-outreach/october-outreach.php` — registers hooks, loads classes, contains the sequence processing handler `oo_process_sequences_handler($campaign_id)`.

### Includes (core classes)

| File | Purpose |
|------|---------|
| `class-oo-database.php` | Schema creation/migration via `dbDelta`. All table definitions live here. |
| `class-oo-license.php` | License key validation |
| `class-oo-claude.php` | Anthropic API wrapper — audience refinement, email sequence writing, reply classification, press pitch writing |
| `class-oo-hunter.php` | Hunter.io API — domain search, save contacts to DB |
| `class-oo-icypeas.php` | Icypeas API — find-people by domain, email-discovery fallback, domain-scan fallback for role-based addresses |
| `class-oo-airtable.php` | Airtable sync (optional) |
| `class-oo-mailer.php` | Email sending abstraction — routes to SES (AWS Sig V4), Mailgun, SendGrid, or SMTP |

### Admin classes

| File | Purpose |
|------|---------|
| `admin/class-oo-admin.php` | Menu registration, page rendering, form POST handlers (`admin-post.php`) |
| `admin/class-oo-ajax.php` | All `wp_ajax_*` AJAX handlers for the wizard |
| `admin/views/` | PHP view files for each page |
| `admin/js/wizard.js` | All wizard JS — multi-step navigation, AJAX calls, rendering |
| `admin/css/style.css` | All plugin CSS — brand colours (#000 sidebar, #E7CD41 accent, 50px border-radius buttons) |

### Database tables

| Table | Purpose |
|-------|---------|
| `oo_contacts` | All contacts — first_name, last_name, email, company, type, title, location, linkedin_url, source, status, notes |
| `oo_campaigns` | Campaigns — name, brand, type, from_name, from_email, reply_to, coupon_code, press_release_url, status |
| `oo_sequences` | Email steps — campaign_id, step (1/2/3), subject, body, delay_days |
| `oo_sends` | Individual send records — campaign_id, contact_id, sequence_id, step, status (pending/sent/replied/bounced), scheduled_at, sent_at, message_id |
| `oo_campaign_contacts` | Junction table — campaign_id ↔ contact_id (INSERT IGNORE) |
| `oo_coupons` | Coupon codes for campaigns |
| `oo_press_releases` | Press release records (title, url, status) |

### Settings (stored in `oo_settings` WP option)

| Key | Purpose |
|-----|---------|
| `license_key` | Plugin license |
| `claude_api_key` | Anthropic API key |
| `hunter_api_key` | Hunter.io API key (optional, 50 free searches/month) |
| `icypeas_api_key` | Icypeas API key (optional, credits roll over — from $19/month) |
| `icypeas_api_secret` | Not currently used — for webhook signatures only |
| `airtable_api_key` | Airtable PAT (optional) |
| `airtable_base_id` | Airtable base ID (optional) |
| `email_provider` | `ses` / `mailgun` / `sendgrid` / `smtp` |
| `ses_key`, `ses_secret`, `ses_region` | AWS SES credentials |
| `mailgun_api_key`, `mailgun_domain`, `mailgun_region` | Mailgun credentials |
| `sendgrid_api_key` | SendGrid key |
| `smtp_host`, `smtp_port`, `smtp_username`, `smtp_password`, `smtp_encryption` | SMTP credentials |
| `default_reply_to` | All reply-to addresses go here |
| `sending_domain` | Used for SPF/DMARC DNS health checks on dashboard |

---

## Campaign Wizard — Step by Step

**Step 1 — Campaign details**
- Campaign name, brand (October Comms / Render Magazine / etc.), campaign type (outreach / press_release), from name/email, reply-to
- If type = press_release: shows press release URL field
- If type ≠ press_release: shows coupon code field

**Step 2 — Audience (Claude)**
- User enters audience description + optional extra instructions
- Claude returns: refined description, 20–30 company domains, 5–8 job titles, rationale
- "Exclude already-searched domains" checkbox (default on) — passes existing DB contact domains + session-searched domains to Claude to avoid repeats
- User can edit/remove domains and job titles as tags
- Contacts per domain selector: 10 / 25 / 50

**Step 3 — Contacts**
Two modes toggled by buttons:

*Find new contacts* — searches Hunter.io and Icypeas in parallel:
- Batches 8 domains per run (to avoid timeouts)
- Hunter.io: domain search → named contacts with emails
- Icypeas: find-people by domain + job titles → if 0 named contacts, falls back to domain-scan for role-based addresses (contact@, info@)
- Results merged and deduplicated by email
- Shows provider diagnostic notes if 0 results
- Multi-run: "Search Next 8 Domains" button accumulates across batches
- Save selected contacts → bulk-inserts to `oo_campaign_contacts`

*Existing contacts* — filter contacts already in DB by type/location:
- Shows contacts not already linked to this campaign
- "Add Selected to Campaign" → INSERT IGNORE into `oo_campaign_contacts`

**Step 4 — Emails (Claude)**
- Claude writes 3-email sequence: day 0, day 4, day 9
- Shows editable subject/body for each step
- Uses `{{first_name}}`, `{{last_name}}`, `{{company}}` placeholders

**Step 5 — Launch**
- Shows summary: X contacts, email from address
- Launch button → creates `oo_sends` records (status=pending, scheduled_at=NOW()) for every contact × step 1
- Action Scheduler fires `oo_process_sequences` for the campaign
- Handler personalises and sends via OO_Mailer, schedules future steps, marks complete when done

---

## Contact Finder — Hunter.io vs Icypeas

Both are configured independently in Settings. If both keys are present, both run on every search batch and results are merged.

**Hunter.io:**
- `GET https://api.hunter.io/v2/domain-search`
- Returns named contacts with confidence scores
- Free plan: 50 searches/month
- Best for: larger firms, publications, companies with public email data

**Icypeas:**
- `POST https://app.icypeas.com/api/find-people` — people database search by domain + job title
- `POST https://app.icypeas.com/api/domain-search` — role-based address scan (fallback)
- `POST https://app.icypeas.com/api/email-discovery` — single email lookup (fallback for named people without email)
- Auth: `Authorization: Bearer {api_key}`
- From $19/month, credits roll over and never expire
- Best for: supplementing Hunter; works on domains Hunter misses

**Known limitation:** Both services rely on publicly indexed data. Small boutique firms (< 10 staff, local/regional) are frequently not in either database. For hyper-local campaigns (e.g. small Atlanta architecture studios), manual research + CSV import is the recommended approach.

---

## CSV Import

**Contacts page → "↑ Import CSV" button**
- Accepts flexible column names (`first_name` or `firstname` or `first`, etc.)
- Required column: `email`
- Accepted columns: `first_name`, `last_name`, `email`, `company`, `type`, `title`, `location`, `linkedin_url`, `notes`
- Skips rows with invalid/duplicate emails
- Shows imported/skipped count after redirect
- "Download template" link outputs a pre-formatted CSV with example row

Handler: `OO_Admin::import_contacts_csv()` → `admin_post_oo_import_contacts`

---

## Email Sending Engine

`oo_process_sequences_handler($campaign_id)` in `october-outreach.php`:
1. Queries `oo_sends` WHERE status=pending AND scheduled_at <= NOW() AND campaign active AND contact not unsubscribed/bounced/do_not_contact
2. Skips contacts with any 'replied' send for this campaign
3. Personalises `{{first_name}}`, `{{last_name}}`, `{{company}}`
4. Sends via `OO_Mailer::send()`
5. Records `sent_at` and `message_id` in `oo_sends`
6. Schedules next sequence step (adds delay_days)
7. Marks campaign 'complete' when no more pending/future sends

**OO_Mailer** supports:
- `send_ses()` — AWS Signature V4 signed POST to SES v2 API
- `send_mailgun()` — POST to api.mailgun.net with Basic auth
- `send_sendgrid()` — POST to api.sendgrid.com with Bearer token
- `send_smtp()` — hooks into WordPress PHPMailer via `phpmailer_init`

---

## Dashboard System Status

Shows green/grey badges for: Claude API, Hunter.io, Icypeas, Email Sending, Airtable, Email Scheduler.

SPF/DMARC checks: uses `dns_get_record()` against `settings['sending_domain']`. Shows green (found) or orange (missing) with link to Help page.

---

## Known Issues / Open Items

### 1. Icypeas data coverage for small firms
Small local boutique firms (< 10 staff) are typically not in the Icypeas people database. The domain-scan fallback should find role-based emails (contact@, info@) but this has not yet been confirmed working in production. Worth verifying the domain-scan API response format matches what `OO_Icypeas::domain_scan()` expects.

### 2. Icypeas may be async
The Icypeas API has a "Fetch results" section in their docs, suggesting some endpoints queue searches rather than returning immediately. If `/find-people` or `/domain-search` is async, the current synchronous implementation will always return 0. A polling mechanism would be needed — submit search → get job ID → poll `/results/{id}`. **This is the most likely remaining blocker for Icypeas producing results.**

### 3. Icypeas API auth not confirmed
Current implementation uses `Authorization: Bearer {api_key}`. The Icypeas account also shows an API Secret. If the correct auth is `Authorization: Basic base64(api_key:api_secret)` or uses both headers, the current code will fail with 401. No auth errors have been seen yet, suggesting Bearer is correct — but worth confirming.

### 4. Reply tracking not wired to webhook
`OO_Claude::classify_reply()` exists and works, but there is no inbound email webhook endpoint to trigger it. If using SES, you could configure SNS → WordPress endpoint → parse reply → update `oo_sends` status to 'replied'. This would stop the sequence for that contact automatically. Currently contacts must be manually set to Unsubscribed/Do Not Contact.

### 5. AIA directory scraper (proposed)
The user wants to source architecture firm contacts from the AIA (American Institute of Architects) member directory at `aia.org/find-an-architect`. A scraper tool could be added to the plugin that crawls this public directory filtered by state/city and returns firm names, websites, and principal names for import. Not yet built — needs investigation of the AIA site structure first.

### 6. Wizard Step 2 — domains sometimes repeat
Claude's audience refinement occasionally suggests previously-searched domains even with the exclusion list. The exclusion logic passes up to 100 domains to Claude's prompt. For very large exclusion lists this may need pagination or a different approach.

### 7. No pagination on contacts list
`admin/views/contacts.php` queries `LIMIT 200`. For large contact databases this will need pagination.

---

## File Structure

```
october-outreach/
├── october-outreach.php          # Main plugin file, v2.7.0
├── includes/
│   ├── class-oo-database.php     # Schema, dbDelta migrations
│   ├── class-oo-license.php      # License validation
│   ├── class-oo-claude.php       # Anthropic API
│   ├── class-oo-hunter.php       # Hunter.io API
│   ├── class-oo-icypeas.php      # Icypeas API (find-people + domain-scan)
│   ├── class-oo-airtable.php     # Airtable sync
│   └── class-oo-mailer.php       # Multi-provider email sending
├── admin/
│   ├── class-oo-admin.php        # Form handlers, menu registration
│   ├── class-oo-ajax.php         # AJAX handlers for wizard
│   ├── css/style.css             # All plugin CSS
│   ├── js/wizard.js              # Wizard JS
│   └── views/
│       ├── dashboard.php         # Dashboard with status checks
│       ├── campaigns.php         # Campaigns list
│       ├── wizard.php            # 5-step campaign wizard
│       ├── contacts.php          # Contacts list + import/export
│       ├── settings.php          # Settings form
│       ├── help.php              # Help & SPF/DMARC guide
│       ├── app-header.php        # Sidebar nav
│       ├── app-footer.php        # Footer
│       └── press.php             # Press releases (legacy, unused)
└── vendor/
    └── action-scheduler/         # Bundled Action Scheduler 3.8.2
```

---

## Brands Available

Configured in `OO_Database::get_brands()`:
- October Comms
- Render Magazine
- (add more in class-oo-database.php)

## Contact Types

Configured in `OO_Database::get_contact_types()`:
- architect, interior_designer, landscape_architect, developer, journalist, editor, pr_contact, supplier, other

---

## Development Notes

- **Version bumping:** Increment in two places in `october-outreach.php` — the plugin header comment and the `OO_VERSION` constant. Also rebuild the zip and name it `october-outreach-vX.X.zip`.
- **Rebuilding zip:** `cd /home/user/claude && rm -f october-outreach-vX.X.zip && zip -r october-outreach-vX.X.zip october-outreach/ --exclude "*.git*"`
- **Branch:** Always work on `claude/email-outreach-app-2MPpx`
- **CSS brand tokens:** `--oo-accent: #E7CD41`, sidebar background `#000000`, buttons use `border-radius: 50px`
- **Action Scheduler** is bundled in `vendor/action-scheduler/` and must not be removed
- **No jQuery UI** — all wizard JS uses vanilla JS + jQuery (already in WP admin)
