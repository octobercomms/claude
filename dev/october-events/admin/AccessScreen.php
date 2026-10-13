<?php
declare(strict_types=1);

namespace OE\Admin;

defined('ABSPATH') || exit;

/**
 * "User access" admin screen (ADMIN-BUILD AD11).
 *
 * A standalone, designed home for the role × section capability grid that used
 * to live only in Settings. Adds one-click role presets and a read-only view of
 * which users each role covers, so an admin can see the effect before saving.
 * Persists through {@see SectionAccess::save_map()} (which re-syncs the caps).
 */
final class AccessScreen {

    public static function init(): void {
        add_action('admin_post_oe_save_access', [self::class, 'save']);
    }

    public static function render(): void {
        if (! current_user_can('manage_options')) {
            wp_die(esc_html__('You do not have access to this section.', 'october-events'), '', ['response' => 403]);
        }
        $roles        = SectionAccess::assignable_roles();
        $map          = SectionAccess::map();
        $sections     = SectionAccess::SECTIONS;
        $presets      = SectionAccess::presets();
        $portal_roles = SectionAccess::portal_only_roles();
        $portal_url   = (string) \OE\Settings::get('portal_page_url', '');

        // Count users per role (for the "who this covers" column).
        $counts = count_users();
        $by_role = (array) ($counts['avail_roles'] ?? []);

        require OE_DIR . 'admin/views/access.php';
    }

    public static function save(): void {
        if (! current_user_can('manage_options') || ! check_admin_referer('oe_save_access')) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        $posted = isset($_POST['section_access']) && is_array($_POST['section_access'])
            ? wp_unslash($_POST['section_access'])
            : [];
        SectionAccess::save_map((array) $posted);

        $portal = isset($_POST['portal_only']) && is_array($_POST['portal_only'])
            ? array_map('sanitize_key', (array) wp_unslash($_POST['portal_only']))
            : [];
        SectionAccess::save_portal_only($portal);

        $portal_url = isset($_POST['portal_page_url']) ? esc_url_raw(trim((string) wp_unslash($_POST['portal_page_url']))) : '';
        \OE\Settings::update(['portal_page_url' => $portal_url]);

        wp_safe_redirect(add_query_arg(['page' => 'oe-access', 'oe_msg' => 'saved'], admin_url('admin.php')));
        exit;
    }
}
