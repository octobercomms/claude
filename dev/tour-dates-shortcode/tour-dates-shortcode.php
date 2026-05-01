<?php
/**
 * Tour Dates Shortcode
 *
 * Usage: [tour_dates id="123"]
 *
 * Requires a variable WooCommerce product with:
 *   - Dates          — local attribute (attribute_dates), value is display text
 *   - Room Occupancy — global attribute (attribute_pa_room-occupancy), slugs: double-occupancy, single-occupancy
 *   - Payment        — global attribute (attribute_pa_payment), slugs: pay-deposit, pay-in-full
 */

// TOUR DATES
add_shortcode('tour_dates', function($atts) {
    $atts = shortcode_atts(['id' => 0], $atts);
    $product = wc_get_product($atts['id']);
    if (!$product || !$product->is_type('variable')) return '';

    $variations = $product->get_available_variations();
    $dates    = [];
    $occ_keys = [];

    foreach ($variations as $v) {
        $date = $v['attributes']['attribute_dates']              ?? '';
        $occ  = $v['attributes']['attribute_pa_room-occupancy'] ?? '';
        $pay  = $v['attributes']['attribute_pa_payment']        ?? '';
        $id    = $v['variation_id'];
        $price = $v['display_price'];

        if ($date && $occ && $pay) {
            $dates[$date][$occ][$pay] = ['id' => $id, 'price' => $price];
            if (!in_array($occ, $occ_keys)) $occ_keys[] = $occ;
        }
    }

    // Double occupancy first.
    usort($occ_keys, function($a, $b) {
        return strpos($a, 'double') !== false ? -1 : 1;
    });

    $checkout = wc_get_checkout_url();

    ob_start(); ?>
    <table class="tdt">
        <thead>
            <tr>
                <th>Date</th>
                <?php foreach ($occ_keys as $occ):
                    $label = strpos($occ, 'double') !== false ? 'Double occupancy' : 'Single occupancy';
                ?>
                <th><?php echo esc_html($label); ?></th>
                <?php endforeach; ?>
            </tr>
        </thead>
        <tbody>
        <?php foreach ($dates as $date => $occs): ?>
            <tr>
                <td class="date-col"><?php echo esc_html($date); ?></td>
                <?php foreach ($occ_keys as $occ):
                    $is_double = strpos($occ, 'double') !== false;
                    $note      = $is_double ? 'Per couple' : 'Per person';
                    $dep       = $occs[$occ]['pay-deposit'] ?? null;
                    $full      = $occs[$occ]['pay-in-full'] ?? null;
                ?>
                <td class="occ-col">
                    <?php if ($full || $dep): ?>
                        <span class="price-note"><?php echo esc_html($note); ?></span>
                        <?php if ($full): ?>
                            <span class="price-main"><?php echo do_shortcode('[currency price="' . esc_attr($full['price']) . '"]'); ?></span>
                        <?php endif; ?>
                        <?php if ($dep): ?>
                            <span class="price-dep"> / deposit <?php echo do_shortcode('[currency price="' . esc_attr($dep['price']) . '"]'); ?></span>
                        <?php endif; ?>
                        <div class="btn-wrap">
                            <?php if ($dep): ?>
                                <a href="<?php echo esc_url($checkout . '?add-to-cart=' . $dep['id']); ?>" class="btn-dep">Pay deposit</a>
                            <?php endif; ?>
                            <?php if ($full): ?>
                                <a href="<?php echo esc_url($checkout . '?add-to-cart=' . $full['id']); ?>" class="btn-full">Pay in full</a>
                            <?php endif; ?>
                        </div>
                    <?php else: ?>
                        <span class="sold-out">Sold out</span>
                    <?php endif; ?>
                </td>
                <?php endforeach; ?>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
    <?php return ob_get_clean();
});
// END TOUR DATES
