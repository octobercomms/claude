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
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-sonnet-4-6';

function claudeClient() {
  return new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });
}

// Fetch a downloadfor.press URL (or any public press page) and pull out
// the structured content. downloadfor.press is WordPress + Elementor so
// we strip the Elementor header / footer / lead-capture form first,
// then take what's left of the single-post Elementor block.
async function fetchAndParse(url) {
  if (!url || !/^https?:\/\//i.test(url)) throw new Error('Provide a full http(s) URL.');
  const { data: html } = await axios.get(url, {
    timeout: 15000,
    maxRedirects: 5,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OctoberPlatform/1.0; +https://platform.octobercomms.com)' },
  });
  const $ = cheerio.load(html);

  // Strip the Elementor header + footer + sidebar form (those wrap the
  // page chrome and the "Download media assets" capture form which
  // we'd otherwise pull into the body).
  $('[data-elementor-type="header"]').remove();
  $('[data-elementor-type="footer"]').remove();
  $('form, .elementor-form, .gform_wrapper, [class*="form-fields"]').remove();
  $('script, style, noscript, iframe').remove();

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
  const images = [];
  const seen = new Set();
  const pushImg = (src, alt) => {
    const abs = absoluteUrl(src, url);
    if (!abs || seen.has(abs)) return;
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
  const allowed = new Set(['p', 'br', 'strong', 'em', 'b', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'img', 'blockquote']);
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

// HTML shell for the personal pitch email. Deliberately plain — looks
// like an email an AM would write, not a marketing campaign. Two
// images max (hero + one inline), the release link, an AM sign-off.
function buildEmailHtml({ release, pitch, sender, recipientName, includeHero = true }) {
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pitchHtml = (pitch || '').split('\n').map(p => p.trim()).filter(Boolean)
    .map(p => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1a1a1a;">${escapeHtml(p)}</p>`)
    .join('');
  const hero = includeHero && release.hero_image
    ? `<div style="margin:18px 0 6px;"><img src="${escapeHtml(release.hero_image)}" alt="${escapeHtml(release.title)}" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:2px;" /></div>`
    : '';
  const releaseLink = `<p style="margin:18px 0 0;font-size:15px;line-height:1.6;color:#1a1a1a;"><strong>Press release</strong> 👉 <a href="${escapeHtml(release.source_url)}" style="color:#1a1a1a;">${escapeHtml(release.source_url)}</a></p>`;
  const signature = sender ? `
    <p style="margin:24px 0 0;font-size:15px;color:#1a1a1a;">${escapeHtml(sender.first_name || sender.name || 'Daniel')}</p>
    <p style="margin:14px 0 0;font-size:13px;color:#666;line-height:1.5;">
      <strong style="color:#1a1a1a;">${escapeHtml(sender.name || 'Daniel Nelson')}</strong><br>
      ${escapeHtml(sender.company || 'October Communications')}
    </p>` : '';
  const greeting = recipientName ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1a1a1a;">${escapeHtml(recipientName.split(' ')[0])},</p>` : '';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${escapeHtml(release.title)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;padding:0 24px;">
        <tr><td>
          ${greeting}
          ${pitchHtml}
          ${releaseLink}
          ${hero}
          ${signature}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
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
 - Be 3-5 short sentences. Total under 110 words.
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

Return ONLY the email body paragraphs (no greeting, no sign-off, no Subject:). British English.`;

  const res = await claudeClient().messages.create({
    model: MODEL, max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });
  return res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
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

Return ONLY a JSON array of three objects: [{ "subject": "...", "body": "..." }, ...]. Subjects under 60 characters. British English. No preamble.`;

  const res = await claudeClient().messages.create({
    model: MODEL, max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
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

module.exports = {
  fetchAndParse,
  buildEmailHtml,
  generatePitch,
  generateFollowUps,
  getOrGenerateEmails,
};
