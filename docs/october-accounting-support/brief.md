# October Accounting Support — Build Brief

Status: draft for sign-off. Nothing is built yet. This is the spec we agree
before code touches live books.

Owner: Daniel Nelson. Accountant: Beany. Entity: UK limited company, VAT
registered (returns filed by Beany through Xero). Currencies: GBP, USD, EUR.

---

## 1. What it is, and what it is not

A decision-support and extraction layer on top of Xero. It reconciles more
accurately than manual sorting does, learns the correct allocation once and
remembers it, and produces the two documents the accountant needs: a VAT-ready
pack each quarter and a year-end handover pack.

It is **not**:

- MTD filing software. Xero already files the VAT return, and Beany runs it.
  Becoming an HMRC-recognised filer is a compliance burden with no payoff.
- Accounts-production software. Statutory accounts and the CT600 are Beany's
  regulated output. We prepare the handover, we do not file.
- A full automation. There is always a human sign-off gate, because the
  director signs the numbers.

The line: everything up to the point of filing. Nothing across it.

---

## 2. The four jobs

1. **Accurate reconciliation.** For each unreconciled Xero bank line, propose
   the correct account code and VAT treatment, flag anything ambiguous or
   tax-sensitive for confirmation, and write the approved coded transaction
   back to Xero.
2. **Learn once, remember.** Every confirmation becomes a deterministic rule.
   Next time that payee appears, the rule fires with no AI call.
3. **VAT-ready pack.** Each quarter, review the period, flag questionable VAT
   treatments, and output a clean summary for review before Xero files.
4. **Year-end handover pack.** By 1 January the books are fully reconciled and
   the pack extracts everything Beany needs, in their format, so it goes across
   immediately with fewer questions and errors.

---

## 3. Architecture

### Xero is the hub

Wise, Stripe and GoCardless already feed bank-statement lines into Xero.
Reconciliation runs against Xero's data. So Xero is the only integration needed
to start.

| Source | Integration | Phase |
|--------|-------------|-------|
| Xero | OAuth2 app (client ID/secret, rotating refresh token, `offline_access`) | 1 |
| Stripe | Read-only restricted key. Splits a bundled net payout back to invoices and books the fee. | 2 |
| GoCardless | Only if the Xero feed loses the payout split | Later |
| Wise | Not needed; feeds Xero already | Later |
| PayPal | Expense-side, messy, lowest priority | Last |

Do not wire five integrations on day one. Xero first. Add Stripe when the
payout-netting problem bites.

### Stack

Matches `dev/platform`: Node/Express backend, Postgres, `@anthropic-ai/sdk`,
`node-cron` worker, React frontend. Deploys next to the platform on the Hetzner
box.

```
dev/october-accounting-support/
  backend/    Express API, Xero OAuth, rules engine, VAT + year-end export
  worker/     node-cron poller: pull unreconciled lines, classify, queue
  frontend/   React review queue (OMI brand)
docs/october-accounting-support/
  brief.md    this file
```

---

## 4. The learning model: rules store, not model memory

The single most important design decision. "Learn once, remember" is built as
a rules table, not as LLM memory.

- **Head (the 80%):** a Postgres `rules` table. Payee pattern to account code,
  VAT rate, confidence, times-confirmed, last-seen. A rule hit needs no AI and
  is fully auditable.
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

## 5. Multi-currency (GBP, USD, EUR)

- Requires Xero's multi-currency plan (Established tier) enabled.
- The VAT return is always GBP; foreign sales convert at the correct date's
  rate.
- Realised FX gain or loss on settlement is booked to its own code. These are
  flagged for confirmation and must reconcile in the year-end pack, or the books
  do not tie out.

This is the part that carries the highest correctness risk.

---

## 6. The 90-day training, honest version

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

## 7. Outputs and delivery

Delivery is deliberately light: email with attachments, or a download link. No
heavy dashboard.

- **Review queue** (web, needed for the confirm/train loop, since allocation is
  visual): the only interactive surface.
- **VAT-ready pack** (quarterly): PDF or spreadsheet summary plus exception
  list, emailed with a download link.
- **Year-end handover pack** (1 January): categorised P&L / trial balance,
  queried-items list, fixed-asset additions, FX realised gains/losses, receipts
  checklist, director's loan and dividend notes. Built to Beany's preferred
  format. Emailed with a download link.

Open decision: is the confirm/train loop a small web review queue (recommended,
fits the React stack) or email-based confirm links only?

---

## 8. Design

October / OMI brand throughout (see `OCT_brand-style-guide.md` and
`.claude/skills/october-design-system`). Warm off-white page `#FAF9F5`, white
cards, near-black text `#1A1A1A`, single yellow accent `#E7CD41` for the one
thing that matters per view. Green / red / amber only for positive / negative /
warning, which suits a reconciliation and P&L tool well. Brockmann, 2px borders,
chunky radii, bento cards, soft depth.

---

## 9. Data model sketch

```
xero_connections   encrypted tokens, tenant id, rotating refresh token
rules              payee_pattern, match_type, account_code, tax_rate,
                   confidence, times_confirmed, last_seen, currency
confirmations      line ref, proposed vs confirmed, who, when, reasoning
reconcile_queue    unreconciled line, status, suggestion, confidence
vat_exceptions     period, line ref, flag reason, resolution
fx_events          invoice, raise rate, settle rate, realised gain/loss, code
```

---

## 10. Phased plan

| Phase | Scope | Rough effort |
|-------|-------|--------------|
| 1 | Xero OAuth, pull unreconciled lines, rules + AI classify, read-only review queue. Writes nothing. Proves match quality on real books at zero risk. | ~1 week |
| 2 | Confirmations become rules; approved lines create coded transactions in Xero; the reconcile click stays with the human. Add Stripe payout splitting. | ~1 to 2 weeks |
| 3 | VAT-ready pack: quarter view, exception flags, email + download. | ~a few days |
| 4 | Year-end handover pack in Beany's format. | ~a few days |

---

## 11. What is needed to start Phase 1

1. A Xero app registered at developer.xero.com (client ID and secret). I can
   walk through this; it takes a few minutes.
2. Confirmation the Xero org is on the multi-currency plan.
3. Decision: read-only decision support first (recommended), or write-back from
   day one.
4. Decision: web review queue vs email confirm links for the training loop.
5. One question for Beany: what format makes their VAT and year-end fastest?
   Build to that, not a generic export.

---

## 12. Reference material verdict

| Source | Use |
|--------|-----|
| `openaccountants/uk-bookkeeping.md` | Mine for COA, VAT mapping, non-deductible filter, bank patterns. Filter out sole-trader / cash-basis parts. |
| `thriveventurelabs/accountsos-agent-plugin` | Not a fit (its own ledger, not Xero). Steal only the idea of pinning verified current-year tax facts. |
| `diy-accounting-uk/spreadsheets` | Reference only, licence-restricted, do not copy. |
| `github.com/topics/accounting` | Ignore. |
