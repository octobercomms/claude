<?php
declare(strict_types=1);

namespace OE\Admin;

use OE\PostTypes;
use OE\Locations\Migrator;

defined('ABSPATH') || exit;

/**
 * Multiple locations admin (ROADMAP R1): the native location records listed
 * inline, a slide-in to add one, plus a dry-runnable migrator that promotes the
 * per-event locations repeater into `oe_location` records.
 */
final class LocationsScreen {

    public static function init(): void {
        add_action('admin_post_oe_locations_promote', [self::class, 'promote']);
        add_action('admin_post_oe_location_create', [self::class, 'create']);
    }

    private static function cap(): bool {
        return current_user_can('manage_options');
    }

    public static function render(): void {
        if (! self::cap()) {
            wp_die(esc_html__('You do not have access to this section.', 'october-events'), '', ['response' => 403]);
        }
        $scan    = Migrator::scan();
        // The native Location records, listed inline (no separate CPT list page).
        $records = get_posts([
            'post_type'      => PostTypes::slug('location'),
            'post_status'    => ['publish', 'draft', 'pending', 'private'],
            'posts_per_page' => 300,
            'orderby'        => 'title',
            'order'          => 'ASC',
        ]);
        $edit_link = static fn(int $id): string => (string) get_edit_post_link($id);
        $preview  = get_transient('oe_loc_promote_' . get_current_user_id());
        if ($preview) {
            delete_transient('oe_loc_promote_' . get_current_user_id());
        }
        require OE_DIR . 'admin/views/locations.php';
    }

    /** Create a native Location record from the slide-in form, then return here. */
    public static function create(): void {
        if (! self::cap() || ! check_admin_referer('oe_location_create')) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        $name = sanitize_text_field((string) wp_unslash($_POST['oe_loc_name'] ?? ''));
        if ($name === '') {
            wp_safe_redirect(admin_url('admin.php?page=oe-locations&oe_msg=loc_noname'));
            exit;
        }
        $id = wp_insert_post([
            'post_type'   => PostTypes::slug('location'),
            'post_title'  => $name,
            'post_status' => 'publish',
        ], true);
        if (is_wp_error($id)) {
            wp_safe_redirect(admin_url('admin.php?page=oe-locations&oe_msg=loc_fail'));
            exit;
        }
        foreach (['address', 'day', 'maps_url'] as $f) {
            $v = (string) wp_unslash($_POST['oe_loc_' . $f] ?? '');
            if ($v === '') {
                continue;
            }
            update_post_meta((int) $id, \OE\Locations\Meta::key($f), $f === 'maps_url' ? esc_url_raw($v) : sanitize_text_field($v));
        }
        wp_safe_redirect(admin_url('admin.php?page=oe-locations&oe_msg=loc_created'));
        exit;
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
