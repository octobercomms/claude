<?php
declare(strict_types=1);

namespace ADF\Migration;

use ADF\PostTypes;
use ADF\Fields;
use ADF\Logger;

defined('ABSPATH') || exit;

/**
 * Migrate the legacy Ad Manager plugin (oc-ad-manager) into `adf_ad` (§9).
 *
 * The old plugin stores data in CUSTOM TABLES, not a CPT:
 *   - {prefix}ocad_campaigns  campaign (name, client_name, url, status, caps…)
 *   - {prefix}ocad_ads        creatives per campaign (format, image_url, alt_text)
 *   - {prefix}ocad_tracking   impression/click events (type column)
 *   - {prefix}ocad_bookings   purchase records (stripe_payment_intent_id, amount…)
 *
 * This importer reads those tables, creating one `adf_ad` per campaign with the
 * first creative's image, aggregated impression/click counts, and the Stripe
 * payment-intent from the matching booking. Idempotent via `_adf_migrated_from`.
 *
 * Usage: wp adf migrate-ads [--prefix=wp_] [--dry-run]
 */
final class MigrateAds {

    public static function run(array $args, array $assoc): void {
        global $wpdb;
        $dry_run = isset($assoc['dry-run']);
        $prefix  = $assoc['prefix'] ?? $wpdb->prefix;

        $campaigns_t = $prefix . 'ocad_campaigns';
        $ads_t       = $prefix . 'ocad_ads';
        $tracking_t  = $prefix . 'ocad_tracking';
        $bookings_t  = $prefix . 'ocad_bookings';

        if (! self::table_exists($campaigns_t)) {
            \WP_CLI::warning("Campaigns table '{$campaigns_t}' not found. The old plugin may be deactivated, or pass --prefix.");
            return;
        }

        $campaigns = $wpdb->get_results("SELECT * FROM {$campaigns_t}");
        \WP_CLI::log(sprintf('Found %d campaign(s).', is_array($campaigns) ? count($campaigns) : 0));
        $created = 0; $skipped = 0;

        foreach (($campaigns ?: []) as $c) {
            $marker = 'ocad_campaigns:' . $c->id;
            if (self::already_migrated($marker)) {
                $skipped++;
                continue;
            }

            // First creative for the image + format/placement.
            $creative = self::table_exists($ads_t)
                ? $wpdb->get_row($wpdb->prepare("SELECT * FROM {$ads_t} WHERE campaign_id = %d ORDER BY id ASC LIMIT 1", $c->id))
                : null;

            // Aggregate tracking counts.
            $impressions = self::table_exists($tracking_t)
                ? (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$tracking_t} WHERE campaign_id = %d AND type = 'impression'", $c->id))
                : 0;
            $clicks = self::table_exists($tracking_t)
                ? (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$tracking_t} WHERE campaign_id = %d AND type = 'click'", $c->id))
                : 0;

            // Matching booking (for the Stripe payment-intent + amount).
            $booking = self::table_exists($bookings_t)
                ? $wpdb->get_row($wpdb->prepare("SELECT * FROM {$bookings_t} WHERE campaign_id = %d ORDER BY id DESC LIMIT 1", $c->id))
                : null;

            \WP_CLI::log(sprintf(' • %s (campaign #%d)%s', $c->name, $c->id, $dry_run ? ' [dry-run]' : ''));
            if ($dry_run) {
                continue;
            }

            $new_id = wp_insert_post([
                'post_type'   => PostTypes::slug('ad'),
                'post_status' => 'publish',
                'post_title'  => (string) $c->name,
                'post_date'   => (string) ($c->created_at ?? current_time('mysql')),
            ], true);
            if (is_wp_error($new_id)) {
                Logger::log('migrate-ads insert failed', ['error' => $new_id->get_error_message()]);
                continue;
            }
            $new_id = (int) $new_id;

            update_post_meta($new_id, '_adf_ad_name', (string) $c->name);
            update_post_meta($new_id, '_adf_client_name', (string) ($c->client_name ?? ''));
            update_post_meta($new_id, '_adf_destination_url', (string) ($c->url ?? ($booking->destination_url ?? '')));
            update_post_meta($new_id, '_adf_image', $creative ? (string) $creative->image_url : '');
            update_post_meta($new_id, '_adf_placement', $creative ? (string) $creative->format : '');
            update_post_meta($new_id, '_adf_impressions', $impressions);
            update_post_meta($new_id, '_adf_clicks', $clicks);
            update_post_meta($new_id, '_adf_start_date', (string) ($c->created_at ?? ''));
            if ($booking) {
                update_post_meta($new_id, '_adf_stripe_payment_intent_id', (string) ($booking->stripe_payment_intent_id ?? ''));
                update_post_meta($new_id, '_adf_amount_cents', (int) ($booking->amount_cents ?? 0));
            }
            Fields::set($new_id, 'listing_type', 'ad');
            Fields::set($new_id, 'status', Fields::STATUS_APPROVED);
            Fields::set($new_id, 'paid_tier', Fields::TIER_FEATURED);
            update_post_meta($new_id, '_adf_migrated_from', $marker);
            $created++;
        }

        \WP_CLI::success(sprintf('Ads migration complete. Created %d, skipped %d (already migrated).', $created, $skipped));
    }

    private static function table_exists(string $table): bool {
        global $wpdb;
        return (string) $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table)) === $table;
    }

    private static function already_migrated(string $marker): bool {
        $found = get_posts([
            'post_type'      => PostTypes::slug('ad'),
            'posts_per_page' => 1,
            'fields'         => 'ids',
            'meta_key'       => '_adf_migrated_from',
            'meta_value'     => $marker,
            'no_found_rows'  => true,
        ]);
        return ! empty($found);
    }
}
