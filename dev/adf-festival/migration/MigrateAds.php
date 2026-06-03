<?php
declare(strict_types=1);

namespace ADF\Migration;

use ADF\Ads\Schema;

defined('ABSPATH') || exit;

/**
 * Migrate the legacy Ad Manager (oc-ad-manager) custom tables into ADF's ad
 * tables (§9). The legacy schema maps almost 1:1:
 *   ocad_campaigns → adf_ad_campaigns
 *   ocad_ads       → adf_ad_creatives
 *   ocad_tracking  → adf_ad_tracking
 *
 * Campaign ids are remapped to the new auto-increment ids; creatives + tracking
 * follow. Idempotent: a campaign whose name+created_at already exists is skipped.
 *
 * Usage: wp adf migrate-ads [--prefix=wp_] [--dry-run]
 */
final class MigrateAds {

    public static function run(array $args, array $assoc): void {
        global $wpdb;
        $dry_run = isset($assoc['dry-run']);
        $prefix  = $assoc['prefix'] ?? $wpdb->prefix;

        $c_t = $prefix . 'ocad_campaigns';
        $a_t = $prefix . 'ocad_ads';
        $t_t = $prefix . 'ocad_tracking';

        if (! self::table_exists($c_t)) {
            \WP_CLI::warning("Campaigns table '{$c_t}' not found. Pass --prefix if needed.");
            return;
        }

        $campaigns = $wpdb->get_results("SELECT * FROM {$c_t}");
        \WP_CLI::log(sprintf('Found %d campaign(s).', is_array($campaigns) ? count($campaigns) : 0));
        $created = 0; $skipped = 0;

        foreach (($campaigns ?: []) as $c) {
            if (self::campaign_exists((string) $c->name, (string) ($c->created_at ?? ''))) {
                $skipped++;
                continue;
            }
            \WP_CLI::log(sprintf(' • %s%s', $c->name, $dry_run ? ' [dry-run]' : ''));
            if ($dry_run) {
                continue;
            }

            $wpdb->insert(Schema::campaigns(), [
                'name'                 => (string) $c->name,
                'client_name'          => (string) ($c->client_name ?? ''),
                'url'                  => (string) ($c->url ?? ''),
                'status'               => (string) ($c->status ?? 'active'),
                'start_date'           => $c->start_date ?? null,
                'end_date'             => $c->end_date ?? null,
                'max_impressions'      => $c->max_impressions ?? null,
                'max_clicks'           => $c->max_clicks ?? null,
                'restrict_impressions' => (int) ($c->restrict_impressions ?? 0),
                'restrict_clicks'      => (int) ($c->restrict_clicks ?? 0),
                'created_at'           => (string) ($c->created_at ?? current_time('mysql', true)),
            ]);
            $new_id = (int) $wpdb->insert_id;

            // Creatives, remapping legacy ad id → new creative id for tracking.
            $ad_map = [];
            if (self::table_exists($a_t)) {
                foreach (($wpdb->get_results($wpdb->prepare("SELECT * FROM {$a_t} WHERE campaign_id = %d", $c->id)) ?: []) as $ad) {
                    $wpdb->insert(Schema::creatives(), [
                        'campaign_id' => $new_id,
                        'format'      => (string) $ad->format,
                        'image_url'   => (string) $ad->image_url,
                        'alt_text'    => (string) ($ad->alt_text ?? ''),
                        'created_at'  => (string) ($ad->created_at ?? current_time('mysql', true)),
                    ]);
                    $ad_map[(int) $ad->id] = (int) $wpdb->insert_id;
                }
            }

            // Tracking rows.
            if (self::table_exists($t_t)) {
                foreach (($wpdb->get_results($wpdb->prepare("SELECT * FROM {$t_t} WHERE campaign_id = %d", $c->id)) ?: []) as $tr) {
                    $wpdb->insert(Schema::tracking(), [
                        'campaign_id' => $new_id,
                        'ad_id'       => $ad_map[(int) $tr->ad_id] ?? 0,
                        'type'        => (string) $tr->type,
                        'ip_hash'     => $tr->ip_hash ?? null,
                        'ua_hash'     => $tr->user_agent_hash ?? null,
                        'source_url'  => $tr->source_url ?? null,
                        'created_at'  => (string) ($tr->created_at ?? current_time('mysql', true)),
                    ]);
                }
            }
            $created++;
        }

        \WP_CLI::success(sprintf('Ads migration complete. Imported %d campaign(s), skipped %d.', $created, $skipped));
    }

    private static function table_exists(string $table): bool {
        global $wpdb;
        return (string) $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table)) === $table;
    }

    private static function campaign_exists(string $name, string $created_at): bool {
        global $wpdb;
        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM " . Schema::campaigns() . " WHERE name = %s AND created_at = %s",
            $name, $created_at
        )) > 0;
    }
}
