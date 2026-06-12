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

    /** Events that have ticket types (for the PWA event picker). */
    public static function events(): array {
        $events = get_posts([
            'post_type'      => PostTypes::slug('event'),
            'post_status'    => 'publish',
            'posts_per_page' => 200,
            'orderby'        => 'title',
            'order'          => 'ASC',
        ]);
        $out = [];
        foreach ($events as $ev) {
            if (TicketTypes::types($ev->ID)) {
                $out[] = ['id' => $ev->ID, 'title' => get_the_title($ev)];
            }
        }
        return $out;
    }

    public static function pin_ok(int $event_id, string $pin): bool {
        $stored = TicketTypes::pin($event_id);
        return $stored !== '' && hash_equals($stored, trim($pin));
    }

    /** @return string[] */
    public static function venues(int $event_id): array {
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
     * @return array{unique:int,venues:array<int,array{venue:string,count:int}>}
     */
    public static function stats(int $event_id): array {
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
