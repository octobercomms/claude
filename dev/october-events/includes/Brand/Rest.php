<?php
declare(strict_types=1);

namespace OE\Brand;

use OE\Settings;

defined('ABSPATH') || exit;

/**
 * Public branding endpoint (oe/v1/brand) — lets the planning platform theme
 * itself per-site: brand name, accent colours, sidebar/page colours, logos and
 * an optional custom font. Only non-empty overrides are returned, so the
 * platform keeps its built-in October defaults for anything left blank.
 *
 * Public (no auth) on purpose: the platform's sign-in screen is themed before
 * the user authenticates, and none of this is sensitive.
 */
final class Rest {

    private const NS = 'oe/v1';

    /** option key => response key */
    private const FIELDS = [
        'theme_accent'      => 'accent',
        'theme_accent_on'   => 'accent_on',
        'theme_sidebar_bg'  => 'sidebar_bg',
        'theme_page_bg'     => 'page_bg',
        'theme_logo_light'  => 'logo_light',
        'theme_logo_dark'   => 'logo_dark',
        'theme_font_family' => 'font_family',
        'theme_font_css'    => 'font_css',
        'theme_font_url'    => 'font_url',
    ];

    public static function init(): void {
        add_action('rest_api_init', [self::class, 'register_routes']);
    }

    public static function register_routes(): void {
        register_rest_route(self::NS, '/brand', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'get_brand'],
            'permission_callback' => '__return_true',
        ]);
    }

    public static function get_brand(): \WP_REST_Response {
        $out = ['brand_name' => (string) Settings::get('brand_name', 'October Events')];
        foreach (self::FIELDS as $opt => $key) {
            $val = trim((string) Settings::get($opt, ''));
            if ($val !== '') {
                $out[$key] = $val;
            }
        }
        $res = new \WP_REST_Response($out, 200);
        $res->header('Cache-Control', 'public, max-age=300');
        return $res;
    }
}
