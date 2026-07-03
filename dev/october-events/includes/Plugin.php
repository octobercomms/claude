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

        // Pretty /checkin URL for the door check-in app (volunteers find it easily).
        add_action('init', [$this, 'register_checkin_route']);
        add_filter('query_vars', [$this, 'add_query_vars']);
    }

    public function register_checkin_route(): void {
        add_rewrite_rule('^checkin/?$', 'index.php?oe_checkin=1', 'top');
        // The service worker is served from the site root so it can claim the
        // /checkin scope (a worker under /wp-content/ couldn't). Lets the app open
        // and keep scanning with no signal.
        add_rewrite_rule('^checkin-sw\.js$', 'index.php?oe_checkin_sw=1', 'top');
        // Flush once per plugin version (covers self-updates, where no activation
        // hook fires) so /checkin resolves without re-saving permalinks.
        if (get_option('oe_rewrite_v') !== OE_VERSION) {
            flush_rewrite_rules(false);
            update_option('oe_rewrite_v', OE_VERSION);
        }
    }

    /** @param array<int,string> $vars */
    public function add_query_vars(array $vars): array {
        $vars[] = 'oe_checkin';
        $vars[] = 'oe_checkin_sw';
        return $vars;
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

        // Service worker for the check-in app (served from root for /checkin scope).
        if (isset($_GET['oe_checkin_sw']) || get_query_var('oe_checkin_sw')) {
            $this->render_checkin_sw();
            exit;
        }

        // Door check-in app at the pretty URL /checkin (or /?oe_checkin=1).
        if (isset($_GET['oe_checkin']) || get_query_var('oe_checkin')) {
            if (! Features::enabled('tickets')) {
                return; // ticketing off for this site
            }
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
        $body  = $app->render();        // enqueues styles/scripts (+ localize) and returns the shell markup
        $brand = (string) \OE\Settings::get('brand_name', get_bloginfo('name'));
        $icon  = function_exists('get_site_icon_url') ? get_site_icon_url(180) : '';
        $fav   = function_exists('get_site_icon_url') ? get_site_icon_url(32) : '';
        ?><!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php echo esc_attr(get_bloginfo('charset')); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<title><?php echo esc_html($brand . ' — ' . __('Check-in', 'october-events')); ?></title>
<!-- Add-to-home-screen: a useful label + the site icon instead of "Door check-in". -->
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="<?php echo esc_attr($brand); ?>">
<meta name="theme-color" content="#0f0f0f">
<?php if ($icon) : ?><link rel="apple-touch-icon" href="<?php echo esc_url($icon); ?>"><?php endif; ?>
<?php if ($fav) : ?><link rel="icon" href="<?php echo esc_url($fav); ?>"><?php endif; ?>
<?php wp_print_styles(); ?>
</head>
<body class="oe-checkin-route">
<?php echo $body; // built from an escaped template ?>
<?php wp_print_footer_scripts(); ?>
<script>
/* Register the offline service worker. It's served from the site root so it can
   also cache the plugin's assets (under /wp-content/), and it only ever
   intercepts its own shell/assets — a transparent passthrough for everything
   else. Best-effort: the app still works online if registration fails. */
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('<?php echo esc_url_raw(home_url('/checkin-sw.js')); ?>')
        .catch(function () {});
}
</script>
</body>
</html><?php
    }

    /**
     * The check-in app's service worker. Served from the site root (via the
     * /checkin-sw.js rewrite) so it can take the /checkin scope. It precaches the
     * app shell + its assets so the scanner opens and runs with no connectivity,
     * and is otherwise a transparent passthrough — it only intercepts its own
     * shell/assets, never the rest of the site or the REST calls.
     */
    private function render_checkin_sw(): void {
        nocache_headers();
        header('Content-Type: application/javascript; charset=utf-8');
        header('Service-Worker-Allowed: /'); // allow the /checkin scope from a root script
        $shell  = home_url('/checkin');
        $assets = [
            OE_URL . 'assets/css/checkin.css?ver=' . OE_VERSION,
            OE_URL . 'assets/js/html5-qrcode.min.js?ver=' . OE_VERSION,
            OE_URL . 'assets/js/checkin.js?ver=' . OE_VERSION,
        ];
        $cache = 'oe-checkin-' . OE_VERSION;
        ?>
const CACHE = <?php echo wp_json_encode($cache); ?>;
const SHELL = <?php echo wp_json_encode($shell); ?>;
const ASSETS = <?php echo wp_json_encode($assets); ?>;
const ASSET_PATHS = ASSETS.map(function (u) { return new URL(u, self.location).pathname; });

self.addEventListener('install', function (e) {
    e.waitUntil((async function () {
        const c = await caches.open(CACHE);
        try { await c.addAll([SHELL].concat(ASSETS)); } catch (err) {}
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', function (e) {
    e.waitUntil((async function () {
        const keys = await caches.keys();
        await Promise.all(keys.filter(function (k) {
            return k.indexOf('oe-checkin-') === 0 && k !== CACHE;
        }).map(function (k) { return caches.delete(k); }));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', function (e) {
    const req = e.request;
    if (req.method !== 'GET') { return; }
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/$/, '');
    const isShell = path.endsWith('/checkin');
    const isAsset = ASSET_PATHS.indexOf(url.pathname) !== -1;
    if (!isShell && !isAsset) { return; } // transparent for everything else

    e.respondWith((async function () {
        const cache = await caches.open(CACHE);
        if (isShell) {
            // Network-first so updates flow; fall back to the cached shell offline.
            try {
                const fresh = await fetch(req);
                cache.put(SHELL, fresh.clone());
                return fresh;
            } catch (err) {
                const cached = await cache.match(SHELL, { ignoreSearch: true });
                return cached || Response.error();
            }
        }
        // Assets are versioned — cache-first.
        const cached = await cache.match(req, { ignoreSearch: true });
        if (cached) { return cached; }
        try {
            const fresh = await fetch(req);
            if (fresh && fresh.ok) { cache.put(req, fresh.clone()); }
            return fresh;
        } catch (err) {
            return Response.error();
        }
    })());
});
<?php
    }

    private function render_ticket(string $token): void {
        // The built-in test ticket — viewable like a real one (open on a phone,
        // scan with another running /checkin). Not in the DB.
        if ($token === \OE\Ticketing\CheckIn::TEST_TOKEN) {
            $ticket = (object) [
                'id' => 0, 'token' => $token, 'ticket_number' => 1, 'total_in_order' => 1,
                'event_id' => 0, 'event_label' => '🧪 ' . __('Test ticket', 'october-events'),
                'attendee_name' => __('Test Attendee', 'october-events'),
                'ticket_type_label' => __('Scanner check', 'october-events'), 'status' => 'active',
            ];
            require OE_DIR . 'frontend/templates/ticket.php';
            return;
        }
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
