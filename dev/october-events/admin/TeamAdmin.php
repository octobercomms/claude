<?php
declare(strict_types=1);

namespace OE\Admin;

use OE\Crew\Crew;
use OE\Crew\Lifecycle;

defined('ABSPATH') || exit;

/**
 * Planning-team / crew admin (ADMIN-BUILD AD7). The lifecycle table + governance
 * screen, the add / edit form handler, and the per-row action dispatcher (send
 * agreement, provision login, send renewal, offboard, delete).
 *
 * The model, emails, provisioning and renewal cron live under {@see \OE\Crew}.
 */
final class TeamAdmin {

    private static ?TeamAdmin $instance = null;

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        add_action('admin_post_oe_crew_save', [$this, 'handle_save']);
        add_action('admin_post_oe_crew_action', [$this, 'handle_action']);
    }

    private function cap(): string {
        return SectionAccess::cap('team');
    }

    /** The Team screen. */
    public function render(): void {
        if (! current_user_can($this->cap())) {
            wp_die(esc_html__('You do not have access to the team.', 'october-events'));
        }
        wp_enqueue_media(); // photo picker on the add/edit form
        $edit_id = isset($_GET['edit']) ? (int) $_GET['edit'] : 0; // phpcs:ignore WordPress.Security.NonceVerification
        $editing = $edit_id ? Crew::get($edit_id) : null;
        $stats   = Crew::stats();
        $grouped = Crew::by_tier();
        require OE_DIR . 'admin/views/team.php';
    }

    /* ------------------------------------------------------------ save -- */

    public function handle_save(): void {
        if (! current_user_can($this->cap()) || ! check_admin_referer('oe_crew_save')) {
            wp_die(esc_html__('Not allowed.', 'october-events'));
        }
        $id = isset($_POST['id']) ? (int) $_POST['id'] : 0;

        $data = [
            'tier'        => isset($_POST['tier']) ? sanitize_key((string) $_POST['tier']) : Crew::TIER_PLANNING,
            'name'        => sanitize_text_field(wp_unslash((string) ($_POST['name'] ?? ''))),
            'email'       => sanitize_email(wp_unslash((string) ($_POST['email'] ?? ''))),
            'phone'       => sanitize_text_field(wp_unslash((string) ($_POST['phone'] ?? ''))),
            'role_title'  => sanitize_text_field(wp_unslash((string) ($_POST['role_title'] ?? ''))),
            'role_owns'   => sanitize_text_field(wp_unslash((string) ($_POST['role_owns'] ?? ''))),
            'hours_month' => sanitize_text_field(wp_unslash((string) ($_POST['hours_month'] ?? ''))),
            'role_email'  => sanitize_email(wp_unslash((string) ($_POST['role_email'] ?? ''))),
            'term_start'  => sanitize_text_field(wp_unslash((string) ($_POST['term_start'] ?? ''))),
            'term_end'    => sanitize_text_field(wp_unslash((string) ($_POST['term_end'] ?? ''))),
            'bio'         => sanitize_textarea_field(wp_unslash((string) ($_POST['bio'] ?? ''))),
            'note'        => sanitize_textarea_field(wp_unslash((string) ($_POST['note'] ?? ''))),
            'sort'        => isset($_POST['sort']) ? (int) $_POST['sort'] : 0,
            'photo_id'    => isset($_POST['photo_id']) ? (int) $_POST['photo_id'] : 0,
        ];

        // Status: respect an explicit choice; default sensibly for new rows.
        if (isset($_POST['status']) && $_POST['status'] !== '') {
            $data['status'] = sanitize_key((string) $_POST['status']);
        } elseif (! $id) {
            // A new managed-tier record with contact details starts as invited;
            // a directory tier (council/board) is simply active.
            $data['status'] = Crew::is_managed_tier($data['tier'])
                ? Crew::STATUS_INVITED
                : Crew::STATUS_ACTIVE;
        }

        if ($id) {
            Crew::update($id, $data);
            $msg = 'saved';
        } else {
            $id  = Crew::insert($data);
            $msg = $id ? 'added' : 'error';
        }
        $this->redirect($msg);
    }

    /* ---------------------------------------------------------- action -- */

    public function handle_action(): void {
        $id  = isset($_GET['id']) ? (int) $_GET['id'] : 0;
        $do  = isset($_GET['do']) ? sanitize_key((string) $_GET['do']) : '';
        if (! current_user_can($this->cap()) || ! $id || ! check_admin_referer('oe_crew_action_' . $id)) {
            wp_die(esc_html__('Not allowed.', 'october-events'));
        }

        $msg = 'error';
        switch ($do) {
            case 'agreement':
                $msg = Lifecycle::send_agreement($id) ? 'agreement_sent' : 'error';
                break;
            case 'provision':
                $res = Lifecycle::provision_login($id);
                $msg = $res['ok'] ? 'provisioned' : 'error';
                break;
            case 'activate':
                $msg = Crew::mark_active($id) ? 'activated' : 'error';
                break;
            case 'renewal':
                $msg = Lifecycle::send_renewal($id, 'manual') ? 'renewal_sent' : 'error';
                break;
            case 'offboard':
                $res = Lifecycle::offboard($id);
                $msg = $res['ok'] ? 'offboarded' : 'error';
                break;
            case 'delete':
                $msg = Crew::delete($id) ? 'deleted' : 'error';
                break;
        }
        $this->redirect($msg);
    }

    private function redirect(string $msg): void {
        wp_safe_redirect(add_query_arg(
            ['page' => 'oe-team', 'oe_msg' => $msg],
            admin_url('admin.php')
        ));
        exit;
    }
}
