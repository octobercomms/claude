<?php
declare(strict_types=1);

namespace OE\Admin;

use OE\AuditLog;
use OE\Logger;

defined('ABSPATH') || exit;

/**
 * Logs screen (Admin hub).
 *
 * Two read views behind one page:
 *  - Audit: the oe_audit_log table (approvals, refunds, auto-approve,
 *    connector activity), newest first, filterable by action.
 *  - Error: the tail of wp-content/oe-debug.log (written only when WP_DEBUG
 *    is on), with a clear-file action.
 *
 * Read-only by design apart from clearing the debug file; the audit trail is
 * append-only and never edited from here.
 */
final class LogsScreen {

    public static function init(): void {
        add_action('admin_post_oe_logs_clear', [self::class, 'clear']);
    }

    private static function require_cap(): void {
        if (! current_user_can('manage_options')) {
            wp_die(esc_html__('You do not have access to this section.', 'october-events'), '', ['response' => 403]);
        }
    }

    public static function render(): void {
        self::require_cap();

        // phpcs:disable WordPress.Security.NonceVerification.Recommended
        $view   = isset($_GET['view']) && $_GET['view'] === 'error' ? 'error' : 'audit';
        $action = isset($_GET['act']) ? sanitize_text_field((string) wp_unslash($_GET['act'])) : '';
        $paged  = isset($_GET['paged']) ? max(1, (int) $_GET['paged']) : 1;
        $cleared = isset($_GET['cleared']);
        // phpcs:enable WordPress.Security.NonceVerification.Recommended

        $per = 100;

        // Audit data.
        $audit_actions = AuditLog::actions();
        $audit_total   = AuditLog::count($action);
        $audit_pages   = (int) max(1, (int) ceil($audit_total / $per));
        $paged         = min($paged, $audit_pages);
        $audit_rows    = $view === 'audit' ? AuditLog::recent($per, ($paged - 1) * $per, $action) : [];

        // Error data.
        $err_enabled = Logger::enabled();
        $err_size    = Logger::size();
        $err_lines   = $view === 'error' ? Logger::tail(400) : [];
        $err_path    = Logger::path();

        require OE_DIR . 'admin/views/logs.php';
    }

    public static function clear(): void {
        self::require_cap();
        if (! check_admin_referer('oe_logs_clear')) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        Logger::clear();
        AuditLog::record('error_log_cleared', 0, '', 'debug log cleared from the Logs screen');
        wp_safe_redirect(add_query_arg(['page' => 'oe-logs', 'view' => 'error', 'cleared' => 1], admin_url('admin.php')));
        exit;
    }
}
