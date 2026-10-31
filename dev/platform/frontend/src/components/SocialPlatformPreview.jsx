// An organic post shown the way the client will see it in the wild.
//
// The approval page rendered social posts flat: a row of thumbnails, the
// hook as a heading, then the whole caption. A client signing that off
// cannot tell what shows before "more", which is the only part of a
// caption most people read. AdPlatformPreview did this for Paid off the
// same review note; this is its organic sibling, sharing its chip row,
// frame CSS and clipping helper.
//
// What this is NOT: a pixel clone of Instagram. The real UI changes every
// few months and renders differently per device. What it IS: the frame,
// the proportions and the truncation point, which are what change a
// decision. Each surface says what it is approximating.
//
// On truncation points. The 125-character Instagram and Facebook feed
// figure is consistent across every source and is the one AdPlatformPreview
// already uses. The reel, TikTok and LinkedIn numbers come from vendor
// guides rather than platform documentation, so they are set a little
// short: a preview that warns slightly early is useful, one that warns
// late is worse than none.

import React, { useState } from 'react';
import { clip, Media } from './AdPlatformPreview';

export const SOCIAL_SURFACES = {
  instagram_feed: {
    label: 'Instagram feed',
    ratio: '1 / 1',
    limit: 125,
    overlay: false,
    note: 'Square in the feed. The caption clips at about 125 characters, hook and hashtags included.',
  },
  instagram_reel: {
    label: 'Instagram reel',
    ratio: '9 / 16',
    limit: 55,
    overlay: true,
    note: 'Full screen, caption over the video. Roughly the first 55 characters are readable.',
  },
  tiktok: {
    label: 'TikTok',
    ratio: '9 / 16',
    limit: 65,
    overlay: true,
    note: 'Full screen, one line of caption over the video before "more".',
  },
  linkedin_feed: {
    label: 'LinkedIn',
    ratio: '1 / 1',
    limit: 200,
    overlay: false,
    note: 'About 200 characters before "see more" on a phone; more on a desktop.',
  },
  facebook_feed: {
    label: 'Facebook feed',
    ratio: '4 / 5',
    limit: 125,
    overlay: false,
    note: 'Taller in the feed. The caption clips at about 125 characters.',
  },
};

// The platform the post was written for, so the chips open on the surface
// it is actually going to run on.
export function defaultSurfaceFor(post) {
  const platform = String(post?.platform || '').toLowerCase();
  const kind = String(post?.kind || '').toLowerCase();
  if (platform === 'tiktok') return 'tiktok';
  if (platform === 'linkedin') return 'linkedin_feed';
  if (platform === 'facebook') return 'facebook_feed';
  if (platform === 'instagram') return kind === 'reel' ? 'instagram_reel' : 'instagram_feed';
  return 'instagram_feed';
}

// What the platform actually truncates is one block of text, not three
// fields. The hook is the caption's first line and the hashtags are its
// tail, so the preview clips what the client will really see cut.
export function captionText(post) {
  const parts = [];
  const hook = String(post?.hook || '').trim();
  const caption = String(post?.caption || '').trim();
  if (hook) parts.push(hook);
  if (caption && caption !== hook) parts.push(caption);
  const tags = (post?.hashtags || []).map(h => `#${String(h).replace(/^#/, '')}`).join(' ');
  if (tags) parts.push(tags);
  return parts.join('\n\n');
}

// Whatever was produced for this post, newest-looking first: a video if one
// exists for a 9:16 surface, otherwise an image.
export function bestMediaFor(post, surfaceKey) {
  const media = post?.media || [];
  const videos = media.filter(m => m.kind === 'video' || m.kind === 'motion');
  const images = media.filter(m => m.kind === 'image');
  const urls = (post?.image_urls || []).map(u => ({ url: u, media_type: 'image' }));
  const tall = SOCIAL_SURFACES[surfaceKey]?.ratio === '9 / 16';
  if (tall && videos.length) return { url: videos[0].url, media_type: 'video', id: videos[0].id };
  const still = images[0] ? { url: images[0].url, media_type: 'image', id: images[0].id } : urls[0];
  if (still) return still;
  if (videos.length) return { url: videos[0].url, media_type: 'video', id: videos[0].id };
  return null;
}

export default function SocialPlatformPreview({ post, brandName, onEnlarge }) {
  const [surface, setSurface] = useState(() => defaultSurfaceFor(post));
  const s = SOCIAL_SURFACES[surface];
  const image = bestMediaFor(post, surface);
  const body = clip(captionText(post), s.limit);

  return (
    <div className="adprev">
      <div className="adprev-chips" role="tablist" aria-label="Where this post will run">
        {Object.entries(SOCIAL_SURFACES).map(([key, def]) => (
          <button key={key} type="button" role="tab" aria-selected={surface === key}
            className={`adprev-chip${surface === key ? ' is-active' : ''}`}
            onClick={() => setSurface(key)}>{def.label}</button>
        ))}
      </div>

      <div className={`adprev-frame adprev-frame--${surface}`}>
        <div className="adprev-bar">
          <span className="adprev-avatar" aria-hidden="true" />
          <span className="adprev-handle">{brandName || 'Your brand'}</span>
        </div>

        <button type="button" className="adprev-mediabtn"
          onClick={() => image && onEnlarge?.(image)}
          title={image ? 'Click to enlarge' : undefined}
          disabled={!image}>
          <Media image={image} ratio={s.ratio} />
        </button>

        {s.overlay ? (
          <div className="adprev-storyfoot">
            <div className="adprev-storyhead">{body.text}{body.clipped && '…'}</div>
          </div>
        ) : (
          <div className="adprev-foot">
            <p className="adprev-body">
              {body.text}{body.clipped && <span className="adprev-more">… more</span>}
            </p>
          </div>
        )}
      </div>

      <div className="adprev-note">
        {s.note}
        {body.clipped && <strong> Something is being cut off here.</strong>}
      </div>
    </div>
  );
}
