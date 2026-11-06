# October Accounting Support — Build Brief (v2)

Status: approved for Phase 1 build. Integrated into OMI, not standalone.

Owner: Daniel Nelson. Accountant: Beany. Entity: UK limited company, VAT
registered (returns filed by Beany through Xero). Currencies: GBP, USD, EUR,
CAD.

---

## 1. What it is, and what it is not

A decision-support and extraction layer on top of Xero, built as the
**Accounts** section inside OMI. It reconciles more accurately than manual
sorting does, learns the correct allocation once and remembers it, attaches
invoices from Google Drive into Xero automatically, and produces the two
documents the accountant needs: a VAT-ready pack each quarter and a year-end
handover pack.

It is **not**:

- MTD filing software. Xero already files the VAT return, and Beany runs it.
  Becoming an HMRC-recognised filer is a compliance burden with no payoff.
- Accounts-production software. Statutory accounts and the CT600 are Beany's
  regulated output. We prepare the handover, we do not file.
- A full automation. There is always a human sign-off gate, because the
  director signs the numbers.

The line: everything up to the point of filing. Nothing across it.

---

## 2. Decision: integrate into OMI

The earlier brief proposed a standalone app in `dev/october-accounting-support/`.
That is replaced. The accounts module lives inside OMI (`dev/platform/`) as a
new top-level section, for these reasons:

- OMI already has the Claude integration, the connections architecture, the
  encrypted credentials store, the scheduler, and Google Drive connected.
- Single-user tool. No multi-tenant isolation needed.
- If OMI ever launches for other users, the accounts section can be separated
  at that point. No point building for a split that may never happen.
- One deployment to manage, one database to back up.

The skeleton in `dev/october-accounting-support/` is superseded. Its patterns
(crypto, OAuth flow, worker loop) were useful reference; the code itself is not
carried forward.

---

## 3. The five jobs

1. **Accurate reconciliation.** For each unreconciled Xero bank line, propose
   the correct account code and VAT treatment, flag anything ambiguous or
   tax-sensitive for confirmation, and write the approved coded transaction
   back to Xero.
2. **Learn once, remember.** Every confirmation becomes a deterministic rule.
   Next time that payee appears, the rule fires with no AI call.
3. **Invoice attachment.** Scan Google Drive invoice folders, match files to
   Xero transactions by amount/date/payee/invoice number, and attach them via
   the Xero Attachments API. Flag missing invoices: amber after 7 days, red
   after 14.
4. **VAT-ready pack.** Each quarter, review the period, flag questionable VAT
   treatments, and output a clean summary for review before Xero files.
5. **Year-end handover pack.** By 1 January the books are fully reconciled and
   the pack extracts everything Beany needs, in their format, so it goes across
   immediately with fewer questions and errors.

---

## 4. Architecture

### Xero is the hub

Wise, Stripe, GoCardless and PayPal already feed bank-statement lines into
Xero. Reconciliation runs against Xero's data. So Xero + Google Drive are the
only integrations needed to start.

| Source | Integration | Phase |
|--------|-------------|-------|
| Xero | OAuth2 app (granular scopes, rotating refresh token) | 1 |
| Google Drive | Already connected in OMI. Scan invoice folders, match to transactions | 1 |
| Stripe | Read-only restricted key. Splits a bundled net payout back to invoices and books the fee | 2 |
| GoCardless | Only if the Xero feed loses the payout split | Later |
| Wise | Not needed; feeds Xero already. Four currencies: GBP, USD, EUR, CAD | N/A |
| PayPal | Expense-side, messy, lowest priority | Last |
| Beany | If they have an API/MCP, wire it in. If not (likely), stop at output packs | TBC |

### Stack

Inside `dev/platform/`: new routes in `backend/src/routes/accounts.js`, new
services in `backend/src/services/accounts/`, new migration(s), new frontend
page `frontend/src/pages/AccountsPage.jsx`. Follows the same patterns as
every other OMI section.

### Xero API specifics (researched November 2026)

