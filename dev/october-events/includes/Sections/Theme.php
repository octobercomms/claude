<?php
declare(strict_types=1);

namespace OE\Sections;

use OE\Settings;
use OE\Planning\Events;

defined('ABSPATH') || exit;

/**
 * Section theming tokens (BUILD-PLAN M2 / FRONTEND-BUILD slice A).
 *
 * The designed look lives in assets/css/sections.css (static, cacheable). This
 * class resolves the per-site design tokens and emits them as CSS custom
 * properties inline, so a tenant restyles every section from one accent. The
 * accent falls back to the existing `theme_accent` / `theme_accent_on` brand
 * settings when the section-specific one is blank, so one brand value covers all.
 *
 * These same token values are what M3 forwards to the Stripe Elements appearance
 * API (the card iframe can't be reached by site CSS, but the tokens can), so the
 * whole checkout matches.
 *
 * @see docs/october-events/UI-SPEC.md  (§4)
 * @see docs/october-events/FRONTEND-BUILD.md
 */
final class Theme {

    public const HANDLE = 'oe-sections';

    /** Token key => default. Defaults match the mockup; every token is a setting. */
    public const DEFAULTS = [
        'section_accent'         => '',        // '' => theme_accent, then #dd4b14
        'section_accent_on'      => '',        // '' => theme_accent_on, then #ffffff
        'section_accent_soft'    => 'rgba(221,75,20,.1)',
        'section_accent_ink'     => '#c2410c',
        'section_surface'        => '#ffffff',
        'section_surface_2'      => '#f3f3f3',
        'section_ink'            => '#1a1a1a',
        'section_muted'          => '#555555',
        'section_subtle'         => '#888888',
        'section_line'           => '#e3e2db',
        'section_radius'         => '14px',
        'section_radius_sm'      => '8px',
        'section_border_width'   => '2px',
        'section_button_style'   => 'filled',  // filled | outline | ghost
        'section_spacing'        => '1.5rem',
        'section_control_height' => '44px',
        'section_font'           => '',        // '' => inherit the theme
        'section_shadow'         => '0 1px 2px rgba(20,20,20,.06),0 5px 14px rgba(20,20,20,.09)',
        'section_shadow_md'      => '0 4px 10px rgba(20,20,20,.09),0 20px 46px rgba(20,20,20,.14)',
    ];

    public const BUTTON_STYLES = ['filled', 'outline', 'ghost'];

    /** @return array<string,string> resolved token values. */
    public static function tokens(): array {
        $t = [];
        foreach (self::DEFAULTS as $k => $def) {
            $v = (string) Settings::get($k, '');
            $t[$k] = $v !== '' ? $v : $def;
        }
        if ($t['section_accent'] === '') {
            $t['section_accent'] = (string) Settings::get('theme_accent', '') ?: '#dd4b14';
        }
        if ($t['section_accent_on'] === '') {
            $t['section_accent_on'] = (string) Settings::get('theme_accent_on', '') ?: '#ffffff';
        }
        if (! in_array($t['section_button_style'], self::BUTTON_STYLES, true)) {
            $t['section_button_style'] = 'filled';
        }
        return $t;
    }

