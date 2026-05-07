/* October Event Tickets — Checkout JS */
/* global octCheckout, Stripe, paypal */
(function ($) {
  'use strict';

  // ---- Config ----
  var cfg            = window.octCheckout || {};
  var ajaxUrl        = cfg.ajaxUrl || '';
  var nonce          = cfg.nonce || '';
  var stripeKey      = cfg.stripePublishable || '';
  var currency       = (cfg.currency || 'USD').toUpperCase();
  var currencySymbol = cfg.currencySymbol || '$';
  var taxRate        = parseFloat(cfg.taxRate) || 0;
  var taxLabel       = cfg.taxLabel || 'Tax';
  var termsUrl       = cfg.termsUrl || '';

  // ---- State ----
  var state = {
    eventId:          0,
    ticketTypes:      [],
    selectedType:     null,
    qty:              0,
    promoCode:        '',
    discountAmount:   0,
    promoValid:       false,
    subtotal:         0,
    taxAmount:        0,
    total:            0,
    stripeReady:      false,
    stripe:           null,
    cardElement:      null,
    paypalRendered:   false,
    processing:       false,
    hasTerms:         false,
  };

  // ---- Init ----
  function init() {
    var $checkout = $('.oct-checkout');
    if (!$checkout.length) return;

    state.eventId  = parseInt($checkout.data('event-id'), 10) || 0;
    state.hasTerms = $checkout.data('has-terms') === '1' || $checkout.data('has-terms') === 1;

    var $json = $('#oct-ticket-data-' + state.eventId);
    if ($json.length) {
      try { state.ticketTypes = JSON.parse($json.text()); } catch (e) {}
    }

    bindTicketRows();
    bindPromo();
    bindPaymentTabs();
    initStripe();
    initPayPal();
    bindFreeRegistration();
    bindWaitlist();

    updateSummary();
  }

  // ---- Ticket rows with inline qty ----
  function bindTicketRows() {
    $(document).on('click', '.oct-ticket-row__qty [data-action="plus"]', function (e) {
      e.stopPropagation();
      var $row = $(this).closest('.oct-ticket-row');
      if ($row.hasClass('oct-ticket-row--unavailable')) return;
      var $val = $row.find('.oct-qty-val');
      var current = parseInt($val.text(), 10) || 0;
      if (current >= 10) return;

      resetOtherRows($row);
      $val.text(current + 1);
      state.qty = current + 1;
      selectRow($row);
    });

    $(document).on('click', '.oct-ticket-row__qty [data-action="minus"]', function (e) {
      e.stopPropagation();
      var $row = $(this).closest('.oct-ticket-row');
      if ($row.hasClass('oct-ticket-row--unavailable')) return;
      var $val = $row.find('.oct-qty-val');
      var current = parseInt($val.text(), 10) || 0;
      if (current <= 0) return;

      $val.text(current - 1);
      state.qty = current - 1;

      if (state.qty === 0) {
        $row.removeClass('oct-ticket-row--selected');
        state.selectedType = null;
      } else {
        selectRow($row);
      }
      updateSummary();
    });

    $(document).on('click', '.oct-ticket-row:not(.oct-ticket-row--unavailable)', function (e) {
      if ($(e.target).closest('.oct-ticket-row__qty').length) return;
      var $row = $(this);
      resetOtherRows($row);
      var $val = $row.find('.oct-qty-val');
      var current = parseInt($val.text(), 10) || 0;
      if (current === 0) {
        $val.text(1);
        state.qty = 1;
      } else {
        state.qty = current;
      }
      selectRow($row);
    });

    $(document).on('keypress', '.oct-ticket-row:not(.oct-ticket-row--unavailable)', function (e) {
      if (e.which === 13 || e.which === 32) {
        e.preventDefault();
        $(this).trigger('click');
      }
    });
  }

  function resetOtherRows($currentRow) {
    $('.oct-ticket-row').not($currentRow).each(function () {
      $(this).removeClass('oct-ticket-row--selected');
      $(this).find('.oct-qty-val').text(0);
      $(this).find('input[type="radio"]').prop('checked', false);
    });
  }

  function selectRow($row) {
    $('.oct-ticket-row').removeClass('oct-ticket-row--selected');
    $row.addClass('oct-ticket-row--selected');
    $row.find('input[type="radio"]').prop('checked', true);

    var key = $row.data('key');
    state.selectedType = null;
    for (var i = 0; i < state.ticketTypes.length; i++) {
      if (state.ticketTypes[i].key === key) {
        state.selectedType = state.ticketTypes[i];
        break;
      }
    }

    state.promoCode      = '';
    state.discountAmount = 0;
    state.promoValid     = false;
    $('#oct-promo').val('');
    $('#oct-promo-message').hide();

    updateSummary();
  }

  // ---- Attendee names ----
  function updateAttendeeNames() {
    var $section = $('#oct-attendee-names-section');
    var $fields  = $('#oct-attendee-names-fields');
    var qty      = state.qty;

    if (!state.selectedType || qty < 1) {
      $section.hide();
      return;
    }

    // Build the right number of name fields
    var existing = $fields.find('.oct-attendee-name').length;
    if (existing === qty) {
      $section.show();
      return;
    }

    $fields.empty();
    for (var i = 1; i <= qty; i++) {
      var $group = $('<div class="oct-field-group"></div>');
      var label  = qty === 1 ? 'Attendee Name' : 'Attendee ' + i + ' Name';
      $group.append('<label class="oct-label">' + label + '</label>');
      $group.append(
        '<input type="text" class="oct-input oct-attendee-name" data-index="' + i + '" placeholder="Full name (optional)" autocomplete="off">'
      );
      $fields.append($group);
    }

    $section.show();
  }

  function getAttendeeNames() {
    var names = [];
    $('#oct-attendee-names-fields .oct-attendee-name').each(function () {
      names.push($(this).val().trim());
    });
    return names;
  }

  // ---- T&Cs validation ----
  function checkTerms() {
    if (!state.hasTerms) return true;
    var checked = $('#oct-terms-checkbox').is(':checked');
    if (!checked) {
      $('#oct-terms-error').show();
    } else {
      $('#oct-terms-error').hide();
    }
    return checked;
  }

  // ---- Promo code ----
  function bindPromo() {
    $('#oct-apply-promo').on('click', applyPromo);
    $('#oct-promo').on('keypress', function (e) {
      if (e.which === 13) { e.preventDefault(); applyPromo(); }
    });
    $('#oct-promo').on('input', function () {
      $(this).val($(this).val().toUpperCase());
    });
  }

  function applyPromo() {
    var code = $('#oct-promo').val().trim().toUpperCase();
    if (!code) return;

    var $msg = $('#oct-promo-message');
    $msg.removeClass('success error').text('Validating…').show();
    $('#oct-apply-promo').prop('disabled', true);

    $.post(ajaxUrl, {
      action:   'oct_validate_promo',
      nonce:    nonce,
      code:     code,
      event_id: state.eventId,
      subtotal: getSubtotal(),
    }, function (res) {
      $('#oct-apply-promo').prop('disabled', false);
      if (res.success) {
        state.promoCode      = code;
        state.discountAmount = parseFloat(res.data.discount_amount) || 0;
        state.promoValid     = true;
        $msg.addClass('success').text('Discount applied: ' + currencySymbol + state.discountAmount.toFixed(2) + ' off').show();
        updateSummary();
      } else {
        state.promoCode      = '';
        state.discountAmount = 0;
        state.promoValid     = false;
        var msg = (res.data && res.data.message) ? res.data.message : 'Invalid promo code.';
        $msg.addClass('error').text(msg).show();
        updateSummary();
      }
    }).fail(function () {
      $('#oct-apply-promo').prop('disabled', false);
      $msg.addClass('error').text('Could not validate promo code. Please try again.').show();
    });
  }

  // ---- Summary ----
  function getSubtotal() {
    if (!state.selectedType || state.qty <= 0) return 0;
    var price = state.selectedType.sale_price !== null && state.selectedType.sale_price !== undefined
      ? parseFloat(state.selectedType.sale_price)
      : parseFloat(state.selectedType.price);
    return Math.round((price * state.qty) * 100) / 100;
  }

  function updateSummary() {
    var subtotal = getSubtotal();
    var discount = state.promoValid ? state.discountAmount : 0;
    var taxBase  = Math.max(0, subtotal - discount);
    var tax      = taxRate > 0 ? Math.round(taxBase * taxRate) / 100 : 0;
    var total    = Math.round((taxBase + tax) * 100) / 100;

    state.subtotal   = subtotal;
    state.taxAmount  = tax;
    state.total      = total;

    if (state.selectedType && state.qty > 0) {
      $('#oct-summary-type').text(state.selectedType.label);
      $('#oct-summary-count').text('×' + state.qty);
      $('#oct-summary-subtotal').text(currencySymbol + subtotal.toFixed(2));
    } else {
      $('#oct-summary-type').text('—');
      $('#oct-summary-count').text('');
      $('#oct-summary-subtotal').text(currencySymbol + '0.00');
    }

    if (discount > 0) {
      $('#oct-discount-row').show();
      $('#oct-summary-discount').text('−' + currencySymbol + discount.toFixed(2));
    } else {
      $('#oct-discount-row').hide();
    }

    if (tax > 0) {
      $('#oct-tax-row').show();
      $('#oct-tax-label').text(taxLabel + ' (' + taxRate + '%)');
      $('#oct-summary-tax').text(currencySymbol + tax.toFixed(2));
    } else {
      $('#oct-tax-row').hide();
    }

    $('#oct-summary-total').text(currencySymbol + total.toFixed(2));
    $('#oct-card-btn-amount').text(currencySymbol + total.toFixed(2));

    updateAttendeeNames();

    var isFree = state.selectedType && state.qty > 0 && total === 0;
    $('#oct-payment-section').toggle(!isFree);
    $('#oct-free-section').toggle(isFree);
  }

  // ---- Payment tabs ----
  function bindPaymentTabs() {
    $(document).on('click', '.oct-tab', function () {
      var $this  = $(this);
      var target = $this.attr('aria-controls');

      $('.oct-tab').removeClass('oct-tab--active').attr('aria-selected', 'false');
      $this.addClass('oct-tab--active').attr('aria-selected', 'true');

      $('.oct-payment-panel').hide().attr('aria-hidden', 'true');
      $('#' + target).show().attr('aria-hidden', 'false');

      if (target === 'panel-paypal' && !state.paypalRendered) {
        renderPayPalButtons();
      }
    });
  }

  // ---- Free ticket registration ----
  function bindFreeRegistration() {
    $('#oct-register-free').on('click', handleFreeRegistration);
  }

  function handleFreeRegistration() {
    if (state.processing) return;

    var email = $('#oct-email').val().trim();
    var name  = $('#oct-name').val().trim();

    if (!email || !isValidEmail(email)) {
      $('#oct-email').addClass('error').focus();
      $('#oct-free-errors').text('Please enter a valid email address.').show();
      return;
    }
    if (!state.selectedType || state.qty <= 0) {
      $('#oct-free-errors').text('Please select a ticket type.').show();
      return;
    }
    if (!checkTerms()) return;

    $('#oct-free-errors').hide();
    setProcessing(true, '#oct-register-free');

    $.post(ajaxUrl, {
      action:           'oct_register_free',
      nonce:            nonce,
      event_id:         state.eventId,
      ticket_type_key:  state.selectedType.key,
      qty:              state.qty,
      promo_code:       state.promoCode,
      name:             name,
      email:            email,
      attendee_names:   getAttendeeNames(),
    }, function (res) {
      setProcessing(false, '#oct-register-free');
      if (res.success) {
        showSuccess(res.data.ticket_urls || []);
      } else {
        $('#oct-free-errors').text((res.data && res.data.message) ? res.data.message : 'Registration failed. Please try again.').show();
      }
    }).fail(function () {
      setProcessing(false, '#oct-register-free');
      $('#oct-free-errors').text('Network error. Please try again.').show();
    });
  }

  // ---- Stripe ----
  function initStripe() {
    if (!stripeKey || typeof Stripe === 'undefined') return;

    state.stripe = Stripe(stripeKey);
    var elements = state.stripe.elements({
      fonts: [{ cssSrc: 'https://fonts.googleapis.com/css?family=Inter' }],
    });

    state.cardElement = elements.create('card', {
      style: {
        base: {
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
          fontSize:   '15px',
          color:      '#1a1a1a',
          '::placeholder': { color: '#aab7c4' },
        },
        invalid: { color: '#e53935', iconColor: '#e53935' },
      },
      hidePostalCode: false,
    });

    state.cardElement.mount('#oct-stripe-elements');
    state.stripeReady = true;

    state.cardElement.on('focus', function () { $('#oct-stripe-elements').addClass('focused'); });
    state.cardElement.on('blur',  function () { $('#oct-stripe-elements').removeClass('focused'); });
    state.cardElement.on('change', function (event) {
      if (event.error) { showCardError(event.error.message); } else { hideCardError(); }
    });

    $('#oct-pay-card').on('click', handleCardPayment);
  }

  function handleCardPayment() {
    if (state.processing) return;

    var email = $('#oct-email').val().trim();
    var name  = $('#oct-name').val().trim();

    if (!email || !isValidEmail(email)) {
      $('#oct-email').addClass('error').focus();
      showCardError('Please enter a valid email address.');
      return;
    }
    if (!state.selectedType || state.qty <= 0) {
      showCardError('Please select a ticket type.');
      return;
    }
    if (!checkTerms()) {
      showCardError('Please agree to the Terms & Conditions.');
      return;
    }

    hideCardError();
    setProcessing(true, '#oct-pay-card');

    $.post(ajaxUrl, {
      action:          'oct_create_payment_intent',
      nonce:           nonce,
      event_id:        state.eventId,
      ticket_type_key: state.selectedType.key,
      qty:             state.qty,
      promo_code:      state.promoCode,
      email:           email,
    }, function (res) {
      if (!res.success) {
        setProcessing(false, '#oct-pay-card');
        showCardError((res.data && res.data.message) ? res.data.message : 'Could not initialise payment.');
        return;
      }

      var clientSecret = res.data.client_secret;
      var piId         = res.data.payment_intent_id;

      state.stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card:            state.cardElement,
          billing_details: { name: name, email: email },
        },
      }).then(function (result) {
        if (result.error) {
          setProcessing(false, '#oct-pay-card');
          showCardError(result.error.message);
          return;
        }

        $.post(ajaxUrl, {
          action:            'oct_confirm_stripe_payment',
          nonce:             nonce,
          payment_intent_id: piId,
          event_id:          state.eventId,
          ticket_type_key:   state.selectedType.key,
          qty:               state.qty,
          name:              name,
          email:             email,
          promo_code:        state.promoCode,
          attendee_names:    getAttendeeNames(),
        }, function (res2) {
          setProcessing(false, '#oct-pay-card');
          if (res2.success) {
            showSuccess(res2.data.ticket_urls || []);
          } else {
            showCardError((res2.data && res2.data.message) ? res2.data.message : 'Payment confirmed but order creation failed. Please contact us with your payment ID: ' + piId);
          }
        }).fail(function () {
          setProcessing(false, '#oct-pay-card');
          showCardError('Network error. Payment may have succeeded — please check your email before trying again.');
        });
      });
    }).fail(function () {
      setProcessing(false, '#oct-pay-card');
      showCardError('Network error. Please try again.');
    });
  }

  function showCardError(msg) { $('#oct-card-errors').text(msg).show(); }
  function hideCardError()    { $('#oct-card-errors').hide().text(''); }

  // ---- PayPal ----
  function initPayPal() {
    if (!stripeKey && typeof paypal !== 'undefined') {
      renderPayPalButtons();
    }
  }

  function renderPayPalButtons() {
    if (state.paypalRendered || typeof paypal === 'undefined') return;
    state.paypalRendered = true;

    var fundingSources = [];
    if (paypal.FUNDING && paypal.FUNDING.PAYLATER) { fundingSources.push(paypal.FUNDING.PAYLATER); }
    if (paypal.FUNDING && paypal.FUNDING.PAYPAL)   { fundingSources.push(paypal.FUNDING.PAYPAL); }
    if (!fundingSources.length) { fundingSources = ['paylater', 'paypal']; }

    fundingSources.forEach(function (fundingSource) {
      paypal.Buttons({
        fundingSource: fundingSource,

        createOrder: function () {
          var email = $('#oct-email').val().trim();
          if (!email || !isValidEmail(email)) {
            $('#oct-email').addClass('error').focus();
            $('#oct-paypal-errors').text('Please enter a valid email address.').show();
            return Promise.reject('email_required');
          }
          if (!state.selectedType || state.qty <= 0) {
            $('#oct-paypal-errors').text('Please select a ticket type.').show();
            return Promise.reject('no_ticket');
          }
          if (!checkTerms()) {
            return Promise.reject('terms_required');
          }
          $('#oct-paypal-errors').hide();

          return new Promise(function (resolve, reject) {
            $.post(ajaxUrl, {
              action:          'oct_create_paypal_order',
              nonce:           nonce,
              event_id:        state.eventId,
              ticket_type_key: state.selectedType.key,
              qty:             state.qty,
              promo_code:      state.promoCode,
              email:           email,
            }, function (res) {
              if (res.success && res.data.paypal_order_id) {
                resolve(res.data.paypal_order_id);
              } else {
                var msg = (res.data && res.data.message) ? res.data.message : 'Could not create PayPal order.';
                $('#oct-paypal-errors').text(msg).show();
                reject(msg);
              }
            }).fail(function () {
              $('#oct-paypal-errors').text('Network error. Please try again.').show();
              reject('network_error');
            });
          });
        },

        onApprove: function (data) {
          var email = $('#oct-email').val().trim();
          var name  = $('#oct-name').val().trim();
          $('#oct-paypal-errors').hide();

          return new Promise(function (resolve) {
            $.post(ajaxUrl, {
              action:          'oct_capture_paypal_order',
              nonce:           nonce,
              paypal_order_id: data.orderID,
              event_id:        state.eventId,
              ticket_type_key: state.selectedType.key,
              qty:             state.qty,
              name:            name,
              email:           email,
              promo_code:      state.promoCode,
              attendee_names:  getAttendeeNames(),
            }, function (res) {
              if (res.success) {
                showSuccess(res.data.ticket_urls || []);
                resolve();
              } else {
                var msg = (res.data && res.data.message) ? res.data.message : 'Order capture failed.';
                $('#oct-paypal-errors').text(msg).show();
                resolve();
              }
            }).fail(function () {
              $('#oct-paypal-errors').text('Network error after payment. Please check your email or contact support.').show();
              resolve();
            });
          });
        },

        onError: function (err) {
          console.error('PayPal error:', err);
          $('#oct-paypal-errors').text('PayPal encountered an error. Please try again.').show();
        },

        onCancel: function () { $('#oct-paypal-errors').hide(); },
      }).render('#oct-paypal-buttons');
    });
  }

  // ---- Success state ----
  function showSuccess(ticketUrls) {
    $('#oct-checkout-form').hide();
    $('#oct-success').show();

    var $links = $('#oct-ticket-links');
    $links.empty();

    if (ticketUrls && ticketUrls.length) {
      ticketUrls.forEach(function (url, i) {
        var $a = $('<a>')
          .addClass('oct-ticket-link')
          .attr('href', url)
          .attr('target', '_blank')
          .text('View Ticket ' + (i + 1) + ' →');
        $links.append($a);
      });
    }

    $('html, body').animate({ scrollTop: $('#oct-success').offset().top - 40 }, 400);
  }

  // ---- UI helpers ----
  function setProcessing(isProcessing, btnSelector) {
    state.processing = isProcessing;
    var $btn = $(btnSelector);
    if (isProcessing) {
      $btn.prop('disabled', true);
      $btn.data('original-html', $btn.html());
      $btn.html('<span class="oct-spinner"></span> Processing…');
    } else {
      $btn.prop('disabled', false);
      if ($btn.data('original-html')) {
        $btn.html($btn.data('original-html'));
      }
    }
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  // ---- Waitlist ----
  function bindWaitlist() {
    var $modal = $('#oct-waitlist-modal');
    var currentWaitlistKey   = '';
    var currentWaitlistLabel = '';

    $(document).on('click', '.oct-btn-waitlist', function (e) {
      e.stopPropagation();
      currentWaitlistKey   = $(this).data('key');
      currentWaitlistLabel = $(this).data('label');
      $('#oct-waitlist-ticket-label').text(currentWaitlistLabel);
      $('#oct-waitlist-email').val($('#oct-email').val());
      $('#oct-waitlist-name').val($('#oct-name').val());
      $('#oct-waitlist-message').hide().removeClass('success error');
      $modal.show();
    });

    $('#oct-waitlist-cancel, .oct-waitlist-modal__backdrop').on('click', function () {
      $modal.hide();
    });

    $('#oct-waitlist-submit').on('click', function () {
      var email = $('#oct-waitlist-email').val().trim();
      var name  = $('#oct-waitlist-name').val().trim();
      var $msg  = $('#oct-waitlist-message');

      if (!email || !isValidEmail(email)) {
        $msg.removeClass('success').addClass('error').text('Please enter a valid email address.').show();
        return;
      }

      var $btn = $(this);
      $btn.prop('disabled', true).text('Joining…');

      $.post(ajaxUrl, {
        action:          'oct_join_waitlist',
        nonce:           nonce,
        event_id:        state.eventId,
        ticket_type_key: currentWaitlistKey,
        email:           email,
        name:            name,
      }, function (res) {
        $btn.prop('disabled', false).text('Join Waitlist');
        if (res.success) {
          $msg.removeClass('error').addClass('success').text(res.data.message).show();
          setTimeout(function () { $modal.hide(); }, 3000);
        } else {
          $msg.removeClass('success').addClass('error').text((res.data && res.data.message) ? res.data.message : 'Could not join waitlist.').show();
        }
      }).fail(function () {
        $btn.prop('disabled', false).text('Join Waitlist');
        $msg.removeClass('success').addClass('error').text('Network error. Please try again.').show();
      });
    });
  }

  // ---- Boot ----
  $(document).ready(init);

})(jQuery);
