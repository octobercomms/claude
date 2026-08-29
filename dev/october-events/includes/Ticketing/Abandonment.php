<?php
declare(strict_types=1);

namespace OE\Ticketing;

use OE\Logger;

defined('ABSPATH') || exit;

/**
 * Cart-abandonment capture.
 *
 * As a buyer fills in the ticket checkout, the front-end saves a draft of what
 * they've entered so far (tickets + quantities, name, email, attendee names,
 * the running total). The draft is updated in place — one row per attempt,
 * keyed by a client session token — so we don't accumulate a row per keystroke.
 *
 * If the same email later completes a purchase the draft is flipped to
 * `recovered`; otherwise it sits `open` and, once it has gone stale, reads as
 * "abandoned" in the admin. This is first-party conversion analytics only — the
 * captured contact details are NOT used for marketing, and rows are auto-purged
 * after a retention window (see purge()).
 *
 * No payment details are ever seen or stored here (Stripe handles cards).
 */
final class Abandonment {

    /** An `open` draft older than this reads as "abandoned" (not still in progress). */
    private const STALE_MINUTES = 30;

    /** Auto-purge drafts older than this many days (retention). */
    private const RETAIN_DAYS = 90;

    /**
     * Create or update the draft for a checkout attempt. Returns the row id, or
     * 0 if there was nothing worth saving (no email and no items).
     *
     * @param array<string,mixed> $data {
     *   session_key, event_id, email, name, cart:[{type_key,qty}],
     *   attendee_names:[...], promo_code, step
     * }
     */
    public static function capture(array $data): int {
        global $wpdb;

        $session = substr(sanitize_text_field((string) ($data['session_key'] ?? '')), 0, 64);
        if ($session === '') {
            return 0;
        }
        $event_id = (int) ($data['event_id'] ?? 0);
        $email    = sanitize_email((string) ($data['email'] ?? ''));
        $name     = sanitize_text_field((string) ($data['name'] ?? ''));

        // Resolve the cart against the event's real ticket types so labels and
        // prices are trustworthy (never trust a client-supplied price).
        [$lines, $subtotal, $item_count] = self::resolve_cart($event_id, (array) ($data['cart'] ?? []));

        // Nothing entered yet — don't create an empty row.
        if ($item_count === 0 && $email === '') {
            return 0;
        }

        $promo    = substr(sanitize_text_field((string) ($data['promo_code'] ?? '')), 0, 50);
        $discount = 0.0;
        if ($promo !== '' && $subtotal > 0) {
            $res = Promo::validate($promo, $event_id, round($subtotal, 2));
            if (! is_wp_error($res)) {
                $discount = (float) $res['discount_amount'];
            }
        }
        $total = max(0, round($subtotal - $discount, 2));

        $attendees = [];
        foreach (array_slice((array) ($data['attendee_names'] ?? []), 0, 50) as $n) {
            $n = sanitize_text_field((string) $n);
            if ($n !== '') { $attendees[] = $n; }
        }

        // Normalise the funnel step. An "exit" beacon is not progress, so it maps
        // to how far the entered data implies they got (email typed = details).
        $step = sanitize_key((string) ($data['step'] ?? 'cart'));
        if (! in_array($step, ['cart', 'details', 'payment'], true)) {
            $step = $email !== '' ? 'details' : 'cart';
        }

        $now   = current_time('mysql');
        $table = Schema::abandoned();

        $row = [
            'event_id'        => $event_id,
            'email'           => $email,
            'name'            => $name,
            'cart'            => (string) wp_json_encode($lines),
            'attendee_names'  => $attendees ? (string) wp_json_encode($attendees) : null,
            'item_count'      => $item_count,
            'promo_code'      => $promo !== '' ? $promo : null,
            'subtotal'        => round($subtotal, 2),
            'discount_amount' => round($discount, 2),
            'total'           => $total,
            'currency'        => strtoupper((string) \OE\Settings::get('currency', 'usd')),
            'furthest_step'   => $step,
            'updated_at'      => $now,
        ];

        $prior = $wpdb->get_row($wpdb->prepare(
            "SELECT id, furthest_step FROM {$table} WHERE session_key = %s",
            $session
        ));

        if ($prior) {
            // Keep furthest_step monotonic — never let a later save (e.g. an exit
            // beacon, or removing items) walk the funnel back.
            $rank = ['cart' => 1, 'details' => 2, 'payment' => 3];
            if (($rank[(string) $prior->furthest_step] ?? 0) >= ($rank[$step] ?? 0)) {
                $row['furthest_step'] = (string) $prior->furthest_step;
            }
            // Don't resurrect a draft we've already marked recovered.
            $wpdb->update($table, $row, ['id' => (int) $prior->id, 'status' => 'open']);
            return (int) $prior->id;
        }

        $row['session_key'] = $session;
        $row['status']      = 'open';
        $row['created_at']  = $now;
        $ok = $wpdb->insert($table, $row);
        return $ok ? (int) $wpdb->insert_id : 0;
    }

