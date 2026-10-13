<?php
declare(strict_types=1);

namespace OE\Admin;

use OE\PostTypes;
use OE\Locations\Migrator;

defined('ABSPATH') || exit;

/**
 * Tour locations admin (ROADMAP R1): the native location list plus a
 * dry-runnable migrator that promotes the Tour pack's per-event locations
 * repeater into `oe_location` records.
 */
final class LocationsScreen {

    public static function init(): void {
        add_action('admin_post_oe_locations_promote', [self::class, 'promote']);
    }

    private static function cap(): bool {
        return current_user_can('manage_options');
    }

    public static function render(): void {
        if (! self::cap()) {
            wp_die(esc_html__('You do not have access to this section.', 'october-events'), '', ['response' => 403]);
        }
        $scan    = Migrator::scan();
        $loc_list = admin_url('edit.php?post_type=' . PostTypes::slug('location'));
        $new_loc  = admin_url('post-new.php?post_type=' . PostTypes::slug('location'));
        $preview  = get_transient('oe_loc_promote_' . get_current_user_id());
        if ($preview) {
            delete_transient('oe_loc_promote_' . get_current_user_id());
        }
        require OE_DIR . 'admin/views/locations.php';
    }

    public static function promote(): void {
        if (! self::cap() || ! check_admin_referer('oe_locations_promote')) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        $dry = ! (isset($_POST['commit']) && $_POST['commit'] === '1');
        $res = Migrator::promote($dry);
        $res['dry'] = $dry;
        set_transient('oe_loc_promote_' . get_current_user_id(), $res, 120);
        wp_safe_redirect(admin_url('admin.php?page=oe-locations'));
        exit;
    }
}
