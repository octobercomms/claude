# nvelope.co — Tracking Setup
**Updated:** March 2026

---

## Tracking Priority

Tracking must be set up **before any ad spend begins**. Without it, campaigns
cannot optimise, and you have no proof of performance for studio clients.

**Priority order:**
1. Google Analytics 4 (GA4) — source of truth
2. Google Ads tag + conversion actions
3. Meta Pixel + server-side CAPI
4. X Pixel
5. UTM parameters on all ad links

---

## Conversion Events to Track

| Event Name | Trigger | Platform | Value |
|------------|---------|----------|-------|
| `quiz_start` | User clicks "Start Quiz" button | GA4, Google Ads, Meta, X | $0 (micro-conversion) |
| `quiz_complete` | User reaches final quiz screen | GA4, Google Ads, Meta, X | $0 (micro-conversion) |
| `lead_submit` | Lead form submitted successfully | GA4, Google Ads (primary), Meta (primary), X | $50–$100 (assign estimated value) |
| `page_view_studio` | User views any `/studio/[slug]/` page | GA4 | $0 |
| `cta_click` | User clicks primary CTA button on studio page | GA4, Meta | $0 |

> **Primary conversion for bidding:** `lead_submit` only.
> `quiz_start` and `quiz_complete` are for funnel diagnostics, not bid optimisation.

---

## Google Ads Tracking Setup

### Step 1 — Google Tag (gtag.js)
Install via Google Tag Manager (GTM) or directly in `<head>`:
```html
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=AW-XXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'AW-XXXXXXXXX');
</script>
```

### Step 2 — Conversion Actions in Google Ads
Create the following in Google Ads → Goals → Conversions:

| Conversion Action | Category | Value | Count | Attribution |
|------------------|----------|-------|-------|-------------|
| Lead Form Submit | Lead | $75 (estimated) | One | Data-driven |
| Quiz Complete | Other | $0 | One | Last click |
| Quiz Start | Other | $0 | One | Last click |

### Step 3 — Enhanced Conversions
Enable Enhanced Conversions to improve match rates for logged-in users:
- In Google Ads: Goals → Settings → Enhanced Conversions for Leads
- Pass hashed email and phone number at form submission
- Requires minimal backend change — hash SHA-256 client-side before sending

```javascript
// On lead form submit
gtag('event', 'conversion', {
  send_to: 'AW-XXXXXXXXX/YYYYYYYYYY',
  value: 75,
  currency: 'GBP',
  user_data: {
    email_address: sha256(userEmail),
    phone_number: sha256(userPhone),
  }
});
```

### Step 4 — Auto-tagging
Ensure auto-tagging is enabled in Google Ads account settings.
This adds `gclid` to URLs and enables GA4 ↔ Google Ads linking.

---

## Meta Pixel + CAPI Setup

### Step 1 — Meta Pixel (Client-Side)
Install Pixel in `<head>` of every page:
```html
<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', 'YOUR_PIXEL_ID');
fbq('track', 'PageView');
</script>
```

### Step 2 — Custom Events
Fire these on the relevant user actions:
```javascript
// Quiz Start
fbq('trackCustom', 'QuizStart', { studio_slug: 'manolo-design-studio' });

// Quiz Complete
fbq('trackCustom', 'QuizComplete', { studio_slug: 'manolo-design-studio' });

// Lead Submit (use standard Lead event for algorithm optimisation)
fbq('track', 'Lead', {
  value: 75,
  currency: 'GBP',
  content_name: 'Architecture Lead',
  content_category: studioSlug,
});
```

### Step 3 — Conversions API (CAPI) — Server-Side
**This is critical.** iOS 14+ and ad blockers block ~30–40% of browser-side Pixel events.
CAPI sends events server-side, recovering lost signal.

**Minimum CAPI setup:**
- Deduplicate events using `event_id` parameter (same ID client-side and server-side)
- Send at minimum: `Lead` event from server when form submission hits database
- Include: `em` (hashed email), `ph` (hashed phone), `fn`, `ln`, `ct`, `country`, `zp`

**Recommended:** Use Meta's CAPI Gateway or a server-side GTM container

**Event Match Quality (EMQ) target:** 7.0+ out of 10.0
- Below 6.0: poor signal, audience building and optimisation will suffer
- Improve by sending more identifiers (email + phone + name + location)

