<?php
declare(strict_types=1);

namespace OE\Connectors;

use OE\Settings;
use OE\Fields;
use OE\PostTypes;

defined('ABSPATH') || exit;

/**
 * Google Maps helper for the Destinations map (§7).
 *
 * Public display is handled by Elementor/JetEngine in our hybrid setup, so this
 * connector's job is to (a) expose the embed API key and (b) assemble the pin
 * data feed that the map view / REST endpoint consumes. A self-contained
 * `[oe_design_map]` shortcode is also provided as a fallback for surfaces not
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
                    'key'   => '_oe_map_visible',
                    'value' => '1',
                ],
            ],
            'no_found_rows'  => true,
        ]);

        $pins = [];
        foreach ($query->posts as $post) {
            $cat = (string) get_post_meta($post->ID, '_oe_category', true);
            if ($categories && ! in_array($cat, $categories, true)) {
                continue;
            }
            $lat = (float) get_post_meta($post->ID, '_oe_lat', true);
            $lng = (float) get_post_meta($post->ID, '_oe_lng', true);
            if ($lat === 0.0 && $lng === 0.0) {
                continue;
            }
            $pins[] = [
                'id'            => $post->ID,
                'name'          => get_the_title($post),
                'category'      => $cat,
                'description'   => get_post_meta($post->ID, '_oe_description', true),
                'image'         => get_the_post_thumbnail_url($post, 'medium') ?: '',
                'website'       => get_post_meta($post->ID, '_oe_website', true),
                'opening_hours' => get_post_meta($post->ID, '_oe_opening_hours', true),
                'festival_offer'=> get_post_meta($post->ID, '_oe_festival_offer', true),
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
        add_shortcode('oe_design_map', [self::class, 'render_shortcode']);
    }

    public static function render_shortcode(array $atts = []): string {
        wp_enqueue_script('oe-map');
        wp_enqueue_style('oe-dashboard');
        wp_localize_script('oe-map', 'OE_MAP', [
            'restUrl'  => esc_url_raw(rest_url('oe/v1/map')),
            'embedKey' => self::embed_key(),
            'categories' => self::CATEGORIES,
        ]);
        return '<div id="oe-design-map" class="oe-design-map" data-loading="1"></div>';
    }
}
