<?php
declare(strict_types=1);

namespace OE\Admin;

use OE\Briefings\Briefings;

defined('ABSPATH') || exit;

/**
 * Briefings & onboarding checklist manager (ROADMAP R4). Admins maintain the
 * reference briefings and the onboarding checklist that partners see in their
 * organizer portal; completion is tracked per partner.
 */
final class BriefingsScreen {

    public static function init(): void {
        add_action('admin_post_oe_briefing_save', [self::class, 'save_briefing']);
        add_action('admin_post_oe_briefing_delete', [self::class, 'delete_briefing']);
        add_action('admin_post_oe_checkitem_save', [self::class, 'save_item']);
        add_action('admin_post_oe_checkitem_delete', [self::class, 'delete_item']);
    }

    private static function guard(string $nonce_action): void {
        if (! current_user_can('manage_options') || ! check_admin_referer($nonce_action)) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
    }

    public static function render(): void {
        if (! current_user_can('manage_options')) {
            wp_die(esc_html__('You do not have access to this section.', 'october-events'), '', ['response' => 403]);
        }
        $briefings = Briefings::briefings();
        $checklist = Briefings::checklist();
        require OE_DIR . 'admin/views/briefings.php';
    }

    public static function save_briefing(): void {
        self::guard('oe_briefing_save');
        Briefings::save_briefing(
            sanitize_key((string) ($_POST['id'] ?? '')),
            (string) wp_unslash($_POST['title'] ?? ''),
            (string) wp_unslash($_POST['body'] ?? ''),
            (string) wp_unslash($_POST['link'] ?? '')
        );
        self::back('briefing_saved');
    }

    public static function delete_briefing(): void {
        $id = isset($_GET['id']) ? sanitize_key((string) $_GET['id']) : '';
        if (! $id || ! current_user_can('manage_options') || ! check_admin_referer('oe_briefing_delete_' . $id)) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        Briefings::delete_briefing($id);
        self::back('briefing_deleted');
    }

    public static function save_item(): void {
        self::guard('oe_checkitem_save');
        Briefings::save_item(
            sanitize_key((string) ($_POST['id'] ?? '')),
            (string) wp_unslash($_POST['label'] ?? ''),
            (string) wp_unslash($_POST['desc'] ?? '')
        );
        self::back('item_saved');
    }

    public static function delete_item(): void {
        $id = isset($_GET['id']) ? sanitize_key((string) $_GET['id']) : '';
        if (! $id || ! current_user_can('manage_options') || ! check_admin_referer('oe_checkitem_delete_' . $id)) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        Briefings::delete_item($id);
        self::back('item_deleted');
    }

    private static function back(string $msg): void {
        wp_safe_redirect(add_query_arg(['page' => 'oe-briefings', 'oe_msg' => $msg], admin_url('admin.php')));
        exit;
    }
}
