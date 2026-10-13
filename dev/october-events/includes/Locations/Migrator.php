<?php
declare(strict_types=1);

namespace OE\Locations;

use OE\PostTypes;
use OE\Packs\Content\Store;

defined('ABSPATH') || exit;

/**
 * Promote the Tour pack's per-event locations repeater to native `oe_location`
 * records (ROADMAP R1). Dry-runnable and idempotent: each promoted row carries
 * a `_oe_loc_src` marker ("<eventId>:<index>") so re-running never duplicates.
 * Nothing is deleted — the original repeater stays as the source of truth until
 * an operator is satisfied and removes it by hand.
 *
 * The JetEngine `portfolio` CPT import is intentionally not run automatically:
 * its field shape differs per site, so that path is reported for review rather
 * than executed blind.
 */
final class Migrator {

    private const MARKER = '_oe_loc_src';

    /** Events that have tour-location rows, with how many are already promoted. */
    public static function scan(): array {
        global $wpdb;
        $pt  = PostTypes::slug('event');
        $key = Store::key('tour', 'locations'); // _oe_tour_locations
        if ($pt === '' || $key === '') {
            return [];
        }
        $ids = $wpdb->get_col($wpdb->prepare(
            "SELECT DISTINCT p.ID FROM {$wpdb->posts} p
             INNER JOIN {$wpdb->postmeta} m ON m.post_id = p.ID AND m.meta_key = %s
             WHERE p.post_type = %s",
            $key,
            $pt
        )) ?: [];

        $out = [];
        foreach ($ids as $id) {
            $id   = (int) $id;
            $rows = Store::get($id, 'tour', 'locations');
            if (! $rows) {
                continue;
            }
            $out[] = [
                'event_id' => $id,
                'title'    => get_the_title($id),
                'count'    => count($rows),
                'promoted' => self::promoted_count($id),
            ];
        }
        return $out;
    }

    private static function promoted_count(int $event_id): int {
        global $wpdb;
        $like = $event_id . ':%';
        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$wpdb->postmeta} WHERE meta_key = %s AND meta_value LIKE %s",
            self::MARKER,
            $like
        ));
    }

    private static function marker_exists(string $marker): bool {
        global $wpdb;
        return (bool) $wpdb->get_var($wpdb->prepare(
            "SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = %s AND meta_value = %s LIMIT 1",
            self::MARKER,
            $marker
        ));
    }

    /**
     * Promote every unpromoted location row.
     *
     * @return array{created:int,skipped:int,events:int,items:array<int,array<string,mixed>>}
     */
    public static function promote(bool $dry = true): array {
        $res = ['created' => 0, 'skipped' => 0, 'events' => 0, 'items' => []];
        $loc_pt = PostTypes::slug('location');
        if ($loc_pt === '') {
            return $res;
        }
        foreach (self::scan() as $ev) {
            $res['events']++;
            $event_id = (int) $ev['event_id'];
            $rows = Store::get($event_id, 'tour', 'locations');
            foreach ($rows as $i => $row) {
                $marker = $event_id . ':' . $i;
                $name   = trim((string) ($row['name'] ?? ''));
                if ($name === '') {
                    $res['skipped']++;
                    continue;
                }
                if (self::marker_exists($marker)) {
                    $res['skipped']++;
                    continue;
                }
                $res['created']++;
                if (count($res['items']) < 50) {
                    $res['items'][] = ['event_id' => $event_id, 'name' => $name, 'marker' => $marker];
                }
                if ($dry) {
                    continue;
                }
                self::create_location($loc_pt, $event_id, $marker, (array) $row);
            }
        }
        return $res;
    }

    /** @param array<string,mixed> $row */
    private static function create_location(string $loc_pt, int $event_id, string $marker, array $row): void {
        $post_id = wp_insert_post([
            'post_type'    => $loc_pt,
            'post_status'  => 'publish',
            'post_title'   => sanitize_text_field((string) ($row['name'] ?? '')),
            'post_content' => '',
        ], true);
        if (is_wp_error($post_id) || ! $post_id) {
            return;
        }
        update_post_meta($post_id, self::MARKER, $marker);
        update_post_meta($post_id, Meta::key('event_id'), $event_id);

        foreach (['day', 'address', 'maps_url', 'architect', 'interior_designer', 'landscape_architect', 'developer', 'photographer', 'realtor'] as $f) {
            $v = (string) ($row[$f] ?? '');
            if ($v === '') {
                continue;
            }
            update_post_meta($post_id, Meta::key($f), $f === 'maps_url' ? esc_url_raw($v) : sanitize_text_field($v));
        }

        // Hero image: the repeater's image URL -> try to resolve to an
        // attachment; otherwise keep the URL in a meta for reference.
        $img = (string) ($row['image'] ?? '');
        if ($img !== '') {
            $att = attachment_url_to_postid($img);
            if ($att) {
                set_post_thumbnail($post_id, $att);
            } else {
                update_post_meta($post_id, '_oe_loc_image_url', esc_url_raw($img));
            }
        }
    }
}