**Scopes went granular in March 2026.** Apps created after 2 March 2026 cannot
use the broad legacy scopes. The app needs:

| Scope | Purpose |
|-------|---------|
| `offline_access` | Refresh tokens (required) |
| `accounting.banktransactions` | Read/write bank transactions for reconciliation |
| `accounting.attachments` | Upload invoice files from Google Drive |
| `accounting.contacts.read` | Read payee/contact details for rule matching |
| `accounting.settings.read` | Read chart of accounts, tax rates, org settings |
| `accounting.reports.trialbalance.read` | Trial balance for year-end pack |
| `accounting.reports.taxreports.read` | VAT report data for quarterly pack |
| `accounting.reports.profitandloss.read` | P&L for reporting |
| `accounting.reports.balancesheet.read` | Balance sheet for year-end pack |

**Token rotation:** Access token expires after 30 minutes. Refresh token
rotates on every use; the new one must be stored each time, or the next
refresh fails permanently. `offline_access` scope is required.

**Rate limits:** 60 calls per minute, 5,000 per day per tenant, 5 concurrent.
The poller must respect these. A single-user tool polling every 15 minutes is
well within limits.

**Attachments API:** `PUT /api.xro/2.0/BankTransactions/{id}/Attachments/{filename}`.
Up to 10MB per file. Supports PDF, JPG, PNG. The file body goes in the
request body with `Content-Type` matching the file type.

**BankTransactions endpoint:** `IsReconciled` is a field on each transaction but
is not listed as an optimised filter. Filtering by `Status` and `Date` is
optimised. Strategy: pull recent transactions, filter `IsReconciled === false`
in code.

**Reports endpoints:**
- `GET /api.xro/2.0/Reports/ProfitAndLoss?fromDate=...&toDate=...`
- `GET /api.xro/2.0/Reports/BalanceSheet?date=...`
- `GET /api.xro/2.0/Reports/TrialBalance?date=...`

---

## 5. The learning model: rules store, not model memory

The single most important design decision. "Learn once, remember" is built as
a rules table, not as LLM memory.

- **Head (the 80%):** a Postgres `acct_rules` table. Payee pattern to account
  code, VAT rate, confidence, times-confirmed, last-seen. A rule hit needs no
  AI and is fully auditable.
- **Long tail (the 20%):** for a genuinely new or ambiguous line, the Anthropic
  SDK proposes a mapping and explains its reasoning. On confirmation it becomes
  a rule row. From then on it is deterministic.

The system gets **more** deterministic over time, not less. Money and tax
cannot sit behind a black box that usually gets it right.

### Confidence gating (a feature, not polish)

- High confidence + rule hit: auto-suggest, one-click approve.
- Low confidence, new payee, or any tax-sensitive line (VAT reverse charge, no
  receipt, personal-use split, FX settlement): forced to review, never
  auto-confirmed.

This gate is what stops a wrong VAT treatment being rubber-stamped onto a return
the director signs. It does not get removed later.

### UK rules to encode

Lifted from the `openaccountants/uk-bookkeeping.md` reference, filtered to a Ltd
on accruals (ignore its sole-trader / SA103 / cash-basis content):

- 4-digit chart-of-accounts structure.
- VAT box to control-code mapping: Box 1 output to 2202, Box 4 input to 2201,
  Box 5 net to 2200 control.
- Non-deductible filter: entertaining, fines, personal, capital items.
- Bank-pattern recognition: DD, STO, HMRC (VAT/PAYE/CT, exclude from P&L),
  Stripe/PayPal (match invoices), FPO/FPI and cheques to manual review.
- Capital vs book depreciation flagged for the year-end pack.

Current-year UK rates and thresholds are pinned as our own reference data so the
model does not drift, refreshed each tax year.

---

## 6. Multi-currency (GBP, USD, EUR, CAD)

- Requires Xero's multi-currency plan (Established tier) enabled.
- The VAT return is always GBP; foreign sales convert at the correct date's
  rate.
- Wise holds four currencies (GBP, USD, EUR, CAD). Each feeds Xero as its own
  bank account.
