import { isSignedIn, json } from '../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  return json({
    signedIn: await isSignedIn(request, env),
    configured: Boolean(env.TEAM_PASSWORD && env.AUTH_SECRET),
    brand: env.BRAND_NAME || 'Content Review',
  });
}
