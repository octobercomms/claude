/* October Events — event checkout. Ported from Event Tickets v1.2.5 (per-row qty
   steppers, attendee names, T&Cs, sold-out waitlist) and extended to a true
   MULTI-LINE cart (mix ticket types in one order). Wired to oe/v1 + Stripe.
   Keeps the original .oct- markup so the look matches the live design exactly. */
/* global jQuery, Stripe */
(function ($) {
  'use strict';

  var cfg            = window.octCheckout || {};
  var nonce          = cfg.nonce || '';
  var stripeKey      = cfg.stripePublishable || '';
  var currencySymbol = cfg.currencySymbol || '$';

  var state = {
    eventId: 0, ticketTypes: [], cart: [],
    promoCode: '', discountAmount: 0, promoValid: false,
    subtotal: 0, total: 0, stripe: null, cardElement: null,
    processing: false, hasTerms: false,
  };

  function rest(path, body) {
    return new Promise(function (resolve) {
      $.ajax({
        url: cfg.restUrl + path, method: 'POST', contentType: 'application/json',
        headers: { 'X-WP-Nonce': nonce }, data: JSON.stringify(body), dataType: 'json',
      }).done(function (b) { resolve({ ok: true, body: b || {} }); })
        .fail(function (xhr) { resolve({ ok: false, body: (xhr && xhr.responseJSON) || {} }); });
    });
  }
  function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
  function typePrice(t) { return parseFloat(t.effective != null ? t.effective : t.price) || 0; }
  function escHtml(s) { return $('<div>').text(s == null ? '' : s).html(); }

  function init() {
    var $checkout = $('.oct-checkout');
    if (!$checkout.length) { return; }
    state.eventId  = parseInt($checkout.data('event-id'), 10) || 0;
    state.hasTerms = String($checkout.data('has-terms')) === '1';
    state.ticketTypes = cfg.types || [];

    bindTicketRows();
    bindPromo();
    initStripe();
    bindFreeRegistration();
    bindWaitlist();
    updateSummary();
  }

  /* ---- Cart: every row with qty > 0 is a line. Rows are independent. ---- */
  function typeFor(key) {
    for (var i = 0; i < state.ticketTypes.length; i++) { if (state.ticketTypes[i].key === key) { return state.ticketTypes[i]; } }
    return null;
  }
  function readCart() {
    var cart = [];
    $('.oct-ticket-row').each(function () {
      var $row = $(this);
      if ($row.hasClass('oct-ticket-row--unavailable')) { return; }
      var qty = parseInt($row.find('.oct-qty-val').text(), 10) || 0;
      if (qty < 1) { return; }
      var type = typeFor($row.data('key'));
      if (type) { cart.push({ key: $row.data('key'), qty: qty, type: type }); }
    });
    return cart;
  }
  function setRowQty($row, n) {
    n = Math.max(0, Math.min(10, n));
    $row.find('.oct-qty-val').text(n);
    $row.toggleClass('oct-ticket-row--selected', n > 0);
    resetPromo();      // any cart change invalidates a previously-applied code
    updateSummary();
  }
  function resetPromo() {
    state.promoCode = ''; state.discountAmount = 0; state.promoValid = false;
    $('#oct-promo').val(''); $('#oct-promo-message').hide().removeClass('success error');
  }
  function bindTicketRows() {
    // Clicking the row body (not the qty control) adds one if none yet.
    $(document).on('click', '.oct-ticket-row:not(.oct-ticket-row--unavailable)', function (e) {
      if ($(e.target).closest('.oct-ticket-row__qty').length) { return; }
      var $row = $(this);
      if ((parseInt($row.find('.oct-qty-val').text(), 10) || 0) === 0) { setRowQty($row, 1); }
    });
    $(document).on('keypress', '.oct-ticket-row:not(.oct-ticket-row--unavailable)', function (e) {
      if (e.which === 13 || e.which === 32) { e.preventDefault(); $(this).trigger('click'); }
    });
  }

  /* ---- Attendee names (across the whole cart, in row order) ---- */
  function updateAttendeeNames(cart) {
    var $section = $('#oct-attendee-names-section'), $fields = $('#oct-attendee-names-fields');
    var total = 0;
    cart.forEach(function (c) { total += c.qty * (parseInt(c.type.admits, 10) || 1); });
    if (total < 1) { $section.hide(); return; }
    if ($fields.find('.oct-attendee-name').length === total) { $section.show(); return; }
    $fields.empty();
    for (var i = 1; i <= total; i++) {
      var label = total === 1 ? 'Attendee Name' : 'Attendee ' + i + ' Name';
      $('<div class="oct-field-group"></div>')
        .append('<label class="oct-label">' + label + '</label>')
        .append('<input type="text" class="oct-input oct-attendee-name" placeholder="Full name (optional)" autocomplete="off">')
        .appendTo($fields);
    }
    $section.show();
  }
  function getAttendeeNames() {
    var names = [];
    $('#oct-attendee-names-fields .oct-attendee-name').each(function () { names.push($(this).val().trim()); });
    return names;
  }

  /* ---- T&Cs ---- */
  function checkTerms() {
    if (!state.hasTerms) { return true; }
    var ok = $('#oct-terms-checkbox').is(':checked');
    $('#oct-terms-error').toggle(!ok);
    return ok;
  }

  /* ---- Promo ---- */
  function bindPromo() {
    $('#oct-apply-promo').on('click', applyPromo);
    $('#oct-promo').on('keypress', function (e) { if (e.which === 13) { e.preventDefault(); applyPromo(); } });
    $('#oct-promo').on('input', function () { $(this).val($(this).val().toUpperCase()); });
  }
  function cartParam() { return readCart().map(function (c) { return { type_key: c.key, qty: c.qty }; }); }
  function applyPromo() {
    var code = $('#oct-promo').val().trim().toUpperCase();
    var cart = cartParam();
    if (!code || !cart.length) { return; }
    var $msg = $('#oct-promo-message');
    $msg.removeClass('success error').text('Validating…').show();
    $('#oct-apply-promo').prop('disabled', true);
    rest('/ticket-promo', { event_id: state.eventId, cart: cart, promo_code: code }).then(function (res) {
      $('#oct-apply-promo').prop('disabled', false);
      if (res.ok) {
        state.promoCode = code; state.discountAmount = parseFloat(res.body.discount) || 0; state.promoValid = true;
        $msg.addClass('success').text('Discount applied: ' + currencySymbol + state.discountAmount.toFixed(2) + ' off').show();
      } else {
        state.promoCode = ''; state.discountAmount = 0; state.promoValid = false;
        $msg.addClass('error').text(res.body.error || 'Invalid promo code.').show();
      }
      updateSummary();
    });
  }

  /* ---- Summary ---- */
  function updateSummary() {
    var cart = readCart();
    var subtotal = 0;
    cart.forEach(function (c) { subtotal += typePrice(c.type) * c.qty; });
    subtotal = Math.round(subtotal * 100) / 100;
    var discount = state.promoValid ? state.discountAmount : 0;
    var total = Math.max(0, Math.round((subtotal - discount) * 100) / 100);
    state.subtotal = subtotal; state.total = total; state.cart = cart;

    var $lines = $('#oct-summary-lines').empty();
    if (cart.length) {
      cart.forEach(function (c) {
        $lines.append(
          '<div class="oct-summary-row"><span class="oct-summary-label">' + escHtml(c.type.label) + '</span>' +
          '<span class="oct-summary-label">×' + c.qty + '</span>' +
          '<span class="oct-summary-price">' + currencySymbol + (typePrice(c.type) * c.qty).toFixed(2) + '</span></div>'
        );
      });
    } else {
      $lines.append('<div class="oct-summary-row"><span class="oct-summary-label">—</span><span class="oct-summary-label"></span><span class="oct-summary-price">' + currencySymbol + '0.00</span></div>');
    }
    if (discount > 0) {
      $('#oct-discount-row').show();
      $('#oct-summary-discount').text('−' + currencySymbol + discount.toFixed(2));
    } else { $('#oct-discount-row').hide(); }

    $('#oct-summary-total').text(currencySymbol + total.toFixed(2));
    $('#oct-card-btn-amount').text(currencySymbol + total.toFixed(2));
    updateAttendeeNames(cart);

    var isFree = cart.length > 0 && total === 0;
    $('#oct-payment-section').toggle(!isFree);
    $('#oct-free-section').toggle(!!isFree);
  }

  /* ---- Free registration ---- */
  function bindFreeRegistration() { $('#oct-register-free').on('click', handleFree); }
  function handleFree() {
    if (state.processing) { return; }
    var email = $('#oct-email').val().trim(), name = $('#oct-name').val().trim();
    if (!email || !isValidEmail(email)) { $('#oct-email').addClass('error').focus(); $('#oct-free-errors').text('Please enter a valid email address.').show(); return; }
    if (!readCart().length) { $('#oct-free-errors').text('Please choose at least one ticket.').show(); return; }
    if (!checkTerms()) { return; }
    $('#oct-free-errors').hide(); setProcessing(true, '#oct-register-free');
    rest('/ticket-intent', payload(name, email)).then(function (res) {
      setProcessing(false, '#oct-register-free');
      if (res.ok && res.body.free) { showSuccess(res.body.tickets); }
      else { $('#oct-free-errors').text(res.body.error || 'Registration failed. Please try again.').show(); }
    });
  }

  /* ---- Stripe ---- */
  function initStripe() {
    if (!stripeKey || typeof Stripe === 'undefined') { return; }
    state.stripe = Stripe(stripeKey);
    state.cardElement = state.stripe.elements().create('card', {
      style: { base: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif', fontSize: '15px', color: '#1a1a1a', '::placeholder': { color: '#aab7c4' } }, invalid: { color: '#e53935', iconColor: '#e53935' } },
    });
    state.cardElement.mount('#oct-stripe-elements');
    state.cardElement.on('focus', function () { $('#oct-stripe-elements').addClass('focused'); });
    state.cardElement.on('blur', function () { $('#oct-stripe-elements').removeClass('focused'); });
    state.cardElement.on('change', function (e) { if (e.error) { showCardError(e.error.message); } else { hideCardError(); } });
    $('#oct-pay-card').on('click', handleCard);
  }
  function payload(name, email) {
    return { event_id: state.eventId, cart: cartParam(), promo_code: state.promoCode, name: name, email: email, attendee_names: getAttendeeNames() };
  }
  function handleCard() {
    if (state.processing) { return; }
    var email = $('#oct-email').val().trim(), name = $('#oct-name').val().trim();
    if (!email || !isValidEmail(email)) { $('#oct-email').addClass('error').focus(); showCardError('Please enter a valid email address.'); return; }
    if (!readCart().length) { showCardError('Please choose at least one ticket.'); return; }
    if (!checkTerms()) { showCardError('Please agree to the Terms & Conditions.'); return; }
    hideCardError(); setProcessing(true, '#oct-pay-card');

    rest('/ticket-intent', payload(name, email)).then(function (res) {
      if (!res.ok) { setProcessing(false, '#oct-pay-card'); showCardError(res.body.error || 'Could not initialise payment.'); return; }
      if (res.body.free) { setProcessing(false, '#oct-pay-card'); showSuccess(res.body.tickets); return; }
      state.stripe.confirmCardPayment(res.body.client_secret, {
        payment_method: { card: state.cardElement, billing_details: { name: name, email: email } },
      }).then(function (result) {
        if (result.error) { setProcessing(false, '#oct-pay-card'); showCardError(result.error.message); return; }
        rest('/ticket-confirm', { intent_id: res.body.intent_id }).then(function (c) {
          setProcessing(false, '#oct-pay-card');
          if (c.ok) { showSuccess(c.body.tickets); }
          else { showCardError(c.body.error || 'Payment confirmed but order creation failed. Please contact us.'); }
        });
      });
    });
  }
  function showCardError(m) { $('#oct-card-errors').text(m).show(); }
  function hideCardError() { $('#oct-card-errors').hide().text(''); }

  /* ---- Waitlist (sold out) ---- */
  function bindWaitlist() {
    var $modal = $('#oct-waitlist-modal'), curKey = '', curLabel = '';
    $(document).on('click', '.oct-btn-waitlist', function (e) {
      e.stopPropagation();
      curKey = $(this).data('key'); curLabel = $(this).data('label');
      $('#oct-waitlist-ticket-label').text(curLabel);
      $('#oct-waitlist-email').val($('#oct-email').val());
      $('#oct-waitlist-name').val($('#oct-name').val());
      $('#oct-waitlist-message').hide().removeClass('success error');
      $modal.show();
    });
    $('#oct-waitlist-cancel, .oct-waitlist-modal__backdrop').on('click', function () { $modal.hide(); });
    $('#oct-waitlist-submit').on('click', function () {
      var email = $('#oct-waitlist-email').val().trim(), name = $('#oct-waitlist-name').val().trim(), $msg = $('#oct-waitlist-message');
      if (!email || !isValidEmail(email)) { $msg.removeClass('success').addClass('error').text('Please enter a valid email address.').show(); return; }
      var $btn = $(this); $btn.prop('disabled', true).text('Joining…');
      rest('/waitlist-join', { event_id: state.eventId, type_key: curKey, email: email, name: name }).then(function (res) {
        $btn.prop('disabled', false).text('Join Waitlist');
        if (res.ok) { $msg.removeClass('error').addClass('success').text('You\'re on the list — we\'ll email you if a spot opens up.').show(); setTimeout(function () { $modal.hide(); }, 3000); }
        else { $msg.removeClass('success').addClass('error').text(res.body.error || 'Could not join waitlist.').show(); }
      });
    });
  }

  /* ---- Success ---- */
  function showSuccess(tickets) {
    $('#oct-checkout-form').hide();
    $('#oct-success').show();
    var $links = $('#oct-ticket-links').empty();
    (tickets || []).forEach(function (t, i) {
      if (!t || !t.url) { return; }
      $('<a>').addClass('oct-ticket-link').attr('href', t.url).attr('target', '_blank').text('View Ticket ' + (i + 1) + ' →').appendTo($links);
    });
    if ($('#oct-success').offset()) { $('html, body').animate({ scrollTop: $('#oct-success').offset().top - 40 }, 400); }
  }

  /* ---- UI helpers ---- */
  function setProcessing(on, sel) {
    state.processing = on;
    var $btn = $(sel);
    if (on) { $btn.prop('disabled', true); $btn.data('html', $btn.html()); $btn.html('<span class="oct-spinner"></span> Processing…'); }
    else { $btn.prop('disabled', false); if ($btn.data('html')) { $btn.html($btn.data('html')); } }
  }

  /* ---- Inline qty handler (called by the buttons' onclick) — per row ---- */
  window.octHandleQty = function (btn, action) {
    if (!state.eventId) { state.eventId = parseInt($('.oct-checkout').data('event-id'), 10) || 0; state.ticketTypes = cfg.types || []; }
    var $row = $(btn).closest('.oct-ticket-row');
    if (!$row.length || $row.hasClass('oct-ticket-row--unavailable')) { return; }
    var current = parseInt($row.find('.oct-qty-val').text(), 10) || 0;
    setRowQty($row, action === 'plus' ? current + 1 : current - 1);
  };

  $(document).ready(init);
})(jQuery);
