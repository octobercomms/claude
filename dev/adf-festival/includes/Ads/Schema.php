<?php
declare(strict_types=1);

namespace ADF\Ads;

defined('ABSPATH') || exit;

/**
 * Ad Manager schema — campaigns, creatives, tracking, bookings — mirroring the
 * proven OC Ad Manager tables with an `adf_` prefix.
 */
final class Schema {

    public static function campaigns(): string { global $wpdb; return $wpdb->prefix . 'adf_ad_campaigns'; }
    public static function creatives(): string { global $wpdb; return $wpdb->prefix . 'adf_ad_creatives'; }
    public static function tracking(): string  { global $wpdb; return $wpdb->prefix . 'adf_ad_tracking'; }
    public static function bookings(): string  { global $wpdb; return $wpdb->prefix . 'adf_ad_bookings'; }

    public static function install(): void {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';

        $c = self::campaigns();
        dbDelta("CREATE TABLE {$c} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL,
            client_name VARCHAR(255) NOT NULL DEFAULT '',
            url VARCHAR(500) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            start_date DATE NULL,
            end_date DATE NULL,
            max_impressions BIGINT NULL,
            max_clicks BIGINT NULL,
            restrict_impressions TINYINT(1) NOT NULL DEFAULT 0,
            restrict_clicks TINYINT(1) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY status (status)
        ) {$charset};");

        $cr = self::creatives();
        dbDelta("CREATE TABLE {$cr} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            campaign_id BIGINT UNSIGNED NOT NULL,
            format VARCHAR(50) NOT NULL,
            image_url VARCHAR(500) NOT NULL,
            alt_text VARCHAR(255) NOT NULL DEFAULT '',
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY campaign_format (campaign_id, format),
            KEY campaign_id (campaign_id),
            KEY format (format)
        ) {$charset};");

        $t = self::tracking();
        dbDelta("CREATE TABLE {$t} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            campaign_id BIGINT UNSIGNED NOT NULL,
            ad_id BIGINT UNSIGNED NOT NULL,
            type VARCHAR(20) NOT NULL,
            ip_hash VARCHAR(64) NULL,
            ua_hash VARCHAR(64) NULL,
            source_url VARCHAR(500) NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY campaign_type (campaign_id, type),
            KEY ad_type (ad_id, type),
            KEY created_at (created_at)
        ) {$charset};");

        $b = self::bookings();
        dbDelta("CREATE TABLE {$b} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            campaign_name VARCHAR(255) NOT NULL DEFAULT '',
            company VARCHAR(200) DEFAULT NULL,
            email VARCHAR(200) NOT NULL,
            destination_url VARCHAR(500) NOT NULL DEFAULT '',
            start_date DATE NULL,
            end_date DATE NULL,
            image_mpu BIGINT UNSIGNED NULL,
            image_leaderboard BIGINT UNSIGNED NULL,
            image_skyscraper BIGINT UNSIGNED NULL,
            package_name VARCHAR(255) NOT NULL DEFAULT '',
            package_type VARCHAR(20) NOT NULL DEFAULT 'impressions',
            package_quantity BIGINT NOT NULL DEFAULT 0,
            amount_cents INT NOT NULL DEFAULT 0,
            promo_code VARCHAR(100) NULL,
            discount_pct INT NOT NULL DEFAULT 0,
            stripe_payment_intent_id VARCHAR(190) NULL,
            campaign_id BIGINT UNSIGNED NULL,
            status VARCHAR(30) NOT NULL DEFAULT 'pending_payment',
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY status (status),
            KEY payment (stripe_payment_intent_id)
        ) {$charset};");
    }
}
