<?php
declare(strict_types=1);

namespace OE\Crew;

defined('ABSPATH') || exit;

/**
 * Planning-team / crew read + write model (CREW-MODULE.md, ADMIN-BUILD AD7).
 *
 * The lifecycle state machine lives here as plain data + transitions; the email
 * sends, login provisioning and offboarding live in {@see Lifecycle}, the
 * renewal cron in {@see Renewals}, and the public directory in {@see Render}.
 */
final class Crew {

    /** Involvement tiers (CREW-MODULE §1). Only planning gets automation. */
    public const TIER_VOLUNTEER = 'volunteer';
    public const TIER_PLANNING  = 'planning';
    public const TIER_COUNCIL   = 'council';
    public const TIER_BOARD     = 'board';

    /** Planning-team lifecycle statuses (CREW-MODULE §3). */
    public const STATUS_INVITED    = 'invited';    // offered, agreement not yet accepted
    public const STATUS_AGREED     = 'agreed';     // agreement accepted, not yet provisioned
    public const STATUS_ACTIVE     = 'active';     // serving the term
    public const STATUS_RENEWING   = 'renewing';   // renewal asked, awaiting reply
    public const STATUS_OFFBOARDED = 'offboarded'; // term ended, access revoked
    public const STATUS_OPEN       = 'open';       // the role is vacant / recruiting

    /** @return array<string,string> tier key => label */
    public static function tiers(): array {
        return [
            self::TIER_PLANNING  => __('Planning team', 'october-events'),
            self::TIER_COUNCIL   => __('Council', 'october-events'),
            self::TIER_BOARD     => __('Board', 'october-events'),
            self::TIER_VOLUNTEER => __('Festival volunteers', 'october-events'),
        ];
    }

    public static function tier_label(string $tier): string {
        return self::tiers()[$tier] ?? ucwords($tier);
    }

    /** Tiers with real lifecycle automation. Council/Board are directory-only. */
    public static function is_managed_tier(string $tier): bool {
        return $tier === self::TIER_PLANNING;
    }

    /** @return array<string,string> status key => label */
    public static function statuses(): array {
        return [
            self::STATUS_OPEN        => __('Open', 'october-events'),
            self::STATUS_INVITED     => __('Invited', 'october-events'),
            self::STATUS_AGREED      => __('Agreed', 'october-events'),
            self::STATUS_ACTIVE      => __('Active', 'october-events'),
            self::STATUS_RENEWING    => __('Renewing', 'october-events'),
            self::STATUS_OFFBOARDED  => __('Offboarded', 'october-events'),
        ];
    }

    public static function status_label(string $status): string {
        return self::statuses()[$status] ?? ucwords($status);
    }

    /** Pill color class for a status (reuses .oe-ad-pill modifiers). */
    public static function status_pill(string $status): string {
        switch ($status) {
            case self::STATUS_ACTIVE:    return 'pos';
            case self::STATUS_AGREED:    return 'info';
            case self::STATUS_INVITED:   return 'warn';
            case self::STATUS_RENEWING:  return 'warn';
            case self::STATUS_OPEN:      return 'info';
            default:                     return 'neu';
        }
    }

    /* ---------------------------------------------------------------- read */

