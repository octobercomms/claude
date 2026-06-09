# Google connectors — dual authentication

Status: **Slice 1 shipped** (GA4 service-account auth). Slices 2–5 pending.

## Why

Every Google connector authenticated with a per-user OAuth refresh token.
Those tokens get revoked whenever client staff change their password, leave
the company, or remove the grant — which is the single biggest source of the
recurring GA4 `400`s the connector health check keeps flagging.

The fix is to add a durable, platform-level authentication path alongside
OAuth, not to replace it:

- **OAuth** — one click for the client, but fragile (breaks on staff/password
  changes and revoked grants).
- **Service account / MCC link** — durable and agency-friendly; never expires.
  Costs the client one setup action (add an email as Viewer, or accept a link
  request).

New connections default to the durable path; existing OAuth connections are
left exactly as they are.

## Data model

`connectors.auth_mode` (`TEXT NOT NULL DEFAULT 'oauth'`, migration `065`):

| Value | Meaning |
|---|---|
| `oauth` | Per-user OAuth refresh token (the existing path). |
| `service_account` | Platform service account added as Viewer/User on the resource. |
| `mcc_link` | Platform manager-account (MCC) / account link request (Ads, Merchant Center — later slices). |

Existing rows stay on `oauth`. No live connection is migrated.

## Platform settings

One new key in the encrypted `platform_settings` store, allowlisted in
`backend/src/routes/settings.js`:

- `GOOGLE_SERVICE_ACCOUNT_JSON` — the full service-account key file contents
  (paste once into Settings). `GOOGLE_ADS_MCC_ID` already exists for the
  MCC-link slices.

`loadSettingsFromDb()` copies every `platform_settings` row into
`process.env` on boot, so no extra wiring is needed for the new key.

## The helper (the key design move)

`backend/src/services/googleAuth.js` is the **only** place that touches the
platform-level Google credentials. The connectors call into it; today it
reads the service account from `process.env`. If/when the platform ever
becomes multi-tenant, this one function changes (look up by tenant) and
nothing else does.

It mints the service-account access token with a signed JWT using Node's
built-in `crypto` — deliberately **dependency-free**, matching the existing
raw-`axios` Google OAuth code rather than pulling in `google-auth-library`.
Tokens are cached per scope-set for their hour-long lifetime.

```js
const { getPlatformGoogleAccessToken, getServiceAccountEmail, getPlatformAdsMccId } = require('./googleAuth');
const token = await getPlatformGoogleAccessToken(['https://www.googleapis.com/auth/analytics.readonly']);
```

## Connector dispatch

In `backend/src/connectors/google.js`, GA4 reads resolve a bearer token via:

```js
async function ga4AccessToken(credentials, authMode) {
  if (authMode === 'service_account' || authMode === 'mcc_link') {
    return getPlatformGoogleAccessToken([GA4_SCOPE]);   // platform service account
  }
  const creds = await getValidToken(credentials);       // existing OAuth path, unchanged
  return creds.access_token;
}
```

`authMode` is threaded from `connector.auth_mode` through the params object at
every GA4 call site (`dataCollector.js`, `salesTraffic.js`, `chat.js`). The
OAuth path is byte-for-byte unchanged when `auth_mode = 'oauth'`.

## Setting up a GA4 service-account connector

Until the two-mode modal lands (slice 5), set it up via the API:

1. Paste the service-account key file into **Settings → `GOOGLE_SERVICE_ACCOUNT_JSON`**.
2. Add the service-account email (shown in the connector's **Diagnose**
   output) as a **Viewer** on the client's GA4 property.
3. Create the connector in service-account mode:
   `POST /api/connectors/client/:clientId` with `{ "connector_type": "ga4", "auth_mode": "service_account" }`
   (or switch an existing one: `PUT /api/connectors/:id/auth-mode` with `{ "auth_mode": "service_account" }`).
4. List properties (`GET /api/connectors/:id/accounts`) and save the chosen
   one (`PUT /api/connectors/:id/config`).
5. **Diagnose** runs a live `runReport`. A `403` means the email isn't yet a
   Viewer on the property — the diagnostic spells out which email to add.

## Remaining slices

2. Google Ads MCC link request
3. Search Console service-account auth (reuses the helper)
4. Merchant Center account link
5. UI — two-mode modal across all four Google connectors (copyable
   service-account email, "pending acceptance" state for link requests)

## Out of scope (deferred)

- Multi-tenant agency model — single-instance for now; the helper is the only
  thing futureproofed.
- Migrating existing OAuth connections — they stay on OAuth.
