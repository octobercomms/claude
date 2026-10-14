<?php
declare(strict_types=1);

namespace OE\Sections;

use OE\Features;
use OE\PostTypes;
use OE\Packs\Registry;
use OE\Planning\Events;

defined('ABSPATH') || exit;

/**
 * Section renderers (BUILD-PLAN M2 — the "native, not an embed" output layer).
 *
 * Each public listing section is a renderer that binds to the current listing
 * by default (or an `id` attribute), and **renders nothing when empty** — the
 * method short-circuits before any markup when the pack is off or the data is
 * absent, so a page composes itself from whatever content exists and an unused
 * section costs a cheap meta check, not a query.
 *
 * Markup is deliberately presentation-light: semantic elements that inherit the
 * theme's type and color, a single `oe-sec oe-sec--{id}` class per section for
 * the theme / Elementor to target, and no plugin chrome. The design-token layer
 * and the Stripe appearance wiring land in a follow-on M2 slice.
 *
 * @see docs/october-events/UI-SPEC.md  (§4 the native-not-embed contract)
 */
final class Renderer {

    /** Resolve and validate the event id from a shortcode's atts / the loop. */
    public static function event_id(array $atts, string $tag): int {
        $atts = shortcode_atts(['id' => get_the_ID()], $atts, $tag);
        $id   = (int) $atts['id'];
        if (! $id || get_post_type($id) !== PostTypes::slug('event')) {
            return 0;
        }
        return $id;
    }

    /** A section wrapper: semantic, theme-inheriting, no plugin chrome. */
    private static function wrap(string $section, string $inner, string $style = ''): string {
        if (trim($inner) === '') {
            return '';
        }
        // Something is rendering — make sure the designed section sheet is present
        // (covers a section dropped on any page, not just a native single view).
        Theme::enqueue();
        return sprintf(
            '<section class="oe-sec oe-sec--%s"%s>%s</section>',
            esc_attr($section),
            $style !== '' ? ' style="' . esc_attr($style) . '"' : '',
            $inner
        );
    }

    private static function field(int $id, string $f): string {
        return trim((string) Events::get($id, $f, ''));
    }

    /** A preset status badge (brand color + readable text), or '' when routine. */
    private static function status_badge(int $id): string {
        $preset = self::field($id, 'status_preset');
        if ($preset === '' || ! isset(Events::STATUS_PRESETS[$preset])) {
            return '';
        }
        [$label, $bg, $fg] = Events::STATUS_PRESETS[$preset];
        $custom = self::field($id, 'status_text');
        if ($custom !== '') {
            $label = $custom;
        }
        return sprintf(
            '<span class="oe-event__badge" style="display:inline-block;padding:.15em .6em;border-radius:var(--oe-radius,6px);font-weight:700;font-size:.8em;background:%s;color:%s">%s</span>',
            esc_attr($bg),
            esc_attr($fg),
            esc_html($label)
        );
    }

    /* ---------------------------------------------------------------- *
     * Base sections (always available)
     * ---------------------------------------------------------------- */

    public static function header(array $atts = []): string {
        $id = self::event_id($atts, 'oe_event_header');
        if (! $id) {
            return '';
        }
        $name = self::field($id, 'name') ?: get_the_title($id);
        if ($name === '') {
            return '';
        }
        $meta = array_filter([
            self::field($id, 'start_datetime'),
            self::field($id, 'location'),
            self::field($id, 'price'),
        ]);
        $num   = self::field($id, 'event_number');
        $brand = self::field($id, 'brand_colour');

        $inner  = '';
        if ($num !== '') {
            $inner .= '<p class="oe-event__number">' . esc_html($num) . '</p>';
        }
        $inner .= '<h1 class="oe-event__title">' . esc_html($name) . '</h1>';
        $badge = self::status_badge($id);
        if ($badge !== '') {
            $inner .= $badge;
        }
        if ($meta) {
            $inner .= '<p class="oe-event__meta">' . esc_html(implode(' · ', $meta)) . '</p>';
        }
        $avail = self::field($id, 'availability');
        if ($avail !== '' && isset(Events::AVAILABILITY[$avail])) {
            $inner .= '<p class="oe-event__avail">' . esc_html(Events::AVAILABILITY[$avail]) . '</p>';
        }
        // Expose the per-listing brand color as a CSS custom property so the
        // theme / Elementor template can paint from it (CC's per-event chrome).
        $style = $brand !== '' ? '--oe-brand:' . $brand : '';
        return self::wrap('header', $inner, $style);
    }

    public static function about(array $atts = []): string {
        $id = self::event_id($atts, 'oe_event_about');
        if (! $id) {
            return '';
        }
        $desc = self::field($id, 'description');
        if ($desc === '') {
            return '';
        }
        // Description is rich text (safe HTML). Paragraph-wrap only when it has
        // no block markup of its own, so a WYSIWYG value renders as authored and
        // a plain string still gets paragraphs.
        $safe = wp_kses_post($desc);
        $html = (strip_tags($safe) === $safe) ? wpautop($safe) : $safe;
        $inner = '<h2>' . esc_html__('About', 'october-events') . '</h2>'
            . '<div class="oe-event__about">' . $html . '</div>';
        return self::wrap('about', $inner);
    }

    public static function gallery(array $atts = []): string {
        $id = self::event_id($atts, 'oe_event_gallery');
        if (! $id) {
            return '';
        }
        $img = get_the_post_thumbnail($id, 'large', ['class' => 'oe-event__image', 'loading' => 'lazy']);
        if (! $img) {
            return '';
        }
        return self::wrap('gallery', $img);
    }

    /**
     * The ticket CTA (base `[oe_event_register]` and pack `[oe_event_tickets]`).
     * External-link mode when a `ticket_link` is set (links out, e.g.
     * EventBrite); otherwise the native checkout when the Tickets pack is on and
     * the feature is enabled; otherwise nothing.
     */
    public static function tickets(array $atts = []): string {
        $id = self::event_id($atts, 'oe_event_tickets');
        if (! $id) {
            return '';
        }
        $link = self::field($id, 'ticket_link');
        if ($link !== '') {
            $label = self::field($id, 'ticket_link_text') ?: __('Book tickets', 'october-events');
            $inner = sprintf(
                '<a class="oe-btn oe-event__cta" href="%s" target="_blank" rel="noopener">%s</a>',
                esc_url($link),
                esc_html($label)
            );
            return self::wrap('tickets', $inner);
        }
        if (Features::enabled('tickets') && Registry::enabled($id, 'tickets')) {
            $native = \OE\Frontend\Checkout::get_instance()->render(['event_id' => $id]);
            return self::wrap('tickets', $native);
        }
        return '';
    }

    public static function map(array $atts = []): string {
        $id = self::event_id($atts, 'oe_event_map');
        if (! $id) {
            return '';
        }
        $out = trim(do_shortcode('[oe_design_map id="' . $id . '"]'));
        return self::wrap('map', $out);
    }

    /* ---------------------------------------------------------------- *
     * Pack sections whose field storage lands with their pack. Each is
     * gated on its pack being on; with no data yet they short-circuit, so
     * dropping the shortcode now is safe and it lights up once the pack's
     * fields are built.
     * ---------------------------------------------------------------- */

    public static function pack_pending(array $atts, string $tag, string $pack): string {
        $id = self::event_id($atts, $tag);
        if (! $id || ! Registry::enabled($id, $pack)) {
            return '';
        }
        // Field storage for this pack is not built yet; nothing to render.
        return '';
    }
}
