import crypto from "node:crypto";

/**
 * Verify the X-Shopify-Hmac-Sha256 header against the raw request body using
 * the app's API secret. Shopify signs the *raw* bytes with HMAC-SHA256 and
 * base64-encodes the digest.
 *
 * The high-level `authenticate.webhook(request)` helper from
 * @shopify/shopify-app-remix already performs this check for the webhook
 * routes in this app. This util is kept as a standalone, dependency-free
 * implementation so the verification logic is auditable in one place and can
 * guard any custom/raw endpoint (e.g. a proxy route) that bypasses the helper.
 *
 * @param {string} rawBody - the exact, unparsed request body
 * @param {string} hmacHeader - value of the X-Shopify-Hmac-Sha256 header
 * @param {string} secret - the Shopify app API secret
 * @returns {boolean} true when the signature is valid
 */
export function verifyShopifyHmac(rawBody, hmacHeader, secret) {
  if (!rawBody || !hmacHeader || !secret) {
    return false;
  }

  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(hmacHeader, "utf8");

  // Length check first — timingSafeEqual throws on length mismatch.
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * Convenience guard for a raw Request. Reads the HMAC header and verifies it
 * against the provided raw body. Returns a boolean; callers decide the
 * response (typically 401 on failure).
 */
export function verifyWebhookRequest(request, rawBody, secret) {
  const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256");
  return verifyShopifyHmac(rawBody, hmacHeader, secret);
}
