<?php
declare(strict_types=1);

namespace OE\Migration;

use OE\Planning\Events;
use OE\Packs\Registry;

defined('ABSPATH') || exit;

/**
 * Migrate legacy (JetEngine) event meta into the native model (BUILD-PLAN M1.3).
 *
 * Reads the JetEngine/ACF meta on the adopted `events` CPT and writes the
 * plugin's own `_oe_plan_*` base fields plus the per-event capability-pack flags
 * (`_oe_pack_{id}_enabled`) derived from the legacy on/off switchers. Mapping and
 * cleanups follow docs/october-events/FIELD-MAPPING.md.
 *
 * Safety:
 *   - **Opt-in:** nothing runs until this command is invoked.
 *   - **Dry-run:** `--dry-run` logs every change and writes nothing.
 *   - **Idempotent + non-destructive:** a base field is written only when the
 *     plugin's own value is empty, so re-runs are safe and native edits are
 *     never clobbered. `--force` overwrites.
 *   - Never deletes or re-keys the source JetEngine meta; the plugin still reads
 *     it as a fallback in adoption mode.
 *
 * Usage:
 *   wp oe migrate-events [--dry-run] [--force] [--limit=N] [--ids=1,2,3]
 *                        [--post-type=events]
 */
final class MigrateEvents {

    /**
     * Plugin base field => candidate legacy meta keys, in priority order. The
     * first non-empty source wins. Keys cover the hyphen/underscore and
     * misspelling variants seen across the two sites (FIELD-MAPPING §cleanup).
     *
     * @var array<string,array<int,string>>
     */
    private const BASE_MAP = [
        'description'        => ['event-details', 'about-the-event', 'event_description'],
        'start_datetime'     => ['start-date', 'start_date'],
        'end_datetime'       => ['end-date', 'end_date'],
        'start_time'         => ['start-time', 'start_time'],
        'end_time'           => ['end-time', 'end_time'],
        'price'              => ['event-price', 'price', 'event_price'],
        'location'           => ['event-location', 'location', 'event_location'],
        'organiser'          => ['company', 'organiser', 'organizer'],
        'ticket_link'        => ['event_ticket_link', 'registration-link', 'external_event_link', 'external-url'],
        'ticket_link_text'   => ['event_ticket_link_text', 'registration-link-text', 'registration_link_text'],
        'event_number'       => ['event_number', 'event-number'],
        'brand_colour'       => ['event_colour', 'event_color', 'event-colour'],
        'brand_colour_image' => ['event_colour_image', 'event_color_image', 'event-colour-image'],
    ];

    /**
     * Capability-pack id => legacy on/off switcher meta keys. When any is truthy
     * the pack is switched on. FIELD-MAPPING §"ADF already is the pack model".
     *
     * @var array<string,array<int,string>>
     */
    private const PACK_SWITCHERS = [
        'tickets'    => ['tickets-section-onoff', 'tickets_section_onoff'],
        'conference' => ['conference-page-switcher', 'conference_page_switcher'],
        'exhibition' => ['exhibition-page-switcher', 'exhibition_page_switcher'],
        'tour'       => ['tours-page-switcher', 'tours_page_switcher', 'tour-page-switcher'],
        'volunteers' => ['needs-volunteers', 'needs_volunteers', 'volunteers-onoff'],
    ];

