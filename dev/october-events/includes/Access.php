<?php
declare(strict_types=1);

namespace OE;

defined('ABSPATH') || exit;

/**
 * Shared access control for the staff/management REST surface.
 *
 * These endpoints expose org-wide PII and bulk actions (the contact CRM, mass
 * email, volunteer signups, tasks, reports, the all-data AI assistant), so they
 * require an administrative capability — not the post-author `edit_posts`, which
 * Contributors/Authors hold. The capability is filterable so a site can grant a
 * dedicated staff role access without making everyone an admin:
 *
 *     add_filter('oe_manage_cap', fn() => 'oe_manage');
 */
final class Access {

    /** True if the current user may use the staff management APIs. */
    public static function can_manage(): bool {
        return current_user_can((string) apply_filters('oe_manage_cap', 'manage_options'));
    }

    /**
     * Simple per-user (or per-IP for guests) rate limit, transient-backed.
     * Returns false when the caller is over the limit for this window.
     */
    public static function throttle(string $bucket, int $limit, int $window = MINUTE_IN_SECONDS): bool {
        $who = get_current_user_id() ?: 'guest';
        $key = 'oe_rl_' . $bucket . '_' . $who;
        $n   = (int) get_transient($key);
        if ($n >= $limit) {
            return false;
        }
        set_transient($key, $n + 1, $window);
        return true;
    }
}
