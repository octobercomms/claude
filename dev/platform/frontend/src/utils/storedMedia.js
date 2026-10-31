// Is a piece of media kept on the platform, or still on the provider's CDN?
//
// Generated media used to be recorded as the URL the provider returned.
// Those links expire within hours or days, so the row outlived the file: ad
// creative exported with gaps, and avatar reels played as blank video whose
// "open in new tab" answered access denied.
//
// Anything generated from 31 October 2026 is fetched and stored under the
// client's own upload folder, which is served from /api/brand/file/…. A
// screen offers to keep the older ones, and that offer has to disappear once
// there is nothing left to keep, so the test is in one place rather than
// repeated as an inline `startsWith` on each panel.

// Served by this platform, from a path only this platform answers.
//
// The /api/approvals/ form is the same file re-pointed at a public approval
// token, which the client-facing view does when it rewrites local paths. It
// counts as kept: there is nothing to fetch and nothing to expire.
const OURS = /^\/api\/(brand|approvals|edit|visualise)\//;

export function isStored(url) {
  return OURS.test(String(url || ''));
}

/**
 * The items still pointing at a provider, so a panel can say how many there
 * are and offer to keep them.
 *
 * `urlOf` reads the URL off each item, because the field is named differently
 * per table: ad creative calls it `url`, a reel calls it `video_url`.
 *
 * An item with no URL at all is **not** unkept. A render still in progress
 * has nothing to keep yet, and counting it would offer to save a file that
 * does not exist.
 */
export function unstoredItems(items, urlOf = (i) => i.url) {
  return (items || []).filter((item) => {
    const url = urlOf(item);
    if (!url) return false;
    return !isStored(url);
  });
}
