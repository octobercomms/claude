<?php
declare(strict_types=1);

namespace OE\Ticketing;

use OE\Connectors\StripeConnector;
use OE\Account;
use OE\Settings;
use OE\AuditLog;
use OE\Logger;

defined('ABSPATH') || exit;

/**
 * Orders + tickets service. One order = one ticket type × qty; it generates
 * qty × qty_per_purchase admission tickets, each with a unique 64-hex token.
 *
 * Handles public (paid) creation, admin manual/comp creation, cancellation and
 * full Stripe refunds, and the confirmation email. Idempotent on payment_id.
 */
final class Orders {

    public static function get(int $id): ?object {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare("SELECT * FROM " . Schema::orders() . " WHERE id = %d", $id)) ?: null;
    }

    public static function by_payment(string $payment_id): ?object {
        global $wpdb;
        if ($payment_id === '') {
            return null;
        }
        return $wpdb->get_row($wpdb->prepare("SELECT * FROM " . Schema::orders() . " WHERE payment_id = %s", $payment_id)) ?: null;
    }

    /** @return array<int,object> */
    public static function tickets(int $order_id): array {
        global $wpdb;
        return $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM " . Schema::tickets() . " WHERE order_id = %d ORDER BY ticket_number ASC",
            $order_id
        )) ?: [];
    }

    public static function ticket_by_token(string $token): ?object {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . Schema::tickets() . " WHERE token = %s",
            $token
        )) ?: null;
    }

    /**
     * Create an order + its tickets.
     *
     * @param array $data ['event_id','email','name','type'(array),'qty','promo'(?array),'unit_price','discount','total']
     * @return array{order_id:int,tickets:array}|\WP_Error
     */
    public static function create(array $data, string $payment_id = '', string $method = 'stripe', string $source = 'public', bool $skip_idem = false) {
        global $wpdb;

        // Idempotency: a webhook + a client confirm can both arrive. Skipped for
        // cart lines, which legitimately create several orders under one payment
        // (the cart-level guard in create_cart handles idempotency there).
        if (! $skip_idem && $payment_id !== '' && ($existing = self::by_payment($payment_id))) {
            return ['order_id' => (int) $existing->id, 'tickets' => self::ticket_dtos(self::tickets((int) $existing->id))];
        }

        $event_id = (int) $data['event_id'];
        $type     = (array) $data['type'];
        $qty      = max(1, (int) ($data['qty'] ?? 1));

        // Capacity guard for public sales.
        if ($source === 'public') {
            $avail = TicketTypes::availability($event_id, $type);
            if ($avail['state'] !== 'available') {
                return new \WP_Error('oe_unavailable', __('Those tickets are no longer available.', 'october-events'));
            }
            $cap = $type['capacity'] ?? null;
            if ($cap !== null) {
                $would = TicketTypes::sold_count($event_id, $type['key']) + ($qty * (int) $type['qty_per_purchase']);
                if ($would > (int) $cap) {
                    return new \WP_Error('oe_capacity', __('Not enough tickets remain for that quantity.', 'october-events'));
                }
            }
        }

        $email = sanitize_email((string) ($data['email'] ?? ''));
        $name  = sanitize_text_field((string) ($data['name'] ?? ''));
        // Optional per-admission attendee names (in order); fall back to the buyer.
        $attendees = array_map('sanitize_text_field', (array) ($data['attendee_names'] ?? []));
        $unit  = (float) ($data['unit_price'] ?? TicketTypes::effective_price($type));
        $disc  = (float) ($data['discount'] ?? 0);
        $total = (float) ($data['total'] ?? max(0, $unit * $qty - $disc));

        $account_id = 0;
        if ($email !== '' && ($user = get_user_by('email', $email))) {
            $account_id = Account::ensure((int) $user->ID);
        }

        $now = current_time('mysql', true);
        $wpdb->insert(Schema::orders(), [
            'event_id'          => $event_id,
            'email'             => $email,
            'name'              => $name,
            'ticket_type_key'   => (string) $type['key'],
            'ticket_type_label' => (string) $type['label'],
            'qty'               => $qty,
            'unit_price'        => $unit,
            'promo_code'        => isset($data['promo']['code']) ? strtoupper((string) $data['promo']['code']) : null,
            'discount_amount'   => $disc,
            'total'             => $total,
            'currency'          => strtoupper((string) Settings::get('currency', 'usd')),
            'payment_method'    => $method,
            'payment_id'        => $payment_id ?: null,
            'source'            => $source,
            'status'            => 'paid',
            'account_id'        => $account_id ?: null,
            'created_at'        => $now,
            'updated_at'        => $now,
        ]);
        $order_id = (int) $wpdb->insert_id;
        if (! $order_id) {
            return new \WP_Error('oe_order_failed', __('Could not create the order.', 'october-events'));
        }

        // Generate admissions: qty × qty_per_purchase.
        $per     = max(1, (int) $type['qty_per_purchase']);
        $total_t = $qty * $per;
        $tickets = [];
        for ($i = 1; $i <= $total_t; $i++) {
            $token = bin2hex(random_bytes(32));
            $wpdb->insert(Schema::tickets(), [
                'order_id'          => $order_id,
                'event_id'          => $event_id,
                'ticket_type_label' => (string) $type['label'],
                'attendee_name'     => ($attendees[$i - 1] ?? '') !== '' ? $attendees[$i - 1] : $name,
                'token'             => $token,
                'ticket_number'     => $i,
                'total_in_order'    => $total_t,
                'status'            => 'active',
                'created_at'        => $now,
            ]);
            $tickets[] = (object) [
                'id' => (int) $wpdb->insert_id, 'token' => $token,
                'ticket_number' => $i, 'total_in_order' => $total_t,
            ];
        }

        if (! empty($data['promo']['promo_id'])) {
            Promo::increment_usage((int) $data['promo']['promo_id']);
        }

        AuditLog::record('order_created', $order_id, 'order', $source);
        self::send_confirmation($order_id);

        return ['order_id' => $order_id, 'tickets' => self::ticket_dtos($tickets)];
    }

    /**
     * Admin manual / comp order. $paid=false marks it comp (no payment, $0).
     */
    /**
     * @return array{order_id:int,tickets:array}|\WP_Error
     */
    public static function create_manual(int $event_id, string $type_key, int $qty, string $name, string $email, bool $paid) {
        $type = TicketTypes::type($event_id, $type_key);
        if (! $type) {
            return new \WP_Error('oe_bad_type', __('Unknown ticket type.', 'october-events'));
        }
        $unit  = $paid ? TicketTypes::effective_price($type) : 0.0;
        return self::create([
            'event_id'   => $event_id,
            'email'      => $email,
            'name'       => $name,
            'type'       => $type,
            'qty'        => $qty,
            'unit_price' => $unit,
            'discount'   => 0,
            'total'      => $unit * $qty,
        ], '', $paid ? 'manual' : 'comp', $paid ? 'manual' : 'comp');
    }

    public static function cancel(int $order_id, bool $refund = false): void {
        global $wpdb;
        $order = self::get($order_id);
        if (! $order) {
            return;
        }
        if ($refund && $order->payment_id && in_array($order->payment_method, ['stripe', 'public'], true)) {
            $refund_id = StripeConnector::refund((string) $order->payment_id);
            $status = $refund_id ? 'refunded' : 'cancelled';
            if ($refund_id) {
                AuditLog::record('order_refunded', $order_id, 'order', $refund_id);
            }
        } else {
            $status = 'cancelled';
        }
        $wpdb->update(Schema::orders(), ['status' => $status, 'updated_at' => current_time('mysql', true)], ['id' => $order_id]);
        $wpdb->update(Schema::tickets(), ['status' => 'cancelled'], ['order_id' => $order_id]);
        AuditLog::record('order_cancelled', $order_id, 'order', $status);
    }

    /* ------------------------------------------------------------------ */

    public static function send_confirmation(int $order_id): void {
        $order = self::get($order_id);
        if (! $order || $order->email === '') {
            return;
        }
        $tickets = self::tickets($order_id);
        \OE\Mail\Contacts::capture($order->email, ['name' => (string) $order->name, 'source' => 'ticket']);
        \OE\Mail\Transactional::send('ticket_delivery', [
            'email' => $order->email,
            'name'  => $order->name,
        ], [
            'event_name'  => get_the_title((int) $order->event_id),
            'order_id'    => $order_id,
            'ticket_type' => $order->ticket_type_label,
            'qty'         => count($tickets),
            'total'       => $order->total,
            'tickets'     => array_map(static fn($t) => [
                'number' => $t->ticket_number . '/' . $t->total_in_order,
                'url'    => self::ticket_url($t->token),
            ], $tickets),
        ]);
    }

    /**
     * Active tickets belonging to an account (dashboard Tickets tab), each
     * joined to its event + order for display.
     *
     * @return array<int,object>
     */
    public static function for_account(int $account_id): array {
        global $wpdb;
        $o = Schema::orders();
        $t = Schema::tickets();
        return $wpdb->get_results($wpdb->prepare(
            "SELECT t.*, o.event_id AS ev, o.email AS email FROM {$t} t
             INNER JOIN {$o} o ON t.order_id = o.id
             WHERE o.account_id = %d AND t.status = 'active'
             ORDER BY t.id DESC",
            $account_id
        )) ?: [];
    }

    public static function checked_in(int $ticket_id): bool {
        global $wpdb;
        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM " . Schema::checkins() . " WHERE ticket_id = %d",
            $ticket_id
        )) > 0;
    }

    public static function ticket_url(string $token): string {
        return add_query_arg(['oe_ticket' => $token], home_url('/'));
    }

    /* ------------------------------------------------------------------ *
     * Reporting
     * ------------------------------------------------------------------ */

    /**
     * Overall + today's sales stats (paid orders, active tickets).
     *
     * @return array{tickets:int,revenue:float,today_tickets:int,today_revenue:float}
     */
    public static function stats(): array {
        global $wpdb;
        $o = Schema::orders();
        $t = Schema::tickets();
        $today = current_time('Y-m-d');
        $year  = current_time('Y');

        $tickets = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$t} ti INNER JOIN {$o} o ON ti.order_id = o.id WHERE o.status='paid' AND ti.status='active'");
        $revenue = (float) $wpdb->get_var("SELECT COALESCE(SUM(total),0) FROM {$o} WHERE status='paid'");
        $today_tickets = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$t} ti INNER JOIN {$o} o ON ti.order_id = o.id WHERE o.status='paid' AND ti.status='active' AND DATE(o.created_at)=%s",
            $today
        ));
        $today_revenue = (float) $wpdb->get_var($wpdb->prepare(
            "SELECT COALESCE(SUM(total),0) FROM {$o} WHERE status='paid' AND DATE(created_at)=%s",
            $today
        ));
        $year_tickets = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$t} ti INNER JOIN {$o} o ON ti.order_id = o.id WHERE o.status='paid' AND ti.status='active' AND YEAR(o.created_at)=%d",
            $year
        ));
        $year_revenue = (float) $wpdb->get_var($wpdb->prepare(
            "SELECT COALESCE(SUM(total),0) FROM {$o} WHERE status='paid' AND YEAR(created_at)=%d",
            $year
        ));
        return compact('tickets', 'revenue') + [
            'today_tickets' => $today_tickets, 'today_revenue' => $today_revenue,
            'year_tickets'  => $year_tickets,  'year_revenue'  => $year_revenue,
            'year'          => (int) $year,
        ];
    }

    /**
     * Per-event sales summary.
     *
     * @return array<int,object>
     */
    public static function event_summary(): array {
        global $wpdb;
        $o = Schema::orders();
        $t = Schema::tickets();
        return $wpdb->get_results(
            "SELECT o.event_id, COUNT(ti.id) AS tickets, COALESCE(SUM(o.total),0) AS revenue
             FROM {$o} o LEFT JOIN {$t} ti ON ti.order_id = o.id AND ti.status='active'
             WHERE o.status='paid' GROUP BY o.event_id ORDER BY revenue DESC"
        ) ?: [];
    }

    /**
     * Public DTOs of the tickets for a given payment intent (used to return
     * tickets after an idempotent re-confirm).
     *
     * @return array<int,array<string,mixed>>
     */
    public static function ticket_dtos_for(string $payment_id): array {
        global $wpdb;
        if ($payment_id === '') {
            return [];
        }
        // A cart pays once but issues several orders — gather tickets across all.
        $ids = $wpdb->get_col($wpdb->prepare('SELECT id FROM ' . Schema::orders() . ' WHERE payment_id = %s ORDER BY id ASC', $payment_id));
        $tickets = [];
        foreach ($ids as $oid) {
            $tickets = array_merge($tickets, self::tickets((int) $oid));
        }
        return self::ticket_dtos($tickets);
    }

    /**
     * Create a cart: several ticket lines bought together in one transaction.
     * Issues one order per line (the schema is single-type per order), all under
     * the same payment id. The promo discount is applied to the first line, and
     * attendee names are distributed across the lines in order.
     *
     * @param array<int,array{type:array,qty:int}> $lines
     * @param array{email:string,name:string} $buyer
     * @return array{tickets:array}|\WP_Error
     */
    public static function create_cart(int $event_id, array $lines, array $buyer, string $payment_id = '', string $method = 'stripe', string $source = 'public', ?array $promo = null, array $attendee_names = [], float $discount = 0.0) {
        // Cart-level idempotency: if this payment already produced orders, reuse.
        if ($payment_id !== '' && self::by_payment($payment_id)) {
            return ['tickets' => self::ticket_dtos_for($payment_id)];
        }
        $tickets = [];
        $offset  = 0;
        $first   = true;
        foreach ($lines as $line) {
            $type = (array) $line['type'];
            $qty  = max(1, (int) $line['qty']);
            $per  = max(1, (int) ($type['qty_per_purchase'] ?? 1));
            $count = $qty * $per;
            $unit  = TicketTypes::effective_price($type);
            $line_disc = $first ? $discount : 0.0;
            $res = self::create([
                'event_id'       => $event_id,
                'type'           => $type,
                'qty'            => $qty,
                'email'          => $buyer['email'] ?? '',
                'name'           => $buyer['name'] ?? '',
                'unit_price'     => $unit,
                'discount'       => $line_disc,
                'total'          => max(0, round($unit * $qty - $line_disc, 2)),
                'promo'          => $first ? $promo : null,
                'attendee_names' => array_slice($attendee_names, $offset, $count),
            ], $payment_id, $method, $source, true);
            if (is_wp_error($res)) {
                return $res;
            }
            $tickets = array_merge($tickets, $res['tickets'] ?? []);
            $offset += $count;
            $first   = false;
        }
        return ['tickets' => $tickets];
    }

    /** @return array<int,array<string,mixed>> */
    private static function ticket_dtos(array $tickets): array {
        return array_map(static fn($t) => [
            'id'     => (int) $t->id,
            'token'  => $t->token,
            'number' => $t->ticket_number,
            'url'    => self::ticket_url($t->token),
        ], $tickets);
    }
}
