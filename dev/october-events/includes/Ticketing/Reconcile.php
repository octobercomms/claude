<?php
declare(strict_types=1);

namespace OE\Ticketing;

use OE\Connectors\StripeConnector;

defined('ABSPATH') || exit;

/**
 * Reconcile paid ticket PaymentIntents against local orders.
 *
 * The Stripe webhook (payment_intent.succeeded → order + emailed ticket) is the
 * source of truth, but a delivery can be missed while an endpoint is down. This
 * sweep is the safety net: it lists every succeeded ticket intent in a window
 * and flags any that never produced an order, optionally rebuilding the missing
 * ones from the intent's own metadata (idempotent, so a webhook that later
 * retries won't duplicate).
 */
final class Reconcile {

    public const LAST_OPTION = 'oe_reconcile_last';

    /**
     * @return array{
     *   days:int, checked:int, matched:int, other_site:int,
     *   orphans:array<int,array{id:string,created:int,amount_cents:int,currency:string,email:string,event:string,repaired:bool}>,
     *   repaired:int, partial:bool, ran_at:int, ready:bool
     * }
     */
    public static function run(int $days = 14, bool $backfill = false): array {
        $result = [
            'days'       => max(1, min(90, $days)),
            'checked'    => 0,
            'matched'    => 0,
            'other_site' => 0,
            'orphans'    => [],
            'repaired'   => 0,
            'partial'    => false,
            'ran_at'     => time(),
            'ready'      => StripeConnector::is_ready(),
        ];
        if (! $result['ready']) {
            return $result;
        }

        $sweep = StripeConnector::succeeded_ticket_intents($result['days']);
        $result['partial'] = (bool) $sweep['partial'];

        foreach ($sweep['intents'] as $pi) {
            // Both October sites share one Stripe account, so the sweep sees the
            // other site's ticket payments too. Only reconcile this site's own.
            if (! OrderFactory::belongs_here((array) $pi['meta'])) {
                $result['other_site']++;
                continue;
            }
            $result['checked']++;
            $id = (string) $pi['id'];
            if (Orders::by_payment($id)) {
                $result['matched']++;
                continue;
            }

            $repaired = false;
            if ($backfill) {
                $order = OrderFactory::from_intent_meta($id, (array) $pi['meta'], (int) $pi['amount_cents']);
                if ($order !== null) {
                    $repaired = true;
                    $result['repaired']++;
                }
            }

            $event_id = (int) $pi['event_id'];
            $result['orphans'][] = [
                'id'           => $id,
                'created'      => (int) $pi['created'],
                'amount_cents' => (int) $pi['amount_cents'],
                'currency'     => (string) $pi['currency'],
                'email'        => (string) $pi['email'],
                'event'        => $event_id ? (string) get_the_title($event_id) : '',
                'repaired'     => $repaired,
            ];
        }

        update_option(self::LAST_OPTION, $result, false);
        return $result;
    }

    /** The last stored reconciliation result, or null if it never ran. */
    public static function last(): ?array {
        $v = get_option(self::LAST_OPTION);
        return is_array($v) ? $v : null;
    }
}
