<?php
declare(strict_types=1);

namespace OE;

defined('ABSPATH') || exit;

/**
 * Backward-compatibility shims for the ADF Festival → October Events rename.
 *
 * Existing live pages use the old `[adf_*]` shortcodes, and Stripe was configured
 * to POST to the old `adf/v1/stripe-webhook` URL. These aliases keep both working
 * so nothing breaks during the transition; they can be retired once pages and the
 * Stripe webhook URL have been updated to the new `oe_*` / `oe/v1` names.
 */
final class Compat {

    private const SHORTCODE_ALIASES = [
        'adf_account_dashboard' => 'oe_account_dashboard',
        'adf_volunteer_signup'  => 'oe_volunteer_signup',
        'adf_event_checkout'    => 'oe_event_checkout',
        'adf_checkin'           => 'oe_checkin',
        'adf_design_map'        => 'oe_design_map',
        // The previous "Event Tickets" (oct_) plugin's live checkout shortcode.
        // Published pages use [oct_checkout event_id="…"]; keep them rendering
        // now that that plugin is retired.
        'oct_checkout'          => 'oe_event_checkout',
    ];

    public static function init(): void {
        add_action('init', [self::class, 'register_shortcode_aliases'], 40);
        add_action('rest_api_init', [self::class, 'register_rest_aliases']);
    }

    public static function register_shortcode_aliases(): void {
        foreach (self::SHORTCODE_ALIASES as $old => $new) {
            if (shortcode_exists($old)) {
                continue;
            }
            add_shortcode($old, static function ($atts, $content = null) use ($new) {
                $attr = '';
                foreach ((array) $atts as $k => $v) {
                    $attr .= is_int($k) ? ' ' . $v : sprintf(' %s="%s"', $k, esc_attr((string) $v));
                }
                return do_shortcode("[{$new}{$attr}]" . ($content !== null ? $content . "[/{$new}]" : ''));
            });
        }
    }

    /**
     * Re-expose the Stripe webhook under the old `adf/v1` namespace so a
     * pre-rename webhook configuration keeps delivering events.
     */
    public static function register_rest_aliases(): void {
        register_rest_route('adf/v1', '/stripe-webhook', [
            'methods'             => 'POST',
            'callback'            => [RestApi::get_instance(), 'stripe_webhook'],
            'permission_callback' => '__return_true',
        ]);
    }
}
