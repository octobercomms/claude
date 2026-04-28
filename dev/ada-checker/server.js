import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

app.post('/api/check', async (req, res) => {
  let { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ADA-Checker/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      maxRedirects: 5,
    });

    const html = response.data;
    const $ = cheerio.load(html);
    const issues = [];
    const passes = [];

    // --- Helper ---
    const addIssue = (category, severity, message, detail = '') =>
      issues.push({ category, severity, message, detail });
    const addPass = (category, message) =>
      passes.push({ category, message });

    // 1. Page language
    const lang = $('html').attr('lang');
    if (!lang || lang.trim() === '') {
      addIssue('Language', 'critical', 'Missing lang attribute on <html>', 'Screen readers need a language to read content correctly. Add lang="en" (or appropriate language code).');
    } else {
      addPass('Language', `Page language declared: "${lang}"`);
    }

    // 2. Page title
    const title = $('title').text().trim();
    if (!title) {
      addIssue('Page Title', 'critical', 'Missing or empty <title> element', 'Every page must have a descriptive title to help users understand its purpose.');
    } else {
      addPass('Page Title', `Page title present: "${title.substring(0, 60)}${title.length > 60 ? '...' : ''}"`);
    }

    // 3. Images without alt text
    const imagesTotal = $('img').length;
    const imagesMissingAlt = [];
    $('img').each((_, el) => {
      const alt = $(el).attr('alt');
      const src = $(el).attr('src') || '';
      const shortSrc = src.split('/').pop()?.substring(0, 40) || 'unknown';
      if (alt === undefined) {
        imagesMissingAlt.push(shortSrc);
      }
    });
    if (imagesMissingAlt.length > 0) {
      addIssue('Images', 'critical', `${imagesMissingAlt.length} image(s) missing alt attribute`,
        `Images without alt text are invisible to screen readers. Affected: ${imagesMissingAlt.slice(0, 5).join(', ')}${imagesMissingAlt.length > 5 ? '...' : ''}`);
    } else if (imagesTotal > 0) {
      addPass('Images', `All ${imagesTotal} image(s) have alt attributes`);
    }

    // 4. Form inputs without labels
    const inputsMissingLabel = [];
    $('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select').each((_, el) => {
      const id = $(el).attr('id');
      const ariaLabel = $(el).attr('aria-label');
      const ariaLabelledBy = $(el).attr('aria-labelledby');
      const title = $(el).attr('title');
      const placeholder = $(el).attr('placeholder');
      const hasLabel = id && $(`label[for="${id}"]`).length > 0;
      const wrappedInLabel = $(el).closest('label').length > 0;

      if (!hasLabel && !wrappedInLabel && !ariaLabel && !ariaLabelledBy && !title) {
        const type = $(el).attr('type') || el.tagName;
        const name = $(el).attr('name') || $(el).attr('id') || type;
        inputsMissingLabel.push(name);
      }
    });
    if (inputsMissingLabel.length > 0) {
      addIssue('Forms', 'critical', `${inputsMissingLabel.length} form field(s) without accessible labels`,
        `Fields: ${inputsMissingLabel.slice(0, 5).join(', ')}${inputsMissingLabel.length > 5 ? '...' : ''}. Use <label for="id">, aria-label, or aria-labelledby.`);
    } else {
      const totalInputs = $('input:not([type="hidden"]), textarea, select').length;
      if (totalInputs > 0) addPass('Forms', `All ${totalInputs} form field(s) appear to have labels`);
    }

    // 5. Empty links
    const emptyLinks = [];
    $('a').each((_, el) => {
      const text = $(el).text().trim();
      const ariaLabel = $(el).attr('aria-label');
      const ariaLabelledBy = $(el).attr('aria-labelledby');
      const title = $(el).attr('title');
      const hasImg = $(el).find('img[alt]').length > 0;
      const hasRole = $(el).attr('role');
      if (!text && !ariaLabel && !ariaLabelledBy && !title && !hasImg) {
        const href = $(el).attr('href') || '';
        emptyLinks.push(href.substring(0, 40) || '(no href)');
      }
    });
    if (emptyLinks.length > 0) {
      addIssue('Links', 'serious', `${emptyLinks.length} link(s) with no accessible text`,
        `Links: ${emptyLinks.slice(0, 5).join(', ')}. Links need descriptive text or aria-label so screen reader users know where they go.`);
    } else {
      const totalLinks = $('a[href]').length;
      if (totalLinks > 0) addPass('Links', `All ${totalLinks} link(s) appear to have accessible text`);
    }

    // 6. Empty buttons
    const emptyButtons = [];
    $('button').each((_, el) => {
      const text = $(el).text().trim();
      const ariaLabel = $(el).attr('aria-label');
      const ariaLabelledBy = $(el).attr('aria-labelledby');
      const title = $(el).attr('title');
      const hasImg = $(el).find('img[alt]').length > 0;
      if (!text && !ariaLabel && !ariaLabelledBy && !title && !hasImg) {
        emptyButtons.push($(el).attr('class') || $(el).attr('id') || 'unknown');
      }
    });
    if (emptyButtons.length > 0) {
      addIssue('Buttons', 'serious', `${emptyButtons.length} button(s) with no accessible text`,
        `Buttons need labels for screen readers. Use visible text, aria-label, or aria-labelledby.`);
    } else {
      const totalButtons = $('button').length;
      if (totalButtons > 0) addPass('Buttons', `All ${totalButtons} button(s) have accessible labels`);
    }

    // 7. Heading hierarchy
    const headings = [];
    $('h1, h2, h3, h4, h5, h6').each((_, el) => {
      headings.push(parseInt(el.tagName[1]));
    });
    const h1Count = headings.filter(h => h === 1).length;
    if (h1Count === 0) {
      addIssue('Headings', 'serious', 'No <h1> heading found', 'Every page should have exactly one H1 that describes its main topic.');
    } else if (h1Count > 1) {
      addIssue('Headings', 'moderate', `${h1Count} <h1> headings found (should be 1)`, 'Multiple H1s can confuse screen reader users navigating by headings.');
    } else {
      addPass('Headings', 'Single H1 heading present');
    }
    // Check for skipped heading levels
    let skipped = false;
    for (let i = 1; i < headings.length; i++) {
      if (headings[i] - headings[i - 1] > 1) { skipped = true; break; }
    }
    if (skipped) {
      addIssue('Headings', 'moderate', 'Heading levels are skipped (e.g. H1 → H3)', 'Heading levels should not skip (H1 → H2 → H3). Skipped levels confuse screen reader navigation.');
    } else if (headings.length > 1) {
      addPass('Headings', 'Heading hierarchy appears sequential');
    }

    // 8. Skip navigation link
    const hasSkipLink = $('a[href^="#"]').first().text().toLowerCase().includes('skip') ||
      $('a').toArray().some(el => $(el).text().toLowerCase().includes('skip to'));
    if (!hasSkipLink) {
      addIssue('Navigation', 'moderate', 'No skip navigation link detected', 'A "Skip to main content" link at the top allows keyboard users to bypass repetitive navigation menus.');
    } else {
      addPass('Navigation', 'Skip navigation link found');
    }

    // 9. ARIA landmark roles / semantic structure
    const hasMain = $('main, [role="main"]').length > 0;
    const hasNav = $('nav, [role="navigation"]').length > 0;
    if (!hasMain) {
      addIssue('Landmarks', 'moderate', 'No <main> landmark found', 'A <main> element helps screen reader users jump directly to the primary content.');
    } else {
      addPass('Landmarks', '<main> landmark present');
    }
    if (!hasNav) {
      addIssue('Landmarks', 'minor', 'No <nav> landmark found', 'Use <nav> to identify navigation regions for screen reader shortcuts.');
    } else {
      addPass('Landmarks', '<nav> landmark present');
    }

    // 10. iframes without title
    const iframesMissingTitle = [];
    $('iframe').each((_, el) => {
      const title = $(el).attr('title');
      const ariaLabel = $(el).attr('aria-label');
      if (!title && !ariaLabel) {
        iframesMissingTitle.push($(el).attr('src')?.substring(0, 40) || 'unknown');
      }
    });
    if (iframesMissingTitle.length > 0) {
      addIssue('iframes', 'serious', `${iframesMissingTitle.length} iframe(s) missing title attribute`,
        `Iframes: ${iframesMissingTitle.slice(0, 3).join(', ')}. Screen readers need a title to describe iframe content.`);
    } else if ($('iframe').length > 0) {
      addPass('iframes', `All ${$('iframe').length} iframe(s) have title attributes`);
    }

    // 11. Tables
    $('table').each((_, table) => {
      const hasHeaders = $(table).find('th').length > 0;
      const hasCaption = $(table).find('caption').length > 0;
      const hasSummary = $(table).attr('summary') || $(table).attr('aria-label') || $(table).attr('aria-describedby');
      if (!hasHeaders) {
        addIssue('Tables', 'serious', 'Table found without <th> header cells', 'Data tables need <th> elements so screen readers can associate data with its column/row headers.');
      } else {
        addPass('Tables', 'Table has header cells');
      }
    });

    // 12. Autoplay media
    const autoplayMedia = $('video[autoplay], audio[autoplay]').length;
    if (autoplayMedia > 0) {
      addIssue('Media', 'serious', `${autoplayMedia} media element(s) with autoplay`, 'Autoplaying audio/video can interfere with screen readers. Provide controls and avoid autoplay without mute.');
    }

    // 13. Meta viewport that disables zoom
    const viewport = $('meta[name="viewport"]').attr('content') || '';
    if (/user-scalable\s*=\s*no/i.test(viewport) || /maximum-scale\s*=\s*1/i.test(viewport)) {
      addIssue('Zoom', 'serious', 'Viewport meta tag disables user zoom', 'Preventing zoom fails WCAG 1.4.4. Users with low vision need to zoom. Remove user-scalable=no and maximum-scale=1.');
    } else {
      addPass('Zoom', 'Viewport does not prevent user scaling');
    }

    // 14. Color contrast hint (static check only)
    const hasInlineColorStyle = $('[style*="color"]').length;
    if (hasInlineColorStyle > 0) {
      addIssue('Color Contrast', 'info', `${hasInlineColorStyle} element(s) use inline color styles (manual review needed)`, 'Inline color styles may have contrast issues. Text must have at least 4.5:1 contrast ratio (WCAG AA). Use a contrast checker to verify.');
    }

    // Scoring
    const severityWeights = { critical: 10, serious: 5, moderate: 3, minor: 1, info: 0 };
    const maxScore = 100;
    const deductions = issues.reduce((sum, i) => sum + (severityWeights[i.severity] || 0), 0);
    const score = Math.max(0, maxScore - deductions);

    const criticalCount = issues.filter(i => i.severity === 'critical').length;
    const seriousCount = issues.filter(i => i.severity === 'serious').length;
    const moderateCount = issues.filter(i => i.severity === 'moderate').length;

    res.json({
      url,
      score,
      issues,
      passes,
      summary: { criticalCount, seriousCount, moderateCount, totalIssues: issues.length, totalPasses: passes.length },
    });
  } catch (err) {
    const msg = err.code === 'ECONNREFUSED' ? 'Connection refused'
      : err.code === 'ENOTFOUND' ? 'Domain not found'
      : err.response ? `HTTP ${err.response.status}`
      : err.message;
    res.status(500).json({ error: `Could not fetch the page: ${msg}` });
  }
});

app.listen(PORT, () => console.log(`ADA Checker running at http://localhost:${PORT}`));
