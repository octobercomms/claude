<?php
/** Check-in PWA shell — hydrated by assets/js/checkin.js. */
defined('ABSPATH') || exit;
?>
<div class="oe-checkin" id="oe-checkin">
    <!-- Step: event -->
    <section data-step="event" class="oe-ci-step is-active">
        <h2><?php esc_html_e('Door check-in', 'october-events'); ?></h2>
        <p class="description"><?php esc_html_e('Choose the event you are working.', 'october-events'); ?></p>
        <div id="oe-ci-events" class="oe-list"></div>
    </section>

    <!-- Step: PIN -->
    <section data-step="pin" class="oe-ci-step">
        <h2><?php esc_html_e('Enter event PIN', 'october-events'); ?></h2>
        <input type="text" inputmode="numeric" id="oe-ci-pin" class="oe-ci-pin" maxlength="6" placeholder="••••">
        <div class="oe-result" id="oe-ci-pin-msg"></div>
        <button class="oe-btn oe-btn-primary" id="oe-ci-pin-go"><?php esc_html_e('Continue', 'october-events'); ?></button>
        <button class="oe-btn" data-back="event"><?php esc_html_e('Back', 'october-events'); ?></button>
    </section>

    <!-- Step: venue -->
    <section data-step="venue" class="oe-ci-step">
        <h2><?php esc_html_e('Which door / venue?', 'october-events'); ?></h2>
        <div id="oe-ci-venues" class="oe-list"></div>
        <button class="oe-btn" data-back="pin"><?php esc_html_e('Back', 'october-events'); ?></button>
    </section>

    <!-- Step: scanner -->
    <section data-step="scan" class="oe-ci-step">
        <h2 id="oe-ci-venue-name"></h2>
        <div id="oe-ci-reader" class="oe-ci-reader"></div>
        <p class="description"><?php esc_html_e('Or enter the ticket code manually:', 'october-events'); ?></p>
        <div class="oe-co-promo">
            <input type="text" id="oe-ci-manual" placeholder="<?php esc_attr_e('Ticket token', 'october-events'); ?>">
            <button class="oe-btn" id="oe-ci-manual-go"><?php esc_html_e('Check', 'october-events'); ?></button>
        </div>
        <div class="oe-ci-counter"><?php esc_html_e('Scanned this session:', 'october-events'); ?> <span id="oe-ci-count">0</span></div>
        <div id="oe-ci-stats" class="oe-ci-stats"></div>
        <button class="oe-btn" data-back="venue"><?php esc_html_e('Change door', 'october-events'); ?></button>
    </section>

    <div id="oe-ci-overlay" class="oe-ci-overlay" hidden><div class="oe-ci-overlay-inner"></div></div>
</div>
