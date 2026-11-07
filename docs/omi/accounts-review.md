# Accounts Module: Full Review

**Date:** 7 November 2026
**Scope:** UX/UI, technical architecture, feature completeness, improvements

---

## Executive Summary

| Area | Rating |
|------|--------|
| Goal execution | **Strong** |
| Architecture | **Solid** |
| UX / UI | **Functional** |
| Feature completeness | **~85%** |

The Accounts module achieves its goal: automated bank reconciliation with a learn-once rules engine, AI fallback, VAT compliance checking, and a weekly digest cycle. The two-tier classification (deterministic rules first, Claude for unknowns) is the right call for a single-company bookkeeping tool where the same suppliers recur. The Xero integration, Google Drive invoice matching, and tax deadline tracking round it out into a genuine bookkeeping co-pilot.

The main gaps are UX polish (the reconcile queue could be faster to work through) and a few features that would meaningfully reduce the manual overhead of VAT return prep and accountant handover.

---

## 1. Goal Assessment

The stated goal: automate bookkeeping for October Communications. Connect to Xero, classify bank transactions, learn from corrections, flag VAT issues, match invoices, and surface deadlines.

| Requirement | Status | Notes |
|-------------|--------|-------|
| Xero OAuth2 connection | **Done** | Encrypted tokens, auto-refresh, CSRF state. Clean implementation. |
| Pull unreconciled bank lines | **Done** | Paginated fetch, weekly scheduler with budget gating. |
| Deterministic rules engine | **Done** | Three-tier priority (exact > starts_with > contains), 29 seed rules, auto-promote from confirmed AI classifications. |
| AI fallback classification | **Done** | Claude Sonnet 4.6, UK bookkeeping system prompt, chart of accounts context, cost-logged. |
| Human review queue | **Done** | Batch approve/skip, search, status filter, Xero dropdowns for corrections. |
| VAT compliance checks | **Done** | Reverse charge, FX/domestic rate mismatches, known overseas suppliers, high-value checks. Runs on every confirm. |
| Google Drive invoice matching | **Done** | Amount + payee + date heuristic, attachment to Xero transactions. |
| Tax deadline tracking | **Done** | VAT, CT600, PAYE, PENSION. Auto-seed, daily weekday alerts. |
| Weekly digest email | **Done** | Aggregates queue, invoices, deadlines, recent confirmations. |
| Write-back to Xero | **Gated** | Implemented but off by default (WRITE_BACK_ENABLED). Correct choice for now. |
| FX gain/loss tracking | **Basic** | Records events, calculates realised GBP, but no raise/settle rate source yet. |
| Audit trail | **Done** | Every confirmation logged with proposed vs confirmed, source, reasoning. CSV export. |

**Bottom line:** Every core requirement is met. The system does what the brief asked for, and the architecture (rules first, AI second, human confirms, rule is born) is the correct pattern for this use case.

---

## 2. Technical Assessment

### What works well

- **Rules engine priority system** (rules.js:14-58). The exact > starts_with > contains cascade is simple and correct. SQL LIKE escaping prevents injection. The promote-to-rule flow on confirmation means the system genuinely learns.
- **Xero token lifecycle** (xero.js:38-93). Encrypted at rest, refresh-before-expiry buffer, single-retry on 429. The rotating refresh token gotcha is handled.
- **Budget gating**. The scheduler checks the task budget before running the AI classifier, preventing runaway costs if the queue gets large.
- **VAT exception detection** (reconcile.js:178-213). The five rules catch the most common UK bookkeeping errors: domestic VAT on foreign suppliers, reverse charge on GBP, high-value without codes, known overseas SaaS with wrong treatment, and large NONE transactions.
- **Idempotent seeding**. Rules and deadlines both use ON CONFLICT patterns so re-running seed is safe.
- **Separation of concerns**. Nine service files, each with a clear job. The index barrel export keeps the routes file clean.

### Technical issues

**N+1 query in pullAndClassify [HIGH]** (reconcile.js:44-47)
Every bank line gets an individual `SELECT id FROM acct_reconcile_queue WHERE line_ref = $1` to check if it already exists. With hundreds of lines per sync, this is hundreds of round trips. Should be a single batch query (`WHERE line_ref = ANY($1)`) per page of lines.