    /** The inline token block: custom properties the static sheet reads. */
    public static function css(): string {
        $t     = self::tokens();
        $style = $t['section_button_style'];

        // Button look from the accent + chosen style, exposed as vars the sheet uses.
        if ($style === 'outline') {
            [$bg, $color, $border] = ['transparent', 'var(--oe-accent)', 'var(--oe-accent)'];
        } elseif ($style === 'ghost') {
            [$bg, $color, $border] = ['transparent', 'var(--oe-accent)', 'transparent'];
        } else { // filled
            [$bg, $color, $border] = ['var(--oe-accent)', 'var(--oe-accent-on)', 'var(--oe-accent)'];
        }

        $font = $t['section_font'] !== '' ? self::safe_font($t['section_font']) : '';

        $vars = ':root{'
            . '--oe-accent:' . self::safe($t['section_accent']) . ';'
            . '--oe-accent-on:' . self::safe($t['section_accent_on']) . ';'
            . '--oe-accent-soft:' . self::safe($t['section_accent_soft']) . ';'
            . '--oe-accent-ink:' . self::safe($t['section_accent_ink']) . ';'
            . '--oe-surface:' . self::safe($t['section_surface']) . ';'
            . '--oe-surface-2:' . self::safe($t['section_surface_2']) . ';'
            . '--oe-ink:' . self::safe($t['section_ink']) . ';'
            . '--oe-muted:' . self::safe($t['section_muted']) . ';'
            . '--oe-subtle:' . self::safe($t['section_subtle']) . ';'
            . '--oe-line:' . self::safe($t['section_line']) . ';'
            . '--oe-radius:' . self::safe($t['section_radius']) . ';'
            . '--oe-radius-sm:' . self::safe($t['section_radius_sm']) . ';'
            . '--oe-border-w:' . self::safe($t['section_border_width']) . ';'
            . '--oe-space:' . self::safe($t['section_spacing']) . ';'
            . '--oe-control-h:' . self::safe($t['section_control_height']) . ';'
            . '--oe-shadow:' . self::safe($t['section_shadow']) . ';'
            . '--oe-shadow-md:' . self::safe($t['section_shadow_md']) . ';'
            . '--oe-btn-bg:' . $bg . ';'
            . '--oe-btn-color:' . $color . ';'
            . '--oe-btn-border:' . $border . ';'
            . ($font !== '' ? '--oe-font:' . $font . ';' : '')
            . '}'
            . ($font !== '' ? '.oe-sec{font-family:var(--oe-font)}' : '');

        return $vars;
    }

    public static function init(): void {
        add_action('wp_enqueue_scripts', [self::class, 'register'], 1);
        add_action('wp_enqueue_scripts', [self::class, 'maybe_enqueue']);
    }

    /** Register early so a late (shortcode-time) enqueue can still attach. */
    public static function register(): void {
        if (wp_style_is(self::HANDLE, 'registered')) {
            return;
        }
        wp_register_style(self::HANDLE, OE_URL . 'assets/css/sections.css', [], OE_VERSION);
        wp_add_inline_style(self::HANDLE, self::css());
    }

    /** Enqueue in head for the common cases (avoids a flash); render-time is the fallback. */
    public static function maybe_enqueue(): void {
        if (self::needed()) {
            self::enqueue();
        }
    }

    /** Enqueue the section sheet now. Safe to call repeatedly / at render time. */
    public static function enqueue(): void {
        self::register();
        wp_enqueue_style(self::HANDLE);
    }

    private static function needed(): bool {
        $slug = Events::slug();
        if ($slug !== '' && is_singular($slug)) {
            return true;
        }
        $post = get_post();
        if ($post instanceof \WP_Post) {
            $content = (string) $post->post_content;
            foreach ([
                'oe_event_header', 'oe_event_about', 'oe_event_gallery', 'oe_event_register',
                'oe_event_tickets', 'oe_event_map', 'oe_event_speakers', 'oe_event_past_speakers',
                'oe_event_schedule', 'oe_event_accommodation', 'oe_event_exhibitors',
                'oe_tour_locations', 'oe_event_staff', 'oe_listings',
            ] as $sc) {
                if (has_shortcode($content, $sc)) {
                    return true;
                }
            }
        }
        return false;
    }

    /** Allow only a safe CSS token value (colours, lengths, keywords, shadows). */
    private static function safe(string $v): string {
        return preg_replace('/[^a-zA-Z0-9#%.,()\\- ]/', '', $v) ?? '';
    }

    /** A font-family value: letters, digits, spaces, commas, quotes, hyphens. */
    private static function safe_font(string $v): string {
        return preg_replace('/[^a-zA-Z0-9 ,"\'\\-]/', '', $v) ?? '';
    }
}
