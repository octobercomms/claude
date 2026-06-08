import { authenticate } from "../shopify.server";
import { forwardWebhook } from "../utils/platform.server";
import prisma from "../db.server";

export const action = async ({ request }) => {
  const { shop, session, topic, apiVersion, payload } =
    await authenticate.webhook(request);

  // Let the platform know the app was removed so it can pause this shop's sync.
  await forwardWebhook({ shop, topic, apiVersion, payload }).catch((error) => {
    console.error(`Failed to notify platform of uninstall for ${shop}:`, error);
  });

  // Clean up local session rows. Webhooks may fire after the offline session
  // is already gone, so guard the session-scoped delete.
  if (session) {
    await prisma.session.deleteMany({ where: { shop } });
  }

  return new Response(null, { status: 200 });
};
