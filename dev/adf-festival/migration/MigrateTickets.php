<?php
declare(strict_types=1);

namespace ADF\Migration;

use ADF\Account;
use ADF\Ticketing\Schema;

defined('ABSPATH') || exit;

/**
 * Migrate the legacy Event Tickets plugin into ADF's relational ticketing
 * tables (§9). The legacy schema maps almost 1:1:
 *   oct_orders   → adf_orders
 *   oct_tickets  → adf_tickets   (unique check-in `token` preserved)
 *   oct_checkins → adf_checkins
 *
 * Event posts are NOT recreated (events live in the adopted `events` CPT) — only
 * the event_id link is carried across. Idempotent: an order whose tickets'
 * tokens already exist is skipped. Order/ticket ids are remapped to the new
 * auto-increment ids.
 *
 * Usage: wp adf migrate-tickets [--prefix=wp_] [--dry-run]
 */
final class MigrateTickets {

    public static function run(array $args, array $assoc): void {
        global $wpdb;
        $dry_run = isset($assoc['dry-run']);
        $prefix  = $assoc['prefix'] ?? $wpdb->prefix;

        $o_t = $prefix . 'oct_orders';
        $t_t = $prefix . 'oct_tickets';
        $c_t = $prefix . 'oct_checkins';

        if (! self::table_exists($t_t)) {
            \WP_CLI::warning("Legacy tickets table '{$t_t}' not found. Pass --prefix if needed.");
            return;
        }

        $orders = $wpdb->get_results("SELECT * FROM {$o_t}");
        \WP_CLI::log(sprintf('Found %d legacy order(s).', is_array($orders) ? count($orders) : 0));
        $created = 0; $skipped = 0;

        foreach (($orders ?: []) as $o) {
            $legacy_tickets = $wpdb->get_results($wpdb->prepare("SELECT * FROM {$t_t} WHERE order_id = %d", $o->id));
            if (! $legacy_tickets) {
                $skipped++;
                continue;
            }
            // Idempotency: if the first token already exists, this order is done.
            if (self::token_exists((string) $legacy_tickets[0]->token)) {
                $skipped++;
                continue;
            }

            \WP_CLI::log(sprintf(' • Order #%d — %s (%d ticket(s))%s', $o->id, $o->email, count($legacy_tickets), $dry_run ? ' [dry-run]' : ''));
            if ($dry_run) {
                continue;
            }

            $account_id = 0;
            if (! empty($o->email) && ($user = get_user_by('email', $o->email))) {
                $account_id = Account::ensure((int) $user->ID);
            }

            $wpdb->insert(Schema::orders(), [
                'event_id'          => (int) $o->event_id,
                'email'             => (string) $o->email,
                'name'              => (string) ($o->name ?? ''),
                'ticket_type_key'   => (string) ($o->ticket_type_key ?? ''),
                'ticket_type_label' => (string) ($o->ticket_type_label ?? ''),
                'qty'               => (int) ($o->qty ?? 1),
                'unit_price'        => (float) ($o->unit_price ?? 0),
                'promo_code'        => $o->promo_code ?? null,
                'discount_amount'   => (float) ($o->discount_amount ?? 0),
                'total'             => (float) ($o->total ?? 0),
                'currency'          => (string) ($o->currency ?? 'USD'),
                'payment_method'    => (string) ($o->payment_method ?? 'stripe'),
                'payment_id'        => $o->payment_id ?? null,
                'source'            => 'migrated',
                'status'            => (string) ($o->status ?? 'paid'),
                'account_id'        => $account_id ?: null,
                'created_at'        => (string) ($o->created_at ?? current_time('mysql', true)),
                'updated_at'        => (string) ($o->updated_at ?? current_time('mysql', true)),
            ]);
            $new_order_id = (int) $wpdb->insert_id;

            foreach ($legacy_tickets as $lt) {
                $wpdb->insert(Schema::tickets(), [
                    'order_id'          => $new_order_id,
                    'event_id'          => (int) $lt->event_id,
                    'ticket_type_label' => (string) ($lt->ticket_type_label ?? ''),
                    'attendee_name'     => (string) ($lt->attendee_name ?? ''),
                    'token'             => (string) $lt->token,
                    'ticket_number'     => (int) ($lt->ticket_number ?? 1),
                    'total_in_order'    => (int) ($lt->total_in_order ?? 1),
                    'status'            => (string) ($lt->status ?? 'active'),
                    'created_at'        => (string) ($lt->created_at ?? current_time('mysql', true)),
                ]);
                $new_ticket_id = (int) $wpdb->insert_id;

                // Carry across check-ins for this ticket.
                if (self::table_exists($c_t)) {
                    $checks = $wpdb->get_results($wpdb->prepare("SELECT * FROM {$c_t} WHERE ticket_id = %d", $lt->id));
                    foreach (($checks ?: []) as $ci) {
                        $wpdb->insert(Schema::checkins(), [
                            'ticket_id'  => $new_ticket_id,
                            'event_id'   => (int) $ci->event_id,
                            'venue_name' => (string) ($ci->venue_name ?? ''),
                            'scanned_at' => (string) ($ci->scanned_at ?? current_time('mysql', true)),
                        ]);
                    }
                }
            }
            $created++;
        }

        \WP_CLI::success(sprintf('Ticket migration complete. Imported %d order(s), skipped %d.', $created, $skipped));
    }

    private static function table_exists(string $table): bool {
        global $wpdb;
        return (string) $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table)) === $table;
    }

    private static function token_exists(string $token): bool {
        global $wpdb;
        return (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM " . Schema::tickets() . " WHERE token = %s",
            $token
        )) > 0;
    }
}
