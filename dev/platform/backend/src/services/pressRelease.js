// Press-release outreach. Modelled on the pattern Daniel actually uses
// in Mautic today: short, personal, angle-led emails that link to the
// full release on downloadfor.press rather than embedding it.
//
// The flow:
//   1. fetchAndParse(url)       — pull the release from downloadfor.press
//                                 (WordPress + Elementor structure), strip
//                                 the noise, and extract title + body +
//                                 hero image + boilerplate.
//   2. generatePitch(...)       — Claude writes a 3-5 sentence personal
//                                 email per journalist. Picks ONE angle
//                                 from the release that lines up with
//                                 their beat. Pointed, not blast-sprayed.
//   3. generateFollowUps(...)   — three chase emails on a 5/10/16-day
//                                 cadence, each with a distinct angle so
//                                 the journalist doesn't feel hounded.
//   4. buildEmailHtml(...)      — wraps the pitch in a clean, plain-
//                                 looking HTML shell with the release
//                                 link, AM sign-off, and optional hero.

const axios = require('axios');
const cheerio = require('cheerio');
const pool = require('../db');
const claude = require('./claude');
const { assertPublicHttpUrl } = require('../utils/urlSafety');

// Press personalisation runs through callClaude so it's model-routable in
// Settings → AI models and cost-logged. It DEFAULTS to Opus (see aiModels
// FEATURE_DEFAULTS) — the pitch and follow-ups are the writing that has to be
// genuinely intelligent and personal, so they get the best model unless the AM
// deliberately routes them down for cost.
const PRESS_SYSTEM = 'You are a senior PR consultant at October Communications writing personal, high-quality journalist pitches. Direct, human, never marketing-speak. Match the spelling and date conventions of the release you are given.';

// Decide whether a release is written in US or British English so the generated
// pitch mirrors it — Daniel works across both markets, and a US release must not
// come back with British spelling or "8 November" dates (his #3). Heuristic on
// the release's own dateline + text; defaults to British for October's base.
function detectLocale(release) {
  const text = `${release.dateline || ''} ${(release.body_html || release.summary || '').replace(/<[^>]+>/g, ' ')}`.toLowerCase();
  const usHits = (text.match(/\b(color|honor|favor|organiz|realiz|center|theater|traveler|defense|\d{1,2}\/\d{1,2}\/\d{2,4}|[a-z]+ \d{1,2}, \d{4})\b/g) || []).length
    + (/\b(new york|los angeles|chicago|san francisco|miami|boston|washington|texas|california|usa|u\.s\.)\b/.test(text) ? 2 : 0);
  const ukHits = (text.match(/\b(colour|honour|favour|organis|realis|centre|theatre|traveller|defence|\d{1,2} (january|february|march|april|may|june|july|august|september|october|november|december))\b/g) || []).length
    + (/\b(london|manchester|edinburgh|uk|united kingdom|britain)\b/.test(text) ? 2 : 0);
  return usHits > ukHits ? 'US' : 'UK';
}

// The instruction we hand Claude so its writing matches the release's market.
function localeGuide(release) {
  return detectLocale(release) === 'US'
    ? 'Write in US English — American spelling (color, organize, center) and US date format (e.g. "November 8, 2026" / month-day-year). Mirror the release; never convert its spelling or dates to British.'
    : 'Write in British English — British spelling (colour, organise, centre) and UK date format (e.g. "8 November 2026" / day-month-year). Mirror the release; never convert its spelling or dates to American.';
}

