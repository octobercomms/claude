<?php
declare(strict_types=1);

namespace OE\Admin;

use OE\Demographics\Store;

defined('ABSPATH') || exit;

/**
 * Demographics dashboard (ROADMAP R2, §11 phase C). Aggregate-only bar charts
 * over consented profiles — no individual records are shown here.
 */
final class DemographicsScreen {

    public static function render(): void {
        if (! current_user_can('manage_options')) {
            wp_die(esc_html__('You do not have access to this section.', 'october-events'), '', ['response' => 403]);
        }
        $agg    = Store::aggregate();
        $fields = Store::fields();
        require OE_DIR . 'admin/views/demographics.php';
    }
}