### Step 4 — Pixel Events Verification
- Use Meta Pixel Helper Chrome extension to verify events fire correctly
- In Events Manager: confirm `Lead` event is received within 24h of first form submit
- Check for duplicate events (should see deduplication working)

---

## X (Twitter) Pixel Setup

### Step 1 — Universal Website Tag
```html
<!-- Twitter conversion tracking for single-page applications -->
<script>
!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);},
s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',
a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');
twq('config','XXXXXXX');
</script>
```

### Step 2 — Conversion Events
```javascript
// Lead Submit
twq('event', 'tw-XXXXXXX-YYYYYYY', {
  value: '75',
  currency: 'GBP',
  email_address: userEmail, // X will hash automatically
});
```

### Step 3 — X CAPI (Optional)
X's server-side API is less mature than Meta/Google. Prioritise client-side for now.
Revisit once volume justifies the engineering effort (>50 leads/month from X).

---

## UTM Parameter Structure

**Apply to every ad link across all platforms:**

```
https://nvelope.co/studio/[studio-slug]/?utm_source=[platform]&utm_medium=paid&utm_campaign=[campaign-name]&utm_content=[ad-id]
```

| Parameter | Google | Meta | X |
|-----------|--------|------|---|
| `utm_source` | `google` | `meta` | `twitter` |
| `utm_medium` | `paid-search` | `paid-social` | `paid-social` |
| `utm_campaign` | Campaign name (auto via ValueTrack `{campaignid}`) | Campaign name | Campaign name |
| `utm_content` | `{adid}` (ValueTrack tag) | Ad ID | Ad ID |
| `utm_term` | `{keyword}` (Google Search only) | — | — |

**Google ValueTrack example URL:**
```
https://nvelope.co/studio/{slug}/?utm_source=google&utm_medium=paid-search&utm_campaign={campaignid}&utm_content={adid}&utm_term={keyword}
```

---

## GA4 Configuration

### Goals to Configure
In GA4 → Admin → Conversions, mark these events as conversions:
- `lead_submit` ✓ (primary)
- `quiz_complete` ✓ (secondary)

### Audiences to Build in GA4 (for import to Google Ads)
| Audience | Definition | Membership Duration |
|----------|-----------|---------------------|
| Studio page visitors | `page_location` contains `/studio/` | 30 days |
| Quiz starters | Event: `quiz_start` | 14 days |
| Quiz completers | Event: `quiz_complete` | 30 days |
| Lead submitters | Event: `lead_submit` | 540 days (max) |

### GA4 ↔ Google Ads Linking
- Link GA4 property to Google Ads account
- Import GA4 audiences into Google Ads for remarketing
- Import GA4 conversions as secondary signal (keep Google Ads tag as primary)

---

## Tracking Verification Checklist

**Before launching any paid traffic:**

### Google
- [ ] gtag.js installed on all pages
- [ ] Conversion action "Lead Form Submit" appears in Google Ads Goals
- [ ] Test conversion fires (use Google Tag Assistant)
- [ ] Auto-tagging enabled
- [ ] GA4 ↔ Google Ads linked
- [ ] Enhanced Conversions configured

### Meta
- [ ] Meta Pixel fires PageView on all pages (verified via Pixel Helper)
- [ ] `Lead` event fires on form submit (verified in Events Manager)
- [ ] `QuizStart` and `QuizComplete` custom events fire correctly
- [ ] CAPI sending `Lead` event server-side
- [ ] Event deduplication working (no duplicate events in Events Manager)
- [ ] EMQ score ≥ 7.0

### X
- [ ] Universal Website Tag fires on all pages
- [ ] Conversion event fires on lead form submit
- [ ] X Pixel Helper confirms events

### Cross-Platform
- [ ] UTM parameters on all ad destination URLs
- [ ] GA4 receiving traffic with correct utm_source values
- [ ] Studio page `/studio/[slug]/` tracked as distinct page view
- [ ] Quiz funnel steps tracked as individual events

---

## Attribution Notes

**Platform overclaim warning:** Meta, Google, and X each claim credit for conversions.
Total platform-reported conversions will always exceed actual leads (often 2–3×).

**Source of truth hierarchy:**
1. CRM / backend database — actual lead records
2. GA4 — cross-platform, session-based (with UTMs)
3. Platform-reported — directional use only

**Monthly reconciliation:** Compare backend lead count vs platform-reported.
If gap >30%, investigate tracking gaps or attribution overlap issues.
