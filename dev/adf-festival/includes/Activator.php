<?php
declare(strict_types=1);

namespace ADF;

defined('ABSPATH') || exit;

/**
 * Activation / deactivation lifecycle.
 */
final class Activator {

    public static function activate(): void {
        // Make sure CPTs exist before flushing rewrite rules.
        PostTypes::get_instance()->register_owned();
        PostTypes::get_instance()->register_external_fallbacks();

        self::install_tables();
        Cron::schedule();

        // Seed default settings if absent.
        if (get_option(Settings::OPTION) === false) {
            update_option(Settings::OPTION, Settings::defaults());
        }

        flush_rewrite_rules();
    }

    /**
     * Create/upgrade all custom tables. Idempotent (dbDelta) so it is safe to
     * run on activation AND on a version-triggered upgrade.
     */
    public static function install_tables(): void {
        AuditLog::install();
        VolunteerSignups::install();
        \ADF\Ticketing\Schema::install();
        \ADF\Ads\Schema::install();
        update_option('adf_db_version', ADF_DB_VERSION);
    }

    /**
     * Run on load: when the stored DB version differs from the code's, build any
     * new/changed tables automatically — no deactivate/reactivate needed after
     * an update.
     */
    public static function maybe_upgrade(): void {
        if (get_option('adf_db_version') !== ADF_DB_VERSION) {
            self::install_tables();
        }
    }

    public static function deactivate(): void {
        Cron::unschedule();
        flush_rewrite_rules();
    }
}
