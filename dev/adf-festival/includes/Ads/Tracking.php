<?php
declare(strict_types=1);

namespace ADF\Ads;

defined('ABSPATH') || exit;

/**
 * Impression / click tracking. Improves on the legacy plugin by de-duplicating
 * repeat events from the same viewer within a short window (the old plugin
 * stored ip/ua hashes but never used them).
 */
final class Tracking {

    private const DEDUP_WINDOW = 1800; // 30 minutes

    public static function log(int $campaign_id, int $ad_id, string $type, string $source_url = ''): void {
        if (is_admin() || wp_doing_cron()) {
            return;
        }
        global $wpdb;
        $ip = self::ip_hash();
        $ua = self::ua_hash();

        // Dedup: same viewer + ad + type within the window counts once.
        $since = gmdate('Y-m-d H:i:s', time() - self::DEDUP_WINDOW);
        $dupe = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM " . Schema::tracking() . "
             WHERE ad_id = %d AND type = %s AND ip_hash = %s AND ua_hash = %s AND created_at >= %s",
            $ad_id, $type, $ip, $ua, $since
        ));
        if ($dupe > 0) {
            return;
        }

        $wpdb->insert(Schema::tracking(), [
            'campaign_id' => $campaign_id,
            'ad_id'       => $ad_id,
            'type'        => $type,
            'ip_hash'     => $ip,
            'ua_hash'     => $ua,
            'source_url'  => mb_substr($source_url, 0, 500),
            'created_at'  => current_time('mysql', true),
        ]);
    }

    public static function count(int $campaign_id, string $type): int {
        global $wpdb;
        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM " . Schema::tracking() . " WHERE campaign_id = %d AND type = %s",
            $campaign_id, $type
        ));
    }

    /** @return array<int,object> domain => count */
    public static function by_source(int $campaign_id, string $type, int $limit = 200): array {
        global $wpdb;
        return $wpdb->get_results($wpdb->prepare(
            "SELECT source_url, COUNT(*) AS hits FROM " . Schema::tracking() . "
             WHERE campaign_id = %d AND type = %s GROUP BY source_url ORDER BY hits DESC LIMIT %d",
            $campaign_id, $type, $limit
        )) ?: [];
    }

    private static function ip_hash(): string {
        $ip = '';
        foreach (['HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'REMOTE_ADDR'] as $k) {
            if (! empty($_SERVER[$k])) {
                $ip = explode(',', (string) $_SERVER[$k])[0];
                break;
            }
        }
        return hash('sha256', trim($ip) . wp_salt());
    }

    private static function ua_hash(): string {
        return hash('sha256', (string) ($_SERVER['HTTP_USER_AGENT'] ?? '') . wp_salt());
    }
}
