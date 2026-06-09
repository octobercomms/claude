# Privacy Policy — October Marketing Intelligence (Shopify app)

_Last updated: 9 June 2026_

This policy explains what data the **October Marketing Intelligence** Shopify app (the "App") collects from your store, what it's used for, where it's stored, and how to request deletion.

The App is operated by **October Communications Ltd**, registered in England & Wales (company no. 8816416), 85 Great Portland Street, First Floor, London, W1W 7LT.

## 1. Who this app is for

The App is intended for Shopify merchants whose marketing agency uses the **October Marketing Intelligence** platform to manage their marketing. Your agency asks you to install it so they can see real-time store activity inside their reporting dashboard.

## 2. What data the App reads from your store

The App is **read-only** — it never writes to your store, never modifies products, prices, customer records, themes or settings. It subscribes to the following Shopify webhooks:

- **Orders** — creates, updates, cancellations, fulfilments, refunds
- **Customers** — creates and updates (name, email, address, order history, marketing-opt-in flags)
- **Products** — creates, updates, deletes (titles, variants, prices, inventory levels)
- **Inventory** — stock-level changes
- **Themes** — published theme changes (so your agency knows when you launched a redesign)
- **Checkouts** — including abandoned carts

It also reads your **shop domain** and **shop name** to identify which October Marketing Intelligence account the data belongs to.

## 3. What it does NOT collect

- Payment card details (Shopify never exposes these to apps)
- Anything outside the scopes listed in section 2
- Anything from stores the App isn't installed on

## 4. What we do with the data

The App forwards the events listed above to your agency's **October Marketing Intelligence** account at `platform.octobercomms.com`, where it appears in their dashboards and reports. Specifically your agency uses it to:

- Generate weekly and monthly performance reports for you
- Power conversion, attribution and retention analysis
- Inform ad creative and campaign decisions on Meta, Google, TikTok and LinkedIn
- Surface trends and anomalies in your store activity

Your data is **never sold**, **never shared with third parties** outside this flow, and **never used to train AI models**.

## 5. Where data is stored

- **Transit**: TLS 1.2+ HTTPS, with HMAC-SHA256 signing between the App and the platform
- **At rest**: in a PostgreSQL database on infrastructure located in the United Kingdom (eu-west-2, AWS London)
- **Encryption**: sensitive credentials encrypted at rest with AES-256

October Communications Ltd is the data controller for the storage of this data on the October Marketing Intelligence platform.

## 6. How long we keep it

- **Order, customer and product events**: retained for the lifetime of your agency's contract with us, used to compute year-on-year trends in reports.
- **On uninstall**: when you uninstall the App from your store, Shopify sends an `app/uninstalled` webhook. We immediately mark the connection as disconnected and stop accepting new events. Existing data is retained for 30 days then permanently deleted, unless we receive a manual deletion request earlier.
- **GDPR data-request and redaction webhooks** (`customers/data_request`, `customers/redact`, `shop/redact`): handled automatically per Shopify's requirements within 30 days.

## 7. Your rights

If you're an EU/UK resident or a customer of a merchant using the App, you can request:

- A copy of all personal data we hold about you
- Correction of inaccurate data
- Deletion of your data
- Restriction of processing
- Portability to another service

Submit any request to **privacy@octobercomms.com**. We will respond within 30 days.

## 8. Contact

**Data protection**: privacy@octobercomms.com
**General support**: support@octobercomms.com
**Postal**: October Communications Ltd, 85 Great Portland Street, First Floor, London, W1W 7LT, United Kingdom

## 9. Changes to this policy

If we materially change how the App collects or uses data, we will update this policy and notify connected merchants via the App's embedded admin before the change takes effect.
