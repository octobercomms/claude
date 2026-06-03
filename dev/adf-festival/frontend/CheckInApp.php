<?php
declare(strict_types=1);

namespace ADF\Frontend;

defined('ABSPATH') || exit;

/**
 * Door check-in PWA — `[adf_checkin]`.
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
        add_shortcode('adf_checkin', [$this, 'render']);
        add_action('wp_enqueue_scripts', [$this, 'register_assets']);
    }

    public function register_assets(): void {
        // Local QR scanner library (no external CDN for core, §12). Drop a build
        // of html5-qrcode here; the app falls back to manual token entry if absent.
        wp_register_script('adf-qr-scanner', ADF_URL . 'assets/js/html5-qrcode.min.js', [], ADF_VERSION, true);
        wp_register_script('adf-checkin', ADF_URL . 'assets/js/checkin.js', ['adf-qr-scanner'], ADF_VERSION, true);
    }

    public function render(array $atts = []): string {
        wp_enqueue_style('adf-dashboard');
        wp_enqueue_script('adf-checkin');
        wp_localize_script('adf-checkin', 'ADF_CHECKIN', [
            'restUrl' => esc_url_raw(rest_url('adf/v1')),
        ]);

        ob_start();
        require ADF_DIR . 'frontend/templates/checkin.php';
        return (string) ob_get_clean();
    }
}
