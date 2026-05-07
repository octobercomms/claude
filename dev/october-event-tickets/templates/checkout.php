<?php
/**
 * Checkout template — rendered by [oct_checkout] shortcode.
 *
 * Variables:
 *   $event          WP_Post
 *   $event_id       int
 *   $active_types   array  (filtered ticket types, active only)
 *   $currency       string
 *   $currency_symbol string
 */
declare(strict_types=1);
defined('ABSPATH') || exit;

$has_paypal = (bool) \OctoberTickets\Settings::get_instance()->get('paypal_client_id');
$has_stripe = (bool) \OctoberTickets\Settings::get_instance()->get('stripe_publishable_key');
?>

<div class="oct-checkout" id="oct-checkout-<?php echo esc_attr((string) $event_id); ?>" data-event-id="<?php echo esc_attr((string) $event_id); ?>">

  <!-- Success State (hidden until payment completes) -->
  <div class="oct-success" id="oct-success" style="display:none">
    <div class="oct-success__icon">&#10003;</div>
    <h2><?php esc_html_e('Payment confirmed!', 'october-event-tickets'); ?></h2>
    <p><?php esc_html_e('Your tickets have been emailed to you. Use the links below to view and print them.', 'october-event-tickets'); ?></p>
    <div id="oct-ticket-links" class="oct-ticket-links"></div>
  </div>

  <!-- Checkout Form (hidden on success) -->
  <div id="oct-checkout-form">

    <!-- Step 1: Ticket Selection -->
    <div class="oct-section">
      <h3 class="oct-section__title"><?php esc_html_e('Choose Your Ticket', 'october-event-tickets'); ?></h3>

      <div class="oct-ticket-types" role="group" aria-label="<?php esc_attr_e('Ticket Types', 'october-event-tickets'); ?>">
        <?php foreach ($active_types as $i => $tt) :
            $effective_price = isset($tt['sale_price']) && $tt['sale_price'] !== null ? (float) $tt['sale_price'] : (float) $tt['price'];
            $has_sale        = isset($tt['sale_price']) && $tt['sale_price'] !== null && (float) $tt['sale_price'] < (float) $tt['price'];
        ?>
          <label class="oct-ticket-card <?php echo $i === 0 ? 'oct-ticket-card--selected' : ''; ?>"
                 data-key="<?php echo esc_attr($tt['key']); ?>"
                 data-price="<?php echo esc_attr((string) $effective_price); ?>"
                 data-label="<?php echo esc_attr($tt['label']); ?>"
                 data-qty-per-purchase="<?php echo esc_attr((string) ($tt['qty_per_purchase'] ?? 1)); ?>">
            <input type="radio" name="oct_ticket_type" value="<?php echo esc_attr($tt['key']); ?>"
                   <?php echo $i === 0 ? 'checked' : ''; ?> style="position:absolute;opacity:0">
            <div class="oct-ticket-card__top">
              <div class="oct-ticket-card__name"><?php echo esc_html($tt['label']); ?></div>
              <div class="oct-ticket-card__price">
                <?php if ($has_sale) : ?>
                  <span class="oct-price-old"><?php echo esc_html($currency_symbol . number_format((float) $tt['price'], 2)); ?></span>
                <?php endif; ?>
                <span class="oct-price-current"><?php echo esc_html($currency_symbol . number_format($effective_price, 2)); ?></span>
              </div>
            </div>
            <?php if (!empty($tt['description'])) : ?>
              <div class="oct-ticket-card__desc"><?php echo esc_html($tt['description']); ?></div>
            <?php endif; ?>
            <?php if (!empty($tt['qty_per_purchase']) && (int) $tt['qty_per_purchase'] > 1) : ?>
              <div class="oct-ticket-card__note">
                <?php echo esc_html(sprintf(
                  /* translators: %d: number of admission tickets */
                  _n('Includes %d admission', 'Includes %d admissions', (int) $tt['qty_per_purchase'], 'october-event-tickets'),
                  (int) $tt['qty_per_purchase']
                )); ?>
              </div>
            <?php endif; ?>
          </label>
        <?php endforeach; ?>
      </div>
    </div>

    <!-- Step 2: Quantity -->
    <div class="oct-section">
      <label for="oct-qty" class="oct-label"><?php esc_html_e('Quantity', 'october-event-tickets'); ?></label>
      <div class="oct-qty-control">
        <button type="button" class="oct-qty-btn" id="oct-qty-minus" aria-label="<?php esc_attr_e('Decrease quantity', 'october-event-tickets'); ?>">−</button>
        <input type="number" id="oct-qty" name="oct_qty" value="1" min="1" max="10" class="oct-qty-input" readonly>
        <button type="button" class="oct-qty-btn" id="oct-qty-plus" aria-label="<?php esc_attr_e('Increase quantity', 'october-event-tickets'); ?>">+</button>
      </div>
    </div>

    <!-- Step 3: Promo Code -->
    <div class="oct-section">
      <label for="oct-promo" class="oct-label"><?php esc_html_e('Promo Code', 'october-event-tickets'); ?> <span class="oct-optional"><?php esc_html_e('(optional)', 'october-event-tickets'); ?></span></label>
      <div class="oct-promo-row">
        <input type="text" id="oct-promo" name="oct_promo" placeholder="<?php esc_attr_e('Enter code', 'october-event-tickets'); ?>"
               class="oct-input" autocomplete="off" style="text-transform:uppercase">
        <button type="button" id="oct-apply-promo" class="oct-btn oct-btn--secondary"><?php esc_html_e('Apply', 'october-event-tickets'); ?></button>
      </div>
      <div id="oct-promo-message" class="oct-promo-message" style="display:none"></div>
    </div>

    <!-- Order Summary -->
    <div class="oct-section oct-summary" id="oct-summary">
      <h3 class="oct-section__title"><?php esc_html_e('Order Summary', 'october-event-tickets'); ?></h3>
      <div class="oct-summary-row">
        <span class="oct-summary-label" id="oct-summary-type"><?php echo esc_html($active_types[0]['label'] ?? ''); ?></span>
        <span class="oct-summary-label" id="oct-summary-count"></span>
        <span class="oct-summary-price" id="oct-summary-subtotal"><?php echo esc_html($currency_symbol . '0.00'); ?></span>
      </div>
      <div class="oct-summary-row" id="oct-discount-row" style="display:none">
        <span class="oct-summary-label oct-discount-label"><?php esc_html_e('Discount', 'october-event-tickets'); ?></span>
        <span class="oct-summary-price oct-discount-value" id="oct-summary-discount"></span>
      </div>
      <div class="oct-summary-row oct-summary-total">
        <span class="oct-summary-label"><?php esc_html_e('Total', 'october-event-tickets'); ?></span>
        <span class="oct-summary-price" id="oct-summary-total"><?php echo esc_html($currency_symbol . '0.00'); ?></span>
      </div>
    </div>

    <!-- Step 4: Attendee Details -->
    <div class="oct-section">
      <h3 class="oct-section__title"><?php esc_html_e('Your Details', 'october-event-tickets'); ?></h3>
      <div class="oct-field-group">
        <label for="oct-name" class="oct-label"><?php esc_html_e('Name', 'october-event-tickets'); ?> <span class="oct-optional"><?php esc_html_e('(optional)', 'october-event-tickets'); ?></span></label>
        <input type="text" id="oct-name" name="oct_name" class="oct-input"
               placeholder="<?php esc_attr_e('Your full name', 'october-event-tickets'); ?>" autocomplete="name">
      </div>
      <div class="oct-field-group">
        <label for="oct-email" class="oct-label"><?php esc_html_e('Email', 'october-event-tickets'); ?> <span class="oct-required" aria-hidden="true">*</span></label>
        <input type="email" id="oct-email" name="oct_email" class="oct-input" required
               placeholder="<?php esc_attr_e('you@example.com', 'october-event-tickets'); ?>" autocomplete="email">
        <span class="oct-field-hint"><?php esc_html_e('Tickets will be sent here.', 'october-event-tickets'); ?></span>
      </div>
    </div>

    <!-- Step 5: Payment -->
    <div class="oct-section">
      <h3 class="oct-section__title"><?php esc_html_e('Payment', 'october-event-tickets'); ?></h3>

      <?php if ($has_stripe && $has_paypal) : ?>
        <!-- Two-tab payment section -->
        <div class="oct-payment-tabs" role="tablist">
          <button type="button" class="oct-tab oct-tab--active" id="tab-card" role="tab"
                  aria-selected="true" aria-controls="panel-card">
            <?php esc_html_e('Pay by Card', 'october-event-tickets'); ?>
          </button>
          <button type="button" class="oct-tab" id="tab-paypal" role="tab"
                  aria-selected="false" aria-controls="panel-paypal">
            <?php esc_html_e('PayPal / Pay Later', 'october-event-tickets'); ?>
          </button>
        </div>
      <?php endif; ?>

      <?php if ($has_stripe) : ?>
        <div class="oct-payment-panel" id="panel-card" role="tabpanel" aria-labelledby="tab-card">
          <div id="oct-stripe-elements" class="oct-stripe-elements">
            <!-- Stripe card element injected here -->
          </div>
          <div id="oct-card-errors" class="oct-payment-error" role="alert" style="display:none"></div>
          <button type="button" id="oct-pay-card" class="oct-btn oct-btn--primary oct-btn--full">
            <span class="btn-text"><?php esc_html_e('Pay Securely', 'october-event-tickets'); ?></span>
            <span class="btn-amount" id="oct-card-btn-amount"></span>
          </button>
          <div class="oct-stripe-badge">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M10 1a9 9 0 1 0 0 18A9 9 0 0 0 10 1zm0 16A7 7 0 1 1 10 3a7 7 0 0 1 0 14zm0-11.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm0 4a1 1 0 0 0-1 1v3a1 1 0 0 0 2 0v-3a1 1 0 0 0-1-1z" fill="#999"/>
            </svg>
            <?php esc_html_e('Secured by Stripe. We never store your card details.', 'october-event-tickets'); ?>
          </div>
        </div>
      <?php endif; ?>

      <?php if ($has_paypal) : ?>
        <div class="oct-payment-panel" id="panel-paypal" role="tabpanel" aria-labelledby="tab-paypal"
             <?php echo ($has_stripe && $has_paypal) ? 'style="display:none"' : ''; ?>>
          <div id="oct-paypal-buttons"></div>
          <div id="oct-paypal-errors" class="oct-payment-error" role="alert" style="display:none"></div>
        </div>
      <?php endif; ?>

      <?php if (!$has_stripe && !$has_paypal) : ?>
        <p class="oct-error"><?php esc_html_e('No payment methods configured. Please contact the site administrator.', 'october-event-tickets'); ?></p>
      <?php endif; ?>

    </div><!-- .oct-section -->

    <!-- Global error zone -->
    <div id="oct-global-error" class="oct-payment-error" role="alert" style="display:none"></div>

  </div><!-- #oct-checkout-form -->

</div><!-- .oct-checkout -->

<script type="application/json" id="oct-ticket-data-<?php echo esc_attr((string) $event_id); ?>">
<?php echo wp_json_encode(array_values($active_types)); ?>
</script>
