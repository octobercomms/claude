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

        AuditLog::install();
        VolunteerSignups::install();
        \ADF\Ticketing\Schema::install();
        Cron::schedule();

        // Seed default settings if absent.
        if (get_option(Settings::OPTION) === false) {
            update_option(Settings::OPTION, Settings::defaults());
        }

        flush_rewrite_rules();
    }

    public static function deactivate(): void {
        Cron::unschedule();
        flush_rewrite_rules();
    }
}
