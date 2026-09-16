<?php
declare(strict_types=1);

namespace OE\Members;

use OE\Settings;
use OE\Connectors\StripeConnector;

defined('ABSPATH') || exit;

/**
 * Public "Friends" and "Patrons" lists for the website footer, drawn live from
 * the active Stripe subscribers on each tier's configured price (Settings →
 * Membership → Website Friends & Patrons lists). Names show as they appear on
 * the Stripe customer, sorted by last name. Output is plain class-named HTML
 * (oe-friends-* / oe-patrons-*) to style in your theme.
 *
 *   [oe_friends_list]
 *   [oe_patrons_list]
 *   [oe_friends_list separator=" · " heading="Friends" empty="Become a Friend"]
 *
 * Attributes:
 *   separator  text between names (default ", ")
 *   heading    optional heading rendered above the names
 *   empty      text shown when the tier has no active members (default: nothing)
 */
final class Shortcodes {

    public static function init(): void {
        add_shortcode('oe_friends_list', [self::class, 'friends']);
        add_shortcode('oe_patrons_list', [self::class, 'patrons']);
        // Background warm for the footer lists (scheduled from a cold render or a
        // settings save), so the shortcodes never call Stripe in a page render.
        add_action('oe_warm_members', [StripeConnector::class, 'warm_members']);
    }

    /** @param array<string,string>|string $atts */
    public static function friends($atts): string {
        return self::render('friends_price_ids', 'oe-friends', (array) $atts);
    }

    /** @param array<string,string>|string $atts */
    public static function patrons($atts): string {
        return self::render('patrons_price_ids', 'oe-patrons', (array) $atts);
    }

    /** @param array<string,string> $atts */
    private static function render(string $setting, string $base, array $atts): string {
        $a = shortcode_atts([
            'separator' => ', ',
            'heading'   => '',
            'empty'     => '',
        ], $atts, $base);

        $ids = array_values(array_filter(array_map('strval', (array) Settings::get($setting, []))));
        if (! $ids) {
            return ''; // tier not configured — render nothing
        }

        $names = self::sorted_names(StripeConnector::active_members($ids));
        if (! $names) {
            return $a['empty'] !== ''
                ? '<div class="' . esc_attr($base) . ' ' . esc_attr($base) . '--empty">' . esc_html((string) $a['empty']) . '</div>'
                : '';
        }

        $items = [];
        foreach ($names as $n) {
            $items[] = '<span class="' . esc_attr($base) . '__name">' . esc_html($n) . '</span>';
        }

        $out = '<div class="' . esc_attr($base) . '">';
        if ((string) $a['heading'] !== '') {
            $out .= '<h3 class="' . esc_attr($base) . '__heading">' . esc_html((string) $a['heading']) . '</h3>';
        }
        $out .= '<span class="' . esc_attr($base) . '__names">'
            . implode(esc_html((string) $a['separator']), $items)
            . '</span></div>';
        return $out;
    }

    /**
     * Display names sorted by last-name token (case-insensitive), blanks dropped.
     * Ties break on the full name so the order is stable.
     *
     * @param array<int,array{name:string,email:string}> $members
     * @return array<int,string>
     */
    private static function sorted_names(array $members): array {
        $names = [];
        foreach ($members as $m) {
            $n = trim((string) ($m['name'] ?? ''));
            if ($n !== '') {
                $names[] = $n;
            }
        }
        usort($names, static function (string $a, string $b): int {
            return strcasecmp(self::last_name($a), self::last_name($b)) ?: strcasecmp($a, $b);
        });
        return $names;
    }

    /** The last whitespace-separated token of a name (its surname, best effort). */
    private static function last_name(string $name): string {
        $parts = preg_split('/\s+/', trim($name)) ?: [];
        return $parts ? (string) end($parts) : $name;
    }
}