    public static function get(int $id): ?object {
        global $wpdb;
        $t = Schema::table();
        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t} WHERE id = %d", $id));
        return $row ?: null;
    }

    public static function find_by_token(string $token): ?object {
        $token = trim($token);
        if ($token === '') {
            return null;
        }
        global $wpdb;
        $t = Schema::table();
        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$t} WHERE token = %s", $token));
        return $row ?: null;
    }

    /**
     * @param array{tier?:string,status?:string} $filters
     * @return array<int,object>
     */
    public static function all(array $filters = []): array {
        global $wpdb;
        $t = Schema::table();
        $where  = ['1=1'];
        $params = [];
        if (! empty($filters['tier'])) {
            $where[]  = 'tier = %s';
            $params[] = (string) $filters['tier'];
        }
        if (! empty($filters['status'])) {
            $where[]  = 'status = %s';
            $params[] = (string) $filters['status'];
        }
        $sql = "SELECT * FROM {$t} WHERE " . implode(' AND ', $where)
             . ' ORDER BY sort ASC, role_title ASC, name ASC';
        if ($params) {
            $sql = $wpdb->prepare($sql, $params);
        }
        return $wpdb->get_results($sql) ?: [];
    }

    /** All rows grouped by tier, in tier display order. @return array<string,array<int,object>> */
    public static function by_tier(): array {
        $out = [];
        foreach (array_keys(self::tiers()) as $tier) {
            $out[$tier] = [];
        }
        foreach (self::all() as $row) {
            $tier = (string) $row->tier;
            if (! isset($out[$tier])) {
                $out[$tier] = [];
            }
            $out[$tier][] = $row;
        }
        return $out;
    }

    /**
     * Headline numbers for the Team screen.
     *
     * @return array{total:int,planning:int,active:int,invited:int,agreements_out:int,renewals_due:int,open_roles:int,council:int,board:int}
     */
    public static function stats(): array {
        global $wpdb;
        $t   = Schema::table();
        $rows = $wpdb->get_results("SELECT tier, status, term_end FROM {$t}") ?: [];
        $s = [
            'total' => 0, 'planning' => 0, 'active' => 0, 'invited' => 0,
            'agreements_out' => 0, 'renewals_due' => 0, 'open_roles' => 0,
            'council' => 0, 'board' => 0,
        ];
        $soon = strtotime('+60 days', current_time('timestamp'));
        $now  = current_time('timestamp');
        foreach ($rows as $r) {
            $s['total']++;
            $tier = (string) $r->tier;
            if ($tier === self::TIER_PLANNING) { $s['planning']++; }
            if ($tier === self::TIER_COUNCIL)  { $s['council']++; }
            if ($tier === self::TIER_BOARD)    { $s['board']++; }
            switch ((string) $r->status) {
                case self::STATUS_ACTIVE:  $s['active']++; break;
                case self::STATUS_INVITED: $s['invited']++; break;
                case self::STATUS_OPEN:    $s['open_roles']++; break;
            }
            // Agreement outstanding: invited and not yet accepted.
            if ((string) $r->status === self::STATUS_INVITED) {
                $s['agreements_out']++;
            }
            // Renewal due: active planning role whose term ends within 60 days.
            if ($tier === self::TIER_PLANNING && (string) $r->status === self::STATUS_ACTIVE && $r->term_end) {
                $end = strtotime((string) $r->term_end);
                if ($end && $end <= $soon && $end >= $now - DAY_IN_SECONDS) {
                    $s['renewals_due']++;
                }
            }
        }
        return $s;
    }

    /* --------------------------------------------------------------- write */

    /** @param array<string,mixed> $data @return int new row id (0 on failure) */
    public static function insert(array $data): int {
        global $wpdb;
        $now  = current_time('mysql');
        $row  = self::sanitize($data);
        $row['token']      = self::new_token();
        $row['created_at'] = $now;
        $row['updated_at'] = $now;
        $ok = $wpdb->insert(Schema::table(), $row);
        return $ok ? (int) $wpdb->insert_id : 0;
    }

    /** @param array<string,mixed> $data */
    public static function update(int $id, array $data): bool {
        global $wpdb;
        $row = self::sanitize($data);
        $row['updated_at'] = current_time('mysql');
        return (bool) $wpdb->update(Schema::table(), $row, ['id' => $id]);
    }

    public static function delete(int $id): bool {
        global $wpdb;
        return (bool) $wpdb->delete(Schema::table(), ['id' => $id]);
    }

    /**
     * Whitelist + sanitize an incoming row. Only keys present in $data are
     * returned, so it suits both insert and partial update.
     *
     * @param array<string,mixed> $data
     * @return array<string,mixed>
     */
    private static function sanitize(array $data): array {
        $out = [];
        $map = [
            'tier'           => 'key',
            'name'           => 'text',
            'email'          => 'email',
            'phone'          => 'text',
            'role_title'     => 'text',
            'role_owns'      => 'text',
            'hours_month'    => 'text',
            'status'         => 'key',
            'term_start'     => 'date',
            'term_end'       => 'date',
            'agreement_year' => 'text',
            'renewal_stage'  => 'key',
            'role_email'     => 'email',
            'bio'            => 'textarea',
            'note'           => 'textarea',
            'sort'           => 'int',
            'user_id'        => 'int',
            'photo_id'       => 'int',
            'agreement_at'   => 'datetime',
            'renewal_sent'   => 'datetime',
            'token'          => 'text',
        ];
        foreach ($data as $k => $v) {
            if (! isset($map[$k])) {
                continue;
            }
            switch ($map[$k]) {
                case 'key':      $out[$k] = sanitize_key((string) $v); break;
                case 'text':     $out[$k] = sanitize_text_field((string) $v); break;
                case 'textarea': $out[$k] = sanitize_textarea_field((string) $v); break;
                case 'email':    $out[$k] = ($v === '' || $v === null) ? '' : sanitize_email((string) $v); break;
                case 'int':      $out[$k] = ($v === '' || $v === null) ? null : (int) $v; break;
                case 'date':     $out[$k] = self::clean_date((string) $v); break;
                case 'datetime': $out[$k] = ($v === '' || $v === null) ? null : (string) $v; break;
            }
        }
        if (isset($out['email'])) {
            $out['email'] = strtolower((string) $out['email']);
        }
        return $out;
    }

    private static function clean_date(string $v): ?string {
        $v = trim($v);
        if ($v === '') {
            return null;
        }
        $ts = strtotime($v);
        return $ts ? gmdate('Y-m-d', $ts) : null;
    }

    public static function new_token(): string {
        return wp_generate_password(32, false, false);
    }

    /* ---------------------------------------------------- transitions ---- */

    public static function mark_agreed(int $id): bool {
        return self::update($id, [
            'status'         => self::STATUS_AGREED,
            'agreement_at'   => current_time('mysql'),
            'agreement_year' => gmdate('Y'),
        ]);
    }

    public static function mark_active(int $id): bool {
        return self::update($id, ['status' => self::STATUS_ACTIVE]);
    }

    public static function mark_renewing(int $id, string $stage): bool {
        return self::update($id, [
            'status'        => self::STATUS_RENEWING,
            'renewal_sent'  => current_time('mysql'),
            'renewal_stage' => $stage,
        ]);
    }

    /** Extend the term by a year and return to active (renewal accepted). */
    public static function renew(int $id): bool {
        $row = self::get($id);
        if (! $row) {
            return false;
        }
        $base = $row->term_end ? strtotime((string) $row->term_end) : current_time('timestamp');
        $new_end = gmdate('Y-m-d', strtotime('+1 year', $base ?: current_time('timestamp')));
        return self::update($id, [
            'status'        => self::STATUS_ACTIVE,
            'term_start'    => $row->term_end ?: gmdate('Y-m-d'),
            'term_end'      => $new_end,
            'renewal_stage' => '',
            'renewal_sent'  => null,
        ]);
    }

    /** Offboard: clear the login link and flip to offboarded. */
    public static function mark_offboarded(int $id): bool {
        return self::update($id, [
            'status'  => self::STATUS_OFFBOARDED,
            'user_id' => null,
        ]);
    }

    /** Reopen a vacated role so the recruit page lists it again. */
    public static function reopen(int $id): bool {
        $row = self::get($id);
        if (! $row) {
            return false;
        }
        // Keep the role definition, blank the person.
        return self::update($id, [
            'status'       => self::STATUS_OPEN,
            'name'         => '',
            'email'        => '',
            'phone'        => '',
            'user_id'      => null,
            'agreement_at' => null,
            'term_start'   => null,
            'term_end'     => null,
            'bio'          => '',
            'photo_id'     => null,
        ]);
    }
}
