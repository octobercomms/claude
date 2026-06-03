<?php
declare(strict_types=1);

namespace ADF\Ads;

use ADF\AuditLog;

defined('ABSPATH') || exit;

/**
 * Campaign + creative CRUD, rotation/selection and stats.
 */
final class Campaigns {

    /** @return array<int,object> */
    public static function all(): array {
        global $wpdb;
        return $wpdb->get_results("SELECT * FROM " . Schema::campaigns() . " ORDER BY created_at DESC") ?: [];
    }

    public static function get(int $id): ?object {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare("SELECT * FROM " . Schema::campaigns() . " WHERE id = %d", $id)) ?: null;
    }

    public static function save(array $data, int $id = 0): int {
        global $wpdb;
        $row = [
            'name'                 => sanitize_text_field((string) ($data['name'] ?? '')),
            'client_name'          => sanitize_text_field((string) ($data['client_name'] ?? '')),
            'url'                  => esc_url_raw((string) ($data['url'] ?? '')),
            'status'               => in_array(($data['status'] ?? ''), ['active', 'inactive'], true) ? $data['status'] : 'active',
            'start_date'           => ($data['start_date'] ?? '') ?: null,
            'end_date'             => ($data['end_date'] ?? '') ?: null,
            'max_impressions'      => ($data['max_impressions'] ?? '') === '' ? null : (int) $data['max_impressions'],
            'max_clicks'           => ($data['max_clicks'] ?? '') === '' ? null : (int) $data['max_clicks'],
            'restrict_impressions' => empty($data['restrict_impressions']) ? 0 : 1,
            'restrict_clicks'      => empty($data['restrict_clicks']) ? 0 : 1,
        ];
        if ($id) {
            $wpdb->update(Schema::campaigns(), $row, ['id' => $id]);
            AuditLog::record('ad_campaign_updated', $id, 'ad');
            return $id;
        }
        $row['created_at'] = current_time('mysql', true);
        $wpdb->insert(Schema::campaigns(), $row);
        $new = (int) $wpdb->insert_id;
        AuditLog::record('ad_campaign_created', $new, 'ad');
        return $new;
    }

    public static function delete(int $id): void {
        global $wpdb;
        $wpdb->delete(Schema::creatives(), ['campaign_id' => $id]);
        $wpdb->delete(Schema::tracking(), ['campaign_id' => $id]);
        $wpdb->delete(Schema::campaigns(), ['id' => $id]);
        AuditLog::record('ad_campaign_deleted', $id, 'ad');
    }

    /* ---- Creatives ---- */

    /** @return array<int,object> */
    public static function creatives(int $campaign_id): array {
        global $wpdb;
        return $wpdb->get_results($wpdb->prepare("SELECT * FROM " . Schema::creatives() . " WHERE campaign_id = %d", $campaign_id)) ?: [];
    }

    public static function creative_for(int $campaign_id, string $format): ?object {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . Schema::creatives() . " WHERE campaign_id = %d AND format = %s",
            $campaign_id, $format
        )) ?: null;
    }

    public static function save_creative(int $campaign_id, string $format, string $image_url, string $alt = ''): void {
        if (! Formats::exists($format) || $image_url === '') {
            return;
        }
        global $wpdb;
        $existing = self::creative_for($campaign_id, $format);
        $row = ['campaign_id' => $campaign_id, 'format' => $format, 'image_url' => esc_url_raw($image_url), 'alt_text' => sanitize_text_field($alt)];
        if ($existing) {
            $wpdb->update(Schema::creatives(), $row, ['id' => $existing->id]);
        } else {
            $row['created_at'] = current_time('mysql', true);
            $wpdb->insert(Schema::creatives(), $row);
        }
    }

    public static function delete_creative(int $campaign_id, string $format): void {
        global $wpdb;
        $wpdb->delete(Schema::creatives(), ['campaign_id' => $campaign_id, 'format' => $format]);
    }

    /* ---- Rotation / selection ---- */

    /**
     * Pick an eligible campaign + creative for a format: active, in date range,
     * has a creative for the format, caps not exhausted. Random rotation.
     *
     * @return object|null {campaign, creative}
     */
    public static function active_for_format(string $format): ?object {
        if (! Formats::exists($format)) {
            return null;
        }
        global $wpdb;
        $c  = Schema::campaigns();
        $cr = Schema::creatives();
        $today = current_time('Y-m-d');

        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT c.*, cr.id AS creative_id, cr.image_url, cr.alt_text
             FROM {$c} c INNER JOIN {$cr} cr ON cr.campaign_id = c.id AND cr.format = %s
             WHERE c.status = 'active'
               AND (c.start_date IS NULL OR c.start_date <= %s)
               AND (c.end_date IS NULL OR c.end_date >= %s)
             ORDER BY RAND()",
            $format, $today, $today
        )) ?: [];

        foreach ($rows as $r) {
            if ($r->restrict_impressions && $r->max_impressions !== null && Tracking::count((int) $r->id, 'impression') >= (int) $r->max_impressions) {
                continue;
            }
            if ($r->restrict_clicks && $r->max_clicks !== null && Tracking::count((int) $r->id, 'click') >= (int) $r->max_clicks) {
                continue;
            }
            return $r;
        }
        return null;
    }

    /** @return array{impressions:int,clicks:int,ctr:float} */
    public static function stats(int $campaign_id): array {
        $imp = Tracking::count($campaign_id, 'impression');
        $clk = Tracking::count($campaign_id, 'click');
        return ['impressions' => $imp, 'clicks' => $clk, 'ctr' => $imp ? round($clk / $imp * 100, 2) : 0.0];
    }

    public static function set_status(int $id, string $status): void {
        global $wpdb;
        $wpdb->update(Schema::campaigns(), ['status' => $status === 'active' ? 'active' : 'inactive'], ['id' => $id]);
    }
}
