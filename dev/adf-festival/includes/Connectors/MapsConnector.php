<?php
declare(strict_types=1);

namespace ADF\Connectors;

use ADF\Settings;
use ADF\Fields;
use ADF\PostTypes;

defined('ABSPATH') || exit;

/**
 * Google Maps helper for the Destinations map (§7).
 *
 * Public display is handled by Elementor/JetEngine in our hybrid setup, so this
 * connector's job is to (a) expose the embed API key and (b) assemble the pin
 * data feed that the map view / REST endpoint consumes. A self-contained
 * `[adf_design_map]` shortcode is also provided as a fallback for surfaces not
 * built in Elementor.
 */
final class MapsConnector {

    public const CATEGORIES = [
        'showroom', 'hotel', 'bar_restaurant', 'gallery',
        'museum', 'studio', 'cultural_space', 'retail', 'other',
    ];

    public static function embed_key(): string {
        return (string) Settings::get('google_maps_key', '');
    }

    /**
     * Approved, map-visible destinations as pin records.
     *
     * @return array<int,array<string,mixed>>
     */
    public static function pins(array $categories = []): array {
        $query = new \WP_Query([
            'post_type'      => PostTypes::slug('destination'),
            'post_status'    => 'publish',
            'posts_per_page' => 500,
            'meta_query'     => [
                [
                    'key'   => Fields::key('status'),
                    'value' => Fields::STATUS_APPROVED,
                ],
                [
                    'key'   => '_adf_map_visible',
                    'value' => '1',
                ],
            ],
            'no_found_rows'  => true,
        ]);

        $pins = [];
        foreach ($query->posts as $post) {
            $cat = (string) get_post_meta($post->ID, '_adf_category', true);
            if ($categories && ! in_array($cat, $categories, true)) {
                continue;
            }
            $lat = (float) get_post_meta($post->ID, '_adf_lat', true);
            $lng = (float) get_post_meta($post->ID, '_adf_lng', true);
            if ($lat === 0.0 && $lng === 0.0) {
                continue;
            }
            $pins[] = [
                'id'            => $post->ID,
                'name'          => get_the_title($post),
                'category'      => $cat,
                'description'   => get_post_meta($post->ID, '_adf_description', true),
                'image'         => get_the_post_thumbnail_url($post, 'medium') ?: '',
                'website'       => get_post_meta($post->ID, '_adf_website', true),
                'opening_hours' => get_post_meta($post->ID, '_adf_opening_hours', true),
                'festival_offer'=> get_post_meta($post->ID, '_adf_festival_offer', true),
                'lat'           => $lat,
                'lng'           => $lng,
                // Featured/paid destinations get a distinct pin colour (§7).
                'featured'      => Fields::tier($post->ID) !== Fields::TIER_FREE,
            ];
        }
        return $pins;
    }

    /**
     * Register the fallback shortcode.
     */
    public static function init(): void {
        add_shortcode('adf_design_map', [self::class, 'render_shortcode']);
    }

    public static function render_shortcode(array $atts = []): string {
        wp_enqueue_script('adf-map');
        wp_enqueue_style('adf-dashboard');
        wp_localize_script('adf-map', 'ADF_MAP', [
            'restUrl'  => esc_url_raw(rest_url('adf/v1/map')),
            'embedKey' => self::embed_key(),
            'categories' => self::CATEGORIES,
        ]);
        return '<div id="adf-design-map" class="adf-design-map" data-loading="1"></div>';
    }
}
