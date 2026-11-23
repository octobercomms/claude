// The key that was here was live, and this file is enqueued on every page
// load (functions.php, wp_enqueue_scripts), so it was readable with
// view-source by any visitor. It was revoked on 23 November 2026.
//
// Do not put another one here. A Brevo key is account-wide within its
// account: whoever holds it can export every contact, send as the account
// and delete lists. (The exposed key was nvelope's own Brevo account, which
// is separate from October's others.)
// The replacement posts to WordPress and keeps the key server-side in
// wp_options, which is where oc-forms already holds its own
// (ocf_brevo_api_key). See docs/nvelope/agent-guide.md.
const BREVO_API_KEY = '';

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

  const listId     = parseInt(form.dataset.listId, 10)     || null;
  const templateId = parseInt(form.dataset.templateId, 10) || null;
  const studioName = form.dataset.studioName || '';
  const studioUrl  = form.dataset.studioUrl  || window.location.href;

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