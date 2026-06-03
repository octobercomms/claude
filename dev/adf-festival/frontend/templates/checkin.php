<?php
/** Check-in PWA shell — hydrated by assets/js/checkin.js. */
defined('ABSPATH') || exit;
?>
<div class="adf-checkin" id="adf-checkin">
    <!-- Step: event -->
    <section data-step="event" class="adf-ci-step is-active">
        <h2><?php esc_html_e('Door check-in', 'adf-festival'); ?></h2>
        <p class="description"><?php esc_html_e('Choose the event you are working.', 'adf-festival'); ?></p>
        <div id="adf-ci-events" class="adf-list"></div>
    </section>

    <!-- Step: PIN -->
    <section data-step="pin" class="adf-ci-step">
        <h2><?php esc_html_e('Enter event PIN', 'adf-festival'); ?></h2>
        <input type="text" inputmode="numeric" id="adf-ci-pin" class="adf-ci-pin" maxlength="6" placeholder="••••">
        <div class="adf-result" id="adf-ci-pin-msg"></div>
        <button class="adf-btn adf-btn-primary" id="adf-ci-pin-go"><?php esc_html_e('Continue', 'adf-festival'); ?></button>
        <button class="adf-btn" data-back="event"><?php esc_html_e('Back', 'adf-festival'); ?></button>
    </section>

    <!-- Step: venue -->
    <section data-step="venue" class="adf-ci-step">
        <h2><?php esc_html_e('Which door / venue?', 'adf-festival'); ?></h2>
        <div id="adf-ci-venues" class="adf-list"></div>
        <button class="adf-btn" data-back="pin"><?php esc_html_e('Back', 'adf-festival'); ?></button>
    </section>

    <!-- Step: scanner -->
    <section data-step="scan" class="adf-ci-step">
        <h2 id="adf-ci-venue-name"></h2>
        <div id="adf-ci-reader" class="adf-ci-reader"></div>
        <p class="description"><?php esc_html_e('Or enter the ticket code manually:', 'adf-festival'); ?></p>
        <div class="adf-co-promo">
            <input type="text" id="adf-ci-manual" placeholder="<?php esc_attr_e('Ticket token', 'adf-festival'); ?>">
            <button class="adf-btn" id="adf-ci-manual-go"><?php esc_html_e('Check', 'adf-festival'); ?></button>
        </div>
        <div class="adf-ci-counter"><?php esc_html_e('Scanned this session:', 'adf-festival'); ?> <span id="adf-ci-count">0</span></div>
        <div id="adf-ci-stats" class="adf-ci-stats"></div>
        <button class="adf-btn" data-back="venue"><?php esc_html_e('Change door', 'adf-festival'); ?></button>
    </section>

    <div id="adf-ci-overlay" class="adf-ci-overlay" hidden><div class="adf-ci-overlay-inner"></div></div>
</div>
