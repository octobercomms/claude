<?php
/** Event checkout shell — hydrated by assets/js/checkout.js. */
defined('ABSPATH') || exit;
?>
<div class="adf-checkout" id="adf-checkout">
    <div class="adf-co-step">
        <h3><?php esc_html_e('Choose your tickets', 'adf-festival'); ?></h3>
        <div id="adf-co-types"></div>
    </div>

    <div class="adf-co-step adf-co-qtyrow">
        <label><?php esc_html_e('Quantity', 'adf-festival'); ?>
            <input type="number" id="adf-co-qty" value="1" min="1" max="10">
        </label>
    </div>

    <div class="adf-co-step">
        <label><?php esc_html_e('Promo code', 'adf-festival'); ?>
            <span class="adf-co-promo">
                <input type="text" id="adf-co-promo" placeholder="<?php esc_attr_e('Optional', 'adf-festival'); ?>">
                <button type="button" class="adf-btn" id="adf-co-promo-apply"><?php esc_html_e('Apply', 'adf-festival'); ?></button>
            </span>
            <span class="adf-result" id="adf-co-promo-msg"></span>
        </label>
    </div>

    <div class="adf-co-summary" id="adf-co-summary"></div>

    <form id="adf-co-form" class="adf-form">
        <label><?php esc_html_e('Your name', 'adf-festival'); ?><input type="text" name="name"></label>
        <label><?php esc_html_e('Email', 'adf-festival'); ?> *<input type="email" name="email" required></label>
        <div id="adf-co-payment" class="adf-payment">
            <div id="adf-co-card"></div>
            <div id="adf-co-card-errors" role="alert"></div>
        </div>
        <button type="submit" class="adf-btn adf-btn-primary" id="adf-co-pay"><?php esc_html_e('Pay', 'adf-festival'); ?></button>
        <div class="adf-result" id="adf-co-result"></div>
    </form>

    <div class="adf-co-success" id="adf-co-success" hidden>
        <h3><?php esc_html_e('You\'re in!', 'adf-festival'); ?></h3>
        <p><?php esc_html_e('Your tickets are below and have been emailed to you.', 'adf-festival'); ?></p>
        <ul id="adf-co-tickets" class="adf-list"></ul>
    </div>
</div>
