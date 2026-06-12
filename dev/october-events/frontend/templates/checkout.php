<?php
/** Event checkout shell — hydrated by assets/js/checkout.js. */
defined('ABSPATH') || exit;
?>
<div class="oe-checkout" id="oe-checkout">
    <div class="oe-co-step">
        <h3><?php esc_html_e('Choose your tickets', 'october-events'); ?></h3>
        <div id="oe-co-types"></div>
    </div>

    <div class="oe-co-step oe-co-qtyrow">
        <label><?php esc_html_e('Quantity', 'october-events'); ?>
            <input type="number" id="oe-co-qty" value="1" min="1" max="10">
        </label>
    </div>

    <div class="oe-co-step">
        <label><?php esc_html_e('Promo code', 'october-events'); ?>
            <span class="oe-co-promo">
                <input type="text" id="oe-co-promo" placeholder="<?php esc_attr_e('Optional', 'october-events'); ?>">
                <button type="button" class="oe-btn" id="oe-co-promo-apply"><?php esc_html_e('Apply', 'october-events'); ?></button>
            </span>
            <span class="oe-result" id="oe-co-promo-msg"></span>
        </label>
    </div>

    <div class="oe-co-summary" id="oe-co-summary"></div>

    <form id="oe-co-form" class="oe-form">
        <label><?php esc_html_e('Your name', 'october-events'); ?><input type="text" name="name"></label>
        <label><?php esc_html_e('Email', 'october-events'); ?> *<input type="email" name="email" required></label>
        <div id="oe-co-payment" class="oe-payment">
            <div id="oe-co-card"></div>
            <div id="oe-co-card-errors" role="alert"></div>
        </div>
        <button type="submit" class="oe-btn oe-btn-primary" id="oe-co-pay"><?php esc_html_e('Pay', 'october-events'); ?></button>
        <div class="oe-result" id="oe-co-result"></div>
    </form>

    <div class="oe-co-success" id="oe-co-success" hidden>
        <h3><?php esc_html_e('You\'re in!', 'october-events'); ?></h3>
        <p><?php esc_html_e('Your tickets are below and have been emailed to you.', 'october-events'); ?></p>
        <ul id="oe-co-tickets" class="oe-list"></ul>
    </div>
</div>
