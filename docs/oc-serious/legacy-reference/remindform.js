// SECURITY: The original file hardcoded a live Brevo *private* API key here and
// shipped it to every browser. That key has been redacted from this reference
// copy and MUST be rotated in Brevo. In October Serious Buyer this call moves
// server-side (via October Forms) so the key never reaches the client.
const BREVO_API_KEY = 'REDACTED-ROTATE-THIS-KEY';  // ← was exposed client-side; do NOT do this

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