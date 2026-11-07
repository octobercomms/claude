# Accounts Module Setup

**Platform**: https://platform.octobercomms.com
**Goal**: Connect Xero and Google Drive so the Accounts reconciliation engine works end-to-end.

---

## Prerequisites

Before starting either track below, you need access to:

- The October Xero account (for Track A)
- The Google Cloud console for the project that owns the platform service account (for Track B)
- Admin access to OMI at https://platform.octobercomms.com

---

## Track A: Xero (bank reconciliation)

This track connects Xero so OMI can pull unreconciled bank transactions and write back confirmed entries.

The module is partially useful with Xero alone: reconciliation, classification, and VAT checking all work without the Drive scanner.

### A1. Create a Xero Developer App

1. Go to https://apps.developer.xero.com
2. Sign in with the October Xero account.
3. Click **New app**.
4. Fill in:
   - **App name**: `October Platform`
   - **Integration type**: Web app
   - **Company or application URL**: `https://platform.octobercomms.com`
   - **Redirect URI**: `https://platform.octobercomms.com/api/accounts/xero/callback`
5. Accept the terms and click **Create app**.
6. On the app's Configuration page, copy these two values:
   - **Client ID**
   - **Client Secret** (click Generate a secret if one is not shown)

Keep both values ready for the next step.

### A2. Save Xero Credentials in OMI

1. Go to https://platform.octobercomms.com/accounts and click the **Xero** tab.
2. Scroll down to the settings fields below the connection panel.
3. Paste:
   - **XERO_CLIENT_ID**: the Client ID from step A1.6
   - **XERO_CLIENT_SECRET**: the Client Secret from step A1.6
   - **XERO_REDIRECT_URI**: exactly `https://platform.octobercomms.com/api/accounts/xero/callback`
4. Click **Save**.

### A3. Connect Xero

1. On the same Xero tab, click **Connect to Xero**.
2. Sign in to Xero if prompted and authorise access to the October organisation.
3. You will be redirected back to OMI. The Xero panel should now show **Connected** with the organisation name.

### A4. Verify

Go to the Reconciliation tab. If the Xero account has unreconciled bank transactions, they will appear after a sync. If the queue is empty and the panel says "No items in the queue with status pending", the connection is working; there are simply no unreconciled items.

If the panel says "Xero is not connected", return to the Xero tab.

---

## Track B: Google Drive (invoice matching)

This track connects a Drive folder so OMI can scan for invoices and receipts and match them against reconcile queue items. It requires Track A to be useful (there is nothing to match without bank transactions).

### B1. Configure the Google service account key

The Drive scanner uses the same Google service account as the platform's GA4, Search Console and Merchant Center integrations.

1. Go to https://platform.octobercomms.com/settings/integrations (the **Platform** section at the top).
2. Find `GOOGLE_SERVICE_ACCOUNT_JSON`.
3. If it is empty, paste the full JSON key for the platform service account. If it is already set (from the GA4/Search Console setup), skip to B2.

Until this key is present, the Drive panel shows "Google service account required" and the remaining steps cannot be completed.

### B2. Share the Drive folder

1. Go to https://platform.octobercomms.com/accounts and click the **Drive** tab.
2. The panel now shows a service account email and a **Copy email** button. Copy it.
3. In Google Drive, navigate to (or create) the folder for invoices and receipts.
4. Right-click the folder, click **Share**, paste the service account email, set permission to **Editor**, and share.

### B3. Link the folder in OMI

1. Copy the folder URL from the browser address bar (e.g. `https://drive.google.com/drive/folders/1AbCdEfGh...`).
2. Back on the Drive tab, paste the URL into the input field and click **Save**.
3. The panel should show **Connected** with the folder name.

### B4. Verify

Click **Scan and match**. The scanner will report how many files were found and how many matched reconcile queue items. If nothing matched, that is fine; the scan ran successfully.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Xero "Connect" button does nothing | Check XERO_CLIENT_ID, XERO_CLIENT_SECRET and XERO_REDIRECT_URI are all saved on the Xero tab. The redirect URI must match exactly. |
| Xero callback fails with "invalid redirect" | The redirect URI in the Xero developer app must be exactly `https://platform.octobercomms.com/api/accounts/xero/callback`. No trailing slash. |
| Drive panel says "Google service account required" | `GOOGLE_SERVICE_ACCOUNT_JSON` is not set. Go to Settings > Integrations and paste the key. |
| Drive folder "Not accessible" | Confirm the folder is shared with the service account email as Editor. |
| No bank transactions showing | Xero bank feeds need to be set up inside Xero itself (Xero > Banking > Add bank account). OMI pulls from Xero, not directly from the bank. |

---

## Notes

- **Banks connect through Xero, not directly to OMI.** Xero has direct bank feeds with most UK banks. Once bank feeds are active in Xero, OMI pulls unreconciled transactions via the Xero API.
- **Token rotation**: Xero rotates the refresh token on every use. OMI handles this automatically. If the connection ever drops, disconnect and reconnect via the Xero tab.
- **No secrets in code**: All credentials are stored as encrypted settings in the database, never in config files.
- **The Google service account is shared.** The same key powers GA4, Search Console, Merchant Center and the Accounts Drive scanner. There is one key, not four.
