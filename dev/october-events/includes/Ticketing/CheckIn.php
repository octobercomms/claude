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
    public static function scan(string $token, int $event_id, string $venue): array {
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

        global $wpdb;
        $venue = sanitize_text_field($venue);
        $already = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM " . Schema::checkins() . " WHERE ticket_id = %d AND venue_name = %s",
            $ticket->id,
            $venue
        )) > 0;

        $wpdb->insert(Schema::checkins(), [
            'ticket_id'  => (int) $ticket->id,
            'event_id'   => $event_id,
            'venue_name' => $venue,
            'scanned_at' => current_time('mysql', true),
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
        ];
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
        return ['unique' => $unique, 'venues' => array_map(static fn($r) => ['venue' => $r->venue, 'count' => (int) $r->count], $rows)];
    }
}
