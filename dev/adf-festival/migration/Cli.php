<?php
declare(strict_types=1);

namespace ADF\Migration;

defined('ABSPATH') || exit;

/**
 * WP-CLI command registrar (§9).
 *
 *   wp adf migrate-ads      Import legacy Ad Manager records into adf_ad.
 *   wp adf migrate-tickets  Import legacy Event Tickets events/tickets.
 *
 * Both are idempotent and safe to dry-run with `--dry-run`.
 */
final class Cli {

    public static function register(): void {
        \WP_CLI::add_command('adf migrate-ads', [MigrateAds::class, 'run']);
        \WP_CLI::add_command('adf migrate-tickets', [MigrateTickets::class, 'run']);
    }
}
