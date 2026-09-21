<?php
/**
 * Door-sale checkout shell — hydrated by assets/js/door.js.
 *
 * Vars in scope (set by DoorSale::render):
 *   $tpl_event_id int, $tpl_title string, $tpl_venue string,
 *   $tpl_types array<{key,label,price,desc,max}>
 */
defined('ABSPATH') || exit;

$brand = (string) \OE\Settings::get('brand_name', get_bloginfo('name'));
$cur   = strtoupper((string) \OE\Settings::get('currency', 'usd'));
$sym   = $cur === 'GBP' ? '£' : ($cur === 'EUR' ? '€' : '$');
?>
<?php if (! empty($tpl_poster)) : ?>

    <!-- Printable poster: a big QR to the buy page. Open on any screen and print
         (Cmd/Ctrl+P). The QR is built by door.js from OE_DOOR.buyUrl. -->
    <div class="oe-door-poster" id="oe-door">
        <div class="poster-brand"><?php echo esc_html($brand); ?></div>
        <h1 class="poster-title"><?php echo esc_html($tpl_title !== '' ? $tpl_title : ($tpl_city !== '' ? $tpl_city : __('Buy tickets', 'october-events'))); ?></h1>
        <?php if ($tpl_venue !== '') : ?>
            <div class="poster-venue"><?php echo esc_html($tpl_venue); ?></div>
        <?php endif; ?>
        <div class="poster-cta"><?php esc_html_e('Scan to buy a tour ticket', 'october-events'); ?></div>
        <div class="poster-qr" id="oe-door-qr"></div>
        <div class="poster-steps"><?php esc_html_e('Point your phone camera at the code, pick your tickets and pay. Your ticket is emailed to you.', 'october-events'); ?></div>
        <button type="button" class="poster-print" id="oe-door-print" onclick="window.print()"><?php esc_html_e('Print this sign', 'october-events'); ?></button>
    </div>

<?php else : ?>
<div class="oe-door" id="oe-door">

    <?php if (! $tpl_event_id || ! $tpl_types) : ?>

        <div class="door-empty">
            <div class="door-empty-icon">🎟</div>
            <h1><?php echo esc_html($brand); ?></h1>
            <p><?php esc_html_e('No tickets are on sale here right now. Please ask a member of staff.', 'october-events'); ?></p>
        </div>

    <?php else : ?>

        <header class="door-head">
            <div class="door-brand"><?php echo esc_html($brand); ?></div>
            <h1 class="door-title"><?php echo esc_html($tpl_title); ?></h1>
            <?php if ($tpl_venue !== '') : ?>
                <div class="door-venue">📍 <?php echo esc_html($tpl_venue); ?></div>
            <?php endif; ?>
        </header>

        <!-- Buy form -->
        <section class="door-buy" id="oe-door-buy">
            <div class="door-types">
                <?php foreach ($tpl_types as $t) : ?>
                    <div class="door-type" data-key="<?php echo esc_attr($t['key']); ?>" data-price="<?php echo esc_attr(number_format($t['price'], 2, '.', '')); ?>" data-max="<?php echo esc_attr((string) $t['max']); ?>">
                        <div class="door-type-info">
                            <div class="door-type-label"><?php echo esc_html($t['label']); ?></div>
                            <?php if ($t['desc'] !== '') : ?>
                                <div class="door-type-desc"><?php echo esc_html($t['desc']); ?></div>
                            <?php endif; ?>
                            <div class="door-type-price"><?php echo esc_html($sym . number_format($t['price'], 2)); ?></div>
                        </div>
                        <div class="door-stepper">
                            <button type="button" class="door-minus" aria-label="<?php esc_attr_e('Remove one', 'october-events'); ?>">−</button>
                            <span class="door-qty" aria-live="polite">0</span>
                            <button type="button" class="door-plus" aria-label="<?php esc_attr_e('Add one', 'october-events'); ?>">+</button>
                        </div>
                    </div>
                <?php endforeach; ?>
            </div>

            <div class="door-field">
                <label for="oe-door-email"><?php esc_html_e('Email for the ticket', 'october-events'); ?></label>
                <input type="email" id="oe-door-email" inputmode="email" autocomplete="email" placeholder="you@example.com" required>
                <p class="door-hint"><?php esc_html_e('We email the ticket so it works at every stop.', 'october-events'); ?></p>
            </div>

            <details class="door-promo">
                <summary><?php esc_html_e('Add a promo or volunteer code', 'october-events'); ?></summary>
                <div class="door-promo-row">
                    <input type="text" id="oe-door-promo" autocapitalize="characters" autocomplete="off" placeholder="<?php esc_attr_e('Code', 'october-events'); ?>">
                    <button type="button" class="door-promo-apply" id="oe-door-promo-apply"><?php esc_html_e('Apply', 'october-events'); ?></button>
                </div>
                <div class="door-promo-msg" id="oe-door-promo-msg" aria-live="polite"></div>
            </details>

            <!-- The Stripe Payment Element (card + Apple Pay / Google Pay) mounts
                 here inline, right under the tickets, as soon as a ticket is
                 chosen. Hidden when the inline flow isn't available (no publishable
                 key) — then the button falls back to the hosted Stripe redirect. -->
            <div class="door-pay-phase" id="oe-door-pay-phase" hidden>
                <div class="door-pay-el" id="oe-door-payment-element"></div>
                <div class="door-pay-err" id="oe-door-pay-err" role="alert"></div>
            </div>

            <div class="door-msg" id="oe-door-msg" role="alert"></div>
        </section>

        <!-- Sticky pay bar -->
        <div class="door-bar">
            <div class="door-total">
                <span class="door-total-label"><?php esc_html_e('Total', 'october-events'); ?></span>
                <span class="door-total-amount" id="oe-door-total"><?php echo esc_html($sym . '0.00'); ?></span>
            </div>
            <button type="button" class="door-pay" id="oe-door-pay" disabled>
                <?php esc_html_e('Pay', 'october-events'); ?>
            </button>
        </div>

    <?php endif; ?>

    <!-- Result overlays (paid / cancelled) — shown by JS from the return URL. -->
    <div class="door-result" id="oe-door-result" hidden>
        <div class="door-result-inner"></div>
    </div>
</div>
<?php endif; ?>