    public static function run(array $args, array $assoc): void {
        $dry   = isset($assoc['dry-run']);
        $force = isset($assoc['force']);
        $pt    = isset($assoc['post-type']) ? sanitize_key((string) $assoc['post-type']) : Events::slug();

        if ($pt === '' || ! post_type_exists($pt)) {
            \WP_CLI::error("Post type '{$pt}' is not registered.");
        }

        $ids = self::target_ids($assoc, $pt);
        \WP_CLI::log(sprintf('Migrating %d %s post(s)%s.', count($ids), $pt, $dry ? ' [dry-run]' : ''));

        $fields_set = 0; $packs_set = 0; $touched = 0;
        foreach ($ids as $id) {
            $id = (int) $id;
            $before = $fields_set + $packs_set;

            foreach (self::BASE_MAP as $field => $sources) {
                $value = self::first_source($id, $sources);
                if ($value === '') {
                    continue;
                }
                $value = self::clean($field, $value);
                if ($value === '') {
                    continue;
                }
                $existing = (string) get_post_meta($id, Events::key($field), true);
                if ($existing !== '' && ! $force) {
                    continue; // native value present — never clobber
                }
                \WP_CLI::log(sprintf('  #%d %s → %s', $id, $field, self::trunc($value)));
                if (! $dry) {
                    Events::set($id, $field, $value);
                }
                $fields_set++;
            }

            foreach (self::PACK_SWITCHERS as $pack => $switchers) {
                if (! Registry::exists($pack)) {
                    continue;
                }
                if (! self::any_truthy($id, $switchers)) {
                    continue;
                }
                if (get_post_meta($id, Registry::enable_key($pack), true) === '1' && ! $force) {
                    continue;
                }
                \WP_CLI::log(sprintf('  #%d pack:%s → on', $id, $pack));
                if (! $dry) {
                    Registry::set($id, $pack, true);
                }
                $packs_set++;
            }

            if ($fields_set + $packs_set > $before) {
                $touched++;
            }
        }

        \WP_CLI::success(sprintf(
            '%s %d post(s): %d field(s), %d pack flag(s)%s.',
            $dry ? 'Would update' : 'Updated',
            $touched,
            $fields_set,
            $packs_set,
            $dry ? ' [dry-run — nothing written]' : ''
        ));
    }

    /** @return int[] */
    private static function target_ids(array $assoc, string $pt): array {
        if (! empty($assoc['ids'])) {
            return array_values(array_filter(array_map('intval', explode(',', (string) $assoc['ids']))));
        }
        $limit = isset($assoc['limit']) ? max(1, (int) $assoc['limit']) : -1;
        return get_posts([
            'post_type'      => $pt,
            'post_status'    => 'any',
            'posts_per_page' => $limit,
            'fields'         => 'ids',
            'orderby'        => 'ID',
            'order'          => 'ASC',
        ]);
    }

    private static function first_source(int $id, array $sources): string {
        foreach ($sources as $key) {
            $v = get_post_meta($id, $key, true);
            if (is_array($v)) {
                $v = reset($v);
            }
            $v = trim((string) $v);
            if ($v !== '') {
                return $v;
            }
        }
        return '';
    }

    private static function any_truthy(int $id, array $keys): bool {
        foreach ($keys as $key) {
            $v = get_post_meta($id, $key, true);
            if (is_array($v)) {
                $v = reset($v);
            }
            $v = strtolower(trim((string) $v));
            if (in_array($v, ['1', 'yes', 'on', 'true', 'enabled'], true)) {
                return true;
            }
        }
        return false;
    }

    /** Per-field cleanup (FIELD-MAPPING §"do not copy the faults across"). */
    private static function clean(string $field, string $value): string {
        if ($field === 'location') {
            // Leading/trailing spaces caused the silent city-filter bug.
            return trim(preg_replace('/\s+/', ' ', $value) ?? $value);
        }
        if ($field === 'brand_colour_image' && ! ctype_digit($value)) {
            // A URL instead of an attachment id — resolve it if we can.
            $resolved = function_exists('attachment_url_to_postid') ? (int) attachment_url_to_postid($value) : 0;
            return $resolved > 0 ? (string) $resolved : '';
        }
        return $value;
    }

    private static function trunc(string $v, int $n = 60): string {
        $v = preg_replace('/\s+/', ' ', $v) ?? $v;
        return mb_strlen($v) > $n ? mb_substr($v, 0, $n - 1) . '…' : $v;
    }
}
