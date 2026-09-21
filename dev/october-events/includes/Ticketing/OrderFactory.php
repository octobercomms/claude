<?php
declare(strict_types=1);

namespace OE\Ticketing;

defined('ABSPATH') || exit;

/**
 * Build a ticket order from a verified PaymentIntent's metadata.
 *
 * Shared by /ticket-confirm, the Stripe webhook and the order reconciliation
 * tool (Settings → Keys & platform). Idempotent on payment_id — a second call
 * for the same intent returns the existing order's tickets rather than issuing
 * duplicates, so Stripe's webhook retries and a manual backfill never double up.
 */
final class OrderFactory {

    /**
     * @param int $amount_paid Captured amount in cents; when >= 0 the order total
     *                         must not exceed it (ADF-01 anti-tampering guard).
     * @return array{order_id:int,tickets:array}|null
     */
    public static function from_intent_meta(string $intent_id, array $meta, int $amount_paid = -1, string $method = 'stripe'): ?array {
        if ($intent_id === '') {
            return null;
        }
        if (Orders::by_payment($intent_id)) {
            return ['tickets' => Orders::ticket_dtos_for($intent_id)];
        }
        // Both October sites share one Stripe account, so a payment from the other
        // site can reach this handler (its webhook fires for every event on the
        // account). Never build an order here for a sale that isn't this site's.
        if (! self::belongs_here($meta)) {
            return null;
        }
        $event_id = (int) ($meta['event_id'] ?? 0);

        // Rebuild the cart from metadata (single type_key/qty for older intents).
        $raw = [];
        if (! empty($meta['cart'])) {
            $decoded = json_decode((string) $meta['cart'], true);
            if (is_array($decoded)) {
                foreach ($decoded as $c) { $raw[] = ['type_key' => (string) ($c['type_key'] ?? ''), 'qty' => (int) ($c['qty'] ?? 0)]; }
            }
        } elseif (! empty($meta['type_key'])) {
            $raw[] = ['type_key' => (string) $meta['type_key'], 'qty' => (int) ($meta['qty'] ?? 1)];
        }

        $lines = [];
        $subtotal = 0.0;
        foreach ($raw as $li) {
            if ($li['qty'] < 1) { continue; }
            $type = TicketTypes::type($event_id, $li['type_key']);
            if (! $type) { return null; }
            $unit = TicketTypes::effective_price($type);
            $subtotal += round($unit * $li['qty'], 2);
            $lines[] = ['type' => $type, 'qty' => $li['qty'], 'type_key' => (string) $li['type_key'], 'amount' => round($unit * $li['qty'], 2)];
        }
        if (! $lines) {
            return null;
        }

        $discount = 0.0;
        $promo    = null;
        if (! empty($meta['promo'])) {
            $res = Promo::validate((string) $meta['promo'], $event_id, round($subtotal, 2), $lines);
            if (! is_wp_error($res)) {
                $discount = (float) $res['discount_amount'];
                $promo    = ['code' => strtoupper((string) $meta['promo']), 'promo_id' => $res['promo_id']];
            }
        }
        $total = max(0, round($subtotal - $discount, 2));

        // ADF-01: never issue tickets worth more than was actually captured.
        if ($amount_paid >= 0 && (int) round($total * 100) > $amount_paid) {
            \OE\Logger::log('Ticket order rejected — amount mismatch', ['intent' => $intent_id, 'total_cents' => (int) round($total * 100), 'paid' => $amount_paid]);
            return null;
        }

        $attendees = [];
        if (! empty($meta['attendees'])) {
            $decoded = json_decode((string) $meta['attendees'], true);
            if (is_array($decoded)) { $attendees = array_map('sanitize_text_field', $decoded); }
        }
        $buyer = ['email' => sanitize_email((string) ($meta['email'] ?? '')), 'name' => sanitize_text_field((string) ($meta['name'] ?? ''))];
        $door  = sanitize_text_field((string) ($meta['door'] ?? ''));

        $order = Orders::create_cart($event_id, $lines, $buyer, $intent_id, $method, 'public', $promo, $attendees, $discount, $door);
        if (! is_wp_error($order) && $buyer['email'] !== '') {
            // A completed purchase — clear any abandonment drafts for this buyer.
            Abandonment::mark_recovered($buyer['email'], $event_id);
        }
        return is_wp_error($order) ? null : $order;
    }

    /**
     * The host that identifies this WordPress site, stamped onto every ticket
     * PaymentIntent's metadata (`site`) at creation. Both October sites share one
     * Stripe account, so this is what lets a sweep of the account tell one site's
     * ticket sales from the other's.
     */
    public static function site_tag(): string {
        return (string) (wp_parse_url(home_url(), PHP_URL_HOST) ?: '');
    }

    /**
     * Whether a ticket PaymentIntent belongs to THIS site. New payments carry a
     * `site` stamp and match on that host exactly. Payments made before the stamp
     * existed fall back to whether the purchased ticket type actually resolves on
     * this install — TicketTypes reads the event's own post meta, so no other
     * site's event/type resolves here.
     */
    public static function belongs_here(array $meta): bool {
        $site = isset($meta['site']) ? (string) $meta['site'] : '';
        if ($site !== '') {
            $host = (string) (wp_parse_url($site, PHP_URL_HOST) ?: $site);
            return strcasecmp($host, self::site_tag()) === 0;
        }
        return self::resolves_here($meta);
    }

    /** Legacy fallback: does the purchased ticket type exist on this install? */
    private static function resolves_here(array $meta): bool {
        $event_id = (int) ($meta['event_id'] ?? 0);
        if ($event_id <= 0) {
            return false;
        }
        $keys = [];
        if (! empty($meta['cart'])) {
            $decoded = json_decode((string) $meta['cart'], true);
            if (is_array($decoded)) {
                foreach ($decoded as $c) { $keys[] = (string) ($c['type_key'] ?? ''); }
            }
        } elseif (! empty($meta['type_key'])) {
            $keys[] = (string) $meta['type_key'];
        }
        foreach ($keys as $k) {
            if ($k !== '' && TicketTypes::type($event_id, $k)) {
                return true;
            }
        }
        return false;
    }
}