// Fetch a downloadfor.press URL (or any public press page) and pull out
// the structured content. downloadfor.press is WordPress + Elementor so
// we strip the Elementor header / footer / lead-capture form first,
// then take what's left of the single-post Elementor block.
//
// SSRF-hardened: the AM-supplied URL is gated by assertPublicHttpUrl
// (no localhost / private / link-local IPs, no in-URL credentials, DNS
// resolved before fetching) and redirects are disabled — otherwise a
// public-looking host can 302-redirect us to 169.254.169.254 and still
// look fine to the pre-fetch check.
async function fetchAndParse(url) {
  await assertPublicHttpUrl(url);
  const { data: html } = await axios.get(url, {
    timeout: 15000,
    maxRedirects: 0,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OctoberPlatform/1.0; +https://platform.octobercomms.com)' },
    validateStatus: s => s >= 200 && s < 300,
  });
  const $ = cheerio.load(html);

  // Strip the Elementor header + footer + sidebar form (those wrap the
  // page chrome and the "Download media assets" capture form which
  // we'd otherwise pull into the body).
  $('[data-elementor-type="header"]').remove();
  $('[data-elementor-type="footer"]').remove();
  $('form, .elementor-form, .gform_wrapper, [class*="form-fields"]').remove();
  $('script, style, noscript, iframe').remove();

  // downloadfor.press (Elementor) emits the SAME content twice — a desktop copy
  // and a mobile copy — using responsive-visibility classes, so a naive scrape
  // embeds the whole release twice (Daniel's #9). Keep the desktop copy and drop
  // anything Elementor hides on desktop (i.e. the mobile/tablet duplicates).
  $('.elementor-hidden-desktop, .elementor-hidden-widescreen, .elementor-hidden-laptop').remove();

  // og: tags are reliable; use them as the source of truth for title +
  // hero image. Fall back to the H1 + first img on the page.
  const ogTitle = ($('meta[property="og:title"]').attr('content') || '').replace(/\s*\|\s*Download for Press\s*$/i, '').replace(/^Press Release:\s*/i, '').trim();
  const ogImage = $('meta[property="og:image"]').attr('content') || null;
  const ogDesc = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || '';

  const h1Text = $('h1').first().text().trim();
  const title = h1Text || ogTitle;

  // Body: the Elementor "single" block holds the post content. Anything
  // outside it (newsroom links, related posts) is page chrome.
  let bodyEl = $('[data-elementor-type="single"]').first();
  if (!bodyEl.length) bodyEl = $('main').first();
  if (!bodyEl.length) bodyEl = $('article').first();
  if (!bodyEl.length) bodyEl = $('body');

  // Collect images observed in the body (deduped, absolutised) so the
  // AM can pick a hero or attach a couple inline. The og:image comes
  // first since the publisher chose it as the canonical hero.
  // Reject anything that isn't https — the URLs end up in <img src>
  // tags in outbound journalist emails, and we don't want to embed
  // links to private/internal hosts (e.g. http://169.254.169.254/...)
  // that a malicious press page might have included.
  const images = [];
  const seen = new Set();
  const pushImg = (src, alt) => {
    const abs = absoluteUrl(src, url);
    if (!abs || seen.has(abs)) return;
    if (!/^https:\/\//i.test(abs)) return;                              // https only
    if (/logo|icon|sprite|placeholder|cubisly/i.test(abs)) return;     // skip chrome
    seen.add(abs);
    images.push({ src: abs, alt: alt || '' });
  };
  if (ogImage) pushImg(ogImage, '');
  bodyEl.find('img').each((_, el) => pushImg($(el).attr('src'), $(el).attr('alt')));

  // Extract press-contact email + boilerplate by scanning text near the
  // "Notes to editors" / "About X" / "press@..." anchors. These pages
  // don't have semantic class names so we work by text matching.
  const bodyText = bodyEl.text();
  const emailMatch = bodyText.match(/press@[\w.-]+\.[a-z]{2,}/i);
  const pressEmail = emailMatch ? emailMatch[0] : null;

  // Split body into [main, boilerplate]. Boilerplate = everything from
  // the first "Notes to editors" / "About <brand>" / "About <person>"
  // heading onward.
  const bodyHtml = cleanBodyHtml(bodyEl.html() || '', url);
  const split = splitOnBoilerplate(bodyHtml);

  return {
    title,
    summary: (ogDesc || split.body.replace(/<[^>]+>/g, ' ').slice(0, 280)).trim(),
    body_html: split.body,
    boilerplate: split.boilerplate || null,
    contact_block: pressEmail ? `Press contact: ${pressEmail}` : null,
    hero_image: ogImage || (images[0]?.src ?? null),
    images,
    dateline: extractDateline($, bodyEl) || null,
    fetched_at: new Date().toISOString(),
    source_url: url,
  };
}

function absoluteUrl(src, base) {
  if (!src) return null;
  try { return new URL(src, base).toString(); }
  catch { return src; }
}

function extractDateline($, bodyEl) {
  // Loose heuristic: first short string near the H1 that looks like a
  // date or month-year. Otherwise the og:article:published_time.
  const monthRe = /(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{0,4}/i;
  const candidates = [];
  bodyEl.find('h1, h2, p, span, time, .elementor-heading-title').slice(0, 15).each((_, el) => {
    const t = $(el).text().trim();
    if (t && t.length < 80 && monthRe.test(t)) candidates.push(t);
  });
  if (candidates.length) return candidates[0];
  const published = $('meta[property="article:published_time"]').attr('content');
  if (published) try {
    const d = new Date(published);
    return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  } catch {}
  return null;
}

// Keep paragraphs / headings / lists / bold / italics / images / links.
// Drop everything else. The released body is mostly for the AM to skim
// in-app — Claude reads the plain text version.
function cleanBodyHtml(html, baseUrl) {
  const $ = cheerio.load(`<root>${html}</root>`);
  const allowed = new Set(['p', 'br', 'strong', 'em', 'b', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'img', 'blockquote', 'figure', 'figcaption']);
  $('root *').each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    if (!allowed.has(tag)) {
      $(el).replaceWith($(el).contents());
    } else {
      const keep = tag === 'a' ? ['href'] : tag === 'img' ? ['src', 'alt'] : [];
      for (const attr of Object.keys(el.attribs || {})) {
        if (!keep.includes(attr)) $(el).removeAttr(attr);
      }
      if (tag === 'a') {
        const href = $(el).attr('href');
        if (href) $(el).attr('href', absoluteUrl(href, baseUrl));
      }
      if (tag === 'img') {
        const src = $(el).attr('src');
        if (src) $(el).attr('src', absoluteUrl(src, baseUrl));
      }
    }
  });
  // Drop empty paragraphs left behind after stripping wrappers.
  $('root p').each((_, el) => { if (!$(el).text().trim() && !$(el).find('img').length) $(el).remove(); });
  return $('root').html() || '';
}

