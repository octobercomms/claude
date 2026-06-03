<?php
declare(strict_types=1);

namespace ADF\Ads;

use ADF\Settings;
use ADF\AuditLog;
use ADF\Connectors\BrevoConnector;

defined('ABSPATH') || exit;

/**
 * Self-serve ad bookings. A paid booking sits at `paid` until an admin Activates
 * it, which creates the live campaign + creatives (mirrors the proven flow —
 * payment does not auto-publish an ad).
 */
final class Bookings {

    /** @return array<int,object> */
    public static function all(): array {
        global $wpdb;
        return $wpdb->get_results("SELECT * FROM " . Schema::bookings() . " ORDER BY created_at DESC") ?: [];
    }

    public static function get(int $id): ?object {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare("SELECT * FROM " . Schema::bookings() . " WHERE id = %d", $id)) ?: null;
    }

    public static function by_payment(string $intent_id): ?object {
        global $wpdb;
        if ($intent_id === '') {
            return null;
        }
        return $wpdb->get_row($wpdb->prepare("SELECT * FROM " . Schema::bookings() . " WHERE stripe_payment_intent_id = %s", $intent_id)) ?: null;
    }

    public static function create(array $data): int {
        global $wpdb;
        $wpdb->insert(Schema::bookings(), [
            'campaign_name'    => sanitize_text_field((string) ($data['campaign_name'] ?? '')),
            'company'          => sanitize_text_field((string) ($data['company'] ?? '')),
            'email'            => sanitize_email((string) ($data['email'] ?? '')),
            'destination_url'  => esc_url_raw((string) ($data['destination_url'] ?? '')),
            'start_date'       => ($data['start_date'] ?? '') ?: null,
            'end_date'         => ($data['end_date'] ?? '') ?: null,
            'image_mpu'         => (int) ($data['image_mpu'] ?? 0) ?: null,
            'image_leaderboard' => (int) ($data['image_leaderboard'] ?? 0) ?: null,
            'image_skyscraper'  => (int) ($data['image_skyscraper'] ?? 0) ?: null,
            'package_name'     => sanitize_text_field((string) ($data['package_name'] ?? '')),
            'package_type'     => in_array(($data['package_type'] ?? ''), ['impressions', 'clicks'], true) ? $data['package_type'] : 'impressions',
            'package_quantity' => (int) ($data['package_quantity'] ?? 0),
            'amount_cents'     => (int) ($data['amount_cents'] ?? 0),
            'promo_code'       => $data['promo_code'] ? strtoupper(sanitize_text_field((string) $data['promo_code'])) : null,
            'discount_pct'     => (int) ($data['discount_pct'] ?? 0),
            'status'           => 'pending_payment',
            'created_at'       => current_time('mysql', true),
        ]);
        return (int) $wpdb->insert_id;
    }

    public static function set_payment_intent(int $id, string $intent_id): void {
        global $wpdb;
        $wpdb->update(Schema::bookings(), ['stripe_payment_intent_id' => $intent_id], ['id' => $id]);
    }

    public static function delete(int $id): void {
        global $wpdb;
        $wpdb->delete(Schema::bookings(), ['id' => $id]);
    }

    /**
     * Mark a booking paid (from the Stripe webhook) and notify the admin.
     */
    public static function mark_paid(string $intent_id): void {
        $booking = self::by_payment($intent_id);
        if (! $booking || $booking->status !== 'pending_payment') {
            return;
        }
        global $wpdb;
        $wpdb->update(Schema::bookings(), ['status' => 'paid'], ['id' => $booking->id]);
        AuditLog::record('ad_booking_paid', (int) $booking->id, 'ad');
        BrevoConnector::send('ad_booking_received', ['email' => get_option('admin_email')], [], 'New ad booking — review needed',
            '<p>A new ad booking from ' . esc_html($booking->email) . ' is paid and awaiting review in ADF Festival → Ad Bookings.</p>');
    }

    /**
     * Activate a paid booking: create the live campaign + creatives.
     */
    public static function activate(int $id): void {
        $b = self::get($id);
        if (! $b || $b->status !== 'paid') {
            return;
        }
        $restrict_imp = $b->package_type === 'impressions' ? 1 : 0;
        $restrict_clk = $b->package_type === 'clicks' ? 1 : 0;

        $campaign_id = Campaigns::save([
            'name'                 => $b->campaign_name ?: ('Booking #' . $b->id),
            'client_name'          => $b->company,
            'url'                  => $b->destination_url,
            'status'               => 'active',
            'start_date'           => $b->start_date,
            'end_date'             => $b->end_date ?: gmdate('Y-m-d', strtotime('+4 weeks')),
            'max_impressions'      => $restrict_imp ? (int) $b->package_quantity : '',
            'max_clicks'           => $restrict_clk ? (int) $b->package_quantity : '',
            'restrict_impressions' => $restrict_imp,
            'restrict_clicks'      => $restrict_clk,
        ]);

        foreach (['mpu' => 'image_mpu', 'leaderboard' => 'image_leaderboard', 'skyscraper' => 'image_skyscraper'] as $format => $col) {
            $att = (int) $b->$col;
            if ($att && ($url = wp_get_attachment_url($att))) {
                Campaigns::save_creative($campaign_id, $format, $url, $b->campaign_name);
            }
        }

        global $wpdb;
        $wpdb->update(Schema::bookings(), ['status' => 'active', 'campaign_id' => $campaign_id], ['id' => $id]);
        AuditLog::record('ad_booking_activated', $id, 'ad', (string) $campaign_id);

        BrevoConnector::send('ad_booking_live', ['email' => $b->email], [], 'Your ad is now live',
            '<p>Good news — your ad campaign "' . esc_html($b->campaign_name) . '" is now live on Atlanta Design Festival.</p>');
    }

    public static function decline(int $id): void {
        global $wpdb;
        $b = self::get($id);
        if (! $b) {
            return;
        }
        $wpdb->update(Schema::bookings(), ['status' => 'declined'], ['id' => $id]);
        AuditLog::record('ad_booking_declined', $id, 'ad');
        BrevoConnector::send('ad_booking_declined', ['email' => $b->email], [], 'Ad booking update',
            '<p>Thank you for your ad booking. Unfortunately we are unable to proceed on this occasion; any payment will be refunded.</p>');
    }

    /* ---- Packages & promo (from settings) ---- */

    /** @return array<int,array{name:string,type:string,quantity:int,price:float}> */
    public static function packages(): array {
        return (array) Settings::get('ad_packages', []);
    }

    public static function package(string $name): ?array {
        foreach (self::packages() as $p) {
            if (($p['name'] ?? '') === $name) {
                return $p;
            }
        }
        return null;
    }

    public static function promo_pct(string $code): int {
        $codes = (array) Settings::get('ad_promo_codes', []);
        $code = strtoupper(trim($code));
        return (int) ($codes[$code] ?? 0);
    }
}
