<?php
declare(strict_types=1);

namespace ADF\Ads;

defined('ABSPATH') || exit;

/**
 * Ad serving: the `[adf_ad]` slot, the REST render endpoint feeding it, and the
 * click-tracking redirect. Slots render empty and are filled via REST so they
 * survive full-page caching (matching the proven approach).
 */
final class Serving {

    private static ?Serving $instance = null;

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        add_shortcode('adf_ad', [$this, 'render_slot']);
        add_action('wp_enqueue_scripts', [$this, 'register_assets']);
        add_action('template_redirect', [$this, 'maybe_click']);
    }

    public function register_assets(): void {
        wp_register_script('adf-ads', ADF_URL . 'assets/js/ads.js', [], ADF_VERSION, true);
    }

    /**
     * `[adf_ad format="mpu"]` — empty slot hydrated by ads.js via REST.
     */
    public function render_slot(array $atts = []): string {
        $atts = shortcode_atts(['format' => 'mpu', 'class' => ''], $atts, 'adf_ad');
        $format = sanitize_key((string) $atts['format']);
        if (! Formats::exists($format)) {
            return current_user_can('manage_options') ? '<!-- adf_ad: unknown format -->' : '';
        }
        wp_enqueue_script('adf-ads');
        $dim = Formats::dimensions($format);
        $url = esc_url(rest_url('adf/v1/ad-render'));
        return sprintf(
            '<div class="adf-ad-slot %s" data-render="%s" data-format="%s" style="max-width:%dpx;min-height:%dpx"></div>',
            esc_attr((string) $atts['class']),
            esc_attr($url),
            esc_attr($format),
            (int) $dim['w'],
            (int) $dim['h']
        );
    }

    /**
     * Build the served ad HTML for a format, logging an impression. Returns ''
     * when nothing eligible.
     */
    public static function render_html(string $format, string $source = ''): string {
        $ad = Campaigns::active_for_format($format);
        if (! $ad) {
            return '';
        }
        Tracking::log((int) $ad->id, (int) $ad->creative_id, 'impression', $source);

        $dim = Formats::dimensions($format);
        $click = add_query_arg(['adf_ad_click' => (int) $ad->creative_id, 'c' => (int) $ad->id], home_url('/'));
        return sprintf(
            '<a href="%s" target="_blank" rel="noopener sponsored"><img src="%s" alt="%s" width="%d" height="%d" loading="lazy" style="max-width:100%%;height:auto"></a>',
            esc_url($click),
            esc_url((string) $ad->image_url),
            esc_attr((string) $ad->alt_text),
            (int) $dim['w'],
            (int) $dim['h']
        );
    }

    /**
     * Click redirect: log the click then send the visitor to the campaign URL.
     */
    public function maybe_click(): void {
        if (! isset($_GET['adf_ad_click'])) {
            return;
        }
        $ad_id       = absint($_GET['adf_ad_click']);
        $campaign_id = absint($_GET['c'] ?? 0);
        $source      = isset($_GET['page']) ? esc_url_raw(wp_unslash($_GET['page'])) : '';

        $campaign = $campaign_id ? Campaigns::get($campaign_id) : null;
        if ($campaign) {
            Tracking::log($campaign_id, $ad_id, 'click', $source);
            wp_redirect($campaign->url);
            exit;
        }
        wp_safe_redirect(home_url('/'));
        exit;
    }
}
