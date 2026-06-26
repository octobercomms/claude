<?php
/** Door check-in PWA shell — hydrated by assets/js/checkin.js. Ported from the
    original Event Tickets check-in design (dark theme, PIN keypad, scanner). */
defined('ABSPATH') || exit;
$brand = (string) \OE\Settings::get('brand_name', get_bloginfo('name'));
?>
<div class="oe-checkin" id="oe-checkin">

    <div class="app-header">
        <h1><?php echo esc_html($brand); ?> · <?php esc_html_e('Check-in', 'october-events'); ?></h1>
        <div class="scan-count-badge"><span id="oe-ci-count">0</span></div>
    </div>

    <!-- Step: event -->
    <section class="oe-ci-step is-active" data-step="event">
        <div class="screen-title"><?php esc_html_e('Select event', 'october-events'); ?></div>
        <div class="screen-sub"><?php esc_html_e('Choose the event you are checking attendees into.', 'october-events'); ?></div>
        <div id="oe-ci-events" class="list-card"></div>
    </section>

    <!-- Step: PIN keypad -->
    <section class="oe-ci-step" data-step="pin">
        <div class="screen-title"><?php esc_html_e('Enter PIN', 'october-events'); ?></div>
        <div class="screen-sub" id="oe-ci-pin-event"></div>
        <div class="pin-display" id="oe-ci-pin-display">&#9679;&#9679;&#9679;&#9679;</div>
        <input type="hidden" id="oe-ci-pin" value="">
        <div class="pin-grid">
            <button type="button" class="pin-btn" data-digit="1">1</button>
            <button type="button" class="pin-btn" data-digit="2">2</button>
            <button type="button" class="pin-btn" data-digit="3">3</button>
            <button type="button" class="pin-btn" data-digit="4">4</button>
            <button type="button" class="pin-btn" data-digit="5">5</button>
            <button type="button" class="pin-btn" data-digit="6">6</button>
            <button type="button" class="pin-btn" data-digit="7">7</button>
            <button type="button" class="pin-btn" data-digit="8">8</button>
            <button type="button" class="pin-btn" data-digit="9">9</button>
            <button type="button" class="pin-btn clear" id="oe-ci-pin-clear"><?php esc_html_e('Clear', 'october-events'); ?></button>
            <button type="button" class="pin-btn" data-digit="0">0</button>
            <button type="button" class="pin-btn enter" id="oe-ci-pin-go"><?php esc_html_e('Enter', 'october-events'); ?></button>
        </div>
        <div class="pin-error" id="oe-ci-pin-msg"></div>
        <button type="button" class="ci-back" data-back="event"><?php esc_html_e('← Back', 'october-events'); ?></button>
    </section>

    <!-- Step: venue -->
    <section class="oe-ci-step" data-step="venue">
        <div class="screen-title"><?php esc_html_e('Select venue', 'october-events'); ?></div>
        <div class="screen-sub"><?php esc_html_e('Choose your check-in point.', 'october-events'); ?></div>
        <div id="oe-ci-venues" class="list-card"></div>
        <button type="button" class="ci-back" data-back="pin"><?php esc_html_e('← Back', 'october-events'); ?></button>
    </section>

    <!-- Step: scanner -->
    <section class="oe-ci-step scan-screen" data-step="scan">
        <div id="oe-ci-reader">
            <div class="scanner-overlay">
                <div class="scan-frame"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i><span class="scan-line"></span></div>
                <div class="scanner-label"><?php esc_html_e('Point at a ticket QR code', 'october-events'); ?></div>
            </div>
        </div>
        <!-- Result overlay + venue label live OUTSIDE the reader so the no-camera
             fallback (which replaces the reader's content) can't wipe them. -->
        <div class="oe-ci-overlay" id="oe-ci-overlay" hidden><div class="oe-ci-overlay-inner"></div></div>
        <div class="scanner-bar">
            <div id="oe-ci-stats"></div>
            <span class="ci-venue" id="oe-ci-venue-name"></span>
            <input type="text" id="oe-ci-manual" placeholder="<?php esc_attr_e('Type ticket code', 'october-events'); ?>">
            <button type="button" class="ci-go" id="oe-ci-manual-go"><?php esc_html_e('Check in', 'october-events'); ?></button>
            <button type="button" data-back="venue"><?php esc_html_e('Change venue', 'october-events'); ?></button>
        </div>
    </section>
</div>
