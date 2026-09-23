# Falcon Enamelware: Purple Dot replacement, research inputs (Brevo + compliance)

Researched 2026-09-23. **Research method caveat:** the network egress proxy blocked direct fetches of developers.brevo.com, help.brevo.com, legislation.gov.uk, ecfr.gov, ico.org.uk, ftc.gov, eur-lex, support.google.com, visa.com and mastercard.com. The findings below come from (1) the official Brevo Node SDK (`@getbrevo/brevo` v6.0.3, pulled from npm and read locally; its types are generated from Brevo's OpenAPI spec) and (2) web-search snippets of the official pages listed. Legal text was **not** read in full. Before launch, a person should check each CONFIRMED legal point against the primary source (links given).

Legend: **CONFIRMED** = read in the official source or SDK, or the same wording came back from the official page in several searches. **LIKELY** = secondary sources, or one search snippet of an official page. **UNKNOWN** = could not verify.

---

## 1. Brevo transactional email API (v3)

### Endpoint and auth
- `POST https://api.brevo.com/v3/smtp/email`: **CONFIRMED** (the SDK's `BrevoEnvironment.Default = "https://api.brevo.com/v3"` plus path `smtp/email`; the doc example uses the same URL). https://developers.brevo.com/reference/send-transac-email
- Auth header `api-key: <key>`: **CONFIRMED** (SDK `HeaderAuthProvider` `HEADER_NAME = "api-key"`). Also send `content-type: application/json` and `accept: application/json`.
- Response: `{ "messageId": "<...>" }`, or `messageIds[]` when `messageVersions` is used: **CONFIRMED** (SDK `SendTransacEmailResponse`).

### Body fields (from SDK `SendTransacEmailRequest`, all CONFIRMED)
| Field | Notes |
|---|---|
| `templateId` (number) | Stored template ID. When it is set, `htmlContent`, `textContent` and `subject` are ignored or optional, and `sender` is optional (the template's sender is used unless you override it). |
| `to` [{email, name?}] | Required unless `messageVersions` is used. `name` has a 70-character maximum. |
| `params` (object) | "Key-value pairs for template variable substitution. Only applicable when the template uses the New Template Language format." |
| `tags` (string[]) | "Array of tags for categorizing and filtering emails". Use them for store, flow and SKU. |
| `headers` (object) | Custom non-standard headers. Names are converted to Title-Case. The SDK's example includes `"Idempotency-Key":"abc-123"` and `"X-Mailin-custom"`. |
| `sender` {email, name?} or {id} | Required only when there is no `templateId`. |
| `replyTo` {email, name?} | Optional. |
| `scheduledAt` | ISO UTC. Scheduled sends can run up to 5 minutes late. |
| `messageVersions[]` | Batch: at most 2,000 recipients per request and 99 per version, `params` at most 100 KB per version and 1,000 KB in total. |
| `to[].contactPixelTrackingConsent` (bool) | New per-recipient open/click tracking consent flag (only applies if the account has the feature enabled). Pass `false` for non-consented contacts if you enable it. |

### Idempotency: **LIKELY** (the sources disagree on the key's spelling)
- Brevo's "Idempotency for batch emails" doc page, as seen in search snippets, says to put an `idempotencyKey` inside the body's `headers` object. The value must be a **UUID**. **TTL is 30 minutes.** A reused key inside the TTL returns a `duplicate_parameter` error and the email is not sent. https://developers.brevo.com/docs/heterogenous-versions-batch-emails
- The SDK's field description gives the example `"Idempotency-Key"` inside `headers` and says header names are Title-Cased.
- **Recommendation:** send `"headers": {"idempotencyKey": "<uuid>"}` as the doc page shows. Before launch, test that a second identical call returns `duplicate_parameter`. If it does not, switch to `"Idempotency-Key"`. Use a **deterministic UUIDv5** built from `store|flow|variant_id|customer_id|restock_event_id` so that Flow retries inside 30 minutes are deduplicated.
- The 30-minute TTL is short. Also make the send itself idempotent in Shopify: remove the waitlist tag (or write a `notified_at` metafield) in the same Flow run, **before or right after** the Brevo call.

### Template syntax: **CONFIRMED**
- Brevo Template Language (Django-like, built on Pongo2): `{{ params.product_name }}`, plus `{% if params.x %}…{% endif %}` and filters. Contact attributes use `{{ contact.FIRSTNAME }}`. To output raw HTML: `{% autoescape off %}{{ params.html }}{% endautoescape %}`. https://help.brevo.com/hc/en-us/articles/4402386448530 and the SDK example `{{params.trackingCode}}`.
- `params` only work in "New Template Language" templates, which is the default for current templates. **CONFIRMED** (SDK).

### Rate limits and plan caps
- Free plan: **300 emails/day, shared between marketing and transactional**. **LIKELY** (several 2026 reviews plus the Brevo pricing and help pages): https://www.brevo.com/pricing/, https://help.brevo.com/hc/en-us/articles/208589409, https://dreamlit.ai/blog/brevo-review. A restock of a popular SKU across 3 stores can easily exceed 300 in one day, so **use a paid plan** (Starter or higher has no daily cap, only a monthly volume).
- API rate limit for `/v3/smtp/email`: roughly 1,000 requests per second on standard plans, higher on Pro/Enterprise. On a 429, read the `x-sib-ratelimit-reset` header. **LIKELY**: https://developers.brevo.com/docs/api-limits, https://www.brevo.com/blog/api-rate-limiting/. Flow's per-customer HTTP actions will not get near this.

### Sender domain authentication: **CONFIRMED** (Brevo help, via search)
- Three DNS records per domain: a **Brevo code** TXT (proves ownership), a **DKIM** record, and a **DMARC** TXT. Keep a single DMARC record with a `rua` tag (Gmail, Yahoo and Microsoft sender rules). SPF include is optional or legacy in Brevo's current flow; DKIM alignment is what matters. Up to 48 hours to propagate. https://help.brevo.com/hc/en-us/articles/12163873383186
- One Brevo account can hold **multiple authenticated domains and senders**, each authenticated separately. **CONFIRMED**: https://developers.brevo.com/docs/getting-started-with-senders-and-domains
- Recommendation: `us.` and `eu.falconenamelware.com` are storefront hostnames, so all three stores can send from **one authenticated root domain** (for example `hello@falconenamelware.com`, or a mail subdomain such as `mail.falconenamelware.com` to isolate reputation) with different From names ("Falcon Enamelware US"). Separate sender *records* per store are optional. Remember that transactional unsubscribes are scoped **per sender** (next point), so use one sender per store if you want a US unsubscribe to leave the UK flow unaffected.

### Unsubscribe and suppression behaviour
- An unsubscribe link is **not mandatory** in transactional emails, and Brevo does not force one. It becomes mandatory if the content is marketing. **CONFIRMED** (Brevo help, via search): https://help.brevo.com/hc/en-us/articles/9741388688402
- Marketing and transactional blocklists are **separate**. A contact who unsubscribed from marketing campaigns **still receives transactional sends** by default. If a contact unsubscribes from a transactional email, they are blocked **only for that sender**. Brevo offers an optional automation to cross-blocklist. **CONFIRMED** (Brevo help, via search): https://help.brevo.com/hc/en-us/articles/19313227820178, https://help.brevo.com/hc/en-us/articles/209458705
- Implication: do not enable the cross-blocklist automation. Otherwise a marketing opt-out would silence legally required preorder delay notices.
- Brevo **does** silently drop sends to addresses on the transactional blocklist, including hard bounces. The API still returns 201. Check via webhooks or the `/smtp/blockedContacts` endpoint. **LIKELY.**
- Gmail and Yahoo's one-click `List-Unsubscribe` requirement applies to bulk *marketing* mail. Transactional mail is exempt. **LIKELY.** Adding a "stop these alerts" link to the waitlist email is still good practice (see 2c).

---

## 2. UK law

### (a) Consumer Rights Act 2015 s.28 (delivery): **CONFIRMED** (statute text via search snippets)
- Unless there is an **agreed time or period**, goods must be delivered "without undue delay, and in any event not more than 30 days after the day on which the contract is entered into". A trader and consumer can agree a longer period. An expected date shown before purchase and accepted at checkout is that agreed period. https://www.legislation.gov.uk/ukpga/2015/15/section/28
- If delivery misses the agreed period: where the time was essential (or the consumer was told it was), the consumer can **treat the contract as at an end**. Otherwise the consumer can **set a further appropriate period** and end the contract if that is missed too. Either way they get all money back. s.28(6)-(10). **CONFIRMED** (search summary of the section and explanatory notes).
- Consumer Contracts Regs Sch 2(g) requires delivery-date information before the contract. This supports showing the expected date on the product page and at checkout. **LIKELY.**

### (b) Consumer Contracts Regulations 2013: **CONFIRMED** (reg text via snippets)
- Reg 30: for goods, the cancellation period **ends 14 days after the day the goods come into the consumer's physical possession** (for split deliveries, the last item). The right can be exercised **from the moment the contract is made**, so a preorder customer can cancel at any time before dispatch, and after delivery too. https://www.legislation.gov.uk/uksi/2013/3134/regulation/30
- Reg 34: refund **within 14 days**. Where goods have **not** been dispatched or collected, that means 14 days after being told of the cancellation. Once goods have been delivered, it is 14 days after getting them back or receiving evidence of return, whichever is sooner. The refund includes standard outbound delivery and uses the same payment method. https://www.legislation.gov.uk/uksi/2013/3134/regulation/34
- If the 30-day or 14-day information is missing, the cancellation period extends by up to 12 months (reg 31). **LIKELY.**

### (c) PECR / ICO: back-in-stock email as a service or solicited message: **LIKELY** (ICO guidance via search; ICO does not name "back in stock" specifically)
- The ICO defines **solicited** messages as those the individual "specifically asks you to send". Most PECR marketing rules (including the consent / soft-opt-in rule in reg 22) apply only to **unsolicited** messages. A consent to marketing, or failing to object, does not make a message solicited. https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-direct-marketing-using-electronic-mail/key-concepts-for-direct-marketing-using-electronic-mail/
- A **service message** is administrative, neutral in tone, and gives information needed as part of the relationship. If it "strays into becoming promotional", PECR marketing rules apply. The ICO has fined disguised marketing. https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/direct-marketing-guidance/identify-direct-marketing/
- A back-in-stock alert *about the product the person asked about* is best treated as a **solicited** message. It is arguably still "marketing" under the UK GDPR, so the right to object applies. It is therefore lawful for subscribers who did **not** give marketing consent, provided it stays within the request. To stay within it, the email **must not contain**:
  - other products, "you might also like", bestsellers or collections;
  - discount codes, sale banners, or urgency or scarcity hype beyond a factual stock note;
  - a newsletter sign-up CTA, social promo blocks or brand-story content;
  - repeat "still available" or "last chance" reminders. **Send once** per request, then remove the tag.
- It **should** contain: sender identity and contact address, a line explaining why they got it ("You asked us to email you when X was back"), and a way to stop alerts or remove themselves. Neutral subject line, e.g. "Back in stock: {{ params.product_name }}".
- Preorder confirmation, date-change and shipped emails are **service messages** (contract performance). They go to everyone regardless of marketing consent. Keep them free of promo blocks. **LIKELY.**
- The Data (Use and Access) Act 2025 raised PECR fines to UK GDPR levels (up to £17.5m or 4% of turnover). This raises the stakes on the point above. **LIKELY.**

---

## 3. US FTC Mail, Internet, or Telephone Order Merchandise Rule (16 CFR 435)
Sources: https://www.ecfr.gov/current/title-16/chapter-I/subchapter-D/part-435, https://www.ftc.gov/business-guidance/resources/business-guide-ftcs-mail-internet-or-telephone-order-merchandise-rule, https://www.law.cornell.edu/cfr/text/16/435.2, https://www.law.cornell.edu/cfr/text/16/435.1

- **(a) Reasonable basis** (435.2(a)): you must not solicit orders unless you have a reasonable basis to expect to ship within the time **clearly and conspicuously stated**, or within 30 days if none is stated (50 days if the buyer applies for seller credit). "Reasonable basis" means information that, at the time of the representation, would satisfy a reasonable and prudent businessperson acting in good faith that it is true. The FTC guide says this covers realistic demand forecasts, stock or supply to meet it, and fulfilment capacity. **CONFIRMED** (definition text via search). So the preorder expected date must come from a real supplier ETA, and you must keep evidence of it (PO, supplier confirmation).
- **(b) First delay option notice** (435.2(b)(1)): if you cannot ship on time, you must, **before the promised date and within a reasonable time after learning of the delay**, offer the buyer the choice to **consent to the delay or cancel for a prompt refund**. The notice must give a **definite revised ship date**, or say you cannot give one if you lack a reasonable basis. For a **definite delay of 30 days or less** past the original date, you may treat **silence as consent**. The notice must then say expressly that unless you receive a cancellation before shipment and before the revised date, the buyer is deemed to consent. **CONFIRMED** (quoted rule text via search). Include a cost-free way to reply, such as a cancel link. **LIKELY.**
- **(c) Longer, indefinite or second delays** (435.2(b)(2), (c)): if the first delay is over 30 days or indefinite, or for any **renewed** delay, you need the buyer's **express consent** (written, electronic or oral) before the current deadline. **Without it you must cancel and refund automatically**, without being asked. A buyer who consents to an indefinite delay keeps the right to cancel at any time before shipment. **CONFIRMED** (FTC guide via search).
- **(d) Refund timing**: for third-party credit or debit card payments, the 2014 amendments require a refund **within 7 working days** of the refund right vesting. The old "one billing cycle" now applies only where the seller itself is the creditor (a store card). Cash, check or money order: 7 working days. **CONFIRMED** (FTC 2014 final rule press release and law-firm summaries): https://www.ftc.gov/news-events/news/press-releases/2014/09/ftc-issues-final-amendments-mail-or-telephone-order-merchandise-rule, https://www.afslaw.com/perspectives/the-fine-print/mailin-it-the-ftc-gives-the-mail-order-rule-makeover
- This matters for flow (c). The US date-change email is legally a 435.2 **option notice**, not a courtesy email. Its logic must branch on (i) whether this is the first delay, and (ii) whether the new date is 30 days or less after the old one. It must include the silence-equals-consent sentence or an express-consent button. If express consent is required and not received by the deadline, the order must be auto-cancelled and refunded within 7 working days.

---

## 4. EU (eu.falconenamelware.com, run from the UK)
- **CRD 2011/83/EU Art. 18**: unless the parties agree otherwise, deliver without undue delay and **within 30 days** of the contract. If you are late, the consumer sets an appropriate additional period and can terminate if it is missed. They can terminate immediately if the date was essential, or if the trader refuses to deliver. Reimbursement is "without undue delay". **CONFIRMED** (article text via search): https://www.legislation.gov.uk/eudr/2011/83/article/18, https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX%3A32011L0083
- **Art. 9 / 13**: a 14-day withdrawal period for goods, running from physical possession, with a refund within 14 days of being told of the withdrawal. The trader may withhold the refund until the goods, or proof of return, arrive. The consumer can withdraw before delivery. **CONFIRMED** (well-established; the same structure as the UK CCR, which transposed it).
- **Additional points for a UK-run EU store:**
  - **Withdrawal button (Directive (EU) 2023/2673, new CRD Art. 11a), applying from 19 June 2026:** online traders must provide a prominent, continuously available "withdraw from contract here" function for the whole withdrawal period, plus an electronic acknowledgement of receipt. **CONFIRMED** (several law-firm sources): https://www.williamfry.com/knowledge/world-consumer-rights-day-part-3-mandatory-withdrawal-button-coming-june-2026/, https://www.iubenda.com/en/blog/the-new-online-withdrawal-function-what-eu-directive-2023-2673-means-for-your-business/. Because the EU store is in scope (it directs activity at EU consumers; Rome I Art. 6 applies the consumer's home law), **the preorder confirmation and date-change emails on the EU store should link to a one-click withdrawal / cancel function**, and the EU store needs one in the account or order-status page. **LIKELY** as to how it applies to Falcon specifically.
  - **GPSR (Reg. 2023/988), in force since 13 Dec 2024:** a UK manufacturer selling direct to EU consumers needs an **EU Responsible Person** named on the product or packaging and in the online listing, together with manufacturer details. Enamelware is also a food-contact material (Reg. 1935/2004 declarations). **LIKELY.**
  - Ireland: the Consumer Rights Act 2022 (IE) transposes the CRD. There are no delivery or withdrawal rules beyond those above that matter for this build. **LIKELY.** VAT: IOSS for consignments of €150 or less. Out of scope, but it affects preorder pricing display. **LIKELY.**

---

## 5. Google Merchant Center / Meta catalogue (preorder)
- **Google:** set `availability = preorder` **and** `availability_date`, which is **required** for preorder and backorder. Use ISO 8601 (`YYYY-MM-DD` or `YYYY-MM-DDThh:mm[:ss]±hh:mm`). Include the time and offset to avoid parse errors, e.g. `2026-11-15T00:00:00+00:00`. The date must be in the future and **no more than 1 year ahead**. Update it whenever the ETA changes. It means the date the product can be **dispatched**. **CONFIRMED** (Google help page via search): https://support.google.com/merchants/answer/6324470, https://support.google.com/merchants/answer/7055760
- **Meta:** the `availability` values are `in stock`, `out of stock`, `preorder`, `available for order`, `discontinued` (with spaces, not underscores). `availability_date` uses the same ISO 8601 format and is expected for preorder items. **LIKELY** (third-party specs; Meta's page was not reachable): https://productfeedspec.com/platforms/meta-catalog
- **Feedoptimise:** the preorder state and date have to reach Feedoptimise from Shopify. Expose them as a product or variant metafield (e.g. `custom.preorder_expected_date`) and a flag, then add Feedoptimise rules: if preorder then `availability=preorder` (Google) or `preorder` (Meta), and `availability_date` = the metafield formatted as ISO 8601 with a timezone offset. The Google and Meta spellings differ, so map them per channel. Make sure the date-change flow updates the same metafield so feeds, product pages and emails stay in sync. Feedoptimise's ability to read metafields was not verified: **UNKNOWN**.

---

## 6. Card-scheme non-receipt disputes
- **Visa 13.1 (Merchandise/Services Not Received):** 120 days from the transaction processing date **or from the last expected delivery date**, capped at 540 days from processing. If no delivery date was specified, the issuer must wait 15 days after the transaction before filing. **LIKELY**: https://chargebacks911.com/chargeback-reason-codes/visa/13-1-merchandise-services-not-received/, https://usa.visa.com/dam/VCOM/global/support-legal/documents/faq-apr-disputes.pdf
- **Mastercard 4853 (Cardholder Dispute: goods not provided; 4855 is retired and folded into it):** 120 days from the expected delivery date, capped at 540 days from processing. **LIKELY**: https://www.chargeflow.io/chargeback-reason-codes/mastercard-4855-goods-or-services-not-provided
- Implication: record the expected date on the order (order metafield or note) and show it in the confirmation email. That date starts the dispute clock and is also your evidence.

---

## Recommended Brevo request (Shopify Flow "Send HTTP request")
```
POST https://api.brevo.com/v3/smtp/email
api-key: {{ secret }}
content-type: application/json
accept: application/json
```
```json
{
  "templateId": 101,
  "sender": { "name": "Falcon Enamelware", "email": "hello@falconenamelware.com" },
  "replyTo": { "email": "hello@falconenamelware.com", "name": "Falcon Enamelware" },
  "to": [ { "email": "jane@example.com", "name": "Jane Smith" } ],
  "params": {
    "store": "uk",
    "product_name": "Falcon Pie Dish 26cm",
    "variant_title": "Pigeon Grey",
    "product_url": "https://www.falconenamelware.com/products/pie-dish?variant=123&utm_source=brevo&utm_medium=email&utm_campaign=back_in_stock",
    "image_url": "https://cdn.shopify.com/...jpg",
    "price": "£22.00",
    "unsubscribe_url": "https://www.falconenamelware.com/pages/waitlist?remove=<signed-token>"
  },
  "tags": ["back-in-stock", "store-uk", "variant-123"],
  "headers": {
    "idempotencyKey": "5b1c9e0a-2f7d-5a4e-9c1b-3e8f6a2d7c40",
    "X-Mailin-custom": "flow=bis|store=uk|variant=123|customer=456"
  }
}
```
- Use one template per store and flow (currency, legal footer and address differ), or one template per flow that branches with `{% if params.store == "us" %}`.
- The idempotency key is a UUIDv5 of `store|flow|variant|customer|restock_event`. Test the `idempotencyKey` vs `Idempotency-Key` spelling (see above).
- Send each store from its own sender record if you want per-store transactional unsubscribes.

## Compliance points that change the email copy
1. **Back-in-stock (all stores):** neutral, single-product, sent once. No cross-sell, discount or newsletter CTA. Include "You're receiving this because you asked to be told when X was back" and a remove-me link. (PECR solicited or service message.)
2. **Date-change email, US:** must be an FTC option notice. State the **definite revised ship date** (or say it cannot be given), give cancel-for-full-refund as an equal option, and **if the new date is 30 days or less past the old one** include: "Unless we hear from you before we ship and before [new date], we'll treat this as your agreement to the new date." For a second delay, a delay over 30 days, or an indefinite delay, show a **"Yes, keep my order" button**. With no click, auto-cancel and refund **within 7 working days**.
3. **Date-change email, UK/EU:** do not present cancellation as a goodwill favour. The customer has a statutory right to cancel before dispatch (CCR reg 30 / CRD Art. 9), with a full refund including delivery **within 14 days**. On the EU store, link to the withdrawal function ("Withdraw from contract here", CRD Art. 11a from 19 June 2026).
4. **Preorder confirmation:** repeat the **expected dispatch date** (this is the agreed delivery period under CRA s.28 / CRD Art. 18 and starts the chargeback clock), and state the cancellation right and the 14-days-after-delivery return window (UK/EU).
5. Preorder confirmation, date-change and shipped emails are service messages. Send them regardless of marketing consent and keep promo blocks out. Do not enable Brevo's cross-blocklisting of marketing unsubscribes into transactional.