// Boilerplate splitter: find the first "Notes to editors" / "About …"
// heading and treat everything from that point as the boilerplate
// section. The main body is everything before.
function splitOnBoilerplate(html) {
  const re = /<(h[1-6])[^>]*>\s*(Notes to editors|About\s+[A-Z])/i;
  const m = html.match(re);
  if (!m) return { body: html, boilerplate: null };
  const idx = m.index;
  return {
    body: html.slice(0, idx).trim(),
    boilerplate: html.slice(idx).trim(),
  };
}

// HTML shell for the personal pitch email. When `embedFull` is true
// (the default, set per-release on the campaign) we render the full
// release body — title, paragraphs, inline images — under the personal
// pitch, so the journalist can read the whole thing without leaving
// the email. When false, we fall back to the original short shape
// (pitch + link + hero).
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Render an AM-configured signature/footer block. Daniel signs off with a logo
// image / gif and a small table, so this is treated as trusted HTML (it's the
// AM's own footer for their own client) — a plain-text footer still works, its
// line breaks are turned into <br>. HTML is detected by a tag heuristic.
function signatureBlock(signature) {
  const sig = String(signature || '').trim();
  if (!sig) return '';
  const looksHtml = /<[a-z][\s\S]*>/i.test(sig);
  const inner = looksHtml ? sig : escapeHtml(sig).replace(/\n/g, '<br>');
  // Capped to the 600px column and marked .oc-sig so the head <style> forces any
  // pasted logo/table down to width (#6 — a wide signature was widening the email).
  return `<div class="oc-sig" style="margin:14px 0 0;max-width:600px;font-size:13px;color:#444;line-height:1.5;overflow:hidden;">${inner}</div>`;
}

