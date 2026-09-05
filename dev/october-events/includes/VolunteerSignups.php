<?php
declare(strict_types=1);

namespace OE;

defined('ABSPATH') || exit;

/**
 * Volunteer signups storage (custom table) — §ADF volunteer model.
 *
 * Now that ADF owns volunteer signups end-to-end (replacing the Sign-up Sheets
 * plugin), each booking is a row here linking a person to a specific SHIFT of a
 * volunteer OPPORTUNITY (the adopted `volunteer` CPT post). Slot capacity is
 * enforced per shift. A custom table keeps slot-counting and reminder scans
 * cheap.
 */
final class VolunteerSignups {

    public const STATUS_PENDING   = 'pending';
    public const STATUS_CONFIRMED = 'confirmed';
    public const STATUS_DECLINED  = 'declined';
    public const STATUS_NO_SHOW   = 'no_show';
    // Set when a volunteer cancels their own shift via the link in their
    // confirmation email. Like 'declined', it frees the slot (count_for_shift
    // only counts pending+confirmed) but records that the VOLUNTEER pulled out.
    public const STATUS_CANCELLED = 'cancelled';

    public static function table(): string {
        global $wpdb;
        return $wpdb->prefix . 'oe_volunteer_signups';
    }

    public static function install(): void {
        global $wpdb;
        $table   = self::table();
        $charset = $wpdb->get_charset_collate();
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta("CREATE TABLE {$table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            opportunity_id BIGINT UNSIGNED NOT NULL,
            shift_id VARCHAR(40) NOT NULL,
            account_id BIGINT UNSIGNED NULL,
            name VARCHAR(190) NOT NULL,
            email VARCHAR(190) NOT NULL,
            phone VARCHAR(40) NULL,
            sms_opt_in TINYINT(1) NOT NULL DEFAULT 0,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            checked_in TINYINT(1) NOT NULL DEFAULT 0,
            shift_start DATETIME NULL,
            reminders_sent TEXT NULL,
            cancel_token VARCHAR(40) NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY  (id),
            KEY opportunity_shift (opportunity_id, shift_id),
            KEY email (email),
            KEY account_id (account_id),
            KEY shift_start (shift_start),
            KEY status (status),
            KEY cancel_token (cancel_token)
        ) {$charset};");
    }

    /**
     * Count active (pending + confirmed) signups for a shift.
     */
    public static function count_for_shift(int $opportunity_id, string $shift_id): int {
        global $wpdb;
        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM " . self::table() . "
             WHERE opportunity_id = %d AND shift_id = %s AND status IN ('pending','confirmed')",
            $opportunity_id,
            $shift_id
        ));
    }

    /**
     * @return array<int,object>
     */
    public static function for_shift(int $opportunity_id, string $shift_id): array {
        global $wpdb;
        return $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM " . self::table() . " WHERE opportunity_id = %d AND shift_id = %s ORDER BY id ASC",
            $opportunity_id,
            $shift_id
        )) ?: [];
    }

    /**
     * All signups for an opportunity (any shift, any status) — management view.
     *
     * @return array<int,object>
     */
    public static function for_opportunity(int $opportunity_id): array {
        global $wpdb;
        return $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM " . self::table() . " WHERE opportunity_id = %d ORDER BY shift_id ASC, id ASC",
            $opportunity_id
        )) ?: [];
    }

    /**
     * @return array<int,object>
     */
    public static function for_account(int $account_id): array {
        global $wpdb;
        return $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM " . self::table() . " WHERE account_id = %d ORDER BY shift_start ASC",
            $account_id
        )) ?: [];
    }

    /**
     * @return array<int,object>
     */
    public static function for_email(string $email): array {
        global $wpdb;
        return $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM " . self::table() . " WHERE email = %s ORDER BY shift_start ASC",
            $email
        )) ?: [];
    }

    public static function get(int $id): ?object {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare("SELECT * FROM " . self::table() . " WHERE id = %d", $id)) ?: null;
    }

    /** Find a signup by its (secret) cancel token, for the email cancel link. */
    public static function by_cancel_token(string $token): ?object {
        $token = trim($token);
        if ($token === '') {
            return null;
        }
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare("SELECT * FROM " . self::table() . " WHERE cancel_token = %s", $token)) ?: null;
    }

    public static function insert(array $row): int {
        global $wpdb;
        $row['created_at'] = current_time('mysql', true);
        $wpdb->insert(self::table(), $row);
        return (int) $wpdb->insert_id;
    }

    public static function update(int $id, array $data): void {
        global $wpdb;
        $wpdb->update(self::table(), $data, ['id' => $id]);
    }

    /**
     * Signups whose shift starts within [from, to] and are not declined.
     *
     * @return array<int,object>
     */
    public static function due_between(string $from, string $to): array {
        global $wpdb;
        return $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM " . self::table() . "
             WHERE status IN ('pending','confirmed')
               AND shift_start IS NOT NULL
               AND shift_start BETWEEN %s AND %s",
            $from,
            $to
        )) ?: [];
    }
}
