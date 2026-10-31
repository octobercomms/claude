// An ad shown the way the client will see it in the wild.
//
// The approval page used to render a row of 110px thumbnails above the copy.
// A client approving a square at that size has no idea what the ad looks
// like in a feed, which is where approvals come unstuck: the headline that
// read fine in a card gets truncated at 40 characters on a phone, and the
// crop that looked deliberate loses its subject to a 4:5 frame.
//
// Daniel: "is it possible to make the ads look like the platform they will be
// placed on? and click chips along the top to toggle between different
// platforms?"
//
// What this is NOT: a pixel-accurate clone of Instagram. Chasing that would
// be a maintenance liability (the real UI changes every few months) and a
// false promise, because the platforms render differently by device anyway.
// What it IS: the frame, the proportions and the truncation rules, which are
// the three things that actually change a decision. Each preview says what
// it is approximating so nobody mistakes it for a screenshot.

import React, { useState } from 'react';

// Truncation points, which are the part worth being accurate about. These are
// the lengths at which each surface clips on a phone, where most of the
// impressions are.
export const SURFACES = {
  instagram_feed: {
    label: 'Instagram feed',
    ratio: '1 / 1',
    bodyLimit: 125,          // before "… more"
    headlineLimit: null,     // the feed has no separate headline
    note: 'Square in the feed. The caption clips at about 125 characters.',
  },
  instagram_story: {
    label: 'Instagram story',
    ratio: '9 / 16',
    bodyLimit: 0,            // stories carry no body copy
    headlineLimit: 40,
    note: 'Full screen. Only the headline and the button are readable at a glance.',
  },
  facebook_feed: {
    label: 'Facebook feed',
    ratio: '4 / 5',
    bodyLimit: 125,
    headlineLimit: 40,
    note: 'The headline sits under the image and clips at about 40 characters.',
  },
};

export function clip(text, limit) {
  const s = String(text || '');
  if (limit == null || s.length <= limit) return { text: s, clipped: false };
  return { text: s.slice(0, limit).trimEnd(), clipped: true };
}

// Exported so the social preview beside this one shows media the same way.
export function Media({ image, ratio }) {
  if (!image) {
    return (
      <div className="adprev-media adprev-media--empty" style={{ aspectRatio: ratio }}>
        <span className="body-xs">Nothing rendered for this size yet</span>
      </div>
    );
  }
  if ((image.media_type || 'image') === 'video') {
    return <video className="adprev-media" style={{ aspectRatio: ratio }} src={image.url} controls playsInline />;
  }
  return <img className="adprev-media" style={{ aspectRatio: ratio }} src={image.url} alt="" />;
}

// Pick the rendered asset closest to the surface's shape, so switching to
// Stories shows the 9:16 if one exists rather than letterboxing the square.
export function bestImageFor(images, surfaceKey) {
  const list = images || [];
  if (!list.length) return null;
  const want = { instagram_feed: '1:1', instagram_story: '9:16', facebook_feed: '4:5' }[surfaceKey];
  return list.find(i => i.aspect_ratio === want) || list[0];
}

export default function AdPlatformPreview({ creative, brandName, onEnlarge }) {
  const [surface, setSurface] = useState('instagram_feed');
  const s = SURFACES[surface];
  const image = bestImageFor(creative.images, surface);
  const body = clip(creative.body, s.bodyLimit);
  const headline = clip(creative.headline, s.headlineLimit);

  return (
    <div className="adprev">
      <div className="adprev-chips" role="tablist" aria-label="Where this ad will run">
        {Object.entries(SURFACES).map(([key, def]) => (
          <button key={key} type="button" role="tab" aria-selected={surface === key}
            className={`adprev-chip${surface === key ? ' is-active' : ''}`}
            onClick={() => setSurface(key)}>{def.label}</button>
        ))}
      </div>

      <div className={`adprev-frame adprev-frame--${surface}`}>
        <div className="adprev-bar">
          <span className="adprev-avatar" aria-hidden="true" />
          <span className="adprev-handle">{brandName || 'Your brand'}</span>
          <span className="adprev-sponsored">Sponsored</span>
        </div>

        {/* Clicking the media enlarges it. The frame is for judging the ad in
            context; the lightbox is for judging the image itself, and both
            questions get asked. */}
        <button type="button" className="adprev-mediabtn"
          onClick={() => image && onEnlarge?.(image)}
          title={image ? 'Click to enlarge' : undefined}
          disabled={!image}>
          <Media image={image} ratio={s.ratio} />
        </button>

        {surface === 'instagram_story' ? (
          <div className="adprev-storyfoot">
            {headline.text && <div className="adprev-storyhead">{headline.text}{headline.clipped && '…'}</div>}
            <div className="adprev-cta">{creative.cta || 'Learn more'} ›</div>
          </div>
        ) : (
          <div className="adprev-foot">
            {s.headlineLimit != null && headline.text && (
              <div className="adprev-headline">{headline.text}{headline.clipped && '…'}</div>
            )}
            {s.bodyLimit > 0 && body.text && (
              <p className="adprev-body">
                {body.text}{body.clipped && <span className="adprev-more">… more</span>}
              </p>
            )}
            <div className="adprev-cta">{creative.cta || 'Learn more'}</div>
          </div>
        )}
      </div>

      <div className="adprev-note">
        {s.note}
        {(headline.clipped || body.clipped) && (
          <strong> Something is being cut off here.</strong>
        )}
      </div>
    </div>
  );
}
