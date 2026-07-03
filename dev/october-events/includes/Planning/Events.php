<?php
declare(strict_types=1);

namespace OE\Planning;

use OE\PostTypes;

defined('ABSPATH') || exit;

/**
 * Event fields data layer.
 *
 * A thin read layer over the adopted `events` CPT: it exposes an event's core
 * info (name, dates, price, location, organiser, description) from `_oe_plan_*`
 * meta, falling back to mapped existing (e.g. JetEngine) fields. Used by the
 * ticket email, calendar files, volunteer emails, reports and the AI assistant.
 *
 * (The old "confirm → green" readiness/gating layer and the planning board were
 * removed — events publish through WordPress/JetEngine as normal.)
 */
final class Events {

    private const PREFIX = '_oe_plan_';

    /** Known event fields => sanitiser (used when reading/normalising values). */
    public const FIELDS = [
        'name'            => 'text',
        'start_datetime'  => 'text',
        'end_datetime'    => 'text',
        'price'           => 'text',     // "Free", "$25", "From $10" — kept as text
        'location'        => 'text',
        'description'     => 'textarea',
        'organiser'       => 'text',
        'ticket_required' => 'bool',
        'notes'           => 'textarea', // internal only, never published
    ];

    public static function slug(): string {
        return PostTypes::slug('event');
    }

    public static function key(string $field): string {
        return self::PREFIX . $field;
    }

    public static function get(int $event_id, string $field, $default = '') {
        $v = get_post_meta($event_id, self::key($field), true);
        if ($v === '' || $v === false) {
            // Fall back to an existing (e.g. JetEngine) field if one is mapped in
            // Settings → Event field mapping, so events that store their data
            // elsewhere still resolve here without re-keying.
            $src = self::field_map()[$field] ?? '';
            if ($src !== '') {
                $ext = get_post_meta($event_id, $src, true);
                if ($ext !== '' && $ext !== false) {
                    return $ext;
                }
            }
            return $default;
        }
        return $v;
    }

    /** @return array<string,string> event field => source meta key */
    public static function field_map(): array {
        $m = \OE\Settings::get('event_field_map', []);
        return is_array($m) ? array_filter(array_map('strval', $m)) : [];
    }

    /**
     * All known field values for an event, with the post title as the name
     * fallback. Used by the AI assistant and reports.
     *
     * @return array<string,mixed>
     */
    public static function values(int $event_id): array {
        $values = [];
        foreach (array_keys(self::FIELDS) as $f) {
            $values[$f] = self::get($event_id, $f, '');
        }
        if (trim((string) $values['name']) === '') {
            $values['name'] = get_the_title($event_id);
        }
        return $values;
    }

    /** @return array<string,mixed> */
    public static function record(int $event_id): array {
        return [
            'id'     => $event_id,
            'title'  => get_the_title($event_id),
            'fields' => self::values($event_id),
            'live'   => get_post_status($event_id) === 'publish',
            'image'  => get_the_post_thumbnail_url($event_id, 'medium') ?: '',
        ];
    }

    /** @return int[] */
    public static function all_event_ids(int $limit = 300): array {
        return get_posts([
            'post_type'      => self::slug(),
            'post_status'    => 'any',
            'posts_per_page' => $limit,
            'fields'         => 'ids',
            'orderby'        => 'modified',
            'order'          => 'DESC',
        ]);
    }
}