// The full release, cleaned for embedding in the email so it mirrors how Daniel
// sends it (a branded card under the personal note), and fixes the scrape
// artefacts he flagged:
//  * a leading heading/hero that just repeats what we render ourselves (#4)
//  * the whole release duplicated by the page's mobile+desktop markup (#9)
//  * "Download media assets" capture chrome we replace with our own button (#8)
//  * runaway image widths (#1) and unstyled captions (#5)
function renderEmbeddedRelease(release) {
  if (!release.body_html) return '';
  let $;
  try { $ = cheerio.load(`<root>${release.body_html}</root>`); }
  catch { return release.body_html; }
  const root = $('root');
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const titleNorm = norm(release.title);
  const heroSrc = release.hero_image;

  // Drop a leading heading that only repeats the release title (#4).
  const firstHeading = root.find('h1,h2,h3').first();
  if (firstHeading.length && titleNorm && norm(firstHeading.text()) === titleNorm) firstHeading.remove();

  // Drop images that repeat the hero we render once ourselves (#4).
  root.find('img').each((_, el) => {
    const src = $(el).attr('src');
    if (heroSrc && src && src === heroSrc) {
      const fig = $(el).closest('figure');
      (fig.length ? fig : $(el)).remove();
    }
  });

  // De-duplicate repeated block-level TEXT across the whole subtree — the page
  // emits the release twice (mobile + desktop) so the same paragraphs recur;
  // remove any block whose text already appeared (#9). Also strip "Download
  // media/hi-res assets" capture chrome (#8).
  const seen = new Set();
  root.find('p,h1,h2,h3,h4,li,figcaption,blockquote').each((_, el) => {
    const t = norm($(el).text());
    if (!t) return;
    if (/download\s+(the\s+)?(media|hi.?res|press)?\s*(assets|images|kit)/.test(t) && t.length < 140) {
      const fig = $(el).closest('figure'); (fig.length ? fig : $(el)).remove(); return;
    }
    if (t.length >= 25) { if (seen.has(t)) { $(el).remove(); return; } seen.add(t); }
  });
  // ...and drop any image whose src already appeared (the duplicated half's
  // images), so a de-duped body doesn't leave doubled pictures behind.
  const seenImg = new Set();
  root.find('img').each((_, el) => {
    const src = $(el).attr('src'); if (!src) return;
    if (seenImg.has(src)) { const fig = $(el).closest('figure'); (fig.length ? fig : $(el)).remove(); return; }
    seenImg.add(src);
  });

  // Constrain every remaining image + style captions (#1, #5).
  root.find('img').each((_, el) => {
    $(el).attr('style', 'display:block;width:100%;max-width:100%;height:auto;border:0;border-radius:4px;margin:0;');
    $(el).removeAttr('width'); $(el).removeAttr('height');
  });
  root.find('figure').each((_, el) => $(el).attr('style', 'margin:0;'));
  root.find('figcaption').each((_, el) => $(el).attr('style', 'font-size:12px;color:#666;line-height:1.4;margin:6px 0 0;text-align:center;'));
  // Drop empty paragraphs left behind after de-duplication.
  root.find('p').each((_, el) => { if (!$(el).text().trim() && !$(el).find('img').length) $(el).remove(); });

  // Lay consecutive image blocks side-by-side, two per row (#8).
  pairAdjacentImages($, root);

  return root.html() || '';
}

// Group runs of adjacent image blocks (a <figure>, a lone <img>, or a <p> that
// only wraps an image) into 2-column tables so images that sit side-by-side on
// the release page don't stack in the email (#8). Single images stay full width.
function pairAdjacentImages($, root) {
  const isImgBlock = (el) => {
    if (!el || el.type !== 'tag') return false;
    const tag = el.tagName;
    if (tag === 'figure' || tag === 'img') return true;
    if (tag === 'p') { const $el = $(el); return $el.find('img').length === 1 && !$el.text().trim(); }
    return false;
  };
  const kids = root.children().toArray();
  for (let i = 0; i < kids.length - 1; i++) {
    const a = kids[i], b = kids[i + 1];
    if (isImgBlock(a) && isImgBlock(b)) {
      const cell = 'valign="top" style="width:50%;vertical-align:top;';
      const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0;border-collapse:collapse;"><tr>`
        + `<td ${cell}padding-right:6px;">${$.html(a)}</td>`
        + `<td ${cell}padding-left:6px;">${$.html(b)}</td>`
        + `</tr></table>`;
      $(a).replaceWith(table);
      $(b).remove();
      i++; // consume b; the next pair starts after it
    }
  }
}

