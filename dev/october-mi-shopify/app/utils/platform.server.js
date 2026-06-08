import crypto from "node:crypto";

const PLATFORM_BASE_URL =
  process.env.OMI_PLATFORM_BASE_URL || "https://platform.octobercomms.com";
const FORWARD_SECRET = process.env.OMI_FORWARD_SECRET || "";

export const INSTALL_ENDPOINT = "/api/shopify-app/install";
export const WEBHOOK_ENDPOINT = "/api/shopify-app/webhook";

/**
 * Sign a JSON-serialisable body with the shared forwarding secret so the
 * October MI platform can verify the request originated from this app.
 * Returns the canonical JSON string and its hex HMAC-SHA256 signature.
 */
export function signPayload(payload) {
  const body = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha256", FORWARD_SECRET)
    .update(body, "utf8")
    .digest("hex");
  return { body, signature };
}

/**
 * POST a signed, shop-identified payload to a platform endpoint.
 * Throws on a non-2xx response so callers can decide how to react
 * (webhooks should still 200 to Shopify to avoid retries storms).
 */
export async function postToPlatform(endpoint, payload, { shop } = {}) {
  const { body, signature } = signPayload(payload);

  const res = await fetch(`${PLATFORM_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OMI-Source": "shopify-app",
      "X-OMI-Signature": signature,
      ...(shop ? { "X-OMI-Shop-Domain": shop } : {}),
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Platform ${endpoint} responded ${res.status}: ${text.slice(0, 500)}`,
    );
  }

  // Some endpoints return JSON, some return an empty 200/204.
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return {};
}

/**
 * Forward a verified Shopify webhook to the platform. Wraps the raw Shopify
 * payload in a normalised envelope identifying the shop, topic and API version.
 */
export async function forwardWebhook({ shop, topic, apiVersion, payload }) {
  const envelope = {
    source: "shopify-app",
    shop_domain: shop,
    topic,
    api_version: apiVersion,
    received_at: new Date().toISOString(),
    payload,
  };
  return postToPlatform(WEBHOOK_ENDPOINT, envelope, { shop });
}

/**
 * Submit a pairing request when a merchant enters their October MI token.
 * The platform validates the token, links the shop to the client account,
 * and returns the resolved client id / name.
 */
export async function submitPairing({ shop, accessToken, pairingToken }) {
  return postToPlatform(
    INSTALL_ENDPOINT,
    {
      source: "shopify-app",
      shop_domain: shop,
      access_token: accessToken,
      pairing_token: pairingToken,
    },
    { shop },
  );
}

export { PLATFORM_BASE_URL };
