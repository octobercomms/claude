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
        // Back-compat aliases — the ADF defaults. Kept so existing pages and the
        // footer keep working unchanged.
        add_shortcode('oe_friends_list', [self::class, 'friends']);
        add_shortcode('oe_patrons_list', [self::class, 'patrons']);
        // Generic, client-named tier list: [oe_members_list tier="founders"].
        add_shortcode('oe_members_list', [self::class, 'members_list']);
        // Background warm for the footer lists (scheduled from a cold render or a
        // settings save), so the shortcodes never call Stripe in a page render.
        add_action('oe_warm_members', [StripeConnector::class, 'warm_members']);
    }

    /** @param array<string,string>|string $atts */
    public static function friends($atts): string {
        return self::render_ids(self::tier_ids('friends'), 'oe-friends', (array) $atts);
    }

    /** @param array<string,string>|string $atts */
    public static function patrons($atts): string {
        return self::render_ids(self::tier_ids('patrons'), 'oe-patrons', (array) $atts);
    }

    /**
     * Generic tier list. `tier` names a built-in tier (friends | patrons) or a
     * client-defined one from the Membership tiers setting; a tier with no
     * configured price ids renders nothing.
     *
     * @param array<string,string>|string $atts
     */
    public static function members_list($atts): string {
        $atts = (array) $atts;
        $tier = sanitize_key((string) ($atts['tier'] ?? ''));
        if ($tier === '') {
            return '';
        }
        // A single-token BEM prefix per tier; built-ins keep their long-standing
        // oe-friends / oe-patrons classes, custom tiers get oe-members-<tier>.
        $base = in_array($tier, ['friends', 'patrons'], true) ? 'oe-' . $tier : 'oe-members-' . $tier;
        return self::render_ids(self::tier_ids($tier), $base, $atts);
    }

    /**
     * Resolve a tier key to its configured Stripe price/product ids. Built-in
     * friends/patrons read their own long-standing settings; any other key reads
     * the `member_tiers` map (key => ['label'=>…, 'price_ids'=>[…]]).
     *
     * @return array<int,string>
     */
    private static function tier_ids(string $tier): array {
        if ($tier === 'friends') {
            $ids = (array) Settings::get('friends_price_ids', []);
        } elseif ($tier === 'patrons') {
            $ids = (array) Settings::get('patrons_price_ids', []);
        } else {
            $tiers = (array) Settings::get('member_tiers', []);
            $ids   = (array) ($tiers[$tier]['price_ids'] ?? []);
        }
        return array_values(array_filter(array_map('strval', $ids)));
    }

    /**
     * @param array<int,string>   $ids  resolved Stripe price/product ids
     * @param array<string,string> $atts
     */
    private static function render_ids(array $ids, string $base, array $atts): string {
        $a = shortcode_atts([
            'separator' => ', ',
            'heading'   => '',
            'empty'     => '',
            'tier'      => '',
        ], $atts, 'oe_members_list');

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
