/**
 * The link for a TikTok sound, worked out rather than remembered.
 *
 * Three things are stored against a sound and only one of them opens:
 *
 *   playUrl     TikTok's raw audio CDN link — signed, referrer-checked and
 *               short-lived, so following it answers "access denied"
 *   /music/ page  a real page that keeps working, and where you go to see
 *               what is using the sound
 *   title + author  what you type into search to attach it to a post
 *
 * The ingest was corrected to store the page link, which fixed every sound
 * fetched afterwards and nothing fetched before. Snapshots are JSONB blobs
 * written once, so the bad links stayed, and "one of them opened, the others
 * are all access denied" is exactly what a mix of old and new rows looks
 * like.
 *
 * The page link is a pure function of the id and the title, both of which
 * every row already has. So it is derived on the way out instead of trusted
 * on the way in, and every snapshot ever taken reads correctly with no
 * backfill. The rule this is an instance of: a value you can compute from
 * what you already hold should not also be stored, because then it can be
 * wrong.
 */

/** A stored link is only believed if it is a music page. Anything else —
 *  an audio CDN link, an empty string, a value from an older shape — is
 *  replaced by one built from the id. */
export function isMusicPage(url) {
  return typeof url === 'string' && /^https:\/\/(www\.)?tiktok\.com\/music\//.test(url);
}

/** The music page for a sound. Null when there is no id to build one from,
 *  because a link that 404s is worse than no link at all. */
export function musicPageUrl(id, title) {
  if (id === null || id === undefined || String(id).trim() === '') return null;
  const slug = String(title ?? 'sound').trim().replace(/\s+/g, '-').replace(/[/?#]/g, '') || 'sound';
  return `https://www.tiktok.com/music/${encodeURIComponent(slug)}-${String(id).trim()}`;
}

/** What to type into TikTok or Instagram search to find the sound. The
 *  link shows you what is using it; this is what actually attaches it to
 *  a post, and it is the step the chips alone left you to work out. */
export function searchTerm(sound) {
  return [sound?.title, sound?.author].filter(Boolean).join(' ').trim() || null;
}

/**
 * One stored sound, made safe to render.
 *
 * Keeps the audio link apart from the page link, because the two are not
 * interchangeable: one may play inline, the other always opens.
 */
export function normaliseSound(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id ?? raw.musicId ?? null;
  const title = raw.title || raw.musicName || null;
  const derived = musicPageUrl(id, title);
  return {
    ...raw,
    id,
    title,
    author: raw.author || raw.musicAuthor || null,
    // The stored link wins only when it is already a music page.
    tiktok_url: isMusicPage(raw.tiktok_url) ? raw.tiktok_url : derived,
    audio_url: raw.audio_url || raw.playUrl || null,
    search_term: raw.search_term || searchTerm({ title, author: raw.author || raw.musicAuthor }),
  };
}

export function normaliseSounds(list) {
  return (Array.isArray(list) ? list : []).map(normaliseSound).filter(Boolean);
}
