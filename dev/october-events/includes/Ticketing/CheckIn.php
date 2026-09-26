<?php
declare(strict_types=1);

namespace OE\Ticketing;

use OE\PostTypes;
use OE\AuditLog;

defined('ABSPATH') || exit;

/**
 * Door check-in logic for the scanning PWA.
 *
 * Access is PIN-gated (per event), not WP-login gated, so door staff can use it
 * on their own phones. Every scan is logged; a repeat scan at the same venue is
 * flagged "already" but still recorded (advisory, matching the proven model).
 */
final class CheckIn {

    /**
     * A built-in, always-available test event so staff can verify the scanner
     * any time without real tickets. It is virtual — never written to the DB and
     * never public/indexed: scanning the test QR just returns a green "valid".
     * The id is a high sentinel that won't collide with a real event post.
     */
    public const TEST_EVENT_ID = 9999999;
    public const TEST_PIN      = '0000';
    public const TEST_TOKEN    = 'OE-TEST-TICKET';

    /** Events that have ticket types (for the PWA event picker). */
    public static function events(): array {
        $events = get_posts([
            'post_type'      => PostTypes::slug('event'),
            'post_status'    => 'publish',
            'posts_per_page' => 200,
            'orderby'        => 'title',
            'order'          => 'ASC',
        ]);
        // Test event always first, so there's a standing scanner check.
        $out = [['id' => self::TEST_EVENT_ID, 'title' => '🧪 ' . __('Test (scanner check)', 'october-events')]];
        foreach ($events as $ev) {
            if (TicketTypes::types($ev->ID)) {
                $out[] = ['id' => $ev->ID, 'title' => get_the_title($ev)];
            }
        }
        return $out;
    }

    public static function pin_ok(int $event_id, string $pin): bool {
        if ($event_id === self::TEST_EVENT_ID) {
            return trim($pin) === self::TEST_PIN;
        }
        $stored = TicketTypes::pin($event_id);
        return $stored !== '' && hash_equals($stored, trim($pin));
    }

    /** @return string[] */
    public static function venues(int $event_id): array {
        if ($event_id === self::TEST_EVENT_ID) {
            return ['Test door'];
        }
        return array_values(array_filter(array_map(
            static fn($v) => (string) ($v['name'] ?? ''),
            TicketTypes::venues($event_id)
        )));
    }

    /**
     * Validate + record a scan.
     *
     * @return array{status:string,attendee?:string,type?:string,count?:int}
     */
    public static function scan(string $token, int $event_id, string $venue, ?string $scanned_at = null): array {
        // Built-in test event: validate the test QR, record nothing.
        if ($event_id === self::TEST_EVENT_ID) {
            return $token === self::TEST_TOKEN
                ? ['status' => 'valid', 'attendee' => __('Test Attendee', 'october-events'), 'type' => __('Test ticket', 'october-events'), 'count' => 1]
                : ['status' => 'invalid'];
        }
        $ticket = Orders::ticket_by_token($token);
        if (! $ticket || $ticket->status !== 'active') {
            return ['status' => 'invalid'];
        }
        if ((int) $ticket->event_id !== $event_id) {
            return ['status' => 'wrong_event'];
        }
        return self::record($ticket, $event_id, $venue, $scanned_at);
    }

    /**
     * Manual check-in by ticket id — the name-lookup path, for a guest with no
     * QR to scan. Online only (no offline manifest lookup). Same validation,
     * venue policy, dedup and result shape as a scan.
     *
     * @return array{status:string,attendee?:string,type?:string,count?:int}
     */
    public static function scan_ticket(int $ticket_id, int $event_id, string $venue): array {
        $ticket = Orders::ticket_get($ticket_id);
        if (! $ticket || $ticket->status !== 'active') {
            return ['status' => 'invalid'];
        }
        if ((int) $ticket->event_id !== $event_id) {
            return ['status' => 'wrong_event'];
        }
        return self::record($ticket, $event_id, $venue, null);
    }

