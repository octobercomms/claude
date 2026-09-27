<?php
declare(strict_types=1);

namespace OE\Survey;

defined('ABSPATH') || exit;

/**
 * Post-event survey storage.
 *
 * One row per attendee, created the moment they answer the first question — so a
 * survey that is started but not finished is still captured (progressive
 * capture, not save-on-submit only). `status` moves from `partial` to `complete`
 * when they finish; `submitted_at` stamps the finish. `segment` snapshots the
 * attendee's ticket type at answer time so results can be split by audience
 * without a later identity lookup.
 *
 * `token` stores an HMAC of the attendee's ticket token, not the token itself:
 * stable per attendee (one response each, segment snapshot) but not reverse-
 * joinable to tickets.token — anonymous to read, pseudonymous underneath (§7a).
 *
 * @see docs/october-events/POST-EVENT-SURVEY-SPEC.md
 */
final class Schema {

    public static function table(): string {
        global $wpdb;
        return $wpdb->prefix . 'oe_survey_responses';
    }

    public static function install(): void {
        global $wpdb;
        $table   = self::table();
        $charset = $wpdb->get_charset_collate();
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta("CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            event_id BIGINT UNSIGNED NOT NULL,
            token VARCHAR(64) NOT NULL,
            segment VARCHAR(120) NOT NULL DEFAULT '',
            answers LONGTEXT NOT NULL,
            status VARCHAR(12) NOT NULL DEFAULT 'partial',
            started_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            submitted_at DATETIME NULL,
            PRIMARY KEY  (id),
            UNIQUE KEY token (token),
            KEY event_id (event_id),
            KEY status (status)
        ) {$charset};");
    }
}
