<?php
declare(strict_types=1);

namespace OE\Packages;

use OE\Features;

defined('ABSPATH') || exit;

/**
 * Single-package detail view (BUILD-PLAN Track F).
 *
 * `[oe_package]` renders one package in full — the step the comparison matrix
 * sends a chosen package to. It reads an `id` attribute, else the `?oe_package`
 * query param the matrix CTA sets, so a single "packages" page can hold both the
 * matrix and this detail view. Native-not-embed: semantic, theme-inheriting,
 * `oe-sec oe-sec--package` wrapper, nothing rendered when the package is absent
 * or off sale.
 *
 * The buy action opens the package's buy link (a Stripe Payment Link that
 * handles VAT/tax in Stripe) when one is set — no bespoke charge code — else the
 * configured wizard page. Payment stays content, not code.
 */
final class Single {

    public static function init(): void {
        add_shortcode('oe_package', [self::class, 'render']);
    }

    public static function render($atts = []): string {
        if (! Features::enabled('packages')) {
            return '';
        }
        $atts = shortcode_atts(['id' => 0], (array) $atts, 'oe_package');
        $id   = (int) $atts['id'];
        if ($id <= 0 && isset($_GET['oe_package'])) {
            $id = (int) $_GET['oe_package'];
        }
        if ($id <= 0 || get_post_type($id) !== Package::slug() || ! Package::on_sale($id)) {
            return '';
        }

        $p    = Package::values($id);
        $name = (string) $p['name'];
        if ($name === '') {
            return '';
        }
        $cur = strtoupper((string) \OE\Settings::get('currency', 'usd'));
        $sym = $cur === 'GBP' ? '£' : ($cur === 'EUR' ? '€' : '$');

        $inner  = '<h2 class="oe-package__name" style="margin:0 0 .25rem">' . esc_html($name) . '</h2>';
        $inner .= '<p class="oe-package__price" style="margin:0 0 1rem;font-size:1.6em;font-weight:700">' . esc_html(self::price_line($p, $sym)) . '</p>';
        if (($p['description'] ?? '') !== '') {
            $inner .= '<div class="oe-package__desc" style="margin:0 0 1rem">' . wp_kses_post(wpautop((string) $p['description'])) . '</div>';
        }
        $inc = self::includes_list($p);
        if ($inc !== '') {
            $inner .= '<h3 style="margin:0 0 .5rem">' . esc_html__('What\'s included', 'october-events') . '</h3>' . $inc;
        }

        $remaining = Package::remaining($id);
        if ($remaining > 0 && $remaining <= 10) {
            $inner .= '<p class="oe-package__stock" style="margin:1rem 0 0;color:#b86e00">' . sprintf(
                /* translators: %d: units left */
                esc_html__('Only %d left', 'october-events'),
                $remaining
            ) . '</p>';
        }
        $inner .= self::cta($id, $name);

        return '<section class="oe-sec oe-sec--package">' . $inner . '</section>';
    }

    private static function price_line(array $p, string $sym): string {
        $price = (float) ($p['price'] ?? 0);
        $tier  = (string) ($p['tier_type'] ?? 'standard');
        $fee   = (float) ($p['handling_fee'] ?? 0);
        if ($tier === 'subsidised' && $price <= 0) {
            return $fee > 0
                ? sprintf(__('Free · %s handling', 'october-events'), $sym . number_format($fee, 2))
                : __('Free', 'october-events');
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
        return '<ul class="oe-package__includes" style="margin:0 0 1rem;padding:0 0 0 1.1em">' . $li . '</ul>';
    }

    private static function cta(int $id, string $name): string {
        $buy = (string) Package::get($id, 'buy_url', '');
        if ($buy === '') {
            $page = (string) \OE\Settings::get('packages_wizard_page', '');
            if ($page === '') {
                return '';
            }
            $buy = add_query_arg('oe_package', $id, $page);
        }
        $ext = (strpos($buy, 'http') === 0 && wp_parse_url($buy, PHP_URL_HOST) !== wp_parse_url(home_url(), PHP_URL_HOST));
        return sprintf(
            '<p style="margin:1.25rem 0 0"><a class="oe-btn oe-package__cta" href="%s"%s>%s</a></p>',
            esc_url($buy),
            $ext ? ' target="_blank" rel="noopener"' : '',
            esc_html(sprintf(/* translators: %s: package name */ __('Buy %s', 'october-events'), $name))
        );
    }
}