function buildEmailHtml({ release, pitch, sender, recipientName, includeHero = true, embedFull = true, contactId, clientId, campaignId, signature }) {
  const pitchHtml = (pitch || '').split('\n').map(p => p.trim()).filter(Boolean)
    .map(p => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1a1a1a;">${escapeHtml(p)}</p>`)
    .join('');
  const hero = includeHero && release.hero_image
    ? `<div style="margin:0 0 14px;"><img src="${escapeHtml(release.hero_image)}" alt="${escapeHtml(release.title)}" style="display:block;width:100%;max-width:100%;height:auto;border:0;border-radius:3px;" /></div>`
    : '';

  // A single, clear pill call-to-action, opening the release page in a new tab
  // (#4, #5). Mirrors the "Download Hi-Res Images" button on Daniel's own sends.
  const downloadBtn = release.source_url ? `
    <div style="margin:20px 0 4px;">
      <a href="${escapeHtml(release.source_url)}" target="_blank" rel="noopener" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 26px;border-radius:999px;">Download hi-res images &amp; full release &rarr;</a>
    </div>` : '';

  // Sign-off directly under the personal note (#2). Just the full name + company
  // (+ footer) — the standalone first-name line was redundant and came through
  // lower-cased from the username (#3).
  const signOff = sender ? `
    <p style="margin:22px 0 0;font-size:15px;color:#1a1a1a;line-height:1.5;">
      <strong>${escapeHtml(sender.name || 'Daniel Nelson')}</strong><br>
      ${escapeHtml(sender.company || 'October Communications')}
    </p>
    ${signatureBlock(signature)}` : signatureBlock(signature);
  const greeting = recipientName ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1a1a1a;">${escapeHtml(recipientName.split(' ')[0])},</p>` : '';

  // Embedded release — a light card under the note: the headline FIRST, large
  // and centred with breathing room (#7), then the hero, the cleaned body, and
  // "Notes to editors" in black (#7-prev).
  const embeddedBody = (embedFull && release.body_html) ? `
    <div style="margin:24px 0 8px;background:#f6f6f4;border-radius:8px;padding:24px 20px;">
      ${release.title ? `<h1 style="margin:0 0 18px;font-size:28px;line-height:1.25;color:#1a1a1a;font-weight:800;text-align:center;padding:0 5%;">${escapeHtml(release.title)}</h1>` : ''}
      ${hero}
      <div style="font-size:15px;line-height:1.65;color:#1a1a1a;margin-top:${hero ? '16' : '0'}px;">
        ${renderEmbeddedRelease(release)}
      </div>
      ${release.boilerplate ? `<div style="margin-top:18px;padding-top:14px;border-top:1px solid #e2e2de;font-size:13px;line-height:1.55;color:#1a1a1a;">${release.boilerplate}</div>` : ''}
    </div>` : '';

  // Unsubscribe footer — required by UK PECR / CAN-SPAM and increasingly
  // by Gmail + Yahoo for sender reputation. Stateless HMAC-signed URL,
  // generated by outreachSender.
  let unsubFooter = '';
  if (contactId) {
    try {
      const { unsubscribeUrl } = require('./outreachSender');
      let link = unsubscribeUrl(contactId, clientId);
      // Carry the campaign so the preference centre can offer "just this story".
      if (link && campaignId) link += `&cm=${campaignId}`;
      if (link) {
        unsubFooter = `<div style="margin-top:32px;padding-top:14px;border-top:1px solid #eee;font-size:11px;color:#888;line-height:1.5;">` +
          `If this isn't relevant to your beat, no hard feelings — you can ` +
          `<a href="${escapeHtml(link)}" style="color:#888;">update your details or unsubscribe here</a>.` +
          `</div>`;
      }
    } catch {}
  }

  // Layout: personal note → sign-off → download button → the release
  // (embedded card, or just the hero when the AM turns embedding off).
  const releaseSection = embedFull && release.body_html ? embeddedBody : hero;

  return emailShell(release.title, `
          ${greeting}
          ${pitchHtml}
          ${signOff}
          ${downloadBtn}
          ${releaseSection}
          ${unsubFooter}`);
}

// One 600px-wide, centred shell for every press email. A head <style> forces
// EVERY image and table down to the column width — the reliable belt-and-braces
// fix for a runaway width, including a pasted HTML signature (#1, #6).
function emailShell(title, inner) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title || '')}</title>
<style>
  body{margin:0;padding:0;background:#ffffff;}
  .oc-wrap{max-width:600px;margin:0 auto;padding:24px 16px;box-sizing:border-box;font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;}
  .oc-wrap img{max-width:100% !important;height:auto !important;}
  .oc-wrap table{max-width:100% !important;}
  .oc-sig img{max-width:100% !important;height:auto !important;}
</style></head>
<body>
  <div class="oc-wrap">${inner}
  </div>
</body></html>`;
}

// A follow-up rendered as a PERSONAL email, not a press blast: "Firstname,"
// greeting, the short body, at most one image, then the AM's sign-off +
// configurable footer and the unsubscribe line. Same shell as the pitch so a
// chase reads like a real human wrote it — which is what earns the reply.
function buildFollowUpHtml({ release, body, sender, recipientName, includeHero = false, contactId, clientId, campaignId, signature }) {
  const greeting = recipientName
    ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1a1a1a;">${escapeHtml(recipientName.split(' ')[0])},</p>` : '';
  const bodyHtml = (body || '').split('\n').map(p => p.trim()).filter(Boolean)
    .map(p => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1a1a1a;">${escapeHtml(p)}</p>`)
    .join('');
  const hero = includeHero && release.hero_image
    ? `<div style="margin:16px 0 6px;"><img src="${escapeHtml(release.hero_image)}" alt="${escapeHtml(release.title || '')}" style="display:block;width:100%;max-width:100%;height:auto;border:0;border-radius:3px;" /></div>`
    : '';
  const signatureHtml = sender ? `
    <p style="margin:22px 0 0;font-size:15px;color:#1a1a1a;line-height:1.5;">
      <strong>${escapeHtml(sender.name || 'Daniel Nelson')}</strong><br>
      ${escapeHtml(sender.company || 'October Communications')}
    </p>
    ${signatureBlock(signature)}` : signatureBlock(signature);
  let unsubFooter = '';
  if (contactId) {
    try {
      const { unsubscribeUrl } = require('./outreachSender');
      let link = unsubscribeUrl(contactId, clientId);
      if (link && campaignId) link += `&cm=${campaignId}`;
      if (link) {
        unsubFooter = `<div style="margin-top:32px;padding-top:14px;border-top:1px solid #eee;font-size:11px;color:#888;line-height:1.5;">` +
          `If this isn't relevant to your beat, no hard feelings — you can ` +
          `<a href="${escapeHtml(link)}" style="color:#888;">update your details or unsubscribe here</a>.` +
          `</div>`;
      }
    } catch {}
  }
  return emailShell(release.title, `
          ${greeting}
          ${bodyHtml}
          ${hero}
          ${signatureHtml}
          ${unsubFooter}`);
}

// Personal pitch — 3-5 sentences. Opens with one specific point from
// the release that matches the journalist's beat. Doesn't say "I hope
// you're well". Doesn't repeat the headline. Ends with a soft offer.
async function generatePitch({ release, journalist, brandBriefing, sender }) {
  const senderName = sender?.first_name || sender?.name?.split(' ')[0] || 'Daniel';
  const releaseText = (release.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1800);

  const prompt = `You're a PR consultant pitching a press release to a journalist by email. Your style is direct, personal, short — like an email a real human wrote in 2 minutes. Never marketing-speak. Never "I hope this email finds you well".

The email body must:
 - Open with one specific point from the release that connects to THIS journalist's beat. Lead with the angle, not the brand.
 - Be 3-5 short sentences, total under 110 words, BROKEN INTO 2-3 short paragraphs with a blank line between them (never one dense block).
 - Mention a concrete asset / interview / data offer once.
 - Close with "Press release 👉 <URL>" — the platform will append this automatically, so DON'T write it yourself.
 - No greeting line (the platform adds "Firstname,"), no sign-off (the platform adds the sender).

Brand: ${brandBriefing || '(no briefing supplied)'}
Sender: ${senderName} at October Communications

Press release headline: ${release.title}
${release.dateline ? `Dateline: ${release.dateline}` : ''}
Release body:
${releaseText}

Journalist:
 - Name: ${journalist.name || '(unknown)'}
 - Outlet: ${journalist.company || '(unknown)'}
 - Beat: ${journalist.contact_type || journalist.role || '(unknown)'}
 - Location: ${journalist.location || '(unknown)'}

Return ONLY the email body paragraphs (no greeting, no sign-off, no Subject:). ${localeGuide(release)}`;

  return (await claude.callClaude({
    max_tokens: 500, system: PRESS_SYSTEM, user: prompt,
    feature: 'press_pitch', clientId: release.client_id || null,
  })).trim();
}

// Three follow-ups on a 5 / 10 / 16-day cadence. Each is a separate
// short personal email with a DIFFERENT angle so the journalist doesn't
// feel hounded.
async function generateFollowUps({ release, journalist, brandBriefing, sender }) {
  const senderName = sender?.first_name || sender?.name?.split(' ')[0] || 'Daniel';
  const releaseText = (release.body_html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200);

  const prompt = `You're writing three follow-up pitch emails to chase a journalist who hasn't replied. Each one is short (under 80 words), personal, and uses a DIFFERENT angle — never "just bumping this up".

Day 5: a gentle nudge with one new piece of value not in the original — a quote, an asset, a stat.
Day 10: re-frame the story with an alternative angle relevant to the journalist's beat.
Day 16: a no-pressure closing email — "happy to circle back if useful later".

Each email body must:
 - Be 2-4 short sentences. No greeting (the platform adds "Firstname,"). No sign-off.
 - Not repeat the headline.
 - Be plain text (the platform wraps each in HTML).

Brand: ${brandBriefing || '(no briefing supplied)'}
Sender: ${senderName} at October Communications

Press release headline: ${release.title}
Release body:
${releaseText}

Journalist:
 - Name: ${journalist.name || '(unknown)'}
 - Outlet: ${journalist.company || '(unknown)'}
 - Beat: ${journalist.contact_type || journalist.role || '(unknown)'}

Return ONLY a JSON array of three objects: [{ "subject": "...", "body": "..." }, ...]. Subjects under 60 characters. ${localeGuide(release)} No preamble.`;

  const text = (await claude.callClaude({
    max_tokens: 1500, system: PRESS_SYSTEM, user: prompt,
    feature: 'press_followups', clientId: release.client_id || null,
  })).trim();
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); }
  catch { throw new Error('Claude returned malformed follow-up JSON'); }
}

