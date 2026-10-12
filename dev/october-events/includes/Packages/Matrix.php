<?php
declare(strict_types=1);

namespace OE\Packages;

use OE\Features;

defined('ABSPATH') || exit;

/**
 * Package comparison matrix (BUILD-PLAN Track F — the front-end surface).
 *
 * `[oe_packages]` renders the published, on-sale packages as cards the partner
 * compares and selects, driven entirely by the admin editor (content, not
 * code). It replaces the placeholder matrix in the front-end mockup. Output is
 * native-not-embed: semantic elements that inherit the theme, a single
 * `oe-sec oe-sec--packages` wrapper the theme / Elementor can target, no plugin
 * chrome, and nothing rendered when there are no packages.
 *
 * The multi-step purchase wizard (Stripe checkout against each package's
 * `stripe_price`) lands with the organizer portal; the "Select" CTA here points
 * at the configured wizard page, or is a plain anchor when none is set.
 *
 * @see docs/october-events/UI-SPEC.md  (§4 the native-not-embed contract)
 */
final class Matrix {

    public static function init(): void {
        add_shortcode('oe_packages', [self::class, 'render']);
    }

    public static function render($atts = []): string {
        if (! Features::enabled('packages')) {
            return '';
        }
        $atts = shortcode_atts([
            'tier'    => '',   // '', standard, subsidised — filter to one tier
            'columns' => '3',  // layout hint; clamps 1–4
        ], (array) $atts, 'oe_packages');

        $ids = Package::all(true);
        if ($atts['tier'] !== '') {
            $want = sanitize_key((string) $atts['tier']);
            $ids  = array_values(array_filter($ids, static fn(int $id) => Package::get($id, 'tier_type', 'standard') === $want));
        }
        if (! $ids) {
            return '';
        }

        $cols = max(1, min(4, (int) $atts['columns']));
        $cur  = strtoupper((string) \OE\Settings::get('currency', 'usd'));
        $sym  = $cur === 'GBP' ? '£' : ($cur === 'EUR' ? '€' : '$');

        $cards = '';
        foreach ($ids as $id) {
            $cards .= self::card((int) $id, $sym);
        }

        return sprintf(
            '<section class="oe-sec oe-sec--packages"><div class="oe-packages" style="display:grid;gap:1.25rem;grid-template-columns:repeat(%d,minmax(0,1fr))">%s</div></section>',
            $cols,
            $cards
        );
    }

    private static function card(int $id, string $sym): string {
        $p = Package::values($id);
        $name = (string) $p['name'];
        if ($name === '') {
            return '';
        }

        $price_line = self::price_line($p, $sym);
        $highlight  = ($p['highlight'] ?? '') === '1';

        $out  = sprintf(
            '<article class="oe-package%s" style="display:flex;flex-direction:column;gap:.75rem;padding:1.25rem;border:1px solid var(--oe-border,#e2e2e2);border-radius:var(--oe-radius,8px)%s">',
            $highlight ? ' is-highlight' : '',
            $highlight ? ';box-shadow:0 0 0 2px var(--oe-accent,#111)' : ''
        );
        if ($highlight) {
            $out .= '<span class="oe-package__flag" style="align-self:flex-start;font-size:.75em;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--oe-accent,#111)">' . esc_html__('Recommended', 'october-events') . '</span>';
        }
        $out .= '<h3 class="oe-package__name" style="margin:0">' . esc_html($name) . '</h3>';
        $out .= '<p class="oe-package__price" style="margin:0;font-size:1.4em;font-weight:700">' . esc_html($price_line) . '</p>';

        if (($p['description'] ?? '') !== '') {
            $out .= '<div class="oe-package__desc">' . wp_kses_post(wpautop((string) $p['description'])) . '</div>';
        }

        $includes = self::includes_list($p);
        if ($includes !== '') {
            $out .= $includes;
        }

        $remaining = Package::remaining($id);
        if ($remaining > 0 && $remaining <= 5) {
            $out .= '<p class="oe-package__stock" style="margin:0;font-size:.85em;color:#b86e00">' . sprintf(
                /* translators: %d: units left */
                esc_html__('Only %d left', 'october-events'),
                $remaining
            ) . '</p>';
        }

        $out .= self::cta($id, $name);
        $out .= '</article>';
        return $out;
    }

    /** The headline price, honouring +VAT and subsidised handling-fee packs. */
    private static function price_line(array $p, string $sym): string {
        $price = (float) ($p['price'] ?? 0);
        $tier  = (string) ($p['tier_type'] ?? 'standard');
        $fee   = (float) ($p['handling_fee'] ?? 0);

        if ($tier === 'subsidised' && $price <= 0) {
            if ($fee > 0) {
                return sprintf(
                    /* translators: %s: formatted handling fee */
                    __('Free · %s handling', 'october-events'),
                    $sym . number_format($fee, 2)
                );
            }
            return __('Free', 'october-events');
        }
        if ($price <= 0) {
            return __('Free', 'october-events');
        }
        $line = $sym . number_format($price, 2);
        if (($p['vat'] ?? '') === '1') {
            $line .= ' ' . __('+VAT', 'october-events');
        }
        return $line;
    }

    /** The "what's included" list: unlock count + gated sections. */
    private static function includes_list(array $p): string {
        $items = [];
        $unlock = (int) ($p['unlock_count'] ?? 0);
        if ($unlock > 0) {
            $items[] = sprintf(
                /* translators: %d: number of activities */
                _n('%d activity included', '%d activities included', $unlock, 'october-events'),
                $unlock
            );
        }
        $labels = [
            'briefing'   => __('Partner briefing', 'october-events'),
            'activities' => __('Activity booking', 'october-events'),
            'assets'     => __('Downloadable assets', 'october-events'),
            'directory'  => __('Directory listing', 'october-events'),
        ];
        foreach ((array) ($p['gated_sections'] ?? []) as $k) {
            if (isset($labels[$k])) {
                $items[] = $labels[$k];
            }
        }
        if (! $items) {
            return '';
        }
        $li = '';
        foreach ($items as $it) {
            $li .= '<li>' . esc_html($it) . '</li>';
        }
        return '<ul class="oe-package__includes" style="margin:0;padding:0 0 0 1.1em">' . $li . '</ul>';
    }

    /**
     * The select CTA. A package's own buy link wins (a Stripe Payment Link that
     * handles VAT/tax in Stripe, opened in a new tab); otherwise the configured
     * wizard page; otherwise the matrix's own page with `?oe_package=<id>` so the
     * single-package view can take over.
     */
    private static function cta(int $id, string $name): string {
        $buy = (string) Package::get($id, 'buy_url', '');
        if ($buy !== '') {
            return sprintf(
                '<a class="oe-btn oe-package__cta" href="%s" target="_blank" rel="noopener" style="margin-top:auto;align-self:flex-start">%s</a>',
                esc_url($buy),
                esc_html(sprintf(/* translators: %s: package name */ __('Choose %s', 'october-events'), $name))
            );
        }
        $page = (string) \OE\Settings::get('packages_wizard_page', '');
        $base = $page !== '' ? $page : (get_permalink() ?: home_url('/'));
        return sprintf(
            '<a class="oe-btn oe-package__cta" href="%s" style="margin-top:auto;align-self:flex-start">%s</a>',
            esc_url(add_query_arg('oe_package', $id, $base)),
            esc_html(sprintf(/* translators: %s: package name */ __('Choose %s', 'october-events'), $name))
        );
    }
}
