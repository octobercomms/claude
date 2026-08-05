/* ============================================================
   Your Architect – Archie — client portal payment (Stripe Payment Element).
   Fetches a PaymentIntent client_secret for the token, mounts the embedded
   Payment Element, and confirms — returning to the portal, where the webhook
   has marked the project paid and the drawings unlock.
   ============================================================ */
(function () {
  'use strict';
  var D = window.yaaPortal || {};
  var mount = document.getElementById('yaa-pay-element');
  var btn = document.getElementById('yaa-pay-btn');
  var msg = document.getElementById('yaa-pay-msg');
  if (!mount || !btn || !window.Stripe) return;

  var stripe = null, elements = null, ready = false;

  btn.disabled = true;
  fetch(D.rest + 'pay-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: D.token })
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || !d.clientSecret) {
        msg.textContent = (d && d.error) || 'We couldn’t start the payment. Please refresh or contact us.';
        return;
      }
      stripe = Stripe(d.publishable);
      elements = stripe.elements({ clientSecret: d.clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: '#253E94' } } });
      elements.create('payment').mount('#yaa-pay-element');
      ready = true;
      btn.disabled = false;
    })
    .catch(function () { msg.textContent = 'We couldn’t start the payment. Please refresh.'; });

  btn.addEventListener('click', function () {
    if (!ready) return;
    btn.disabled = true;
    msg.textContent = '';
    stripe.confirmPayment({ elements: elements, confirmParams: { return_url: D.returnUrl } })
      .then(function (res) {
        if (res && res.error) {
          msg.textContent = res.error.message || 'Payment could not be completed.';
          btn.disabled = false;
        }
      });
  });
})();
