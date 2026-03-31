const BREVO_API_KEY = '';  // ← paste your Brevo API key here

document.addEventListener('submit', async function (e) {
  const form = e.target.closest('.remind-form');
  if (!form) return;
  e.preventDefault();

  const input  = form.querySelector('input[type="email"]');
  const button = form.querySelector('button');
  const email  = input.value.trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    input.focus();
    return;
  }

  button.disabled = true;

  // remindFormPage is injected by wp_localize_script and is more reliable
  // than data attributes when the shortcode runs in an Elementor header template.
  const page      = (typeof remindFormPage !== 'undefined') ? remindFormPage : {};
  const listId     = page.listId     || parseInt(form.dataset.listId, 10)     || null;
  const templateId = page.templateId || parseInt(form.dataset.templateId, 10) || null;
  const studioName = page.studioName || form.dataset.studioName || '';
  const studioUrl  = page.studioUrl  || form.dataset.studioUrl  || window.location.href;

  try {
    // 1. Upsert contact
    const contactPayload = {
      email,
      attributes: { STUDIO_NAME: studioName, STUDIO_URL: studioUrl, REMIND_SOURCE: 'sticky_bar' },
      updateEnabled: true,
    };
    if (listId) contactPayload.listIds = [listId];

    await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(contactPayload),
    });

    // 2. Send transactional email
    if (templateId) {
      await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: [{ email }],
          templateId,
          params: { STUDIO_NAME: studioName, STUDIO_URL: studioUrl },
        }),
      });
    }

    // Success — swap form contents for confirmation
    form.innerHTML = '<span class="remind-form-done">Check your inbox ✓</span>';

  } catch (err) {
    console.error('[remind-form]', err);
    button.disabled = false;
  }
});
