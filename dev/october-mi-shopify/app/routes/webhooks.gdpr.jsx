import { authenticate } from "../shopify.server";
import { forwardWebhook } from "../utils/platform.server";
import prisma from "../db.server";

/**
 * Mandatory GDPR / compliance webhooks. Shopify App Store review requires all
 * three to be registered and to respond 200 to a valid (HMAC-verified)
 * request and 401 to an invalid one.
 *
 * authenticate.webhook performs the HMAC verification and throws a 401
 * Response for unverified requests, satisfying the review requirement.
 *
 *  - customers/data_request: a customer asked for their data. We hold no
 *    customer PII at rest in this app (we forward, we don't store), so we relay
 *    the request to the platform, which owns any retained data and fulfils it.
 *  - customers/redact: erase a specific customer's data. Relayed to the
 *    platform to purge any retained records for that customer.
 *  - shop/redact: 48h after uninstall, erase the shop's data. We delete all
 *    local rows for the shop and tell the platform to do the same.
 */
export const action = async ({ request }) => {
  const { topic, shop, payload, apiVersion } =
    await authenticate.webhook(request);

  // Relay the compliance request to the platform, which is the system of
  // record for any retained data and is responsible for fulfilling it.
  await forwardWebhook({ shop, topic, apiVersion, payload }).catch((error) => {
    console.error(
      `Failed to relay GDPR webhook ${topic} for ${shop}:`,
      error,
    );
  });

  if (topic === "SHOP_REDACT") {
    // Remove every local trace of this shop: sessions and the pairing record.
    await prisma.session.deleteMany({ where: { shop } }).catch(() => {});
    await prisma.storePairing.deleteMany({ where: { shop } }).catch(() => {});
  }

  // customers/data_request and customers/redact: this app stores no customer
  // PII at rest, so there is nothing local to action beyond the relay above.

  return new Response(null, { status: 200 });
};
