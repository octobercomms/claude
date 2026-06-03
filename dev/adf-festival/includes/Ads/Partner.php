<?php
declare(strict_types=1);

namespace ADF\Ads;

use ADF\Settings;
use ADF\Logger;

defined('ABSPATH') || exit;

/**
 * Partner-mode ad rendering: this site pulls ads from a configured hub and
 * serves them, so the hub can syndicate campaigns across multiple partner sites.
 *
 * The fetch happens server-side (avoiding CORS); results are cached briefly per
 * format. Clicks route back through the hub's redirect so the hub records them.
 */
final class Partner {

    private const CACHE_TTL = 300; // 5 minutes
    private const NEG_TTL   = 60;

    public static function is_partner(): bool {
        return Settings::get('ad_site_mode', 'hub') === 'partner' && (string) Settings::get('ad_hub_url', '') !== '';
    }

    /**
     * Fetch + render an ad for a format from the hub. Returns '' if none.
     */
    public static function render_ad(string $format, string $source = ''): string {
        if (! Formats::exists($format)) {
            return '';
        }
        $ad = self::fetch($format);
        if (! $ad) {
            return '';
        }
        $dim   = Formats::dimensions($format);
        $click = (string) $ad['click_url'];
        if ($source !== '') {
            $click = add_query_arg('page', rawurlencode($source), $click);
        }
        return sprintf(
            '<a href="%s" target="_blank" rel="noopener sponsored"><img src="%s" alt="%s" width="%d" height="%d" loading="lazy" style="max-width:100%%;height:auto"></a>',
            esc_url($click),
            esc_url((string) $ad['image_url']),
            esc_attr((string) ($ad['alt_text'] ?? '')),
            (int) $dim['w'],
            (int) $dim['h']
        );
    }

    /**
     * @return array<string,mixed>|null
     */
    private static function fetch(string $format): ?array {
        $key = 'adf_partner_ad_' . $format;
        $cached = get_transient($key);
        if ($cached === 'none') {
            return null;
        }
        if (is_array($cached)) {
            return $cached;
        }

        $hub = trailingslashit((string) Settings::get('ad_hub_url', ''));
        $url = $hub . 'wp-json/adf/v1/ad?format=' . rawurlencode($format) . '&source=' . rawurlencode(home_url('/'));
        $resp = wp_remote_get($url, [
            'timeout' => 5,
            'headers' => ['X-ADF-API-Key' => (string) Settings::get('ad_hub_api_key', '')],
        ]);
        if (is_wp_error($resp) || (int) wp_remote_retrieve_response_code($resp) !== 200) {
            set_transient($key, 'none', self::NEG_TTL);
            return null;
        }
        $data = json_decode((string) wp_remote_retrieve_body($resp), true);
        if (! is_array($data) || empty($data['image_url'])) {
            set_transient($key, 'none', self::NEG_TTL);
            return null;
        }
        set_transient($key, $data, self::CACHE_TTL);
        return $data;
    }

    /**
     * Hub-side: record a partner domain that pulled an ad (for the settings list).
     */
    public static function register_partner(string $source): void {
        $host = wp_parse_url($source, PHP_URL_HOST);
        if (! $host) {
            return;
        }
        $known = (array) Settings::get('ad_known_partners', []);
        if (! in_array($host, $known, true)) {
            $known[] = $host;
            Settings::update(['ad_known_partners' => array_slice($known, -100)]);
            Logger::log('New ad partner registered', ['host' => $host]);
        }
    }
}
