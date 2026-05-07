<?php
/**
 * Uninstall handler for October Event Tickets.
 *
 * Runs when the plugin is deleted from the WordPress admin.
 * Only drops database tables if the admin has opted in (oct_tickets_drop_on_uninstall = 1).
 */

defined('WP_UNINSTALL_PLUGIN') || exit;

if (get_option('oct_tickets_drop_on_uninstall')) {
    global $wpdb;

    $wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}oct_checkins");
    $wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}oct_tickets");
    $wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}oct_orders");
    $wpdb->query("DROP TABLE IF EXISTS {$wpdb->prefix}oct_promo_codes");

    delete_option('oct_tickets_settings');
    delete_option('oct_tickets_version');
    delete_option('oct_tickets_db_version');
    delete_option('oct_tickets_drop_on_uninstall');

    // Clear any transients
    $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_oct_qr_%'");
    $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_timeout_oct_qr_%'");
    $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_oct_paypal_%'");
    $wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_timeout_oct_paypal_%'");
}