**Sequential AI classification [MEDIUM]** (classify.js:60-80)
Lines are classified one at a time in a loop. Batching 5-10 lines per Claude call (structured output with an array response) would cut API calls by 80%+ while keeping per-line reasoning. The system prompt already understands multiple transactions.

**In-memory OAuth state [MEDIUM]** (accounts.js routes:29)
`router._xeroStates = new Map()` stores CSRF state in memory. A pm2 restart or multi-process deploy loses all pending auth flows. Fine for single-user/single-process, but should move to the DB or a short-lived cache if the platform ever runs multiple workers.

**FX tracker has no rate source [MEDIUM]** (fxTracker.js:20-22)
The realised gain/loss formula is correct, but `raiseRate` and `settleRate` are never populated from Xero. The auto-scan from the queue (`scanQueueForFx`) passes no rates, so `realisedGbp` is always null. Either pull rates from Xero's CurrencyRate endpoint or from the transaction's CurrencyRate field.

**Date handling in deadlines [LOW]** (deadlines.js:24-26)
Adding 37 days to the quarter end for VAT due dates works for most quarters, but the HMRC rule is "one calendar month and seven days", not "37 days". Minor because the differences are small and the deadlines are manually verifiable.

**Missing error handling on Drive download [LOW]** (driveScanner.js:90-101)
`downloadFile` has no retry or timeout. Large PDFs on a slow connection will fail silently. A 30-second timeout and single retry would cover this.

---

## 3. UX / UI Assessment

### Strengths

- **Dashboard overview**. The DashboardPanel gives a single-screen summary of queue status, invoice stats, and upcoming deadlines. This is the right landing page.
- **Xero dropdowns**. The `useXeroRefData()` hook populates account code and tax rate selectors from live Xero data, with manual text fallback. Prevents typos and speeds up corrections.
- **Batch operations**. Select multiple pending items and approve or skip in bulk. Essential for a weekly review of 50-100 items.
- **Audit trail with "changed" chip**. Items where the confirmed code differs from the proposal get a visual flag. Good for spotting where the AI or rules got it wrong.
- **CSV exports**. Queue and audit trail both export. Useful for handing data to Beany.

### Weaknesses

**Reconcile queue lacks keyboard workflow [HIGH]**
The most-used panel requires mouse clicks for every action. A keyboard-driven flow (arrow keys to navigate, Enter to approve with current suggestion, S to skip, E to edit) would halve the time spent on the weekly review. This is the single biggest UX improvement available.

**No inline confidence indicator [MEDIUM]**
The queue sorts by confidence (lowest first, which is correct), but the confidence value isn't visible on each row. A colour-coded bar or percentage would let the reviewer see at a glance which items need attention vs which are safe to batch-approve.

**No "undo" on confirm [MEDIUM]**
Once an item is confirmed, it can't be reverted to pending. If the user realises they approved something with the wrong code, they have to find it in the audit trail and there's no way back. A "revert to pending" action on confirmed items (pre-write-back) would catch mistakes.

**VAT exceptions not surfaced in the reconcile flow [MEDIUM]**
VAT exception detection runs on confirm, but the flags appear only in the VAT tab. The user confirming a line doesn't see the warning inline. An inline alert ("This will flag a VAT exception: reverse charge on GBP transaction") before confirmation would prevent errors rather than recording them.

**DeadlinesPanel is read-heavy [LOW]**
The deadlines table shows all deadlines for the year. For a daily-use tool, a focused view of just the next 30-60 days (with the ability to expand) would be more useful.

**No mobile-optimised reconcile view [LOW]**
The reconcile table has many columns and doesn't stack well on narrow screens. A card-based layout at phone width would make it possible to review items on a phone.

---

## 4. Feature Completeness

| Feature | Coverage | Gap |
|---------|----------|-----|
| Bank reconciliation | 95% | Missing: multi-line split transactions |
| Rules engine | 95% | Missing: currency-specific rules (same payee, different treatment by currency) |
| AI classification | 90% | Missing: confidence feedback loop (track accuracy over time) |
| VAT compliance | 85% | Missing: flat-rate scheme support, partial exemption |
| Invoice matching | 75% | Missing: OCR on invoice PDFs to extract amount/date/supplier |
| Tax deadlines | 95% | Missing: Companies House deadlines (annual return, confirmation statement) |
| Digest emails | 90% | Missing: configurable frequency (some users want daily) |
| FX tracking | 50% | Missing: rate source, unrealised gain/loss, period summaries |
| Financial reports | 70% | P&L and balance sheet from Xero, but no trend analysis or comparatives |
| Accountant handover | 30% | No packaged quarter-end or year-end bundle for Beany |

