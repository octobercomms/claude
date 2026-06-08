import { authenticate } from "../shopify.server";
import { forwardWebhook } from "../utils/platform.server";
import prisma from "../db.server";

// Topics this route is subscribed to (see shopify.app.toml). Kept here for
// reference and so the handler can branch if topic-specific logic is needed.
export const HANDLED_TOPICS = [
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "ORDERS_CANCELLED",
  "ORDERS_FULFILLED",
  "REFUNDS_CREATE",
  "CUSTOMERS_CREATE",
  "CUSTOMERS_UPDATE",
  "PRODUCTS_CREATE",
  "PRODUCTS_UPDATE",
  "PRODUCTS_DELETE",
  "INVENTORY_LEVELS_UPDATE",
  "THEMES_PUBLISH",
  "CHECKOUTS_CREATE",
];

export const action = async ({ request }) => {
  // authenticate.webhook verifies the X-Shopify-Hmac-Sha256 signature against
  // the app secret and rejects (401) unverified requests before we get here.
  const { topic, shop, payload, apiVersion } =
    await authenticate.webhook(request);

  try {
    await forwardWebhook({ shop, topic, apiVersion, payload });

    // Best-effort local bookkeeping for the embedded admin's sync counters.
    await prisma.storePairing
      .update({
        where: { shop },
        data: {
          lastSyncAt: new Date(),
          eventsThisWeek: { increment: 1 },
        },
      })
      .catch(() => {
        // No pairing row yet (store not paired) — nothing to update.
      });
  } catch (error) {
    // Log but still return 200 so Shopify doesn't enter aggressive retries;
    // the platform handles its own durable retry/queue for forwarded events.
    console.error(`Failed to forward webhook ${topic} for ${shop}:`, error);
  }

  return new Response(null, { status: 200 });
};
