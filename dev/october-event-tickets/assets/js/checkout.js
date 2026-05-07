/* October Event Tickets — Checkout JS */
/* global octCheckout, Stripe, paypal */
(function ($) {
  'use strict';

  // ---- Config ----
  var cfg           = window.octCheckout || {};
  var ajaxUrl       = cfg.ajaxUrl || '';
  var nonce         = cfg.nonce || '';
  var stripeKey     = cfg.stripePublishable || '';
  var currency      = (cfg.currency || 'USD').toUpperCase();
  var currencySymbol = cfg.currencySymbol || '$';

  // ---- State ----
  var state = {
    eventId:          0,
    ticketTypes:      [],
    selectedType:     null,
    qty:              1,
    promoCode:        '',
    discountAmount:   0,
    promoValid:       false,
    subtotal:         0,
    total:            0,
    stripeReady:      false,
    stripe:           null,
    cardElement:      null,
    paypalRendered:   false,
    processing:       false,
  };

  // ---- Init ----
  function init() {
    var $checkout = $('.oct-checkout');
    if (!$checkout.length) return;

    state.eventId = parseInt($checkout.data('event-id'), 10) || 0;

    // Load ticket type data from embedded JSON
    var $json = $('#oct-ticket-data-' + state.eventId);
    if ($json.length) {
      try { state.ticketTypes = JSON.parse($json.text()); } catch (e) {}
    }

    bindTicketCards();
    bindQtyControls();
    bindPromo();
    bindPaymentTabs();
    initStripe();
    initPayPal();

    // Select first ticket type
    var $firstCard = $('.oct-ticket-card').first();
    if ($firstCard.length) {
      selectTicketCard($firstCard);
    }
  }

  // ---- Ticket cards ----
  function bindTicketCards() {
    $(document).on('click', '.oct-ticket-card', function () {
      selectTicketCard($(this));
    });
  }

  function selectTicketCard($card) {
    $('.oct-ticket-card').removeClass('oct-ticket-card--selected');
    $card.addClass('oct-ticket-card--selected');
    $card.find('input[type="radio"]').prop('checked', true);

    var key = $card.data('key');
    state.selectedType = null;
    for (var i = 0; i < state.ticketTypes.length; i++) {
      if (state.ticketTypes[i].key === key) {
        state.selectedType = state.ticketTypes[i];
        break;
      }
    }

    // Reset promo when ticket changes
    state.promoCode      = '';
    state.discountAmount = 0;
    state.promoValid     = false;
    $('#oct-promo').val('');
    $('#oct-promo-message').hide();

    updateSummary();
  }

  // ---- Quantity ----
  function bindQtyControls() {
    $('#oct-qty-plus').on('click', function () {
      var val = parseInt($('#oct-qty').val(), 10) || 1;
      if (val < 10) {
        $('#oct-qty').val(val + 1);
        state.qty = val + 1;
        updateSummary();
      }
    });

    $('#oct-qty-minus').on('click', function () {
      var val = parseInt($('#oct-qty').val(), 10) || 1;
      if (val > 1) {
        $('#oct-qty').val(val - 1);
        state.qty = val - 1;
        updateSummary();
      }
    });

    $('#oct-qty').on('change', function () {
      var val = Math.max(1, Math.min(10, parseInt($(this).val(), 10) || 1));
      $(this).val(val);
      state.qty = val;
      updateSummary();
    });
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
    if (!state.selectedType) return 0;
    var price = state.selectedType.sale_price !== null && state.selectedType.sale_price !== undefined
      ? parseFloat(state.selectedType.sale_price)
      : parseFloat(state.selectedType.price);
    return Math.round((price * state.qty) * 100) / 100;
  }

  function updateSummary() {
    if (!state.selectedType) return;

    var subtotal = getSubtotal();
    var discount = state.promoValid ? state.discountAmount : 0;
    var total    = Math.max(0, subtotal - discount);

    state.subtotal = subtotal;
    state.total    = total;

    $('#oct-summary-type').text(state.selectedType.label);
    $('#oct-summary-count').text('×' + state.qty);
    $('#oct-summary-subtotal').text(currencySymbol + subtotal.toFixed(2));

    if (discount > 0) {
      $('#oct-discount-row').show();
      $('#oct-summary-discount').text('−' + currencySymbol + discount.toFixed(2));
    } else {
      $('#oct-discount-row').hide();
    }

    $('#oct-summary-total').text(currencySymbol + total.toFixed(2));
    $('#oct-card-btn-amount').text(currencySymbol + total.toFixed(2));
  }

  // ---- Payment tabs ----
  function bindPaymentTabs() {
    $(document).on('click', '.oct-tab', function () {
      var $this = $(this);
      var target = $this.attr('aria-controls');

      $('.oct-tab').removeClass('oct-tab--active').attr('aria-selected', 'false');
      $this.addClass('oct-tab--active').attr('aria-selected', 'true');

      $('.oct-payment-panel').hide().attr('aria-hidden', 'true');
      $('#' + target).show().attr('aria-hidden', 'false');

      // Init PayPal lazily when its tab is first shown
      if (target === 'panel-paypal' && !state.paypalRendered) {
        renderPayPalButtons();
      }
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
        invalid: {
          color: '#e53935',
          iconColor: '#e53935',
        },
      },
      hidePostalCode: false,
    });

    state.cardElement.mount('#oct-stripe-elements');
    state.stripeReady = true;

    state.cardElement.on('focus', function () {
      $('#oct-stripe-elements').addClass('focused');
    });
    state.cardElement.on('blur', function () {
      $('#oct-stripe-elements').removeClass('focused');
    });
    state.cardElement.on('change', function (event) {
      if (event.error) {
        showCardError(event.error.message);
      } else {
        hideCardError();
      }
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

    if (!state.selectedType) {
      showCardError('Please select a ticket type.');
      return;
    }

    hideCardError();
    setProcessing(true, '#oct-pay-card');

    // Step 1: Create PaymentIntent
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

      // Step 2: Confirm card payment via Stripe.js
      state.stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: state.cardElement,
          billing_details: { name: name, email: email },
        },
      }).then(function (result) {
        if (result.error) {
          setProcessing(false, '#oct-pay-card');
          showCardError(result.error.message);
          return;
        }

        // Step 3: Confirm server-side and create order
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

  function showCardError(msg) {
    $('#oct-card-errors').text(msg).show();
  }

  function hideCardError() {
    $('#oct-card-errors').hide().text('');
  }

  // ---- PayPal ----
  function initPayPal() {
    // Buttons are rendered lazily when the PayPal tab is first shown
    // If Stripe not available, render immediately
    if (!stripeKey && typeof paypal !== 'undefined') {
      renderPayPalButtons();
    }
  }

  function renderPayPalButtons() {
    if (state.paypalRendered || typeof paypal === 'undefined') return;
    state.paypalRendered = true;

    var fundingSources = [];
    if (paypal.FUNDING && paypal.FUNDING.PAYLATER) {
      fundingSources.push(paypal.FUNDING.PAYLATER);
    }
    if (paypal.FUNDING && paypal.FUNDING.PAYPAL) {
      fundingSources.push(paypal.FUNDING.PAYPAL);
    }
    if (!fundingSources.length) {
      fundingSources = ['paylater', 'paypal'];
    }

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
          if (!state.selectedType) {
            $('#oct-paypal-errors').text('Please select a ticket type.').show();
            return Promise.reject('no_ticket');
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

        onCancel: function () {
          $('#oct-paypal-errors').hide();
        },
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

  // ---- Boot ----
  $(document).ready(init);

})(jQuery);
