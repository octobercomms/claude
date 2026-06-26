<?php
declare(strict_types=1);

namespace OE;

use OE\Connectors\MapsConnector;
use OE\Admin\Admin;
use OE\Frontend\Dashboard;

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
        load_plugin_textdomain('october-events', false, dirname(OE_BASENAME) . '/languages');

        // Auto-build new/changed tables after an update (no reactivation needed).
        Activator::maybe_upgrade();

        // Backward-compat shims for the ADF → October Events rename.
        Compat::init();

        // Data layer.
        PostTypes::get_instance()->init();
        Fields::get_instance()->init();
        Account::get_instance()->init();
        (new Volunteers())->init();

        // Services.
        RestApi::get_instance()->init();
        Cors::init();
        \OE\Planning\Rest::init();
        \OE\Tasks\Rest::init();
        \OE\Volunteers\Rest::init();
        \OE\Brand\Rest::init();
        \OE\Mail\Mailer::init();
        \OE\Mail\SnsController::init();
        \OE\Mail\CampaignsRest::init();
        \OE\Mail\ContactsRest::init();
        \OE\AI\Rest::init();
        \OE\AI\PublicRest::init();
        \OE\Reports\Rest::init();
        (new Cron())->init();
        MapsConnector::init();
        Chat::init();

        // Interfaces.
        if (is_admin()) {
            Admin::get_instance()->init();
        }
        Dashboard::get_instance()->init();
        \OE\Frontend\Checkout::get_instance()->init();
        \OE\Frontend\CheckInApp::get_instance()->init();
        \OE\Frontend\SupportChat::get_instance()->init();

        // GitHub self-updater (offers releases in the WP Updates screen).
        (new Updater(OE_BASENAME, OE_VERSION, Updater::repo(), Updater::token()))->init();

        // Shared asset registration (used by dashboard + map).
        add_action('wp_enqueue_scripts', [$this, 'register_assets']);
        add_action('admin_enqueue_scripts', [$this, 'register_admin_assets']);

        // Ticket view + invoice download routing.
        add_action('template_redirect', [$this, 'handle_public_routes']);
    }

    public function register_assets(): void {
        wp_register_style('oe-dashboard', OE_URL . 'assets/css/dashboard.css', [], OE_VERSION);
        wp_register_script('oe-dashboard', OE_URL . 'assets/js/dashboard.js', [], OE_VERSION, true);
        wp_register_script('oe-map', OE_URL . 'assets/js/map.js', [], OE_VERSION, true);
    }

    public function register_admin_assets(string $hook): void {
        // The submenu page hook is derived from the (brand-named) parent menu
        // title, so it can't be matched reliably. Match the page query param —
        // our screens are page=october-events or page=oe-* — plus our CPT
        // edit/list screens (hook contains oe_).
        $page = isset($_GET['page']) ? sanitize_key((string) $_GET['page']) : '';
        $is_oe_page = ($page === 'october-events' || strpos($page, 'oe-') === 0);
        if (! $is_oe_page && strpos($hook, 'oe_') === false) {
            return;
        }
        wp_enqueue_style('oe-admin', OE_URL . 'assets/css/admin.css', [], OE_VERSION);
        // Per-site accent (Settings → Branding) — falls back to brand yellow.
        $accent    = (string) Settings::get('theme_accent', '') ?: '#E7CD41';
        $accent_on = (string) Settings::get('theme_accent_on', '') ?: '#1a1a1a';
        wp_add_inline_style('oe-admin', '.oe-admin{--oe-accent:' . esc_html($accent) . ';--oe-accent-on:' . esc_html($accent_on) . '}');
        // Uploaded brand font(s) apply in wp-admin too (else Brockmann). Two
        // weights supported: regular for body, bold for headings.
        $font_url  = (string) Settings::get('theme_font_url', '');
        $font_bold = (string) Settings::get('theme_font_url_bold', '');
        if ($font_url !== '' || $font_bold !== '') {
            $family = (string) Settings::get('theme_font_family', '') ?: 'BrandFont';
            $fmt = static function (string $u): string {
                return preg_match('/\.woff2($|\?)/i', $u) ? 'woff2' : (preg_match('/\.woff($|\?)/i', $u) ? 'woff' : (preg_match('/\.otf($|\?)/i', $u) ? 'opentype' : 'truetype'));
            };
            $faces = '';
            if ($font_url !== '') {
                $faces .= '@font-face{font-family:"' . esc_html($family) . '";src:url("' . esc_url($font_url) . '") format("' . $fmt($font_url) . '");font-weight:' . ($font_bold !== '' ? '100 500' : '400 800') . ';font-style:normal;font-display:swap}';
            }
            if ($font_bold !== '') {
                $faces .= '@font-face{font-family:"' . esc_html($family) . '";src:url("' . esc_url($font_bold) . '") format("' . $fmt($font_bold) . '");font-weight:600 900;font-style:normal;font-display:swap}';
            }
            wp_add_inline_style('oe-admin',
                $faces
                . '.oe-admin{--oe-font:"' . esc_html($family) . '",-apple-system,BlinkMacSystemFont,system-ui,sans-serif}');
        }
        // The Settings screen uses the media library to upload a brand font.
        if (strpos($hook, 'oe-settings') !== false) {
            wp_enqueue_media();
        }
    }

    /**
     * Lightweight front routes for ticket view + invoice download. Public
     * listing/map pages are handled by Elementor/JetEngine (hybrid model).
     */
    public function handle_public_routes(): void {
        // One-click unsubscribe (?oe_unsub=…&k=…) — exits if it handles the request.
        \OE\Mail\Unsubscribe::handle();

        // Campaign open pixel.
        $open = isset($_GET['oe_o']) ? sanitize_text_field(wp_unslash($_GET['oe_o'])) : '';
        if ($open !== '') {
            \OE\Mail\Campaigns::track_open($open);
            nocache_headers();
            header('Content-Type: image/gif');
            echo base64_decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'); // 1x1 transparent gif
            exit;
        }

        // Campaign click redirect (URL is HMAC-signed to prevent open redirects).
        $click = isset($_GET['oe_c']) ? sanitize_text_field(wp_unslash($_GET['oe_c'])) : '';
        if ($click !== '') {
            \OE\Mail\Campaigns::track_click($click);
            $url = isset($_GET['u']) ? esc_url_raw(wp_unslash($_GET['u'])) : '';
            $sig = isset($_GET['s']) ? sanitize_text_field(wp_unslash($_GET['s'])) : '';
            if ($url !== '' && \OE\Mail\Campaigns::verify_link($url, $sig)) {
                wp_redirect($url); // external (validated) — wp_safe_redirect would block off-site links
            } else {
                wp_safe_redirect(home_url('/'));
            }
            exit;
        }

        // Always-on door check-in app (so there's a working URL without having to
        // place the [oe_checkin] shortcode on a page): /?oe_checkin=1
        if (isset($_GET['oe_checkin'])) {
            $this->render_checkin();
            exit;
        }

        $ticket_token = isset($_GET['oe_ticket']) ? sanitize_text_field(wp_unslash($_GET['oe_ticket'])) : '';
        if ($ticket_token !== '') {
            $this->render_ticket($ticket_token);
            exit;
        }

        $invoice_listing = isset($_GET['oe_invoice']) ? absint($_GET['oe_invoice']) : 0;
        if ($invoice_listing) {
            $this->render_invoice($invoice_listing);
            exit;
        }
    }

    /** Render the door check-in PWA as a standalone full page. */
    private function render_checkin(): void {
        nocache_headers();
        $app = \OE\Frontend\CheckInApp::get_instance();
        $app->register_assets();        // register handles now (template_redirect is before wp_enqueue_scripts)
        $body = $app->render();         // enqueues styles/scripts (+ localize) and returns the shell markup
        ?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php echo esc_attr(get_bloginfo('charset')); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title><?php esc_html_e('Door check-in', 'october-events'); ?></title>
<?php wp_print_styles(); ?>
</head>
<body class="oe-checkin-route">
<?php echo $body; // built from an escaped template ?>
<?php wp_print_footer_scripts(); ?>
</body>
</html><?php
    }

    private function render_ticket(string $token): void {
        $ticket = \OE\Ticketing\Orders::ticket_by_token($token);
        if (! $ticket || $ticket->status !== 'active') {
            wp_die(esc_html__('Ticket not found.', 'october-events'), '', ['response' => 404]);
        }
        require OE_DIR . 'frontend/templates/ticket.php';
    }

    private function render_invoice(int $listing_id): void {
        $invoice = get_post_meta($listing_id, '_oe_invoice', true);
        $account_id = (int) Fields::get($listing_id, 'submitter_account_id');
        // Only the owner (or an admin) may view.
        if (! is_array($invoice) || (Account::for_user(get_current_user_id()) !== $account_id && ! current_user_can('manage_options'))) {
            wp_die(esc_html__('Invoice not available.', 'october-events'), '', ['response' => 403]);
        }
        $invoice['listing_name'] = get_the_title($listing_id);
        header('Content-Type: text/html; charset=utf-8');
        echo Invoice::render_html($invoice); // phpcs:ignore — already escaped within.
    }
}
