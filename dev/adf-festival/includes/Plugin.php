<?php
declare(strict_types=1);

namespace ADF;

use ADF\Connectors\MapsConnector;
use ADF\Admin\Admin;
use ADF\Frontend\Dashboard;

defined('ABSPATH') || exit;

/**
 * Main plugin singleton — wires every module together.
 */
final class Plugin {

    private static ?Plugin $instance = null;

    private function __construct() {}

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        load_plugin_textdomain('adf-festival', false, dirname(ADF_BASENAME) . '/languages');

        // Auto-build new/changed tables after an update (no reactivation needed).
        Activator::maybe_upgrade();

        // Data layer.
        PostTypes::get_instance()->init();
        Fields::get_instance()->init();
        Account::get_instance()->init();
        (new Volunteers())->init();

        // Services.
        RestApi::get_instance()->init();
        (new Cron())->init();
        MapsConnector::init();

        // Interfaces.
        if (is_admin()) {
            Admin::get_instance()->init();
        }
        Dashboard::get_instance()->init();
        \ADF\Frontend\Checkout::get_instance()->init();
        \ADF\Frontend\CheckInApp::get_instance()->init();
        \ADF\Ads\Serving::get_instance()->init();
        \ADF\Frontend\AdBooking::get_instance()->init();

        // GitHub self-updater (offers releases in the WP Updates screen).
        (new Updater(ADF_BASENAME, ADF_VERSION, Updater::repo(), Updater::token()))->init();

        // Shared asset registration (used by dashboard + map).
        add_action('wp_enqueue_scripts', [$this, 'register_assets']);
        add_action('admin_enqueue_scripts', [$this, 'register_admin_assets']);

        // Ticket view + invoice download routing.
        add_action('template_redirect', [$this, 'handle_public_routes']);
    }

    public function register_assets(): void {
        wp_register_style('adf-dashboard', ADF_URL . 'assets/css/dashboard.css', [], ADF_VERSION);
        wp_register_script('adf-dashboard', ADF_URL . 'assets/js/dashboard.js', [], ADF_VERSION, true);
        wp_register_script('adf-map', ADF_URL . 'assets/js/map.js', [], ADF_VERSION, true);
    }

    public function register_admin_assets(string $hook): void {
        if (strpos($hook, 'adf-festival') === false && strpos($hook, 'adf_') === false) {
            return;
        }
        wp_enqueue_style('adf-admin', ADF_URL . 'assets/css/admin.css', [], ADF_VERSION);
    }

    /**
     * Lightweight front routes for ticket view + invoice download. Public
     * listing/map pages are handled by Elementor/JetEngine (hybrid model).
     */
    public function handle_public_routes(): void {
        $ticket_token = isset($_GET['adf_ticket']) ? sanitize_text_field(wp_unslash($_GET['adf_ticket'])) : '';
        if ($ticket_token !== '') {
            $this->render_ticket($ticket_token);
            exit;
        }

        $invoice_listing = isset($_GET['adf_invoice']) ? absint($_GET['adf_invoice']) : 0;
        if ($invoice_listing) {
            $this->render_invoice($invoice_listing);
            exit;
        }
    }

    private function render_ticket(string $token): void {
        $ticket = \ADF\Ticketing\Orders::ticket_by_token($token);
        if (! $ticket || $ticket->status !== 'active') {
            wp_die(esc_html__('Ticket not found.', 'adf-festival'), '', ['response' => 404]);
        }
        require ADF_DIR . 'frontend/templates/ticket.php';
    }

    private function render_invoice(int $listing_id): void {
        $invoice = get_post_meta($listing_id, '_adf_invoice', true);
        $account_id = (int) Fields::get($listing_id, 'submitter_account_id');
        // Only the owner (or an admin) may view.
        if (! is_array($invoice) || (Account::for_user(get_current_user_id()) !== $account_id && ! current_user_can('manage_options'))) {
            wp_die(esc_html__('Invoice not available.', 'adf-festival'), '', ['response' => 403]);
        }
        $invoice['listing_name'] = get_the_title($listing_id);
        header('Content-Type: text/html; charset=utf-8');
        echo Invoice::render_html($invoice); // phpcs:ignore — already escaped within.
    }
}
