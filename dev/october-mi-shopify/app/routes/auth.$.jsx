import { authenticate } from "../shopify.server";

// Catch-all for the OAuth flow: /auth/login, /auth/callback, etc.
// `authenticate.admin` drives the install + token exchange and redirects
// back into the embedded app on success.
export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};
