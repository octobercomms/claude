<?php
declare(strict_types=1);

namespace OE\Crew;

defined('ABSPATH') || exit;

/**
 * Planning-team / crew storage (CREW-MODULE.md §3, ADMIN-BUILD AD7 + R5).
 *
 * One row per named team member across the four involvement tiers (festival
 * volunteers, planning team, council, board). The day-of volunteer shift system
 * is separate ({@see \OE\VolunteerSignups}); this table carries the year-long
 * named roles with a lifecycle: invited -> agreement accepted -> login/role
 * email provisioned -> active for the term -> renewed or offboarded.
 *
 * Council and Board tiers are directory-only (no automation), but are stored
 * here so one template can render the whole team grouped by tier.
 *
 * Identity is the email (lower-cased on write). A `token` gives no-login accept
 * / renewal links. `user_id` links the WordPress login once provisioned; it is
 * cleared on offboard so access is never left dangling.
 */
final class Schema {

    public static function table(): string {
        global $wpdb;
        return $wpdb->prefix . 'oe_team';
    }

    public static function install(): void {
        global $wpdb;
        $table   = self::table();
        $charset = $wpdb->get_charset_collate();
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta("CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            tier VARCHAR(20) NOT NULL DEFAULT 'planning',
            name VARCHAR(190) NOT NULL DEFAULT '',
            email VARCHAR(190) NOT NULL DEFAULT '',
            phone VARCHAR(40) NOT NULL DEFAULT '',
            role_title VARCHAR(190) NOT NULL DEFAULT '',
            role_owns VARCHAR(255) NOT NULL DEFAULT '',
            hours_month VARCHAR(40) NOT NULL DEFAULT '',
            status VARCHAR(20) NOT NULL DEFAULT 'invited',
            term_start DATE NULL,
            term_end DATE NULL,
            agreement_at DATETIME NULL,
            agreement_year VARCHAR(4) NOT NULL DEFAULT '',
            renewal_sent DATETIME NULL,
            renewal_stage VARCHAR(10) NOT NULL DEFAULT '',
            user_id BIGINT UNSIGNED NULL,
            role_email VARCHAR(190) NOT NULL DEFAULT '',
            token VARCHAR(64) NOT NULL DEFAULT '',
            bio TEXT NULL,
            photo_id BIGINT UNSIGNED NULL,
            sort INT NOT NULL DEFAULT 0,
            note TEXT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY tier (tier),
            KEY status (status),
            KEY email (email),
            KEY term_end (term_end)
        ) {$charset};");
    }
}