---

## 5. Suggested Improvements

### Tier 1: high impact, moderate effort

1. **Keyboard-driven reconcile queue** (2-3 hrs, frontend-only). Arrow keys move between items, Enter approves with current suggestion, S skips, E opens edit. Would cut weekly review time from 20-30 minutes to under 10.

2. **Inline VAT warnings on confirm** (3-4 hrs). Run VAT exception checks before the user confirms. Show a yellow warning bar. The user still confirms, but they see the issue first.

3. **Fix the N+1 in pullAndClassify** (1 hr, backend-only). Replace per-line existence check with a batch query. Turns hundreds of queries into one per page.

4. **Batch AI classification** (2 hrs, backend-only). Send 5-10 lines per Claude call with structured output. Cuts API calls and cost by 80%+ with no quality loss.

### Tier 2: high impact, higher effort

5. **Accountant export pack** (1-2 days). A "Quarter end pack" button that bundles: confirmed transactions by account code, VAT exceptions with resolutions, missing invoices list, tax deadline status, and a PDF-ready summary. This is the missing link between OMI and Beany.

6. **Invoice OCR** (1 day). Use Claude's vision capability to extract amount, date, supplier, and VAT from invoice PDFs in the Drive folder. Would dramatically improve invoice-to-transaction matching. Budget-gate it like the reconcile classifier.

7. **Populate FX rates from Xero** (3-4 hrs). Xero's BankTransaction response includes CurrencyRate. Capture this during pullAndClassify and pass it through to the FX tracker.

### Tier 3: nice to have

8. **Confidence trend dashboard** (half day). Track AI classification accuracy over time.
9. **Split transaction support** (1 day). Some bank lines need splitting across multiple account codes.
10. **Companies House deadlines** (1-2 hrs). Annual return, confirmation statement, accounts filing deadline.

---

## 6. Alternative Approaches Considered

**Why not use an off-the-shelf reconciliation tool?**
Tools like Dext, AutoEntry, or Xero's own bank rules exist. They don't learn from corrections the way this does, they don't run VAT compliance checks specific to October's supplier mix, and they don't integrate with the rest of OMI. The custom build is justified.

**AI-first vs rules-first.**
The current approach (rules first, AI for unknowns) is correct. An AI-first approach would be more expensive, slower, and less deterministic. The rules engine handles 60-80% of recurring transactions with zero cost.

**Real-time sync vs weekly batch.**
The weekly Sunday batch is the right choice. Real-time webhooks would add complexity without matching the actual workflow (review on Monday morning). If the queue grows beyond 200 items per week, a twice-weekly run would be simpler than real-time.

**Single 2,000-line frontend file vs component split.**
AccountsPanels.jsx is 2,081 lines containing 12 panels. At the upper limit of manageable. Each panel is self-contained, so the file is more barrel than monolith, but extracting each panel into its own file would improve navigation as features are added.

---

## 7. Priority Action List

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| 1 | Keyboard-driven reconcile queue | High | 2-3 hrs |
| 2 | Fix N+1 query in pullAndClassify | High | 1 hr |
| 3 | Batch AI classification (5-10 per call) | High | 2 hrs |
| 4 | Inline VAT warnings before confirm | High | 3-4 hrs |
| 5 | Accountant quarter-end export pack | High | 1-2 days |
| 6 | Populate FX rates from Xero transactions | Medium | 3-4 hrs |
| 7 | Invoice OCR via Claude vision | Medium | 1 day |
| 8 | Confidence trend tracking | Medium | 4 hrs |
| 9 | Split transaction support | Low freq | 1 day |
| 10 | Companies House deadlines | Low | 1-2 hrs |

**Recommendation:** Items 1-4 are quick wins that should ship together. They address the two biggest pain points (reconcile speed and performance) with under a day of work. Item 5 (accountant pack) is the highest-value feature not yet built, and the one that would most reduce the manual handover to Beany.
