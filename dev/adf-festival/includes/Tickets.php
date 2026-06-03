<?php
declare(strict_types=1);

namespace ADF;

use ADF\Connectors\StripeConnector;
use ADF\Connectors\BrevoConnector;

defined('ABSPATH') || exit;

/**
 * Event ticketing (§1.2 `adf_ticket`).
 *
 * Tickets attach to the adopted `events` CPT. Each ticket gets a unique number,
 * a QR payload for check-in, a Brevo delivery email and contributes to the
 * event's computed `tickets_sold` count.
 */
final class Tickets {

    public static function slug(): string {
        return PostTypes::slug('ticket');
    }

    /**
     * Create a paid ticket once its PaymentIntent has succeeded.
     *
     * @return int Ticket post id (0 on failure).
     */
    public static function create(int $event_id, int $account_id, string $purchaser_name, string $purchaser_email, string $payment_intent_id = ''): int {
        $number = self::generate_number();

        $post_id = wp_insert_post([
            'post_type'   => self::slug(),
            'post_status' => 'publish',
            'post_title'  => $number,
            'post_author' => (int) get_post_meta($account_id, '_adf_wp_user_id', true) ?: get_current_user_id(),
        ], true);
        if (is_wp_error($post_id)) {
            Logger::log('Ticket create failed', ['error' => $post_id->get_error_message()]);
            return 0;
        }
        $post_id = (int) $post_id;

        $meta = [
            '_adf_event_id'                 => $event_id,
            '_adf_account_id'               => $account_id,
            '_adf_ticket_number'            => $number,
            '_adf_purchaser_name'           => sanitize_text_field($purchaser_name),
            '_adf_purchaser_email'          => sanitize_email($purchaser_email),
            '_adf_stripe_payment_intent_id' => $payment_intent_id,
            '_adf_purchase_date'            => current_time('mysql'),
            '_adf_checked_in'               => 0,
            '_adf_check_in_time'            => '',
            // Opaque token for the QR / check-in URL.
            '_adf_qr_token'                 => wp_generate_password(32, false),
        ];
        foreach ($meta as $k => $v) {
            update_post_meta($post_id, $k, $v);
        }

        AuditLog::record('ticket_created', $post_id, 'ticket', $number);

        // Subscribe purchaser to attendees list + send the delivery email (§5).
        $lists = (array) Settings::get('brevo_lists', []);
        if (isset($lists['adf_event_attendees'])) {
            BrevoConnector::upsert_contact($purchaser_email, [], [(int) $lists['adf_event_attendees']]);
        }
        BrevoConnector::send('ticket_delivery', [
            'email' => $purchaser_email,
            'name'  => $purchaser_name,
        ], [
            'event_name'    => get_the_title($event_id),
            'ticket_number' => $number,
            'ticket_url'    => self::ticket_url($post_id),
        ]);

        return $post_id;
    }

    /**
     * Computed tickets-sold count for an event.
     */
    public static function sold_for_event(int $event_id): int {
        $found = get_posts([
            'post_type'      => self::slug(),
            'post_status'    => 'publish',
            'posts_per_page' => -1,
            'fields'         => 'ids',
            'meta_key'       => '_adf_event_id',
            'meta_value'     => $event_id,
            'no_found_rows'  => true,
        ]);
        return count($found);
    }

    /**
     * Tickets owned by an account (dashboard Tickets tab).
     *
     * @return int[] ticket ids
     */
    public static function for_account(int $account_id): array {
        return get_posts([
            'post_type'      => self::slug(),
            'post_status'    => 'publish',
            'posts_per_page' => 200,
            'fields'         => 'ids',
            'meta_key'       => '_adf_account_id',
            'meta_value'     => $account_id,
            'orderby'        => 'date',
            'order'          => 'DESC',
        ]);
    }

    /**
     * Mark a ticket checked-in by its QR token. Returns the ticket id or 0.
     */
    public static function check_in(string $qr_token): int {
        $found = get_posts([
            'post_type'      => self::slug(),
            'posts_per_page' => 1,
            'fields'         => 'ids',
            'meta_key'       => '_adf_qr_token',
            'meta_value'     => $qr_token,
            'no_found_rows'  => true,
        ]);
        if (! $found) {
            return 0;
        }
        $id = (int) $found[0];
        if (get_post_meta($id, '_adf_checked_in', true)) {
            return $id; // Already in.
        }
        update_post_meta($id, '_adf_checked_in', 1);
        update_post_meta($id, '_adf_check_in_time', current_time('mysql'));
        AuditLog::record('ticket_checked_in', $id, 'ticket');
        return $id;
    }

    public static function ticket_url(int $ticket_id): string {
        $token = (string) get_post_meta($ticket_id, '_adf_qr_token', true);
        return add_query_arg(['adf_ticket' => $token], home_url('/'));
    }

    /**
     * QR image URL via Google Charts-style endpoint is avoided (no external CDN
     * for core, §12). Instead we return the check-in URL and let the front end
     * render the QR with a bundled JS library, or fall back to the raw token.
     */
    public static function qr_payload(int $ticket_id): string {
        return self::ticket_url($ticket_id);
    }

    private static function generate_number(): string {
        return 'ADF-' . strtoupper(wp_generate_password(8, false));
    }
}
