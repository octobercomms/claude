<?php
declare(strict_types=1);

namespace OE;

use OE\Connectors\StripeConnector;

defined('ABSPATH') || exit;

/**
 * Access / entitlement gating primitive (BUILD-PLAN M5).
 *
 * One mechanism that answers "may this visitor see this content?" from their
 * membership, so packages, member-only sections and supporter perks all gate
 * through the same check. **Default open:** nothing is gated unless an admin
 * explicitly wraps it in `[oe_gate]`, so adding this changes no existing page.
 *
 * Entitlement is resolved from the logged-in user's email against the active
 * Stripe membership (any tier, or a named tier's price ids). Package-purchase
 * entitlement will join here once purchases are captured in our DB (the native
 * wizard noted in Track F); until then a package's `unlock_count` is config the
 * gate can read but not yet enforce per-buyer.
 *
 *   [oe_gate]                        → members only (any active tier)
 *   [oe_gate require="patrons"]      → a specific tier
 *   [oe_gate require="member" message="Join to read this."]…[/oe_gate]
 *   [oe_gate require="guest"]…[/oe_gate]  → shown only to non-members
 */
final class Access {

    public static function init(): void {
        add_shortcode('oe_gate', [self::class, 'gate']);
    }

    /** The current visitor's email (the logged-in WP user's), or '' when none. */
    public static function current_email(): string {
        if (! is_user_logged_in()) {
            return '';
        }
        $u = wp_get_current_user();
        $email = $u ? trim(strtolower((string) $u->user_email)) : '';
        return is_email($email) ? $email : '';
    }

    /**
     * Is the current visitor an active member? `$tier` empty = any active
     * membership; a tier key ('friends', 'patrons', or a configured member_tier)
     * = that tier specifically. Resolves off the logged-in user's email; a
     * logged-out visitor is never a member.
     */
    public static function is_member(string $tier = ''): bool {
        $email = self::current_email();
        if ($email === '' || ! StripeConnector::is_ready()) {
            return false;
        }
        $status = StripeConnector::member_status($email);
        if (empty($status['active'])) {
            return false;
        }
        if ($tier === '' || $tier === 'member') {
            return true;
        }
        $ids = self::tier_ids($tier);
        if (! $ids) {
            return false; // tier not configured → no one qualifies for it
        }
        return in_array((string) ($status['price_id'] ?? ''), $ids, true);
    }

    /** Resolve a tier key to its Stripe price/product ids (built-in + custom). */
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
     * `[oe_gate]` — render the wrapped content only to an entitled visitor.
     * `require` defaults to any active membership; `require="guest"` inverts to
     * non-members. A blocked visitor sees the `message` (and a join link when a
     * join URL is set), or nothing.
     */
    public static function gate($atts, string $content = ''): string {
        $a = shortcode_atts([
            'require' => 'member',
            'message' => '',
        ], (array) $atts, 'oe_gate');

        $require = sanitize_key((string) $a['require']);
        $allowed = $require === 'guest' ? ! self::is_member() : self::is_member($require);

        if ($allowed) {
            // Process nested shortcodes in the gated content.
            return do_shortcode((string) $content);
        }
        if ($require === 'guest') {
            return ''; // members simply don't see guest-only content
        }

        $msg = trim((string) $a['message']);
        if ($msg === '') {
            return '';
        }
        $join = (string) Settings::get('membership_join_url', '');
        $out  = '<div class="oe-gate oe-gate--blocked"><p>' . esc_html($msg) . '</p>';
        if ($join !== '') {
            $out .= '<p><a class="oe-btn oe-gate__join" href="' . esc_url($join) . '">' . esc_html__('Join', 'october-events') . '</a></p>';
        }
        return $out . '</div>';
    }
}
