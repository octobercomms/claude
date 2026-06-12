<?php
declare(strict_types=1);

namespace OE;

defined('ABSPATH') || exit;

/**
 * Cross-origin (CORS) support for the oe/v1 REST API so the planning platform
 * SPA (hosted off-site, e.g. october-platform.pages.dev) can call it.
 *
 * WordPress core already echoes the request Origin for REST responses, which is
 * usually enough. But many hosts / security plugins ALSO add a blanket
 * `Access-Control-Allow-Origin: *` to every response — and a browser rejects a
 * response that carries the header twice ("contains multiple values … but only
 * one is allowed"). This handler takes ownership of the CORS headers for our
 * namespace: it strips whatever was set (core's echo + the stray `*`) and emits
 * exactly one valid value for an allowed origin, plus a clean preflight.
 *
 * Note: this can only override headers added by PHP (core + other plugins). If
 * the duplicate `*` is added by the web server itself (Apache `Header always
 * set`, nginx `add_header`) it must be removed there — PHP can't unset it.
 */
final class Cors {

    public static function init(): void {
        // Run after core's rest_send_cors_headers (priority 10) so our header
        // wins and we can clear duplicates.
        add_filter('rest_pre_serve_request', [self::class, 'send_headers'], 20, 4);

        // Let core treat our platform origins as allowed (used in a few places).
        add_filter('allowed_http_origins', [self::class, 'allow_origins']);
    }

    /** @return array<int,string> normalised list of allowed origins. */
    public static function allowed(): array {
        $raw = Settings::get('platform_origins', []);
        if (is_string($raw)) {
            $raw = preg_split('/[\r\n,]+/', $raw) ?: [];
        }
        $out = [];
        foreach ((array) $raw as $o) {
            $o = untrailingslashit(trim((string) $o));
            if ($o !== '') {
                $out[] = $o;
            }
        }
        return array_values(array_unique($out));
    }

    /**
     * @param array<int,string> $origins
     * @return array<int,string>
     */
    public static function allow_origins(array $origins): array {
        return array_values(array_unique(array_merge($origins, self::allowed())));
    }

    /**
     * Emit a single, correct set of CORS headers for our namespace.
     *
     * @param bool             $served
     * @param mixed            $result
     * @param \WP_REST_Request $request
     * @param \WP_REST_Server  $server
     * @return bool
     */
    public static function send_headers($served, $result, $request, $server) {
        if (! $request instanceof \WP_REST_Request) {
            return $served;
        }
        // Only manage CORS for our own routes.
        if (strpos((string) $request->get_route(), '/oe/v1') !== 0) {
            return $served;
        }

        $origin = get_http_origin();
        if (! $origin || ! in_array(untrailingslashit($origin), self::allowed(), true)) {
            return $served;
        }

        // Replace any prior Access-Control-Allow-Origin (core's echo, plus a
        // stray `*` from the host/another plugin) with exactly one value.
        if (! headers_sent()) {
            header_remove('Access-Control-Allow-Origin');
            header_remove('Access-Control-Allow-Credentials');
            header('Access-Control-Allow-Origin: ' . esc_url_raw($origin));
            header('Access-Control-Allow-Methods: OPTIONS, GET, POST, DELETE');
            header('Access-Control-Allow-Headers: Authorization, Content-Type, X-WP-Nonce');
            header('Access-Control-Allow-Credentials: true');
            header('Vary: Origin', false);
        }

        return $served;
    }
}
