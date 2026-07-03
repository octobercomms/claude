<?php
/**
 * Event checkout — ported verbatim from the original Event Tickets v1.2.5 design
 * (gold/orange theme, per-row qty steppers, attendee names, T&Cs, waitlist),
 * wired to October Events' data + oe/v1 endpoints. Keeps the `.oct-` class names
 * so assets/css/checkout.css (the v1.2.5 stylesheet) applies unchanged.
 *
 * In scope from Checkout::render(): $types (array), $event_id (int), $currency.
 */
defined('ABSPATH') || exit;

$sym       = $currency === 'GBP' ? '£' : ($currency === 'EUR' ? '€' : '$');
$has_stripe = \OE\Connectors\StripeConnector::is_ready();
$has_paypal = \OE\Connectors\PayPalConnector::is_ready();
$terms_url = (string) \OE\Settings::get('checkout_terms_url', '');
$first_label = $types[0]['label'] ?? '';
$unavailable_states = ['coming_soon', 'sale_ended', 'sold_out', 'unavailable'];
?>
<div class="oct-checkout" id="oct-checkout-<?php echo esc_attr((string) $event_id); ?>" data-event-id="<?php echo esc_attr((string) $event_id); ?>" data-has-terms="<?php echo $terms_url ? '1' : '0'; ?>">

  <div class="oct-success" id="oct-success" style="display:none">
    <div class="oct-success__icon">&#10003;</div>
    <h2><?php esc_html_e('Payment confirmed!', 'october-events'); ?></h2>
    <p><?php esc_html_e('Your tickets have been emailed to you. Use the links below to view and print them.', 'october-events'); ?></p>
    <div id="oct-ticket-links" class="oct-ticket-links"></div>
  </div>

  <div id="oct-checkout-form">

    <div class="oct-section oct-section--tickets">
      <h6 class="oct-section__title"><?php esc_html_e('Choose Your Ticket', 'october-events'); ?></h6>
      <div class="oct-ticket-list" role="group" aria-label="<?php esc_attr_e('Ticket Types', 'october-events'); ?>">
        <?php
        $first_available_done = false;
        foreach ($types as $tt) :
            $state       = (string) ($tt['state'] ?? 'available');
            $unavailable = in_array($state, $unavailable_states, true);
            $eff         = (float) ($tt['effective'] ?? $tt['price']);
            $has_sale    = isset($tt['sale_price']) && $tt['sale_price'] !== null && (float) $tt['sale_price'] < (float) $tt['price'];
            $is_first    = (! $unavailable && ! $first_available_done);
            if ($is_first) { $first_available_done = true; }
            $row_class   = 'oct-ticket-row' . ($is_first ? ' oct-ticket-row--selected' : '') . ($unavailable ? ' oct-ticket-row--unavailable' : '') . ($state === 'sold_out' ? ' oct-ticket-row--soldout' : '');
        ?>
          <div class="<?php echo esc_attr($row_class); ?>"
               data-key="<?php echo esc_attr((string) $tt['key']); ?>"
               data-price="<?php echo esc_attr($unavailable ? '0' : (string) $eff); ?>"
               data-label="<?php echo esc_attr((string) $tt['label']); ?>"
               data-qty-per-purchase="<?php echo esc_attr((string) ($tt['admits'] ?? 1)); ?>"
               data-max-qty="<?php echo esc_attr((string) ($tt['max'] ?? 99)); ?>"
               <?php echo $unavailable ? '' : 'role="button" tabindex="0"'; ?>>
            <input type="radio" name="oct_ticket_type" value="<?php echo esc_attr((string) $tt['key']); ?>" <?php echo $is_first ? 'checked' : ''; ?> style="display:none">
            <div class="oct-ticket-row__info">
              <div class="oct-ticket-row__name"><?php echo esc_html((string) $tt['label']); ?></div>
              <?php if (! empty($tt['desc'])) : ?>
                <div class="oct-ticket-row__desc"><?php echo esc_html((string) $tt['desc']); ?></div>
              <?php endif; ?>
              <?php if ((int) ($tt['admits'] ?? 1) > 1) : ?>
                <div class="oct-ticket-row__admissions"><?php echo esc_html(sprintf(_n('Includes %d admission', 'Includes %d admissions', (int) $tt['admits'], 'october-events'), (int) $tt['admits'])); ?></div>
              <?php endif; ?>
            </div>
            <div class="oct-ticket-row__price">
              <?php if ($unavailable) : ?>
                <?php if ($state === 'sold_out') : ?>
                  <span class="oct-ticket-row__status oct-ticket-row__status--soldout"><?php esc_html_e('Sold out', 'october-events'); ?></span>
                  <button type="button" class="oct-btn-waitlist" data-key="<?php echo esc_attr((string) $tt['key']); ?>" data-label="<?php echo esc_attr((string) $tt['label']); ?>"><?php esc_html_e('Join Waitlist', 'october-events'); ?></button>
                <?php elseif ($state === 'coming_soon') : ?>
                  <span class="oct-ticket-row__status"><?php echo esc_html($tt['opens'] ? sprintf(__('Opens %s', 'october-events'), date_i18n(get_option('date_format'), strtotime((string) $tt['opens']))) : __('Coming soon', 'october-events')); ?></span>
                <?php else : ?>
                  <span class="oct-ticket-row__status"><?php esc_html_e('Sale ended', 'october-events'); ?></span>
                <?php endif; ?>
              <?php else : ?>
                <span class="oct-price-current"><?php echo esc_html($sym . number_format($eff, 2)); ?></span>
                <?php if ($has_sale) : ?><span class="oct-price-old"><?php echo esc_html($sym . number_format((float) $tt['price'], 2)); ?></span><?php endif; ?>
              <?php endif; ?>
            </div>
            <?php if (! $unavailable) : ?>
            <div class="oct-ticket-row__qty" role="group">
              <button type="button" class="oct-qty-btn" data-action="minus" onclick="event.stopPropagation();if(window.octHandleQty)window.octHandleQty(this,'minus')" aria-label="<?php esc_attr_e('Decrease quantity', 'october-events'); ?>">−</button>
              <span class="oct-qty-val" aria-live="polite">0</span>
              <button type="button" class="oct-qty-btn" data-action="plus" onclick="event.stopPropagation();if(window.octHandleQty)window.octHandleQty(this,'plus')" aria-label="<?php esc_attr_e('Increase quantity', 'october-events'); ?>">+</button>
            </div>
            <?php endif; ?>
          </div>
        <?php endforeach; ?>
      </div>
    </div>

    <!-- Waitlist modal (sold-out) -->
    <div id="oct-waitlist-modal" style="display:none" class="oct-waitlist-modal" role="dialog" aria-modal="true" aria-labelledby="oct-waitlist-title">
      <div class="oct-waitlist-modal__backdrop"></div>
      <div class="oct-waitlist-modal__box">
        <h6 id="oct-waitlist-title" class="oct-section__title"><?php esc_html_e('Join the Waitlist', 'october-events'); ?></h6>
        <p class="oct-waitlist-modal__sub" id="oct-waitlist-ticket-label"></p>
        <div class="oct-field-group">
          <label for="oct-waitlist-name" class="oct-label"><?php esc_html_e('Name', 'october-events'); ?> <span class="oct-optional"><?php esc_html_e('(optional)', 'october-events'); ?></span></label>
          <input type="text" id="oct-waitlist-name" class="oct-input" placeholder="<?php esc_attr_e('Your name', 'october-events'); ?>">
        </div>
        <div class="oct-field-group">
          <label for="oct-waitlist-email" class="oct-label"><?php esc_html_e('Email', 'october-events'); ?> <span class="oct-required">*</span></label>
          <input type="email" id="oct-waitlist-email" class="oct-input" placeholder="<?php esc_attr_e('you@example.com', 'october-events'); ?>">
        </div>
        <div id="oct-waitlist-message" class="oct-promo-message" style="display:none"></div>
        <div style="display:flex;gap:10px;margin-top:12px;">
          <button type="button" id="oct-waitlist-submit" class="oct-btn oct-btn--primary" style="flex:1"><?php esc_html_e('Join Waitlist', 'october-events'); ?></button>
          <button type="button" id="oct-waitlist-cancel" class="oct-btn oct-btn--secondary"><?php esc_html_e('Cancel', 'october-events'); ?></button>
        </div>
      </div>
    </div>

    <div class="oct-section oct-section--promo">
      <div class="oct-promo-row">
        <label for="oct-promo" class="oct-label"><?php esc_html_e('Promo Code', 'october-events'); ?> <span class="oct-optional"><?php esc_html_e('(optional)', 'october-events'); ?></span></label>
        <input type="text" id="oct-promo" name="oct_promo" placeholder="<?php esc_attr_e('Enter code', 'october-events'); ?>" class="oct-input" autocomplete="off" style="text-transform:uppercase">
        <button type="button" id="oct-apply-promo" class="oct-btn oct-btn--secondary"><?php esc_html_e('Apply', 'october-events'); ?></button>
      </div>
      <div id="oct-promo-message" class="oct-promo-message" style="display:none"></div>
    </div>

    <div class="oct-section oct-section--summary oct-summary" id="oct-summary">
      <h6 class="oct-section__title"><?php esc_html_e('Order Summary', 'october-events'); ?></h6>
      <!-- One row per ticket line in the cart (filled by checkout.js) -->
      <div id="oct-summary-lines">
        <div class="oct-summary-row">
          <span class="oct-summary-label">&mdash;</span>
          <span class="oct-summary-label"></span>
          <span class="oct-summary-price"><?php echo esc_html($sym . '0.00'); ?></span>
        </div>
      </div>
      <div class="oct-summary-row" id="oct-discount-row" style="display:none">
        <span class="oct-summary-label oct-discount-label"><?php esc_html_e('Discount', 'october-events'); ?></span>
        <span class="oct-summary-price oct-discount-value" id="oct-summary-discount"></span>
      </div>
      <div class="oct-summary-row oct-summary-total">
        <span class="oct-summary-label"><?php esc_html_e('Total', 'october-events'); ?></span>
        <span class="oct-summary-price" id="oct-summary-total"><?php echo esc_html($sym . '0.00'); ?></span>
      </div>
    </div>

    <div class="oct-section oct-section--details">
      <h6 class="oct-section__title"><?php esc_html_e('Your Details', 'october-events'); ?></h6>
      <div class="oct-field-group">
        <label for="oct-name" class="oct-label"><?php esc_html_e('Name', 'october-events'); ?> <span class="oct-optional"><?php esc_html_e('(optional)', 'october-events'); ?></span></label>
        <div class="oct-field-input"><input type="text" id="oct-name" name="oct_name" class="oct-input" placeholder="<?php esc_attr_e('Your full name', 'october-events'); ?>" autocomplete="name"></div>
      </div>
      <div class="oct-field-group">
        <label for="oct-email" class="oct-label"><?php esc_html_e('Email', 'october-events'); ?> <span class="oct-required" aria-hidden="true">*</span></label>
        <div class="oct-field-input">
          <input type="email" id="oct-email" name="oct_email" class="oct-input" required placeholder="<?php esc_attr_e('you@example.com', 'october-events'); ?>" autocomplete="email">
          <span class="oct-field-hint"><?php esc_html_e('Tickets will be sent here.', 'october-events'); ?></span>
        </div>
      </div>
    </div>

    <div class="oct-section oct-section--attendees" id="oct-attendee-names-section" style="display:none">
      <h6 class="oct-section__title"><?php esc_html_e('Attendee Names', 'october-events'); ?> <span class="oct-optional"><?php esc_html_e('(optional)', 'october-events'); ?></span></h6>
      <p class="oct-field-hint" style="margin-bottom:12px;"><?php esc_html_e('Add names for each ticket — useful for group bookings.', 'october-events'); ?></p>
      <div id="oct-attendee-names-fields"></div>
    </div>

    <?php if ($terms_url) : ?>
    <div class="oct-section oct-section--terms oct-terms-section">
      <label class="oct-terms-label">
        <input type="checkbox" id="oct-terms-checkbox" class="oct-terms-checkbox">
        <span><?php esc_html_e('I agree to the', 'october-events'); ?>
          <a href="<?php echo esc_url($terms_url); ?>" target="_blank" rel="noopener"><?php esc_html_e('Terms &amp; Conditions', 'october-events'); ?></a>
          <span class="oct-required" aria-hidden="true">*</span></span>
      </label>
      <div id="oct-terms-error" class="oct-field-hint" style="color:#e53935;display:none;"><?php esc_html_e('Please agree to the Terms & Conditions to continue.', 'october-events'); ?></div>
    </div>
    <?php endif; ?>

    <div id="oct-payment-section">
    <div class="oct-section oct-section--payment">
      <h6 class="oct-section__title"><?php esc_html_e('Payment', 'october-events'); ?></h6>
      <?php if ($has_stripe) : ?>
        <div class="oct-payment-panel" id="panel-card" role="tabpanel">
          <div id="oct-stripe-elements" class="oct-stripe-elements"></div>
          <div id="oct-card-errors" class="oct-payment-error" role="alert" style="display:none"></div>
          <button type="button" id="oct-pay-card" class="oct-btn oct-btn--primary oct-btn--full">
            <span class="btn-text"><?php esc_html_e('Pay Securely', 'october-events'); ?></span>
            <span class="btn-amount" id="oct-card-btn-amount"></span>
          </button>
          <div class="oct-stripe-badge">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M10 1a9 9 0 1 0 0 18A9 9 0 0 0 10 1zm0 16A7 7 0 1 1 10 3a7 7 0 0 1 0 14zm0-11.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm0 4a1 1 0 0 0-1 1v3a1 1 0 0 0 2 0v-3a1 1 0 0 0-1-1z" fill="#999"/></svg>
            <?php esc_html_e('Secured by Stripe. We never store your card details.', 'october-events'); ?>
          </div>
        </div>
      <?php endif; ?>
      <?php if ($has_paypal) : ?>
        <?php if ($has_stripe) : ?><div class="oct-pay-or"><span><?php esc_html_e('or', 'october-events'); ?></span></div><?php endif; ?>
        <div class="oct-payment-panel" id="panel-paypal" role="tabpanel">
          <div id="oct-paypal-buttons"></div>
          <div id="oct-paypal-errors" class="oct-payment-error" role="alert" style="display:none"></div>
        </div>
      <?php endif; ?>
      <?php if (! $has_stripe && ! $has_paypal) : ?>
        <p class="oct-error"><?php esc_html_e('No payment method configured. Please contact the organiser.', 'october-events'); ?></p>
      <?php endif; ?>
    </div>
    </div>

    <div id="oct-free-section" style="display:none">
      <button type="button" id="oct-register-free" class="oct-btn oct-btn--primary oct-btn--full"><?php esc_html_e('Complete Registration', 'october-events'); ?></button>
      <div id="oct-free-errors" class="oct-payment-error" role="alert" style="display:none"></div>
    </div>

    <div id="oct-global-error" class="oct-payment-error" role="alert" style="display:none"></div>

  </div><!-- #oct-checkout-form -->
</div><!-- .oct-checkout -->
