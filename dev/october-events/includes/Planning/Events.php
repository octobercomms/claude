<?php
declare(strict_types=1);

namespace OE\Planning;

use OE\PostTypes;
use OE\AuditLog;

defined('ABSPATH') || exit;

/**
 * Event planning layer (Elayne's domain).
 *
 * Stores the canonical event info + sessions + internal notes as `_oe_plan_*`
 * meta on the adopted `events` CPT, runs it through {@see Gating}, and only lets
 * an event go green (confirmed) once the required fields are complete.
 * Confirming publishes the event to the public site.
 *
 * Stored in post meta (no new tables) so it layers cleanly onto JetEngine.
 */
final class Events {

    private const PREFIX = '_oe_plan_';

    /** Editable planning fields => sanitiser. */
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
        return ($v === '' || $v === false) ? $default : $v;
    }

    public static function status(int $event_id): string {
        $s = (string) get_post_meta($event_id, self::key('status'), true);
        return in_array($s, [Gating::STATUS_DRAFT, Gating::STATUS_IN_PROGRESS, Gating::STATUS_CONFIRMED], true)
            ? $s : Gating::STATUS_DRAFT;
    }

    /**
     * Field values used for gating — planning meta plus name (post-title
     * fallback) and the featured image presence.
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
        $values['image'] = has_post_thumbnail($event_id) ? '1' : '';
        return $values;
    }

    /**
     * @return array{required:string[],missing:string[],done:string[],complete:bool,percent:int}
     */
    public static function readiness(int $event_id): array {
        return Gating::evaluate(Gating::event_required(), self::values($event_id));
    }

    public static function save_fields(int $event_id, array $input): void {
        foreach (self::FIELDS as $field => $type) {
            if (! array_key_exists($field, $input)) {
                continue;
            }
            $raw = $input[$field];
            if ($type === 'bool') {
                update_post_meta($event_id, self::key($field), empty($raw) ? '0' : '1');
            } elseif ($type === 'textarea') {
                update_post_meta($event_id, self::key($field), sanitize_textarea_field((string) $raw));
            } else {
                update_post_meta($event_id, self::key($field), sanitize_text_field((string) $raw));
            }
        }
        // Keep status honest as fields change.
        $status = self::status($event_id);
        if ($status === Gating::STATUS_CONFIRMED && ! self::readiness($event_id)['complete']) {
            self::set_status($event_id, Gating::STATUS_IN_PROGRESS);
        } elseif ($status === Gating::STATUS_DRAFT && self::has_any($event_id)) {
            self::set_status($event_id, Gating::STATUS_IN_PROGRESS);
        }
    }

    private static function has_any(int $event_id): bool {
        foreach (self::values($event_id) as $k => $v) {
            if ($k !== 'image' && ! is_array($v) && trim((string) $v) !== '') {
                return true;
            }
        }
        return false;
    }

    public static function set_status(int $event_id, string $status): void {
        update_post_meta($event_id, self::key('status'), $status);
    }

    /* ---- Sessions (structured meta: {title,time,desc,speakers}) ---- */

    /** @return array<int,array<string,mixed>> */
    public static function sessions(int $event_id): array {
        $raw = get_post_meta($event_id, self::key('sessions'), true);
        $decoded = is_string($raw) ? json_decode($raw, true) : $raw;
        return is_array($decoded) ? array_values($decoded) : [];
    }

    public static function set_sessions(int $event_id, array $sessions): void {
        $clean = [];
        foreach ($sessions as $s) {
            $title = sanitize_text_field((string) ($s['title'] ?? ''));
            if ($title === '') {
                continue;
            }
            $clean[] = [
                'title'    => $title,
                'time'     => sanitize_text_field((string) ($s['time'] ?? '')),
                'desc'     => sanitize_textarea_field((string) ($s['desc'] ?? '')),
                'speakers' => array_values(array_filter(array_map('sanitize_text_field', (array) ($s['speakers'] ?? [])))),
            ];
        }
        update_post_meta($event_id, self::key('sessions'), wp_json_encode($clean));
    }

    /* ---- Confirm / publish ---- */

    /**
     * Confirm an event (go green) — only when complete. Publishes on success.
     *
     * @return true|\WP_Error
     */
    public static function confirm(int $event_id) {
        $r = self::readiness($event_id);
        if (! $r['complete']) {
            return new \WP_Error('oe_not_ready', sprintf(
                /* translators: %s: comma-separated field labels */
                __('Not ready yet — still need: %s', 'october-events'),
                implode(', ', array_map([Gating::class, 'field_label'], $r['missing']))
            ), ['missing' => $r['missing']]);
        }
        self::set_status($event_id, Gating::STATUS_CONFIRMED);
        update_post_meta($event_id, self::key('confirmed_at'), current_time('mysql', true));
        update_post_meta($event_id, self::key('confirmed_by'), get_current_user_id());

        if (get_post_status($event_id) !== 'publish') {
            wp_update_post(['ID' => $event_id, 'post_status' => 'publish']);
        }
        AuditLog::record('event_confirmed', $event_id, 'event');
        return true;
    }

    public static function unconfirm(int $event_id): void {
        self::set_status($event_id, Gating::STATUS_IN_PROGRESS);
        delete_post_meta($event_id, self::key('confirmed_at'));
        AuditLog::record('event_unconfirmed', $event_id, 'event');
    }

    /* ---- Platform/admin facing ---- */

    /** @return array<string,mixed> */
    public static function summary(int $event_id): array {
        $r = self::readiness($event_id);
        return [
            'id'       => $event_id,
            'title'    => get_the_title($event_id) ?: (string) self::get($event_id, 'name'),
            'status'   => self::status($event_id),
            'percent'  => $r['percent'],
            'missing'  => array_map([Gating::class, 'field_label'], $r['missing']),
            'live'     => get_post_status($event_id) === 'publish',
            'edit_url' => (string) get_edit_post_link($event_id, 'raw'),
        ];
    }

    /** @return array<string,mixed> */
    public static function record(int $event_id): array {
        $values = self::values($event_id);
        unset($values['image']);
        return [
            'id'        => $event_id,
            'title'     => get_the_title($event_id),
            'status'    => self::status($event_id),
            'readiness' => self::readiness($event_id),
            'fields'    => $values,
            'sessions'  => self::sessions($event_id),
            'image'     => get_the_post_thumbnail_url($event_id, 'medium') ?: '',
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
