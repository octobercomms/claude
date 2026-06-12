<?php
/**
 * Plugin Name: ADF Festival
 * Plugin URI:  https://atlantadesignfestival.net
 * Description: Consolidated operations platform for the Atlanta Design Festival — accounts, listings (directory, destinations, products, events, stories), submission/approval, Stripe payments, Brevo email, ticketing, volunteers and the AI Stories editorial connector. Replaces the Event Tickets plugin. (Ads are handled by the standalone oc-ad-manager plugin.)
 * Version:     1.4.0
 * Author:      October Communications
 * Author URI:  https://octobercommunications.com
 * License:     GPL-2.0-or-later
 * Text Domain: adf-festival
 * Domain Path: /languages
 * Requires at least: 6.0
 * Requires PHP: 7.4
 *
 * Architecture notes (see docs/adf-festival/README.md for full detail):
 *   - The festival site already manages `events` and `volunteer` as JetEngine
 *     CPTs with live data and Elementor listings. This plugin ADOPTS those two
 *     CPTs rather than re-registering or migrating them: it only layers the
 *     shared ADF meta, submission/approval, payment and email logic on top.
 *   - All other listing types (directory, destinations, products, stories)
 *     plus the supporting `adf_account` and `adf_ticket` records are registered
 *     fresh by this plugin with an `adf_` slug prefix so they never collide with
 *     JetEngine.
 *   - Front end is HYBRID: this plugin owns the gated account dashboard,
 *     submission forms, Stripe checkout, tickets/QR and REST API. Public listing,
 *     map and story display is left to Elementor + JetEngine, which bind to the
 *     data and REST endpoints this plugin exposes.
 */

declare(strict_types=1);

defined('ABSPATH') || exit;

define('ADF_VERSION', '1.4.0');
// Bump when the DB schema changes so tables auto-(re)build on upgrade without a
// manual deactivate/reactivate. dbDelta makes the install routines idempotent.
define('ADF_DB_VERSION', '2');
define('ADF_FILE', __FILE__);
define('ADF_DIR', plugin_dir_path(__FILE__));
define('ADF_URL', plugin_dir_url(__FILE__));
define('ADF_BASENAME', plugin_basename(__FILE__));

/*
 * Composer autoloader (Stripe PHP SDK, etc.). Optional at load time so the
 * plugin still boots before `composer install` has run; connectors degrade
 * gracefully and surface an admin notice when a required SDK is missing.
 */
if (is_readable(ADF_DIR . 'vendor/autoload.php')) {
    require ADF_DIR . 'vendor/autoload.php';
}

/*
 * PSR-4-style autoloader for the plugin's own classes under the `ADF` root
 * namespace. Top-level sub-namespaces map to their directories; everything
 * else lives in includes/.
 */
spl_autoload_register(static function (string $class): void {
    if (strpos($class, 'ADF\\') !== 0) {
        return;
    }

    $parts = explode('\\', substr($class, strlen('ADF\\')));
    $dir_map = [
        'Admin'     => 'admin',
        'Frontend'  => 'frontend',
        'Migration' => 'migration',
    ];

    $top = $parts[0];
    if (isset($dir_map[$top])) {
        $base = ADF_DIR . $dir_map[$top] . '/';
        array_shift($parts);
    } else {
        $base = ADF_DIR . 'includes/';
    }

    $file = $base . implode('/', $parts) . '.php';
    if (is_readable($file)) {
        require $file;
    }
});

/*
 * Activation / deactivation. Flushing rewrite rules and (de)registering cron
 * lives in the Activator so the main file stays thin.
 */
register_activation_hook(__FILE__, ['ADF\\Activator', 'activate']);
register_deactivation_hook(__FILE__, ['ADF\\Activator', 'deactivate']);

/*
 * Boot. Everything is wired from the Plugin singleton on `plugins_loaded` so
 * JetEngine (which registers `events`/`volunteer`) has loaded first.
 */
add_action('plugins_loaded', static function (): void {
    ADF\Plugin::get_instance()->init();
}, 20);

/*
 * WP-CLI migration command (`wp adf migrate-tickets`).
 */
if (defined('WP_CLI') && WP_CLI) {
    ADF\Migration\Cli::register();
}
