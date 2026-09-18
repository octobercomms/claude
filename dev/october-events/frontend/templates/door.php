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
                <input type="text" id="oe-door-promo" autocapitalize="characters" autocomplete="off" placeholder="<?php esc_attr_e('Code', 'october-events'); ?>">
            </details>

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
