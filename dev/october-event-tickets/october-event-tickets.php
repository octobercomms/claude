<?php
/**
 * Plugin Name: Event Tickets by October Communications
 * Plugin URI:  https://octobercommunications.com
 * Description: Complete event ticketing solution with Stripe, PayPal Pay Later, Brevo email, QR code tickets, and mobile check-in PWA.
 * Version:     1.0.0
 * Author:      October Communications
 * Author URI:  https://octobercommunications.com
 * License:     GPL-2.0-or-later
 * Text Domain: october-event-tickets
 * Domain Path: /languages
 * Requires at least: 6.0
 * Requires PHP: 7.4
 */

declare(strict_types=1);

defined('ABSPATH') || exit;

define('OCT_TICKETS_VERSION', '1.0.0');
define('OCT_TICKETS_FILE', __FILE__);
define('OCT_TICKETS_DIR', plugin_dir_path(__FILE__));
define('OCT_TICKETS_URL', plugin_dir_url(__FILE__));
define('OCT_TICKETS_BASENAME', plugin_basename(__FILE__));

// Autoloader
spl_autoload_register(function (string $class): void {
    if (strpos($class, 'OctoberTickets\\') !== 0) {
        return;
    }

    $relative = substr($class, strlen('OctoberTickets\\'));
    $relative = str_replace('\\', DIRECTORY_SEPARATOR, $relative);

    // Map Lib namespace to lib/ folder
    if (strpos($relative, 'Lib' . DIRECTORY_SEPARATOR) === 0) {
        $file = OCT_TICKETS_DIR . 'lib' . DIRECTORY_SEPARATOR . substr($relative, strlen('Lib' . DIRECTORY_SEPARATOR)) . '.php';
    } else {
        $file = OCT_TICKETS_DIR . 'includes' . DIRECTORY_SEPARATOR . $relative . '.php';
    }

    if (file_exists($file)) {
        require_once $file;
    }
});

// Activation / deactivation hooks
register_activation_hook(__FILE__, function (): void {
    require_once OCT_TICKETS_DIR . 'includes/DB.php';
    \OctoberTickets\DB::create_tables();
    \OctoberTickets\DB::set_version();
    // Register rewrite rules so we can flush them
    \OctoberTickets\Plugin::get_instance()->register_rewrite_rules();
    flush_rewrite_rules();
});

register_deactivation_hook(__FILE__, function (): void {
    flush_rewrite_rules();
});

// Boot plugin
add_action('plugins_loaded', function (): void {
    \OctoberTickets\Plugin::get_instance()->init();
}, 10);