- Realised FX gain or loss on settlement is booked to its own code. These are
  flagged for confirmation and must reconcile in the year-end pack, or the books
  do not tie out.

This is the part that carries the highest correctness risk.

---

## 7. Google Drive invoice matching

OMI already has Google Drive connected. The invoice workflow:

1. **Scan** designated invoice folder(s) in Google Drive on each weekly run.
2. **Index** new files: extract filename, date modified, and (where possible)
   invoice number and amount from the filename or PDF text.
3. **Match** each file to an unattached Xero transaction by: payee name in
   filename, amount, date proximity, invoice number.
4. **Attach** matched files to Xero transactions via the Attachments API.
5. **Flag** unmatched transactions as missing invoices. Amber after 7 days, red
   after 14. These appear in the review queue and the weekly digest.
6. **Historical backfill** on first connection: walk the existing Drive folder
   and attach everything matchable to already-reconciled transactions.

The user's workflow stays simple: download an invoice, drop it in the Google
Drive folder. The system does the rest.

---

## 8. Tax deadline awareness

The weekly digest and the accounts dashboard surface upcoming deadlines:

| Deadline | Frequency | What |
|----------|-----------|------|
| VAT return | Quarterly (dates from Xero VAT returns) | Flag when books are not reconciled to the period end |
| Corporation tax (CT600) | Annual (9 months + 1 day after year-end) | Alert 60 days before |
| PAYE | Monthly (19th or 22nd) | Reminder if payroll is run |
| Year-end | Annual (company year-end) | The handover pack trigger |
| Accounts filing | Annual (9 months after year-end) | Alert 90 days before |

These are configuration, not integration. The dates are set once and the system
counts down.

---

## 9. The 90-day training, honest version

Question-driven onboarding bootstraps the rules store. The volume of questions
falls, the sign-off gate stays.

| Period | Behaviour |
|--------|-----------|
| Week 1 | Asks about most lines; rules store is near empty |
| Weeks 2 to 8 | Asks only about payees it has not seen; head fills in |
| Day 90 | Asks only about new payees and tax-sensitive or low-confidence lines |

Outcome: from confirming everything to glancing at exceptions. Not zero-human,
because the director signs the filed numbers.

---

## 10. Outputs and delivery

### Interactive

- **Review queue** (the Accounts section in OMI): unreconciled transactions with
  suggested codes, confidence indicators, approve/edit/reject actions, missing
  invoice flags. The primary working surface.
- **Dashboard** at the top of the Accounts section: reconciliation status,
  missing invoices count, next deadline, P&L snapshot.

### Automated

- **Weekly digest** (email, or in-app notification): reconciliation summary,
  items needing attention, missing invoices, upcoming deadlines. Runs on the
  OMI scheduler (same pattern as the Monday strategist email).
- **VAT-ready pack** (quarterly): PDF or spreadsheet summary plus exception
  list, emailed with a download link.
- **Year-end handover pack** (1 January): categorised P&L / trial balance,
  queried-items list, fixed-asset additions, FX realised gains/losses, receipts
  checklist, director's loan and dividend notes. Built to Beany's preferred
  format. Emailed with a download link.

---

## 11. Design

October / OMI brand throughout (see `OCT_brand-style-guide.md` and
`.claude/skills/october-design-system`). Warm off-white page `#FAF9F5`, white
cards, near-black text `#1A1A1A`, single yellow accent `#E7CD41` for the one
thing that matters per view. Green / red / amber only for positive / negative /
warning, which suits a reconciliation and P&L tool well. Brockmann, 2px borders,
chunky radii, bento cards, soft depth.

The Accounts section follows the same section-panel navigation as the rest of
OMI: a left rail with rows, content on the right.

---

## 12. Data model (OMI tables, prefixed `acct_`)

All tables prefixed `acct_` to avoid collisions with existing OMI schema.

