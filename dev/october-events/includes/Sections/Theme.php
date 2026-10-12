<?php
declare(strict_types=1);

namespace OE\Sections;

use OE\Settings;

defined('ABSPATH') || exit;

/**
 * Section theming tokens (BUILD-PLAN M2 — the "native, not an embed" styling).
 *
 * A small set of design tokens drives the functional parts of the sections
 * (the ticket button, spacing, controls) as CSS custom properties, so a dropped
 * section reads as part of the client's site. Defaults are neutral and every
 * token is a per-site setting; the accent falls back to the existing
 * `theme_accent` / `theme_accent_on` brand settings when the section-specific
 * one is blank, so one brand value covers both.
 *
 * These same token values are what M3 forwards to the Stripe Elements appearance
 * API (the card iframe can't be reached by site CSS, but the tokens can), so the
 * whole checkout matches. This slice emits the CSS; the Stripe wiring follows.
 *
 * @see docs/october-events/UI-SPEC.md  (§4)
 */
final class Theme {

    /** Token key => default. Neutral and overridable; accent falls back to brand. */
    public const DEFAULTS = [
        'section_accent'         => '',        // '' => theme_accent, then #1a1a1a
        'section_accent_on'      => '',        // '' => theme_accent_on, then #ffffff
        'section_radius'         => '6px',
        'section_border_width'   => '1px',
        'section_button_style'   => 'filled',  // filled | outline | ghost
        'section_spacing'        => '1.5rem',
        'section_control_height' => '44px',
        'section_font'           => '',        // '' => inherit the theme
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
            $t['section_accent'] = (string) Settings::get('theme_accent', '') ?: '#1a1a1a';
        }
        if ($t['section_accent_on'] === '') {
            $t['section_accent_on'] = (string) Settings::get('theme_accent_on', '') ?: '#ffffff';
        }
        if (! in_array($t['section_button_style'], self::BUTTON_STYLES, true)) {
            $t['section_button_style'] = 'filled';
        }
        return $t;
    }

    /** The stylesheet: token custom properties + the structural rules that read them. */
    public static function css(): string {
        $t      = self::tokens();
        $accent = $t['section_accent'];
        $on     = $t['section_accent_on'];
        $style  = $t['section_button_style'];

        // Button look derives from the accent + chosen style.
        if ($style === 'outline') {
            $btn = "background:transparent;color:var(--oe-accent);border:var(--oe-border-w) solid var(--oe-accent);";
            $btn_hover = "background:var(--oe-accent);color:var(--oe-accent-on);";
        } elseif ($style === 'ghost') {
            $btn = "background:transparent;color:var(--oe-accent);border:var(--oe-border-w) solid transparent;";
            $btn_hover = "border-color:var(--oe-accent);";
        } else { // filled
            $btn = "background:var(--oe-accent);color:var(--oe-accent-on);border:var(--oe-border-w) solid var(--oe-accent);";
            $btn_hover = "filter:brightness(.92);";
        }

        $font = $t['section_font'] !== '' ? 'font-family:' . self::safe_font($t['section_font']) . ';' : '';

        $vars = ':root{'
            . '--oe-accent:' . self::safe($accent) . ';'
            . '--oe-accent-on:' . self::safe($on) . ';'
            . '--oe-radius:' . self::safe($t['section_radius']) . ';'
            . '--oe-border-w:' . self::safe($t['section_border_width']) . ';'
            . '--oe-space:' . self::safe($t['section_spacing']) . ';'
            . '--oe-control-h:' . self::safe($t['section_control_height']) . ';'
            . '}';

        // Presentation-light: inherit the theme, only style what the theme won't
        // reach (the button, section rhythm, the colour-painted header).
        $rules = '.oe-sec{margin-block:var(--oe-space);' . $font . '}'
            . '.oe-sec--header .oe-event__number{font-weight:700;opacity:.6;margin:0 0 .25em}'
            . '.oe-sec--header .oe-event__title{margin:0}'
            . '.oe-sec--header .oe-event__meta{opacity:.75;margin:.4em 0 0}'
            . '.oe-sec .oe-event__image{display:block;max-width:100%;height:auto;border-radius:var(--oe-radius)}'
            . '.oe-sec .oe-btn{display:inline-block;padding:0 1.25em;height:var(--oe-control-h);line-height:var(--oe-control-h);border-radius:var(--oe-radius);font-weight:600;text-decoration:none;cursor:pointer;transition:filter .15s,background .15s,color .15s,border-color .15s;' . $btn . '}'
            . '.oe-sec .oe-btn:hover{' . $btn_hover . '}';

        return $vars . $rules;
    }

    /** Emit the section CSS in the document head (front end only, cheap). */
    public static function init(): void {
        add_action('wp_head', [self::class, 'print_css'], 20);
    }

    public static function print_css(): void {
        echo "\n<style id=\"oe-sections\">" . self::css() . "</style>\n";
    }

    /** Allow only a safe CSS token value (colours, lengths, keywords). */
    private static function safe(string $v): string {
        return preg_replace('/[^a-zA-Z0-9#%.,()\\- ]/', '', $v) ?? '';
    }

    /** A font-family value: letters, digits, spaces, commas, quotes, hyphens. */
    private static function safe_font(string $v): string {
        return preg_replace('/[^a-zA-Z0-9 ,"\'\\-]/', '', $v) ?? '';
    }
}