// Cache the pitch + follow-ups per (release × journalist) so re-opening
// the preview doesn't re-bill. `force` regenerates.
async function getOrGenerateEmails({ pressReleaseId, contactId, force = false }) {
  if (!force) {
    const { rows } = await pool.query(
      'SELECT * FROM press_release_emails WHERE press_release_id = $1 AND contact_id = $2',
      [pressReleaseId, contactId]
    );
    if (rows.length) return rows[0];
  }

  const [{ rows: relRows }, { rows: contactRows }] = await Promise.all([
    pool.query('SELECT pr.*, c.briefing_field FROM outreach_press_releases pr JOIN clients c ON c.id = pr.client_id WHERE pr.id = $1', [pressReleaseId]),
    pool.query('SELECT * FROM outreach_contacts WHERE id = $1', [contactId]),
  ]);
  if (!relRows.length) throw new Error('Press release not found');
  if (!contactRows.length) throw new Error('Contact not found');
  const release = relRows[0];
  release.hero_image = (release.images?.[0]?.src) || null;
  const journalist = contactRows[0];

  const sender = { name: 'Daniel Nelson', first_name: 'Daniel', company: 'October Communications' };

  const [pitch, followUps] = await Promise.all([
    generatePitch({ release, journalist, brandBriefing: release.briefing_field, sender }),
    generateFollowUps({ release, journalist, brandBriefing: release.briefing_field, sender }),
  ]);

  const { rows } = await pool.query(
    `INSERT INTO press_release_emails (press_release_id, contact_id, intro, follow_ups)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (press_release_id, contact_id) DO UPDATE
       SET intro = EXCLUDED.intro, follow_ups = EXCLUDED.follow_ups, generated_at = NOW()
     RETURNING *`,
    [pressReleaseId, contactId, pitch, JSON.stringify(followUps)]
  );
  return rows[0];
}

