<?php
declare(strict_types=1);

namespace ADF\Migration;

use ADF\PostTypes;
use ADF\Account;
use ADF\Logger;

defined('ABSPATH') || exit;

/**
 * Migrate the legacy Event Tickets plugin (october-event-tickets) into the
 * `adf_ticket` records (§9).
 *
 * Real legacy schema (custom tables):
 *   - {prefix}oct_orders   id, event_id, email, name, payment_method, payment_id,
 *                          total, currency, status, created_at …
 *   - {prefix}oct_tickets  id, order_id, event_id, ticket_type_label,
 *                          attendee_name, token (unique), ticket_number (seq),
 *                          total_in_order, status, created_at
 *   - {prefix}oct_checkins token-based check-in log
 *
 * Each legacy ticket becomes one `adf_ticket`, joined to its order for the
 * purchaser email/name + Stripe payment id, with the unique `token` preserved as
 * the QR/check-in token (so existing printed tickets keep working) and a stable
 * human number of `<order_id>-<seq>`. Events already exist in the adopted
 * `events` CPT, so event posts are NOT recreated — only the event_id link.
 * Idempotent: a ticket whose token already exists is skipped.
 *
 * Usage: wp adf migrate-tickets [--prefix=wp_] [--dry-run]
 */
final class MigrateTickets {

    public static function run(array $args, array $assoc): void {
        global $wpdb;
        $dry_run = isset($assoc['dry-run']);
        $prefix  = $assoc['prefix'] ?? $wpdb->prefix;

        $tickets_t  = $prefix . 'oct_tickets';
        $orders_t   = $prefix . 'oct_orders';
        $checkins_t = $prefix . 'oct_checkins';

        if (! self::table_exists($tickets_t)) {
            \WP_CLI::warning("Legacy tickets table '{$tickets_t}' not found. Pass --prefix if needed.");
            return;
        }
        $has_orders   = self::table_exists($orders_t);
        $has_checkins = self::table_exists($checkins_t);

        // Join tickets to orders for purchaser + payment data.
        $sql = $has_orders
            ? "SELECT t.*, o.email AS o_email, o.name AS o_name, o.payment_id AS o_payment_id,
                      o.payment_method AS o_payment_method, o.created_at AS o_created_at
                 FROM {$tickets_t} t LEFT JOIN {$orders_t} o ON t.order_id = o.id"
            : "SELECT t.* FROM {$tickets_t} t";

        $rows = $wpdb->get_results($sql);
        \WP_CLI::log(sprintf('Found %d ticket(s).', is_array($rows) ? count($rows) : 0));

        // Preload check-in tokens.
        $checked_tokens = [];
        if ($has_checkins) {
            $tokens = $wpdb->get_col("SELECT token FROM {$checkins_t}");
            $checked_tokens = array_flip(array_map('strval', $tokens ?: []));
        }

        $created = 0; $skipped = 0;
        foreach (($rows ?: []) as $r) {
            $token = (string) ($r->token ?? '');
            if ($token === '' || self::token_exists($token)) {
                $skipped++;
                continue;
            }

            $email = (string) ($r->o_email ?? '');
            $name  = (string) ($r->attendee_name ?: ($r->o_name ?? ''));
            $number = ((int) ($r->order_id ?? 0)) . '-' . ((int) ($r->ticket_number ?? 1));

            \WP_CLI::log(sprintf(' • %s — %s (%s)%s', $number, $name, $email, $dry_run ? ' [dry-run]' : ''));
            if ($dry_run) {
                continue;
            }

            $account_id = 0;
            if ($email !== '' && ($user = get_user_by('email', $email))) {
                $account_id = Account::ensure((int) $user->ID);
            }

            $new_id = wp_insert_post([
                'post_type'   => PostTypes::slug('ticket'),
                'post_status' => 'publish',
                'post_title'  => $number,
                'post_date'   => (string) ($r->created_at ?? $r->o_created_at ?? current_time('mysql')),
            ], true);
            if (is_wp_error($new_id)) {
                Logger::log('migrate-tickets insert failed', ['error' => $new_id->get_error_message()]);
                continue;
            }
            $new_id = (int) $new_id;

            $payment_id = (($r->o_payment_method ?? '') === 'stripe') ? (string) ($r->o_payment_id ?? '') : '';

            update_post_meta($new_id, '_adf_ticket_number', $number);
            update_post_meta($new_id, '_adf_event_id', (int) ($r->event_id ?? 0));
            update_post_meta($new_id, '_adf_account_id', $account_id);
            update_post_meta($new_id, '_adf_purchaser_name', $name);
            update_post_meta($new_id, '_adf_purchaser_email', $email);
            update_post_meta($new_id, '_adf_ticket_type', (string) ($r->ticket_type_label ?? ''));
            update_post_meta($new_id, '_adf_stripe_payment_intent_id', $payment_id);
            update_post_meta($new_id, '_adf_purchase_date', (string) ($r->created_at ?? ''));
            update_post_meta($new_id, '_adf_qr_token', $token); // preserve check-in token
            update_post_meta($new_id, '_adf_checked_in', isset($checked_tokens[$token]) ? 1 : 0);
            update_post_meta($new_id, '_adf_migrated_from', 'oct_tickets:' . ($r->id ?? $token));
            $created++;
        }

        \WP_CLI::success(sprintf('Ticket migration complete. Created %d, skipped %d.', $created, $skipped));
    }

    private static function table_exists(string $table): bool {
        global $wpdb;
        return (string) $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table)) === $table;
    }

    private static function token_exists(string $token): bool {
        $found = get_posts([
            'post_type'      => PostTypes::slug('ticket'),
            'posts_per_page' => 1,
            'fields'         => 'ids',
            'meta_key'       => '_adf_qr_token',
            'meta_value'     => $token,
            'no_found_rows'  => true,
        ]);
        return ! empty($found);
    }
}
