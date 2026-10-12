<?php
declare(strict_types=1);

namespace OE\Reports;

use OE\Ticketing\Schema;

defined('ABSPATH') || exit;

/**
 * End-of-event report (BUILD-PLAN M7). Read-only aggregation over the ticketing
 * tables for a single event: tickets sold vs comp, revenue net of discounts,
 * check-in rate, promo breakdown, waitlist and cart conversion. No new capture —
 * it reads data the plugin already owns.
 */
final class EventReport {

    /**
     * @return array<string,mixed> the report figures for one event.
     */
    public static function for_event(int $event_id): array {
        global $wpdb;
        $o = Schema::orders();
        $t = Schema::tickets();
        $c = Schema::checkins();
        $w = Schema::waitlist();
        $a = Schema::abandoned();

        $paid = $wpdb->get_row($wpdb->prepare(
            "SELECT COUNT(*) AS orders, COALESCE(SUM(qty),0) AS tickets,
                    COALESCE(SUM(total),0) AS revenue, COALESCE(SUM(discount_amount),0) AS discount,
                    COALESCE(SUM(CASE WHEN total = 0 THEN qty ELSE 0 END),0) AS comp
             FROM {$o} WHERE event_id = %d AND status = 'paid'",
            $event_id
        ));

        $issued = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$t} WHERE event_id = %d AND status = 'active'",
            $event_id
        ));
        $checked_in = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(DISTINCT ticket_id) FROM {$c} WHERE event_id = %d",
            $event_id
        ));

        $promos = $wpdb->get_results($wpdb->prepare(
            "SELECT promo_code AS code, COUNT(*) AS orders, COALESCE(SUM(discount_amount),0) AS discount
             FROM {$o} WHERE event_id = %d AND status = 'paid' AND promo_code IS NOT NULL AND promo_code <> ''
             GROUP BY promo_code ORDER BY orders DESC",
            $event_id
        )) ?: [];

        $wl = $wpdb->get_row($wpdb->prepare(
            "SELECT COUNT(*) AS total, COALESCE(SUM(notified_at IS NOT NULL),0) AS notified,
                    COALESCE(SUM(status = 'converted'),0) AS converted
             FROM {$w} WHERE event_id = %d",
            $event_id
        ));

        $carts = $wpdb->get_row($wpdb->prepare(
            "SELECT COUNT(*) AS started, COALESCE(SUM(status = 'recovered'),0) AS recovered
             FROM {$a} WHERE event_id = %d",
            $event_id
        ));

        $tickets = (int) ($paid->tickets ?? 0);
        $comp    = (int) ($paid->comp ?? 0);
        $started = (int) ($carts->started ?? 0);

        $survey = self::survey($event_id, $issued);

        return [
            'event_id'      => $event_id,
            'orders'        => (int) ($paid->orders ?? 0),
            'tickets'       => $tickets,
            'comp'          => $comp,
            'paid_tickets'  => max(0, $tickets - $comp),
            'revenue'       => (float) ($paid->revenue ?? 0),
            'discount'      => (float) ($paid->discount ?? 0),
            'issued'        => $issued,
            'checked_in'    => $checked_in,
            'checkin_rate'  => $issued > 0 ? round($checked_in / $issued * 100, 1) : 0.0,
            'promos'        => array_map(static fn($p): array => [
                'code'     => (string) $p->code,
                'orders'   => (int) $p->orders,
                'discount' => (float) $p->discount,
            ], $promos),
            'waitlist'      => [
                'total'     => (int) ($wl->total ?? 0),
                'notified'  => (int) ($wl->notified ?? 0),
                'converted' => (int) ($wl->converted ?? 0),
            ],
            'carts'         => [
                'started'    => $started,
                'recovered'  => (int) ($carts->recovered ?? 0),
                'conversion' => $started > 0 ? round((int) ($carts->recovered ?? 0) / $started * 100, 1) : 0.0,
            ],
            'survey'        => $survey,
        ];
    }

    /**
     * Post-event survey summary (BUILD-PLAN M7 extension): completed / started
     * counts and the response rate against tickets issued. Read-only; returns
     * zeros when the survey table is absent (survey never installed) so the
     * report never fatals on a site that does not run surveys.
     *
     * @return array{complete:int,partial:int,total:int,response_rate:float}
     */
    private static function survey(int $event_id, int $issued): array {
        global $wpdb;
        $t = \OE\Survey\Schema::table();
        if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $t)) !== $t) {
            return ['complete' => 0, 'partial' => 0, 'total' => 0, 'response_rate' => 0.0];
        }
        $complete = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$t} WHERE event_id = %d AND status = 'complete'", $event_id));
        $partial  = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM {$t} WHERE event_id = %d AND status = 'partial'", $event_id));
        return [
            'complete'      => $complete,
            'partial'       => $partial,
            'total'         => $complete + $partial,
            'response_rate' => $issued > 0 ? round($complete / $issued * 100, 1) : 0.0,
        ];
    }
}