// Create a distribution press-release row + its backing outreach campaign and
// the standard four-step sequence (release + 3 follow-ups), in one transaction.
// Shared by the /api/press create route and the PR authoring → pitch hand-off.
async function createReleaseWithCampaign(clientId, { title, body_html, source_url, dateline, images, contact_block, boilerplate, embargo_at, fetched_at }) {
  const plain = String(body_html || '').replace(/<[^>]+>/g, ' ');
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    const { rows: campaignRows } = await dbClient.query(
      `INSERT INTO outreach_campaigns (client_id, name, kind, status, audience_description)
       VALUES ($1, $2, 'press_release', 'draft', $3) RETURNING *`,
      [clientId, `Press: ${title}`.slice(0, 250), 'Press release distribution']
    );
    const campaign = campaignRows[0];
    const { rows } = await dbClient.query(
      `INSERT INTO outreach_press_releases
         (client_id, title, body, summary, source_url, dateline, body_html, images, contact_block, boilerplate, embargo_at, fetched_at, campaign_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [clientId, title, plain, plain.slice(0, 280), source_url || null, dateline || null, body_html,
       JSON.stringify(images || []), contact_block || null, boilerplate || null,
       embargo_at || null, fetched_at || new Date().toISOString(), campaign.id]
    );
    const offsets = [0, 5, 10, 16];
    for (let i = 0; i < offsets.length; i++) {
      await dbClient.query(
        `INSERT INTO outreach_sequences (campaign_id, step_number, subject, body, delay_days) VALUES ($1,$2,$3,$4,$5)`,
        [campaign.id, i + 1,
         i === 0 ? title : `Follow-up ${i}: ${title}`.slice(0, 250),
         i === 0 ? '__press_release__' : `__press_followup_${i}__`,
         offsets[i]]
      );
    }
    await dbClient.query('COMMIT');
    return { ...rows[0], campaign_id: campaign.id };
  } catch (err) {
    await dbClient.query('ROLLBACK');
    throw err;
  } finally {
    dbClient.release();
  }
}

// Four DISTINCT, enticing subject lines from the release — each leading with a
// different genuinely newsworthy hook, so the four sends (initial + the
// resend-to-unopeners follow-ups) each try a fresh angle to grab attention.
// This is the "bait" the AM uses to earn the open. Runs on Opus (press_pitch).
async function generateSubjectLines({ release }) {
  const releaseText = (release.body_html || release.summary || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1800);
  const user = `Read this press release and write FOUR different email subject lines to pitch it to journalists. We send them in sequence to try to earn the open, so each must lead with a DIFFERENT genuinely enticing hook — a distinct newsworthy angle or the single most interesting fact from the release, not four rewordings of one idea.

Rules:
- Under 65 characters each.
- Specific and concrete — use the real names, numbers, and the actual story. No vague teasers, no clickbait, no "Press release:" prefix.
- Order them strongest-first.
- ${localeGuide(release)}

HEADLINE: ${release.title}
RELEASE:
"""
${releaseText}
"""

Return ONLY a JSON array of exactly 4 strings.`;
  const text = await claude.callClaude({ max_tokens: 400, system: PRESS_SYSTEM, user, feature: 'press_pitch', clientId: release.client_id || null });
  let arr = [];
  const fence = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*(\[[\s\S]*?\])\s*```/);
  const body = fence ? fence[1] : text.slice(text.indexOf('['), text.lastIndexOf(']') + 1);
  try { const v = JSON.parse(body.trim()); if (Array.isArray(v)) arr = v; } catch { /* none */ }
  return arr.filter(s => typeof s === 'string').map(s => s.trim().replace(/^["']|["']$/g, '').slice(0, 250)).filter(Boolean).slice(0, 4);
}

// Generate the subjects and write them onto the campaign's step rows (step 1 =
// initial, 2-4 = follow-ups). Best-effort — a failure leaves existing subjects.
async function applyGeneratedSubjects(pressReleaseId) {
  const { rows } = await pool.query(
    'SELECT pr.*, c.name AS client_name FROM outreach_press_releases pr LEFT JOIN clients c ON c.id = pr.client_id WHERE pr.id = $1',
    [pressReleaseId]
  );
  if (!rows.length || !rows[0].campaign_id) return [];
  const release = rows[0];
  const subjects = await generateSubjectLines({ release });
  for (let i = 0; i < subjects.length; i++) {
    await pool.query(
      'UPDATE outreach_sequences SET subject = $1 WHERE campaign_id = $2 AND step_number = $3',
      [subjects[i], release.campaign_id, i + 1]
    );
  }
  return subjects;
}

// Load the AM-configured press signature/footer for a client (nullable).
async function clientSignature(clientId) {
  if (!clientId) return null;
  try {
    const { rows } = await pool.query('SELECT press_signature FROM clients WHERE id = $1', [clientId]);
    return rows[0]?.press_signature || null;
  } catch { return null; }
}

module.exports = {
  fetchAndParse,
  buildEmailHtml,
  buildFollowUpHtml,
  clientSignature,
  generatePitch,
  generateFollowUps,
  getOrGenerateEmails,
  createReleaseWithCampaign,
  generateSubjectLines,
  applyGeneratedSubjects,
};
