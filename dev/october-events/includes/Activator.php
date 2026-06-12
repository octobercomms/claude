<?php
declare(strict_types=1);

namespace OE;

defined('ABSPATH') || exit;

/**
 * Activation / deactivation lifecycle.
 */
final class Activator {

    public static function activate(): void {
        // Migrate any pre-rename (adf_*) data before tables are (re)built.
        self::migrate_legacy();

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
        \OE\Ticketing\Schema::install();
        \OE\Tasks\Schema::install();
        \OE\Mail\EmailLog::install();
        \OE\Mail\Suppression::install();
        \OE\Mail\Contacts::install();
        update_option('oe_db_version', OE_DB_VERSION);
    }

    /**
     * Run on load: when the stored DB version differs from the code's, build any
     * new/changed tables automatically — no deactivate/reactivate needed after
     * an update.
     */
    public static function maybe_upgrade(): void {
        self::migrate_legacy();
        if (get_option('oe_db_version') !== OE_DB_VERSION) {
            self::install_tables();
        }
    }

    /**
     * One-time migration of pre-rename data (the plugin was "ADF Festival" up to
     * 1.4.0). Renames adf_* tables, options, post meta and post types to oe_*.
     * Idempotent — gated by the `oe_migrated_from_adf` flag.
     */
    public static function migrate_legacy(): void {
        if (get_option('oe_migrated_from_adf')) {
            return;
        }
        global $wpdb;

        // 1. Tables: rename adf_* → oe_* when the old exists and new does not.
        foreach (['audit_log', 'volunteer_signups', 'orders', 'tickets', 'checkins', 'promo_codes'] as $base) {
            $old = $wpdb->prefix . 'adf_' . $base;
            $new = $wpdb->prefix . 'oe_' . $base;
            $old_exists = (string) $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $old)) === $old;
            $new_exists = (string) $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $new)) === $new;
            if ($old_exists && ! $new_exists) {
                $wpdb->query("RENAME TABLE `{$old}` TO `{$new}`");
            }
        }

        // 2. Options: copy adf_* → oe_* (don't clobber an existing new value).
        foreach (['settings', 'db_version', 'invoice_seq', 'ai_seen_guids'] as $name) {
            $old = 'adf_' . $name;
            $new = 'oe_' . $name;
            $old_val = get_option($old, null);
            if ($old_val !== null && get_option($new, null) === null) {
                update_option($new, $old_val);
            }
            delete_option($old);
        }

        // 2b. Brevo list-label keys inside settings carried the adf_ prefix.
        $settings = get_option('oe_settings', []);
        if (is_array($settings) && ! empty($settings['brevo_lists']) && is_array($settings['brevo_lists'])) {
            $relabelled = [];
            foreach ($settings['brevo_lists'] as $k => $v) {
                $relabelled[strpos((string) $k, 'adf_') === 0 ? 'oe_' . substr((string) $k, 4) : $k] = $v;
            }
            $settings['brevo_lists'] = $relabelled;
            update_option('oe_settings', $settings);
        }

        // 3. Post meta keys: _adf_* → _oe_* (exact prefix via LEFT()).
        $wpdb->query("UPDATE {$wpdb->postmeta} SET meta_key = CONCAT('_oe_', SUBSTRING(meta_key, 6)) WHERE LEFT(meta_key, 5) = '_adf_'");

        // 4. Our CPT post_type values: adf_* → oe_* (events/volunteer untouched).
        $wpdb->query("UPDATE {$wpdb->posts} SET post_type = CONCAT('oe_', SUBSTRING(post_type, 5)) WHERE LEFT(post_type, 4) = 'adf_'");

        // 5. Clear orphaned old cron hooks (new ones are scheduled on activate).
        foreach (['adf_daily_cron', 'adf_monthly_digest', 'adf_hourly_cron'] as $hook) {
            wp_clear_scheduled_hook($hook);
        }

        update_option('oe_migrated_from_adf', 1);
        Logger::log('Migrated legacy adf_* data to oe_* (rename to October Events)');
    }

    public static function deactivate(): void {
        Cron::unschedule();
        flush_rewrite_rules();
    }
}
