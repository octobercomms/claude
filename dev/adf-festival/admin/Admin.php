<?php
declare(strict_types=1);

namespace ADF\Admin;

use ADF\PostTypes;
use ADF\Fields;
use ADF\Submission;
use ADF\Volunteers;
use ADF\AuditLog;

defined('ABSPATH') || exit;

/**
 * ADF Festival admin menu + screens (§8).
 *
 * A single top-level menu with the submenus from the brief. The approval queue
 * and the per-type management screens drive the shared Submission engine.
 */
final class Admin {

    private static ?Admin $instance = null;

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        add_action('admin_menu', [$this, 'register_menu']);
        add_action('admin_post_adf_approve', [$this, 'handle_approve']);
        add_action('admin_post_adf_reject', [$this, 'handle_reject']);
        add_action('admin_post_adf_volunteer_status', [$this, 'handle_volunteer_status']);
        add_action('admin_post_adf_send_digest', [$this, 'handle_send_digest']);
        add_action('admin_init', [$this, 'maybe_export_csv']);
        Settings::get_instance()->init();
        TicketsAdmin::get_instance()->init();
    }

    public function register_menu(): void {
        $cap = 'manage_options';

        add_menu_page('ADF Festival', 'ADF Festival', $cap, 'adf-festival', [$this, 'page_dashboard'], 'dashicons-art', 28);
        add_submenu_page('adf-festival', 'Dashboard', 'Dashboard', $cap, 'adf-festival', [$this, 'page_dashboard']);
        add_submenu_page('adf-festival', 'Accounts', 'Accounts', $cap, 'adf-accounts', [$this, 'page_accounts']);
        add_submenu_page('adf-festival', 'Approval Queue', 'Approval Queue', $cap, 'adf-queue', [$this, 'page_queue']);
        add_submenu_page('adf-festival', 'Directory', 'Directory', $cap, 'adf-directory', fn() => $this->page_listing('directory'));
        add_submenu_page('adf-festival', 'Destinations', 'Destinations', $cap, 'adf-destinations', fn() => $this->page_listing('destination'));
        add_submenu_page('adf-festival', 'Products', 'Products', $cap, 'adf-products', fn() => $this->page_listing('product'));
        add_submenu_page('adf-festival', 'Events', 'Events', $cap, 'adf-events', fn() => $this->page_listing('event'));
        add_submenu_page('adf-festival', 'Registrations', 'Tickets', $cap, 'adf-tickets', [$this, 'page_tickets']);
        add_submenu_page('adf-festival', 'Promo Codes', 'Promo Codes', $cap, 'adf-promos', [TicketsAdmin::get_instance(), 'render_promos']);
        add_submenu_page('adf-festival', 'Volunteers', 'Volunteers', $cap, 'adf-volunteers', [$this, 'page_volunteers']);
        add_submenu_page('adf-festival', 'Stories', 'Stories', $cap, 'adf-stories', fn() => $this->page_listing('story'));
        add_submenu_page('adf-festival', 'Ads', 'Ads', $cap, 'adf-ads', fn() => $this->page_listing('ad'));
        add_submenu_page('adf-festival', 'Email', 'Email', $cap, 'adf-email', [$this, 'page_email']);
        add_submenu_page('adf-festival', 'Settings', 'Settings', $cap, 'adf-settings', [Settings::get_instance(), 'render']);
    }

    /* ----------------------------------------------------------------- *
     * Pages
     * ----------------------------------------------------------------- */

    public function page_dashboard(): void {
        $counts = [];
        foreach (PostTypes::listing_types() as $type) {
            $counts[$type] = $this->count_by_status(PostTypes::slug($type));
        }
        require ADF_DIR . 'admin/views/dashboard.php';
    }

    public function page_queue(): void {
        $filter = isset($_GET['type']) ? sanitize_key((string) $_GET['type']) : '';
        $slugs  = ($filter && PostTypes::slug($filter)) ? [PostTypes::slug($filter)] : PostTypes::listing_slugs();

        $items = get_posts([
            'post_type'      => $slugs,
            'post_status'    => 'any',
            'posts_per_page' => 100,
            'meta_query'     => [['key' => Fields::key('status'), 'value' => Fields::STATUS_PENDING_REVIEW]],
            'orderby'        => 'date',
            'order'          => 'ASC',
        ]);
        require ADF_DIR . 'admin/views/queue.php';
    }

    public function page_accounts(): void {
        $accounts = get_posts([
            'post_type'      => PostTypes::slug('account'),
            'post_status'    => 'any',
            'posts_per_page' => 200,
        ]);
        require ADF_DIR . 'admin/views/accounts.php';
    }

    public function page_listing(string $type): void {
        $slug  = PostTypes::slug($type);
        $label = PostTypes::TYPES[$type]['label'] ?? $type;
        $items = get_posts([
            'post_type'      => $slug,
            'post_status'    => 'any',
            'posts_per_page' => 200,
            'orderby'        => 'modified',
            'order'          => 'DESC',
        ]);
        require ADF_DIR . 'admin/views/listing.php';
    }

    public function page_tickets(): void {
        TicketsAdmin::get_instance()->render_registrations();
    }

    public function page_volunteers(): void {
        // Opportunities (the adopted `volunteer` CPT) with their shifts +
        // signups pulled from the signups table.
        $opportunities = get_posts([
            'post_type'      => Volunteers::slug(),
            'post_status'    => 'publish',
            'posts_per_page' => 200,
            'orderby'        => 'title',
            'order'          => 'ASC',
        ]);
        require ADF_DIR . 'admin/views/volunteers.php';
    }

    public function page_email(): void {
        require ADF_DIR . 'admin/views/email.php';
    }

    /* ----------------------------------------------------------------- *
     * Actions
     * ----------------------------------------------------------------- */

    public function handle_approve(): void {
        $id = $this->verify_action('adf_approve');
        Submission::approve($id, false);
        $this->redirect_back();
    }

    public function handle_reject(): void {
        $id = $this->verify_action('adf_reject');
        Submission::reject($id);
        $this->redirect_back();
    }

    public function handle_volunteer_status(): void {
        $id = $this->verify_action('adf_volunteer_status'); // signup id (table row)
        $status = isset($_REQUEST['status']) ? sanitize_key((string) $_REQUEST['status']) : '';
        if ($status === 'confirmed') {
            Volunteers::confirm($id);
        } elseif ($status === 'declined') {
            Volunteers::decline($id);
        } elseif ($status === 'no_show') {
            Volunteers::mark_no_show($id);
        }
        $this->redirect_back();
    }

    public function handle_send_digest(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('adf_send_digest');
        (new \ADF\Cron())->run_digest();
        wp_safe_redirect(add_query_arg('digest', 'sent', admin_url('admin.php?page=adf-email')));
        exit;
    }

    private function verify_action(string $action): int {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        $id = isset($_REQUEST['id']) ? absint($_REQUEST['id']) : 0;
        check_admin_referer($action . '_' . $id);
        return $id;
    }

    private function redirect_back(): void {
        $back = wp_get_referer() ?: admin_url('admin.php?page=adf-queue');
        wp_safe_redirect($back);
        exit;
    }

    /* ----------------------------------------------------------------- *
     * CSV export (§8 tickets/volunteers)
     * ----------------------------------------------------------------- */

    public function maybe_export_csv(): void {
        if (empty($_GET['adf_export']) || ! current_user_can('manage_options')) {
            return;
        }
        check_admin_referer('adf_export');
        $what = sanitize_key((string) $_GET['adf_export']);

        // Ticket/order CSV is handled by TicketsAdmin::maybe_export_orders().

        if ($what === 'volunteers') {
            global $wpdb;
            $rows = $wpdb->get_results('SELECT * FROM ' . \ADF\VolunteerSignups::table() . ' ORDER BY shift_start ASC');
            $this->stream_csv('adf-volunteers.csv', ['Name', 'Email', 'Phone', 'Opportunity', 'Shift', 'Status', 'Checked in'], array_map(static function ($r) {
                $shift = \ADF\Volunteers::shift((int) $r->opportunity_id, $r->shift_id);
                return [
                    $r->name,
                    $r->email,
                    $r->phone,
                    get_the_title((int) $r->opportunity_id),
                    $shift['label'] ?? $r->shift_id,
                    $r->status,
                    $r->checked_in ? 'yes' : 'no',
                ];
            }, $rows ?: []));
        }
    }

    private function stream_csv(string $filename, array $header, array $rows): void {
        nocache_headers();
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename=' . $filename);
        $out = fopen('php://output', 'w');
        fputcsv($out, $header);
        foreach ($rows as $row) {
            fputcsv($out, $row);
        }
        fclose($out);
        exit;
    }

    private function count_by_status(string $slug): array {
        $out = [];
        foreach ([Fields::STATUS_PENDING_REVIEW, Fields::STATUS_APPROVED, Fields::STATUS_REJECTED] as $status) {
            $q = new \WP_Query([
                'post_type'      => $slug,
                'post_status'    => 'any',
                'fields'         => 'ids',
                'posts_per_page' => 1,
                'meta_query'     => [['key' => Fields::key('status'), 'value' => $status]],
            ]);
            $out[$status] = (int) $q->found_posts;
        }
        return $out;
    }
}
