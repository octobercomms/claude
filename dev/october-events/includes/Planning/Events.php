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
        // Optional daily hours for date-only (often multi-day) events, e.g. a
        // two-day tour running 10am–4pm each day. Time-of-day only; combined
        // with the start/end DATE by the ticketing/calendar layer (see Ics).
        'start_time'      => 'text',
        'end_time'        => 'text',
        'price'           => 'text',     // "Free", "$25", "From $10" — kept as text
        'location'        => 'text',
        'description'     => 'textarea',
        'organiser'       => 'text',
        'ticket_required' => 'bool',
        'notes'           => 'textarea', // internal only, never published
        // Second-tenant base fields (BUILD-PLAN M1, Concrete Communities parity).
        // A reference number, a per-listing brand color + image (CC paints the
        // whole page from this; distinct from a category color or status badge),
        // and an external ticket link so a listing can link out (EventBrite)
        // instead of selling natively. All optional and additive.
        'event_number'       => 'text',
        'brand_colour'       => 'color', // #rrggbb; exposed as an Elementor dynamic tag in M3
        'brand_colour_image' => 'int',   // attachment ID for the color/hero image
        'ticket_link'        => 'url',   // external ticketing URL (blank = native checkout)
        'ticket_link_text'   => 'text',  // button label for the external link
        // Structured fields (FIELD-MAPPING §structured): replace the old
        // HTML-in-a-field patterns with data the template renders. Availability
        // retires the sat_only/sun_only switcher pair; the status badge is a
        // preset (dropdown, brand color + readable text) for exceptions only.
        'availability'       => 'text',  // saturday | sunday | both | specific | ''
        'status_preset'      => 'text',  // new | rescheduled | soldout | cancelled | ''
        'status_text'        => 'text',  // optional custom label; else derived from preset
    ];

    /** Availability choice => label. '' (default) shows no availability note. */
    public const AVAILABILITY = [
        'saturday' => 'Saturday',
        'sunday'   => 'Sunday',
        'both'     => 'Saturday & Sunday',
        'specific' => 'Specific date',
    ];

    /** Status preset => [label, background, text color]. Brand-approved, accessible. */
    public const STATUS_PRESETS = [
        'new'         => ['New', '#2e7d32', '#ffffff'],
        'rescheduled' => ['Rescheduled', '#b86e00', '#ffffff'],
        'soldout'     => ['Sold out', '#c62828', '#ffffff'],
        'cancelled'   => ['Canceled', '#555555', '#ffffff'],
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
            // Then the common convention keys for date/time fields, so a tour that
            // already stores start-date / end-date / start-time / end-time resolves
            // its full schedule without every field being mapped by hand.
            foreach (self::convention_keys($field) as $ck) {
                $ext = get_post_meta($event_id, $ck, true);
                if ($ext !== '' && $ext !== false) {
                    return $ext;
                }
            }
            return $default;
        }
        return $v;
    }

    /**
     * Conventional source meta keys tried, in order, after the mapped one for the
     * date/time fields. Only fires when the primary value is empty, so a mapping
     * always wins and non-date fields are never touched.
     *
     * @return string[]
     */
    private static function convention_keys(string $field): array {
        switch ($field) {
            case 'start_datetime': return ['start-date', 'start_date'];
            case 'end_datetime':   return ['end-date', 'end_date'];
            case 'start_time':     return ['start-time', 'start_time'];
            case 'end_time':       return ['end-time', 'end_time'];
            case 'schedule_text':  return ['date-time', 'date_time', 'dates-times'];
            default:               return [];
        }
    }

    /**
     * Sanitise a field value by its declared type (see FIELDS). Returns a string
     * ('' when empty / invalid), or '' / '1' for a bool.
     */
    public static function sanitise(string $field, $value): string {
        $type = self::FIELDS[$field] ?? 'text';
        // The description is rich text (WYSIWYG in the Event Studio), so keep
        // safe HTML rather than flattening it; other textareas stay plain.
        if ($field === 'description') {
            return (string) wp_kses_post((string) $value);
        }
        switch ($type) {
            case 'textarea':
                return sanitize_textarea_field((string) $value);
            case 'bool':
                return $value ? '1' : '';
            case 'color':
                return (string) (sanitize_hex_color((string) $value) ?: '');
            case 'url':
                return esc_url_raw(trim((string) $value));
            case 'int':
                return (string) $value === '' ? '' : (string) max(0, (int) $value);
            default:
                return sanitize_text_field((string) $value);
        }
    }

    /**
     * Write one field to `_oe_plan_*`. An empty value removes the row, so an
     * unset field leaves nothing behind. Never touches foreign (JetEngine) meta,
     * so it is safe in adoption mode.
     */
    public static function set(int $event_id, string $field, $value): void {
        if (! array_key_exists($field, self::FIELDS)) {
            return;
        }
        $clean = self::sanitise($field, $value);
        if ($clean === '') {
            delete_post_meta($event_id, self::key($field));
        } else {
            update_post_meta($event_id, self::key($field), $clean);
        }
    }

    /**
     * Save a posted field map (only keys present in the input are written; the
     * bool `ticket_required` is read by presence). Each value is sanitised by
     * its type before storage.
     *
     * @param array<string,mixed> $input
     */
    public static function save_fields(int $event_id, array $input): void {
        foreach (array_keys(self::FIELDS) as $field) {
            if ($field === 'ticket_required') {
                self::set($event_id, 'ticket_required', ! empty($input['ticket_required']));
                continue;
            }
            if (array_key_exists($field, $input)) {
                self::set($event_id, $field, $input[$field]);
            }
        }
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
