<?php
declare(strict_types=1);

namespace OE\Migration;

defined('ABSPATH') || exit;

/**
 * WP-CLI command registrar (§9).
 *
 *   wp adf migrate-tickets  Import legacy Event Tickets events/tickets.
 *
 * Idempotent and safe to dry-run with `--dry-run`.
 * (Ad migration lives in the standalone oc-ad-manager plugin, not here.)
 */
final class Cli {

    public static function register(): void {
        \WP_CLI::add_command('adf migrate-tickets', [MigrateTickets::class, 'run']);
    }
}
