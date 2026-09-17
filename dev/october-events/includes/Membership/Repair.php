<?php
declare(strict_types=1);

namespace OE\Membership;

use OE\Settings;
use OE\AuditLog;
use OE\Ticketing\Schema;
use OE\Ticketing\TicketTypes;
use OE\Connectors\StripeConnector;

defined('ABSPATH') || exit;

/**
 * Recover memberships that were meant to be created at ticket checkout but
 * weren't. When someone buys a members-only rate as a non-member, the checkout
 * saves their card and is supposed to create the Friend subscription off-session
 * straight after. If that step ever fails (a bad join price, a dropped confirm
 * call, an off-session decline), the buyer keeps the discounted ticket but never
 * becomes a member. This finds those people and, on request, creates the
 * subscription on the card they already saved — never touching anyone who is
 * already a member.
 */
final class Repair {

    /** The recurring join price, but only when it's a real Stripe price id. */
    public static function join_price(): string {
        if (empty(Settings::get('membership_enabled', false))) {
            return '';
        }
        $p = trim((string) Settings::get('membership_join_price_id', ''));
        // A subscription bills a price_… , never a prod_… . Treating a wrong id as
        // "no join price" is deliberate: the checkout then blocks the member rate
        // for non-members instead of selling it with a join that can't complete.
        return strpos($p, 'price_') === 0 ? $p : '';
    }

    /**
     * People who bought a members-only rate but have no active membership — one
     * entry per email (their most recent qualifying order).
     *
     * @return array<int,array{order_id:int,email:string,name:string,payment_id:string,event_id:int,label:string,created:string,has_card:bool}>
     */
    public static function candidates(int $limit = 1000): array {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            'SELECT id, event_id, email, name, ticket_type_key, ticket_type_label, payment_id, created_at
               FROM ' . Schema::orders() . "
              WHERE status = 'paid' AND email <> '' AND payment_id IS NOT NULL AND payment_id <> ''
           ORDER BY id DESC
              LIMIT %d",
            max(1, $limit)
        )) ?: [];

        // Keep only members-only rates, newest per email.
        $seen = [];
        $out  = [];
        foreach ($rows as $r) {
            $email = strtolower(trim((string) $r->email));
            if ($email === '' || isset($seen[$email])) {
                continue;
            }
            $type = TicketTypes::type((int) $r->event_id, (string) $r->ticket_type_key);
            if (! $type || ! TicketTypes::is_members_only($type)) {
                continue;
            }
            $seen[$email] = true; // decided this person on their newest members-only order
            // Already a member (bought as a member, or joined some other way)? Not a candidate.
            if (! empty(StripeConnector::member_status($email)['active'])) {
                continue;
            }
            $out[] = [
                'order_id'   => (int) $r->id,
                'email'      => $email,
                'name'       => (string) $r->name,
                'payment_id' => (string) $r->payment_id,
                'event_id'   => (int) $r->event_id,
                'label'      => (string) $r->ticket_type_label,
                'created'    => (string) $r->created_at,
                'has_card'   => true, // confirmed at repair time against the PaymentIntent
            ];
        }
        return $out;
    }

    /**
     * Create the missing membership for one order, on the card saved with its
     * ticket payment. Idempotent: skips anyone who is already an active member.
     *
     * @return array{ok:bool,status:string,message:string}
     */
    public static function repair_order(int $order_id): array {
        global $wpdb;
        $order = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . Schema::orders() . ' WHERE id = %d', $order_id));
        if (! $order) {
            return ['ok' => false, 'status' => 'not_found', 'message' => __('Order not found.', 'october-events')];
        }
        $email = strtolower(trim((string) $order->email));
        $price = self::join_price();
        if ($price === '') {
            return ['ok' => false, 'status' => 'no_price', 'message' => __('Set a recurring Friend price (price_…) in Settings → Membership first.', 'october-events')];
        }
        // Don't double-charge an existing member.
        StripeConnector::bust_member_status($email);
        if (! empty(StripeConnector::member_status($email)['active'])) {
            return ['ok' => true, 'status' => 'already_member', 'message' => __('Already a member — skipped.', 'october-events')];
        }
        $pid = (string) $order->payment_id;
        if ($pid === '') {
            return ['ok' => false, 'status' => 'no_payment', 'message' => __('No card on file for this order.', 'october-events')];
        }
        $pi          = StripeConnector::retrieve_payment_intent($pid);
        $customer_id = is_string($pi['customer'] ?? null) ? (string) $pi['customer'] : (string) ($pi['customer']['id'] ?? '');
        $pm_id       = is_string($pi['payment_method'] ?? null) ? (string) $pi['payment_method'] : (string) ($pi['payment_method']['id'] ?? '');
        if ($customer_id === '' || $pm_id === '') {
            return ['ok' => false, 'status' => 'no_card', 'message' => __('No saved card on this payment — contact the buyer instead.', 'october-events')];
        }

        $sub = StripeConnector::create_membership_subscription($customer_id, $price, $pm_id, [
            'source' => 'repair_missing_join',
            'email'  => $email,
            'order'  => (string) $order_id,
        ]);
        StripeConnector::bust_member_status($email);

        $ok = in_array($sub['status'], ['active', 'trialing'], true);
        AuditLog::record($ok ? 'membership_repaired' : 'membership_repair_failed', $order_id, 'order', $email);
        if ($ok) {
            return ['ok' => true, 'status' => 'created', 'message' => __('Membership created and first month charged.', 'october-events')];
        }
        return ['ok' => false, 'status' => 'charge_failed', 'message' => sprintf(
            /* translators: %s: Stripe error or subscription status */
            __('Card didn’t go through (%s) — send this buyer a join link instead.', 'october-events'),
            $sub['error'] !== '' ? $sub['error'] : ($sub['status'] ?: 'declined')
        )];
    }
}