    /**
     * Shared check-in core: venue policy, same-door dedup, insert + audit. Called
     * with an already-resolved, active, in-event ticket by both scan() (token)
     * and scan_ticket() (manual by id).
     *
     * @return array{status:string,attendee?:string,type?:string,count?:int}
     */
    private static function record(object $ticket, int $event_id, string $venue, ?string $scanned_at): array {
        global $wpdb;
        $venue = sanitize_text_field($venue);

        // Venue-scoped ticket types (e.g. a Serenbe-only ticket) are valid only at
        // their listed doors. Resolve the ticket's type via its order and reject at
        // any other door — no check-in is recorded, so stats stay clean.
        $type_key = (string) $wpdb->get_var($wpdb->prepare(
            "SELECT o.ticket_type_key FROM " . Schema::orders() . " o
             INNER JOIN " . Schema::tickets() . " t ON t.order_id = o.id WHERE t.id = %d",
            (int) $ticket->id
        ));
        if ($type_key !== '') {
            $type = TicketTypes::type($event_id, $type_key);
            if ($type && ! TicketTypes::venue_ok($type, $venue)) {
                return ['status' => 'wrong_venue', 'type' => (string) $ticket->ticket_type_label];
            }
        }
        $prior = $wpdb->get_row($wpdb->prepare(
            "SELECT COUNT(*) AS n, MIN(scanned_at) AS first_at FROM " . Schema::checkins() . " WHERE ticket_id = %d AND venue_name = %s",
            $ticket->id,
            $venue
        ));
        $already = $prior && (int) $prior->n > 0;

        // Already scanned at this door. Unless the event allows re-entry, block it —
        // a shared ticket must not get a second person in. Nothing is recorded, so
        // the admission count stays honest; the attempt is logged for the door
        // history. A DIFFERENT door is still a fresh valid check-in above.
        if ($already && ! TicketTypes::reentry_allowed($event_id)) {
            AuditLog::record('ticket_reentry_blocked', (int) $ticket->id, 'ticket', $venue);
            return [
                'status'   => 'blocked',
                'attendee' => (string) $ticket->attendee_name,
                'type'     => (string) $ticket->ticket_type_label,
                'count'    => (int) $prior->n,
                'first_at' => (string) ($prior->first_at ?? ''),
            ];
        }

        $wpdb->insert(Schema::checkins(), [
            'ticket_id'  => (int) $ticket->id,
            'event_id'   => $event_id,
            'venue_name' => $venue,
            // Offline scans carry the time they actually happened (synced later).
            'scanned_at' => $scanned_at ?: current_time('mysql', true),
        ]);
        AuditLog::record('ticket_checked_in', (int) $ticket->id, 'ticket', $venue);

        $count = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM " . Schema::checkins() . " WHERE ticket_id = %d",
            $ticket->id
        ));

        return [
            'status'   => $already ? 'already' : 'valid',
            'attendee' => (string) $ticket->attendee_name,
            'type'     => (string) $ticket->ticket_type_label,
            'count'    => $count,
            // So the manual (name-lookup) path can mark this ticket in the client's
            // offline cache — it has no scanned token to hash itself. The hash is
            // already shipped in the manifest, so exposing it here leaks nothing.
            'token_hash' => self::token_hash((string) $ticket->token),
        ];
    }

    /**
     * Search an event's active tickets by attendee/buyer name or email, for the
     * manual (name-lookup) check-in when a guest has no QR. Each result carries
     * its live check-in state so staff can see who is already in.
     *
     * @return array<int,array{id:int,attendee:string,type:string,checked_in:bool,venues:array<int,string>}>
     */
    public static function search(int $event_id, string $q, int $limit = 25): array {
        global $wpdb;
        $q = trim($q);
        if ($event_id <= 0 || mb_strlen($q) < 2) {
            return [];
        }
        $t = Schema::tickets();
        $o = Schema::orders();
        $c = Schema::checkins();
        $like = '%' . $wpdb->esc_like($q) . '%';
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT ti.id, ti.attendee_name, ti.ticket_type_label, o.name AS buyer
             FROM {$t} ti INNER JOIN {$o} o ON ti.order_id = o.id
             WHERE ti.event_id = %d AND ti.status = 'active'
               AND (ti.attendee_name LIKE %s OR ti.attendee_email LIKE %s
                    OR o.name LIKE %s OR o.email LIKE %s)
             ORDER BY ti.attendee_name ASC, ti.id ASC
             LIMIT %d",
            $event_id, $like, $like, $like, $like, max(1, min(100, $limit))
        )) ?: [];
        if (! $rows) {
            return [];
        }
        // Doors each matched ticket has already been scanned at, in one query.
        $ids   = array_map(static fn($r) => (int) $r->id, $rows);
        $place = implode(',', array_fill(0, count($ids), '%d'));
        $scans = $wpdb->get_results($wpdb->prepare(
            "SELECT ticket_id, venue_name FROM {$c} WHERE ticket_id IN ($place) ORDER BY id ASC",
            ...$ids
        )) ?: [];
        $venues_by = [];
        foreach ($scans as $s) {
            $venues_by[(int) $s->ticket_id][] = (string) $s->venue_name;
        }
        $out = [];
        foreach ($rows as $r) {
            $venues = array_values(array_unique($venues_by[(int) $r->id] ?? []));
            $out[] = [
                'id'         => (int) $r->id,
                'attendee'   => (string) ((string) $r->attendee_name !== '' ? $r->attendee_name : $r->buyer),
                'type'       => (string) $r->ticket_type_label,
                'checked_in' => ! empty($venues),
                'venues'     => $venues,
            ];
        }
        return $out;
    }

    /**
     * Offline manifest for the scanner: every valid token for an event plus the
     * tokens already checked in. The PWA caches this on PIN entry so it can keep
     * validating (and flagging repeats) when the venue Wi-Fi drops. Small by
     * design — a few KB even at ~1,000 tickets.
     *
     * @return array{tickets:array<int,array{token:string,attendee:string,type:string}>,checked_in:array<int,array{token_hash:string,venue:string}>,generated:string}
     */
    public static function manifest(int $event_id): array {
        if ($event_id === self::TEST_EVENT_ID) {
            return [
                'tickets'    => [[
                    'token_hash' => self::token_hash(self::TEST_TOKEN),
                    'attendee'   => __('Test Attendee', 'october-events'),
                    'type'       => __('Test ticket', 'october-events'),
                ]],
                'checked_in' => [],
                'reentry'    => true, // the scanner-check test ticket never blocks
                'generated'  => current_time('mysql', true),
            ];
        }
        global $wpdb;
        $t = Schema::tickets();
        $c = Schema::checkins();
        $o = Schema::orders();
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT ti.token, ti.attendee_name, ti.ticket_type_label, o.ticket_type_key
             FROM {$t} ti INNER JOIN {$o} o ON ti.order_id = o.id
             WHERE ti.event_id = %d AND ti.status = 'active'",
            $event_id
        )) ?: [];
        // Per-type door restrictions (empty list = valid at every door), so the
        // offline scanner can reject a wrong-door scan without the network.
        $type_venues = [];
        foreach (TicketTypes::types($event_id) as $tt) {
            $type_venues[(string) $tt['key']] = TicketTypes::type_venues($tt);
        }
        // Tokens are the admission credential, so the manifest ships only their
        // SHA-256 hash — the scanner hashes the scanned QR and matches locally.
        // A leaked manifest can no longer forge/clone tickets.
        $tickets = array_map(static fn($r) => [
            'token_hash' => self::token_hash((string) $r->token),
            'attendee'   => (string) $r->attendee_name,
            'type'       => (string) $r->ticket_type_label,
            'venues'     => $type_venues[(string) $r->ticket_type_key] ?? [],
        ], $rows);
        // Tokens already scanned, paired with the door — so an offline device flags
        // a repeat only at the *same* door (a new door is a fresh valid check-in,
        // matching the online behaviour). Token is shipped hashed, never raw.
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT DISTINCT t.token AS token, c.venue_name AS venue FROM {$c} c INNER JOIN {$t} t ON t.id = c.ticket_id WHERE c.event_id = %d",
            $event_id
        )) ?: [];
        $checked = array_map(static fn($r) => [
            'token_hash' => self::token_hash((string) $r->token),
            'venue'      => (string) $r->venue,
        ], $rows);
        return [
            'tickets'    => $tickets,
            'checked_in' => $checked,
            // So an offline scanner enforces the same door policy: false = block a
            // repeat at the same door, true = allow re-entry (advisory flag only).
            'reentry'    => TicketTypes::reentry_allowed($event_id),
            'generated'  => current_time('mysql', true),
        ];
    }

    /** SHA-256 of a ticket token, hex — matches the scanner's crypto.subtle hash. */
    public static function token_hash(string $token): string {
        return hash('sha256', $token);
    }

    /**
     * Paginated check-in log (most recent first), optionally for one event.
     * Joined with the ticket for attendee/type/number context.
     *
     * @return array<int,object>
     */
    public static function log(int $event_id = 0, int $limit = 50, int $offset = 0): array {
        global $wpdb;
        $c = Schema::checkins();
        $t = Schema::tickets();
        $cols = "c.id, c.event_id, c.venue_name, c.scanned_at, c.ticket_id,
                 t.attendee_name, t.ticket_type_label, t.ticket_number, t.total_in_order";
        $sql = "SELECT {$cols} FROM {$c} c LEFT JOIN {$t} t ON t.id = c.ticket_id ";
        $limit  = max(1, min(200, $limit));
        $offset = max(0, $offset);
        if ($event_id > 0) {
            return $wpdb->get_results($wpdb->prepare(
                $sql . "WHERE c.event_id = %d ORDER BY c.id DESC LIMIT %d OFFSET %d",
                $event_id, $limit, $offset
            )) ?: [];
        }
        return $wpdb->get_results($wpdb->prepare(
            $sql . "ORDER BY c.id DESC LIMIT %d OFFSET %d",
            $limit, $offset
        )) ?: [];
    }

    /** Total number of recorded scans (optionally for one event). */
    public static function log_total(int $event_id = 0): int {
        global $wpdb;
        $c = Schema::checkins();
        if ($event_id > 0) {
            return (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$c} WHERE event_id = %d", $event_id));
        }
        return (int) $wpdb->get_var("SELECT COUNT(*) FROM {$c}");
    }

    /**
     * Shared SELECT … FROM … JOIN prefix for the collapsed (ticket × door)
     * check-in log, used by both the paginated view and the CSV export so the
     * column list stays in one place. Callers append their own WHERE / GROUP BY
     * / ORDER BY (the aliases `c` and `t` are in scope for those clauses).
     */
    private static function log_grouped_select(): string {
        $c = Schema::checkins();
        $t = Schema::tickets();
        // MAX() on the per-ticket columns keeps ONLY_FULL_GROUP_BY happy — they're
        // constant for a ticket_id, so any aggregate returns the right value.
        return "SELECT c.event_id, c.venue_name, c.ticket_id,
                 COUNT(*) AS scans, (COUNT(*) - 1) AS rescans,
                 MIN(c.scanned_at) AS first_at, MAX(c.scanned_at) AS last_at,
                 MAX(t.attendee_name) AS attendee_name, MAX(t.ticket_type_label) AS ticket_type_label,
                 MAX(t.ticket_number) AS ticket_number, MAX(t.total_in_order) AS total_in_order
                 FROM {$c} c LEFT JOIN {$t} t ON t.id = c.ticket_id ";
    }

    /**
     * Paginated check-in log collapsed to one row per ticket + door: a second
     * scan of the same ticket at the same door isn't a new line, it bumps a
     * "rescans" count. Scanning at a *different* door is a separate row. Ordered
     * by most recent scan first.
     *
     * @return array<int,object> {event_id, venue_name, ticket_id, scans, rescans,
     *                            first_at, last_at, attendee_name, ticket_type_label,
     *                            ticket_number, total_in_order}
     */
    public static function log_grouped(int $event_id = 0, int $limit = 50, int $offset = 0): array {
        global $wpdb;
        $limit  = max(1, min(200, $limit));
        $offset = max(0, $offset);
        $sql = self::log_grouped_select();
        $group = "GROUP BY c.event_id, c.venue_name, c.ticket_id ORDER BY last_at DESC LIMIT %d OFFSET %d";
        if ($event_id > 0) {
            return $wpdb->get_results($wpdb->prepare(
                $sql . "WHERE c.event_id = %d " . $group,
                $event_id, $limit, $offset
            )) ?: [];
        }
        return $wpdb->get_results($wpdb->prepare($sql . $group, $limit, $offset)) ?: [];
    }

    /** Number of collapsed (ticket × door) log rows — for pagination. */
    public static function log_groups_total(int $event_id = 0): int {
        global $wpdb;
        $c = Schema::checkins();
        $inner = "SELECT 1 FROM {$c} c ";
        $grp = "GROUP BY c.event_id, c.venue_name, c.ticket_id";
        if ($event_id > 0) {
            return (int) $wpdb->get_var($wpdb->prepare(
                "SELECT COUNT(*) FROM ({$inner} WHERE c.event_id = %d {$grp}) x",
                $event_id
            ));
        }
        return (int) $wpdb->get_var("SELECT COUNT(*) FROM ({$inner} {$grp}) x");
    }

    /**
     * Scan counts per event + door, for the "events split out by doors" chart.
     * Most-scanned door first within each event.
     *
     * @return array<int,object> {event_id, venue, scans}
     */
    public static function scans_by_event_venue(int $event_id = 0): array {
        global $wpdb;
        $c = Schema::checkins();
        if ($event_id > 0) {
            return $wpdb->get_results($wpdb->prepare(
                "SELECT event_id, venue_name AS venue, COUNT(*) AS scans FROM {$c}
                 WHERE event_id = %d GROUP BY event_id, venue_name ORDER BY scans DESC",
                $event_id
            )) ?: [];
        }
        return $wpdb->get_results(
            "SELECT event_id, venue_name AS venue, COUNT(*) AS scans FROM {$c}
             GROUP BY event_id, venue_name ORDER BY event_id ASC, scans DESC"
        ) ?: [];
    }

    /**
     * Scans bucketed into short segments across only the window in which people
     * actually checked in (first scan → last scan), so the chart grows or shrinks
     * to the real hours instead of always showing a full day. The step widens
     * automatically for long windows (15m ≤12h, 30m ≤24h, 60m ≤4d, else 4h).
     * scanned_at is stored as a UTC wall-clock string; each bucket is converted to
     * the site timezone for its label.
     *
     * @return array{slots:array<int,array{label:string,day:string,count:int}>,step:int,multi_day:bool}
     */
    public static function scans_by_slot(int $event_id = 0): array {
        global $wpdb;
        $c = Schema::checkins();
        // LEFT(scanned_at,13) = "YYYY-MM-DD HH" (UTC), tz-safe and no % to clash
        // with $wpdb->prepare; MINUTE()/15 splits the hour into four 15-min slots.
        $sql = "SELECT LEFT(scanned_at, 13) AS ymdh, FLOOR(MINUTE(scanned_at) / 15) AS q, COUNT(*) AS scans FROM {$c} ";
        if ($event_id > 0) {
            $rows = $wpdb->get_results($wpdb->prepare($sql . "WHERE event_id = %d GROUP BY ymdh, q", $event_id)) ?: [];
        } else {
            $rows = $wpdb->get_results($sql . "GROUP BY ymdh, q") ?: [];
        }
        if (! $rows) {
            return ['slots' => [], 'step' => 15, 'multi_day' => false];
        }
        $utc = new \DateTimeZone('UTC');
        $counts = []; // UTC 15-min slot epoch => count
        $min = PHP_INT_MAX; $max = PHP_INT_MIN;
        foreach ($rows as $r) {
            $dt = \DateTimeImmutable::createFromFormat('Y-m-d H', (string) $r->ymdh, $utc);
            if (! $dt) { continue; }
            $epoch = $dt->getTimestamp() + ((int) $r->q) * 900;
            $counts[$epoch] = ($counts[$epoch] ?? 0) + (int) $r->scans;
            $min = min($min, $epoch);
            $max = max($max, $epoch);
        }
        if (! $counts) {
            return ['slots' => [], 'step' => 15, 'multi_day' => false];
        }
        $span = $max - $min;
        $step = 900;                                  // 15 min
        if ($span > 12 * HOUR_IN_SECONDS) { $step = 1800; }   // 30 min
        if ($span > DAY_IN_SECONDS)       { $step = 3600; }   // 60 min
        if ($span > 4 * DAY_IN_SECONDS)   { $step = 4 * 3600; }
        // Hard cap on bar count so a very long span (e.g. "All events" across a
        // year) can't build thousands of buckets — widen the step to fit.
        $max_bars = 240;
        if ((int) ($span / $step) + 1 > $max_bars) {
            $step = (int) (ceil(($span / $max_bars) / 900) * 900); // round up to whole 15-min steps
        }
        // Re-bucket to the chosen step, aligned to the step grid.
        $buckets = [];
        foreach ($counts as $epoch => $n) {
            $b = (int) (floor($epoch / $step) * $step);
            $buckets[$b] = ($buckets[$b] ?? 0) + $n;
        }
        $tz    = wp_timezone();
        $start = (int) (floor($min / $step) * $step);
        $end   = (int) (floor($max / $step) * $step);
        $slots = [];
        $first_day = ''; $last_day = '';
        for ($t = $start; $t <= $end; $t += $step) {
            $local = (new \DateTimeImmutable('@' . $t))->setTimezone($tz);
            $day   = $local->format('D j M');
            if ($first_day === '') { $first_day = $day; }
            $last_day = $day;
            $slots[] = [
                'label' => $local->format('g:i a'),
                'day'   => $day,
                'count' => (int) ($buckets[$t] ?? 0),
            ];
        }
        return ['slots' => $slots, 'step' => (int) ($step / 60), 'multi_day' => $first_day !== $last_day];
    }

    /** Every collapsed (ticket × door) log row for an event, unpaginated — for CSV export. */
    public static function log_grouped_export(int $event_id = 0): array {
        global $wpdb;
        $sql   = self::log_grouped_select();
        $group = "GROUP BY c.event_id, c.venue_name, c.ticket_id ORDER BY c.event_id ASC, first_at ASC";
        if ($event_id > 0) {
            return $wpdb->get_results($wpdb->prepare($sql . "WHERE c.event_id = %d " . $group, $event_id)) ?: [];
        }
        return $wpdb->get_results($sql . $group) ?: [];
    }

    /**
     * @return array{unique:int,venues:array<int,array{venue:string,count:int}>}
     */
    public static function stats(int $event_id): array {
        if ($event_id === self::TEST_EVENT_ID) {
            return ['unique' => 0, 'venues' => []];
        }
        global $wpdb;
        $c = Schema::checkins();
        $unique = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(DISTINCT ticket_id) FROM {$c} WHERE event_id = %d",
            $event_id
        ));
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT venue_name AS venue, COUNT(*) AS count FROM {$c} WHERE event_id = %d GROUP BY venue_name",
            $event_id
        )) ?: [];
        return [
            'unique' => $unique,
            'venues' => array_map(static fn($r) => ['venue' => $r->venue, 'count' => (int) $r->count], $rows),
            // Door-side ticket sales, grouped by the venue they were sold at.
            'door_sales' => \OE\Ticketing\Orders::sold_by_door($event_id),
        ];
    }
}