```sql
-- Xero connection (one row; encrypted tokens)
acct_xero_connection
  id, tenant_id, access_token_enc, refresh_token_enc, token_expires_at,
  scopes, connected_at, last_refreshed_at

-- Reconciliation rules (the learning store)
acct_rules
  id, payee_pattern, match_type (exact|contains|regex),
  account_code, account_name, tax_rate_id, tax_rate_name,
  confidence, times_confirmed, last_seen, currency,
  created_at, updated_at

-- Reconciliation queue (unreconciled lines from Xero)
acct_reconcile_queue
  id, xero_transaction_id, bank_account_id, date, amount, currency,
  payee_name, reference, description,
  suggested_code, suggested_tax, suggested_confidence,
  matched_rule_id (FK acct_rules), ai_reasoning,
  status (pending|approved|rejected|written_back),
  invoice_file_id, invoice_status (matched|missing_amber|missing_red|not_required),
  reviewed_at, created_at, updated_at

-- Confirmations log (audit trail)
acct_confirmations
  id, queue_item_id (FK acct_reconcile_queue),
  proposed_code, proposed_tax, confirmed_code, confirmed_tax,
  confirmed_by, reasoning, created_at

-- Invoice files (indexed from Google Drive)
acct_invoice_files
  id, drive_file_id, filename, mime_type, size_bytes,
  extracted_amount, extracted_date, extracted_invoice_number,
  extracted_payee, xero_transaction_id, attached_to_xero (boolean),
  attached_at, created_at

-- VAT exceptions
acct_vat_exceptions
  id, period_start, period_end, xero_transaction_id,
  flag_reason, resolution, resolved_at, created_at

-- FX events
acct_fx_events
  id, xero_transaction_id, invoice_currency, settlement_currency,
  raise_rate, settle_rate, realised_gain_loss, account_code,
  created_at

-- Tax deadlines
acct_tax_deadlines
  id, deadline_type (vat|ct600|paye|year_end|accounts_filing),
  due_date, description, alert_days_before, notified_at, created_at

-- Weekly digest log
acct_digest_log
  id, period_start, period_end, summary_json, sent_at, created_at
```

---

## 13. Phased plan

| Phase | Scope | Effort |
|-------|-------|--------|
| **1a** | Xero OAuth in OMI connections. Pull unreconciled lines. Rules + AI classify. Read-only review queue. Writes nothing to Xero. Proves match quality on real books at zero risk. | ~1 week |
| **1b** | Google Drive invoice scanning. Match files to transactions. Missing invoice tracker with amber/red flags. | ~3 days |
| **2** | Confirmations become rules. Approved lines create coded transactions in Xero. Attach matched invoices to Xero. The reconcile click stays with the human. | ~1 week |
| **3** | Weekly automated reconciliation via scheduler. Weekly digest email. Tax deadline tracker. | ~3 days |
| **4** | Stripe payout splitting (when the netting problem bites). | ~3 days |
| **5** | VAT-ready pack: quarter view, exception flags, email + download. | ~3 days |
| **6** | Year-end handover pack in Beany's format. | ~3 days |

---

## 14. What is needed to start Phase 1

1. Register a Xero app at developer.xero.com (client ID and secret). Web app
   type. Redirect URI must match the OMI callback URL.
2. Confirm the Xero org is on the multi-currency (Established) plan.
3. Identify the Google Drive folder(s) where invoices are stored.
4. Decision already made: read-only first (Phase 1a writes nothing to Xero).
5. Decision already made: web review queue in OMI (not email-based).

---

## 15. Security notes

- Xero tokens encrypted at rest using OMI's existing `ENCRYPTION_KEY`
  (AES-256-GCM), same as all other connector credentials.
- Refresh token rotates on every use. Always store the newest one before
  using the new access token.
- The Xero client ID and secret go into `platform_settings` (encrypted),
  not into `.env` or committed files.
- Google Drive access uses OMI's existing OAuth connection.
- Review against the `october-security` skill before exposing any new
  endpoints publicly.
- `WRITE_BACK_ENABLED` flag controls whether approved lines are written to
  Xero. Default `false` for Phase 1.
