<?php
declare(strict_types=1);

namespace OE\Sections;

defined('ABSPATH') || exit;

/**
 * Registers the section shortcodes (BUILD-PLAN M2). Each is also the basis for
 * the Gutenberg block / Elementor widget added in M3 — one renderer behind all
 * three. Only shortcodes not already owned elsewhere are registered here:
 * `[oe_event_volunteers]` (Volunteers), `[oe_event_checkout]` (Checkout) and
 * `[oe_design_map]` (Maps) keep their existing owners.
 */
final class Shortcodes {

    public static function init(): void {
        // Base sections.
        add_shortcode('oe_event_header',  [Renderer::class, 'header']);
        add_shortcode('oe_event_about',   [Renderer::class, 'about']);
        add_shortcode('oe_event_gallery', [Renderer::class, 'gallery']);
        add_shortcode('oe_event_register', [Renderer::class, 'tickets']);
        add_shortcode('oe_event_tickets',  [Renderer::class, 'tickets']);
        add_shortcode('oe_event_map',      [Renderer::class, 'map']);

        // Conference pack sections (storage + renderers built, FRONTEND-BUILD B).
        add_shortcode('oe_event_speakers',      [\OE\Packs\Content\ConferenceRender::class, 'speakers']);
        add_shortcode('oe_event_past_speakers', [\OE\Packs\Content\ConferenceRender::class, 'past_speakers']);
        add_shortcode('oe_event_schedule',      [\OE\Packs\Content\ConferenceRender::class, 'schedule']);
        add_shortcode('oe_event_accommodation', [\OE\Packs\Content\ConferenceRender::class, 'accommodation']);

        // Exhibition pack (FRONTEND-BUILD C).
        add_shortcode('oe_event_exhibitors', [\OE\Packs\Content\ExhibitionRender::class, 'exhibitors']);

        // Tour pack locations (FRONTEND-BUILD D).
        add_shortcode('oe_tour_locations', [\OE\Packs\Content\TourRender::class, 'locations']);

        // Pack sections whose field storage lands with their pack. Registered
        // now so a page can hold them; they render nothing until built.
        $pending = [
            'oe_event_staff'         => 'staff',
        ];
        foreach ($pending as $tag => $pack) {
            add_shortcode($tag, static function ($atts) use ($tag, $pack): string {
                return Renderer::pack_pending(is_array($atts) ? $atts : [], $tag, $pack);
            });
        }
    }
}
