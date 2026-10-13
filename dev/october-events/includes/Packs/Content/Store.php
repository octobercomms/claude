<?php
declare(strict_types=1);

namespace OE\Packs\Content;

defined('ABSPATH') || exit;

/**
 * Repeater storage for pack content (FRONTEND-BUILD slices B/C).
 *
 * Pack content (speakers, sessions, exhibitors, …) is stored as one post-meta
 * value per field: a clean array of rows, each row an associative array sanitized
 * per a field spec. No pasted HTML, consistent with the structured-fields rule in
 * FIELD-MAPPING.md. The meta key is `_oe_{pack}_{field}`.
 *
 * A field spec maps a column key to a type: 'text' | 'textarea' | 'url' | 'image'
 * (an attachment id). Save drops empty rows (a row is empty when every column is
 * blank) and deletes the meta when nothing is left, so an unused field leaves no
 * row behind.
 */
final class Store {

    /** Build the meta key for a pack field. */
    public static function key(string $pack, string $field): string {
        return '_oe_' . $pack . '_' . $field;
    }

    /**
     * Read the stored rows for a pack field.
     *
     * @return array<int,array<string,mixed>>
     */
    public static function get(int $post_id, string $pack, string $field): array {
        $rows = get_post_meta($post_id, self::key($pack, $field), true);
        return is_array($rows) ? array_values($rows) : [];
    }

    /**
     * Sanitize posted rows against a field spec and store them (or clear the
     * meta when nothing non-empty remains).
     *
     * @param mixed                 $raw  posted value (expected array of rows)
     * @param array<string,string>  $spec column => type
     */
    public static function save(int $post_id, string $pack, string $field, $raw, array $spec): void {
        $clean = [];
        if (is_array($raw)) {
            foreach ($raw as $row) {
                if (! is_array($row)) {
                    continue;
                }
                $out      = [];
                $nonEmpty = false;
                foreach ($spec as $col => $type) {
                    $val = self::sanitize_value($type, $row[$col] ?? '');
                    $out[$col] = $val;
                    if ($val !== '' && $val !== 0) {
                        $nonEmpty = true;
                    }
                }
                if ($nonEmpty) {
                    $clean[] = $out;
                }
            }
        }
        if ($clean) {
            update_post_meta($post_id, self::key($pack, $field), $clean);
        } else {
            delete_post_meta($post_id, self::key($pack, $field));
        }
    }

    /** Sanitize a single value by its declared type. */
    private static function sanitize_value(string $type, $val) {
        switch ($type) {
            case 'image':
                return (int) $val;
            case 'url':
                return esc_url_raw(trim((string) $val));
            case 'textarea':
                return sanitize_textarea_field((string) $val);
            case 'text':
            default:
                return sanitize_text_field((string) $val);
        }
    }
}
