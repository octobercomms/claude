<?php
/** Event checkout shell — hydrated by assets/js/checkout.js. */
defined('ABSPATH') || exit;
?>
<div class="oe-checkout" id="oe-checkout">
    <div class="oe-co-step">
        <h3><?php esc_html_e('Choose your ticket', 'october-events'); ?></h3>
        <div id="oe-co-types"></div>
    </div>

    <div class="oe-co-step oe-co-qtyrow">
        <span class="oe-co-label"><?php esc_html_e('Quantity', 'october-events'); ?></span>
        <div class="oe-qty">
            <button type="button" class="oe-qty-btn" id="oe-co-qty-minus" aria-label="<?php esc_attr_e('Decrease quantity', 'october-events'); ?>">−</button>
            <input type="number" id="oe-co-qty" value="1" min="1" max="10" readonly>
            <button type="button" class="oe-qty-btn" id="oe-co-qty-plus" aria-label="<?php esc_attr_e('Increase quantity', 'october-events'); ?>">+</button>
        </div>
    </div>

    <div class="oe-co-step">
        <label class="oe-co-label"><?php esc_html_e('Promo code', 'october-events'); ?>
            <span class="oe-co-promo">
                <input type="text" id="oe-co-promo" placeholder="<?php esc_attr_e('Optional', 'october-events'); ?>" autocomplete="off">
                <button type="button" class="oe-btn" id="oe-co-promo-apply"><?php esc_html_e('Apply', 'october-events'); ?></button>
            </span>
            <span id="oe-co-promo-msg"></span>
        </label>
    </div>

    <div class="oe-co-summary" id="oe-co-summary"></div>

    <form id="oe-co-form" class="oe-form">
        <h3><?php esc_html_e('Your details', 'october-events'); ?></h3>
        <label><?php esc_html_e('Your name', 'october-events'); ?><input type="text" name="name"></label>
        <label><?php esc_html_e('Email', 'october-events'); ?> *<input type="email" name="email" required></label>
        <div id="oe-co-payment" class="oe-payment">
            <div id="oe-co-card"></div>
            <div id="oe-co-card-errors" role="alert"></div>
            <div class="oe-co-badge">
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M10 1a9 9 0 1 0 0 18A9 9 0 0 0 10 1zm0 16A7 7 0 1 1 10 3a7 7 0 0 1 0 14zm0-11.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm0 4a1 1 0 0 0-1 1v3a1 1 0 0 0 2 0v-3a1 1 0 0 0-1-1z" fill="#999"/></svg>
                <?php esc_html_e('Secured by Stripe. We never store your card details.', 'october-events'); ?>
            </div>
        </div>
        <button type="submit" class="oe-btn oe-btn-primary" id="oe-co-pay"><?php esc_html_e('Pay', 'october-events'); ?></button>
        <div class="oe-result" id="oe-co-result"></div>
    </form>

    <div class="oe-co-success" id="oe-co-success" hidden>
        <div class="oe-co-success-icon">&#10003;</div>
        <h3><?php esc_html_e('You\'re in!', 'october-events'); ?></h3>
        <p><?php esc_html_e('Your tickets are below and have been emailed to you.', 'october-events'); ?></p>
        <ul id="oe-co-tickets"></ul>
    </div>
</div>
