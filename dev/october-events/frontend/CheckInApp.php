<?php
declare(strict_types=1);

namespace OE\Frontend;

defined('ABSPATH') || exit;

/**
 * Door check-in PWA — `[oe_checkin]`.
 *
 * Drop the shortcode on a private page (e.g. /checkin/). Staff pick the event,
 * enter the event PIN, choose a venue/door and scan ticket QR codes. Access is
 * PIN-gated via the REST API, so staff don't need WordPress logins.
 */
final class CheckInApp {

    private static ?CheckInApp $instance = null;

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        add_shortcode('oe_checkin', [$this, 'render']);
        add_action('wp_enqueue_scripts', [$this, 'register_assets']);
    }

    public function register_assets(): void {
        wp_register_style('oe-checkin', OE_URL . 'assets/css/checkin.css', [], OE_VERSION);
        // Local QR scanner library (no external CDN for core, §12). Drop a build
        // of html5-qrcode here; the app falls back to manual token entry if absent.
        wp_register_script('oe-qr-scanner', OE_URL . 'assets/js/html5-qrcode.min.js', [], OE_VERSION, true);
        wp_register_script('oe-checkin', OE_URL . 'assets/js/checkin.js', ['oe-qr-scanner'], OE_VERSION, true);
    }

    public function render(array $atts = []): string {
        if (! \OE\Features::enabled('tickets')) {
            return '';
        }
        wp_enqueue_style('oe-checkin');
        wp_enqueue_script('oe-checkin');
        wp_localize_script('oe-checkin', 'OE_CHECKIN', [
            'restUrl' => esc_url_raw(rest_url('oe/v1')),
        ]);

        ob_start();
        require OE_DIR . 'frontend/templates/checkin.php';
        return (string) ob_get_clean();
    }
}