    /**
     * A purchase completed for this email — flip any open drafts to `recovered`
     * so they drop out of the abandoned count. Scoped to the event when known.
     */
    public static function mark_recovered(string $email, int $event_id = 0): void {
        $email = sanitize_email($email);
        if ($email === '') {
            return;
        }
        global $wpdb;
        $table = Schema::abandoned();
        $now   = current_time('mysql');

        if ($event_id > 0) {
            $n = $wpdb->query($wpdb->prepare(
                "UPDATE {$table} SET status='recovered', updated_at=%s WHERE email=%s AND event_id=%d AND status='open'",
                $now, $email, $event_id
            ));
        } else {
            $n = $wpdb->query($wpdb->prepare(
                "UPDATE {$table} SET status='recovered', updated_at=%s WHERE email=%s AND status='open'",
                $now, $email
            ));
        }
        if ($n) {
            Logger::log('Cart recovered', ['email' => $email, 'event_id' => $event_id, 'rows' => (int) $n]);
        }
    }

    /**
     * Resolve a client cart ([{type_key, qty}]) to priced lines using the
     * event's real ticket types. Unknown keys are kept (label = the key) at a
     * zero price so the snapshot still shows what they tried to buy.
     *
     * @param array<int,mixed> $cart
     * @return array{0:array<int,array<string,mixed>>,1:float,2:int}
     */
    private static function resolve_cart(int $event_id, array $cart): array {
        $lines = [];
        $subtotal = 0.0;
        $count = 0;
        foreach ($cart as $c) {
            if (! is_array($c)) { continue; }
            $key = sanitize_key((string) ($c['type_key'] ?? ($c['type'] ?? '')));
            $qty = min(99, max(0, (int) ($c['qty'] ?? 0)));
            if ($key === '' || $qty < 1) { continue; }

            $label = $key;
            $unit  = 0.0;
            if ($event_id > 0) {
                $type = TicketTypes::type($event_id, $key);
                if ($type) {
                    $label = (string) ($type['label'] ?? $key);
                    $unit  = (float) TicketTypes::effective_price($type);
                }
            }
            $subtotal += round($unit * $qty, 2);
            $count    += $qty;
            $lines[]   = ['type_key' => $key, 'label' => $label, 'qty' => $qty, 'unit_price' => round($unit, 2)];
        }
        return [$lines, round($subtotal, 2), $count];
    }

    /**
     * Recent drafts for the admin list. Each row is decorated with a derived
     * `state` (in_progress | abandoned | recovered) and a decoded `items` array.
     *
     * @param array<string,mixed> $args  ['limit'=>int, 'event_id'=>int, 'state'=>string]
     * @return array<int,object>
     */
    public static function recent(array $args = []): array {
        global $wpdb;
        $table = Schema::abandoned();
        $limit = min(500, max(1, (int) ($args['limit'] ?? 200)));

        $where = '1=1';
        $params = [];
        if (! empty($args['event_id'])) {
            $where .= ' AND event_id = %d';
            $params[] = (int) $args['event_id'];
        }
        $sql = "SELECT * FROM {$table} WHERE {$where} ORDER BY updated_at DESC LIMIT %d";
        $params[] = $limit;
        $rows = $wpdb->get_results($wpdb->prepare($sql, $params)) ?: [];

        $stale_before = strtotime('-' . self::STALE_MINUTES . ' minutes', (int) current_time('timestamp'));
        foreach ($rows as $r) {
            $r->items = json_decode((string) $r->cart, true) ?: [];
            $r->attendees = json_decode((string) ($r->attendee_names ?? ''), true) ?: [];
            if ($r->status === 'recovered') {
                $r->state = 'recovered';
            } elseif (strtotime((string) $r->updated_at) < $stale_before) {
                $r->state = 'abandoned';
            } else {
                $r->state = 'in_progress';
            }
        }

        if (! empty($args['state'])) {
            $want = (string) $args['state'];
            $rows = array_values(array_filter($rows, static fn($r) => $r->state === $want));
        }
        return $rows;
    }

    /**
     * Headline counts for the admin KPIs.
     *
     * @return array{open:int,abandoned:int,recovered:int,lost_value:float,recovered_value:float}
     */
    public static function stats(): array {
        global $wpdb;
        $table = Schema::abandoned();
        $stale = gmdate('Y-m-d H:i:s', (int) strtotime('-' . self::STALE_MINUTES . ' minutes', (int) current_time('timestamp')));

        $abandoned = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$table} WHERE status='open' AND updated_at < %s AND item_count > 0",
            $stale
        ));
        $in_progress = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$table} WHERE status='open' AND updated_at >= %s",
            $stale
        ));
        $recovered = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$table} WHERE status='recovered'");
        $lost = (float) $wpdb->get_var($wpdb->prepare(
            "SELECT COALESCE(SUM(total),0) FROM {$table} WHERE status='open' AND updated_at < %s AND item_count > 0",
            $stale
        ));
        $recovered_value = (float) $wpdb->get_var("SELECT COALESCE(SUM(total),0) FROM {$table} WHERE status='recovered'");

        return [
            'open'            => $in_progress,
            'abandoned'       => $abandoned,
            'recovered'       => $recovered,
            'lost_value'      => round($lost, 2),
            'recovered_value' => round($recovered_value, 2),
        ];
    }

    /** Delete drafts older than the retention window. Returns rows removed. */
    public static function purge(?int $days = null): int {
        global $wpdb;
        $days = $days ?? self::RETAIN_DAYS;
        $table = Schema::abandoned();
        $cutoff = gmdate('Y-m-d H:i:s', (int) strtotime('-' . (int) $days . ' days', (int) current_time('timestamp')));
        $n = (int) $wpdb->query($wpdb->prepare("DELETE FROM {$table} WHERE updated_at < %s", $cutoff));
        if ($n) {
            Logger::log('Purged abandoned-cart drafts', ['rows' => $n, 'older_than_days' => $days]);
        }
        return $n;
    }
}
