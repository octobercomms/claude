/**
 * Sticky "Remind me on desktop" bar
 * Integrates with Brevo Contacts API + Transactional Email API
 *
 * Fill in CONFIG before deploying.
 */

const CONFIG = {
  brevoApiKey: '',        // Your Brevo API key (single account, shared across all pages)
  brevoListId: null,      // Fallback list ID — overridden per-page via #nvelope-brevo-list-id hidden input
  brevoTemplateId: null,  // Fallback template ID — overridden per-page via #nvelope-brevo-template-id hidden input
  cookieName: 'nvelope_remind_dismissed',
  cookieDays: 30,
};

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

function setCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Lax`;
}

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'));
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// DOM: build and inject the bar
// ---------------------------------------------------------------------------

function buildBar() {
  const bar = document.createElement('div');
  bar.id = 'nvelope-remind-bar';
  bar.setAttribute('role', 'banner');
  bar.innerHTML = `
    <div class="nvelope-remind-inner">
      <label class="nvelope-remind-label" for="nvelope-remind-email">Remind me on desktop</label>
      <div class="nvelope-remind-form-row">
        <input
          id="nvelope-remind-email"
          class="nvelope-remind-input"
          type="email"
          placeholder="your@email.com"
          autocomplete="email"
          required
        />
        <button class="nvelope-remind-submit" type="button">Remind me</button>
      </div>
      <p class="nvelope-remind-confirmation" aria-live="polite" hidden>Check your inbox</p>
    </div>
    <button class="nvelope-remind-close" type="button" aria-label="Dismiss reminder bar">&times;</button>
  `;
  return bar;
}

function injectBar(bar) {
  document.body.insertBefore(bar, document.body.firstChild);
  // Push page content down so the bar doesn't overlap it
  document.body.style.paddingTop = (document.body.style.paddingTop
    ? parseInt(document.body.style.paddingTop, 10)
    : 0) + bar.offsetHeight + 'px';
}

function dismissBar(bar) {
  const currentPadding = parseInt(document.body.style.paddingTop, 10) || 0;
  const barHeight = bar.offsetHeight;
  document.body.style.paddingTop = Math.max(0, currentPadding - barHeight) + 'px';
  bar.remove();
}

// ---------------------------------------------------------------------------
// Read hidden fields (set by Elementor / page template)
// ---------------------------------------------------------------------------

function getPageMeta() {
  const studioNameEl   = document.getElementById('nvelope-studio-name')
    || document.querySelector('[name="studio_name"]');
  const studioUrlEl    = document.getElementById('nvelope-studio-url')
    || document.querySelector('[name="studio_url"]');
  const listIdEl       = document.getElementById('nvelope-brevo-list-id')
    || document.querySelector('[name="brevo_list_id"]');
  const templateIdEl   = document.getElementById('nvelope-brevo-template-id')
    || document.querySelector('[name="brevo_template_id"]');

  const rawListId    = listIdEl    ? listIdEl.value.trim()    : null;
  const rawTemplId   = templateIdEl ? templateIdEl.value.trim() : null;

  return {
    studioName:   studioNameEl ? studioNameEl.value || studioNameEl.textContent.trim() : '',
    studioUrl:    studioUrlEl  ? studioUrlEl.value  || studioUrlEl.textContent.trim()  : window.location.href,
    // Per-page overrides; fall back to CONFIG values if not present on this page
    brevoListId:     rawListId   ? parseInt(rawListId, 10)   : CONFIG.brevoListId,
    brevoTemplateId: rawTemplId  ? parseInt(rawTemplId, 10)  : CONFIG.brevoTemplateId,
  };
}

// ---------------------------------------------------------------------------
// Brevo API calls
// ---------------------------------------------------------------------------

async function brevoUpsertContact(email, studioName, studioUrl, listId) {
  const payload = {
    email,
    attributes: {
      STUDIO_NAME:   studioName,
      STUDIO_URL:    studioUrl,
      REMIND_SOURCE: 'sticky_bar',
    },
    updateEnabled: true,
  };

  if (listId) {
    payload.listIds = [listId];
  }

  const res = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: {
      'api-key': CONFIG.brevoApiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok && res.status !== 204) {
    const body = await res.text();
    throw new Error(`Brevo contacts error ${res.status}: ${body}`);
  }
}

async function brevoSendReminder(email, studioName, studioUrl, templateId) {
  const payload = {
    to: [{ email }],
    templateId,
    params: {
      STUDIO_NAME: studioName,
      STUDIO_URL:  studioUrl,
    },
  };

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': CONFIG.brevoApiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo email error ${res.status}: ${body}`);
  }
}

// ---------------------------------------------------------------------------
// Form submit handler
// ---------------------------------------------------------------------------

async function handleSubmit(bar) {
  const input  = bar.querySelector('.nvelope-remind-input');
  const button = bar.querySelector('.nvelope-remind-submit');
  const confirm = bar.querySelector('.nvelope-remind-confirmation');
  const email  = input.value.trim();

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    input.focus();
    input.setCustomValidity('Please enter a valid email address.');
    input.reportValidity();
    return;
  }
  input.setCustomValidity('');

  button.disabled = true;
  button.textContent = 'Sending…';

  const { studioName, studioUrl, brevoListId, brevoTemplateId } = getPageMeta();

  try {
    await brevoUpsertContact(email, studioName, studioUrl, brevoListId);

    if (brevoTemplateId) {
      await brevoSendReminder(email, studioName, studioUrl, brevoTemplateId);
    }

    setCookie(CONFIG.cookieName, '1', CONFIG.cookieDays);

    // Show confirmation, then remove bar after short delay
    const formRow = bar.querySelector('.nvelope-remind-form-row');
    const label   = bar.querySelector('.nvelope-remind-label');
    if (formRow) formRow.hidden = true;
    if (label)   label.hidden   = true;
    confirm.hidden = false;

    setTimeout(() => dismissBar(bar), 2500);

  } catch (err) {
    console.error('[nvelope-remind-bar]', err);
    button.disabled = false;
    button.textContent = 'Remind me';
    // Surface a short user-facing error without exposing internals
    confirm.textContent = 'Something went wrong — please try again.';
    confirm.hidden = false;
    setTimeout(() => {
      confirm.hidden = true;
      confirm.textContent = 'Check your inbox';
    }, 4000);
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
  // Don't show if already dismissed
  if (getCookie(CONFIG.cookieName)) return;

  const bar = buildBar();
  injectBar(bar);

  bar.querySelector('.nvelope-remind-submit').addEventListener('click', () => handleSubmit(bar));

  bar.querySelector('.nvelope-remind-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSubmit(bar);
  });

  bar.querySelector('.nvelope-remind-close').addEventListener('click', () => {
    setCookie(CONFIG.cookieName, '1', CONFIG.cookieDays);
    dismissBar(bar);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
