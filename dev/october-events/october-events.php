<?php
/**
 * Plugin Name: October Events
 * Plugin URI:  https://atlantadesignfestival.net
 * Description: Festival & events operations platform — accounts, listings (directory, destinations, products, events, stories), submission/approval, Stripe payments, Brevo email + SMS, ticketing + QR check-in, volunteers, and the AI Stories editorial connector. Runs on multiple sites (e.g. Atlanta Design Festival, Architecture Tours) with a per-site brand. (Ads are handled by the standalone oc-ad-manager plugin.)
 * Version:     1.9.0
 * Author:      October Communications
 * Author URI:  https://octobercommunications.com
 * License:     GPL-2.0-or-later
 * Text Domain: october-events
 * Domain Path: /languages
 * Requires at least: 6.0
 * Requires PHP: 7.4
 *
 * Architecture notes (see docs/october-events/README.md for full detail):
 *   - The festival site already manages `events` and `volunteer` as JetEngine
 *     CPTs with live data and Elementor listings. This plugin ADOPTS those two
 *     CPTs rather than re-registering or migrating them: it only layers the
 *     shared OE meta, submission/approval, payment and email logic on top.
 *   - All other listing types (directory, destinations, products, stories)
 *     plus the supporting `oe_account` and `oe_ticket` records are registered
 *     fresh by this plugin with an `oe_` slug prefix so they never collide with
 *     JetEngine.
 *   - Front end is HYBRID: this plugin owns the gated account dashboard,
 *     submission forms, Stripe checkout, tickets/QR and REST API. Public listing,
 *     map and story display is left to Elementor + JetEngine, which bind to the
 *     data and REST endpoints this plugin exposes.
 */

declare(strict_types=1);

defined('ABSPATH') || exit;

define('OE_VERSION', '1.9.0');
// Bump when the DB schema changes so tables auto-(re)build on upgrade without a
// manual deactivate/reactivate. dbDelta makes the install routines idempotent.
define('OE_DB_VERSION', '3');
define('OE_FILE', __FILE__);
define('OE_DIR', plugin_dir_path(__FILE__));
define('OE_URL', plugin_dir_url(__FILE__));
define('OE_BASENAME', plugin_basename(__FILE__));

/*
 * Composer autoloader (Stripe PHP SDK, etc.). Optional at load time so the
 * plugin still boots before `composer install` has run; connectors degrade
 * gracefully and surface an admin notice when a required SDK is missing.
 */
if (is_readable(OE_DIR . 'vendor/autoload.php')) {
    require OE_DIR . 'vendor/autoload.php';
}

/*
 * PSR-4-style autoloader for the plugin's own classes under the `OE` root
 * namespace. Top-level sub-namespaces map to their directories; everything
 * else lives in includes/.
 */
spl_autoload_register(static function (string $class): void {
    if (strpos($class, 'OE\\') !== 0) {
        return;
    }

    $parts = explode('\\', substr($class, strlen('OE\\')));
    $dir_map = [
        'Admin'     => 'admin',
        'Frontend'  => 'frontend',
        'Migration' => 'migration',
    ];

    $top = $parts[0];
    if (isset($dir_map[$top])) {
        $base = OE_DIR . $dir_map[$top] . '/';
        array_shift($parts);
    } else {
        $base = OE_DIR . 'includes/';
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
register_activation_hook(__FILE__, ['OE\\Activator', 'activate']);
register_deactivation_hook(__FILE__, ['OE\\Activator', 'deactivate']);

/*
 * Boot. Everything is wired from the Plugin singleton on `plugins_loaded` so
 * JetEngine (which registers `events`/`volunteer`) has loaded first.
 */
add_action('plugins_loaded', static function (): void {
    OE\Plugin::get_instance()->init();
}, 20);

/*
 * WP-CLI migration command (`wp adf migrate-tickets`).
 */
if (defined('WP_CLI') && WP_CLI) {
    OE\Migration\Cli::register();
}
