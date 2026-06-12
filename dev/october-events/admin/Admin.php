<?php
declare(strict_types=1);

namespace OE\Admin;

use OE\PostTypes;
use OE\Fields;
use OE\Submission;
use OE\Volunteers;
use OE\AuditLog;

defined('ABSPATH') || exit;

/**
 * October Events admin menu + screens (§8).
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
        add_action('admin_post_oe_approve', [$this, 'handle_approve']);
        add_action('admin_post_oe_reject', [$this, 'handle_reject']);
        add_action('admin_post_oe_volunteer_status', [$this, 'handle_volunteer_status']);
        add_action('admin_post_oe_send_digest', [$this, 'handle_send_digest']);
        add_action('admin_post_oe_rebuild_contacts', [$this, 'handle_rebuild_contacts']);
        add_action('admin_post_oe_seed_planning', [$this, 'handle_seed_planning']);
        add_action('admin_post_oe_import_contacts', [$this, 'handle_import_contacts']);
        add_action('admin_init', [$this, 'maybe_export_csv']);
        Settings::get_instance()->init();
        TicketsAdmin::get_instance()->init();
        PlanningAdmin::get_instance()->init();
        TasksAdmin::get_instance()->init();
    }

    public function register_menu(): void {
        $cap = 'manage_options';

        $brand = (string) \OE\Settings::get('brand_name', 'October Events');
        add_menu_page($brand, $brand, $cap, 'october-events', [$this, 'page_dashboard'], 'dashicons-art', 28);
        add_submenu_page('october-events', 'Dashboard', 'Dashboard', $cap, 'october-events', [$this, 'page_dashboard']);
        add_submenu_page('october-events', 'Accounts', 'Accounts', $cap, 'oe-accounts', [$this, 'page_accounts']);
        add_submenu_page('october-events', 'Approval Queue', 'Approval Queue', $cap, 'oe-queue', [$this, 'page_queue']);
        add_submenu_page('october-events', 'Directory', 'Directory', $cap, 'oe-directory', fn() => $this->page_listing('directory'));
        add_submenu_page('october-events', 'Destinations', 'Destinations', $cap, 'oe-destinations', fn() => $this->page_listing('destination'));
        add_submenu_page('october-events', 'Products', 'Products', $cap, 'oe-products', fn() => $this->page_listing('product'));
        add_submenu_page('october-events', 'Events', 'Events', $cap, 'oe-events', fn() => $this->page_listing('event'));
        add_submenu_page('october-events', 'Event Planning', 'Event Planning', $cap, 'oe-planning', [PlanningAdmin::get_instance(), 'render_list']);
        add_submenu_page('october-events', 'Registrations', 'Tickets', $cap, 'oe-tickets', [$this, 'page_tickets']);
        add_submenu_page('october-events', 'Promo Codes', 'Promo Codes', $cap, 'oe-promos', [TicketsAdmin::get_instance(), 'render_promos']);
        add_submenu_page('october-events', 'Volunteers', 'Volunteers', $cap, 'oe-volunteers', [$this, 'page_volunteers']);
        add_submenu_page('october-events', 'Tasks', 'Tasks', $cap, 'oe-tasks', [TasksAdmin::get_instance(), 'render']);
        add_submenu_page('october-events', 'Stories', 'Stories', $cap, 'oe-stories', fn() => $this->page_listing('story'));
        add_submenu_page('october-events', 'Email', 'Email', $cap, 'oe-email', [$this, 'page_email']);
        add_submenu_page('october-events', 'Contacts', 'Contacts', $cap, 'oe-contacts', [$this, 'page_contacts']);
        add_submenu_page('october-events', 'Settings', 'Settings', $cap, 'oe-settings', [Settings::get_instance(), 'render']);
    }

    /* ----------------------------------------------------------------- *
     * "What you can do" intro bento (rendered at the top of each screen)
     * ----------------------------------------------------------------- */

    /** @var array<string,array{title:string,text:string,steps:array<int,array{0:string,1:string}>}> */
    private const BENTOS = [
        'dashboard' => ['title' => 'Run the whole festival from here', 'text' => 'Accounts, listings, tickets, volunteers and email — one place. The planning platform is the friendlier front-end on the same data.',
            'steps' => [['Review submissions', 'Approve or reject in the queue'], ['Manage tickets', 'Sales, comps, check-in'], ['Coordinate volunteers', 'Shifts and signups'], ['Send email', 'Contacts, campaigns, the digest']]],
        'queue' => ['title' => 'Approve what people submit', 'text' => 'Every listing submitted across the site lands here for review.',
            'steps' => [['Read it', 'Open the submission'], ['Approve', 'Publishes it live + emails them'], ['Reject', 'Refunds any payment + emails them'], ['Filter', 'By listing type']]],
        'accounts' => ['title' => 'Everyone with an account', 'text' => 'Partners, exhibitors and submitters — and what they’re allowed to auto-publish.',
            'steps' => [['Find an account', 'Search the list'], ['Auto-approve', 'Per listing type'], ['See their listings', 'What they’ve submitted'], ['Contact', 'Email on file']]],
        'listing' => ['title' => 'Manage this listing type', 'text' => 'Add entries manually or edit what was submitted — same data the public site shows.',
            'steps' => [['Add new', 'Create one by hand'], ['Edit', 'Update details + media'], ['Status', 'Draft / pending / published'], ['Feature', 'Flag for the email digest']]],
        'planning' => ['title' => 'Get every event to green', 'text' => 'The confirm→green workflow: an event publishes only once its essentials are complete.',
            'steps' => [['Open an event', 'See its readiness'], ['Fill essentials', 'Title, dates, price, location'], ['Confirm', 'Goes green + publishes'], ['Track', 'Completion across all events']]],
        'tickets' => ['title' => 'Tickets & registrations', 'text' => 'Sales, manual/comp entry, refunds and the door check-in — all here.',
            'steps' => [['Add an order', 'Comp or paid, by hand'], ['Refund / cancel', 'With Stripe refund'], ['Export', 'CSV of registrations'], ['Check-in', 'QR scanning at the door']]],
        'promos' => ['title' => 'Promo codes', 'text' => 'Percentage or fixed discounts for ticket checkout, scoped and capped.',
            'steps' => [['Create a code', 'Percent or fixed'], ['Scope it', 'To an event / window'], ['Cap uses', 'Max redemptions'], ['Track', 'How often it’s used']]],
        'volunteers' => ['title' => 'Staff every shift', 'text' => 'Each opportunity carries shifts with capacity; manage who’s confirmed and check them in.',
            'steps' => [['Pick an opportunity', 'See its shifts'], ['Decide on signups', 'Confirm / decline / no-show'], ['Remind', 'Email (SMS when on)'], ['Check in', 'On the day']]],
        'tasks' => ['title' => 'The team’s shared task board', 'text' => 'Department-grouped work, the same board the platform shows.',
            'steps' => [['Add a task', 'Title + department'], ['Set status', 'To do → done'], ['Assign', 'Owner + due date'], ['Group', 'By department']]],
        'email' => ['title' => 'All your email in one place', 'text' => 'Native sending (SES), a unified contact list, campaigns and the monthly digest.',
            'steps' => [['Check sending', 'SES status + test'], ['Grow contacts', 'Auto-built, no imports'], ['Build campaigns', 'In the platform'], ['Send the digest', 'Monthly, to subscribers']]],
        'contacts' => ['title' => 'Your audience, unified', 'text' => 'Built automatically from accounts, ticket buyers, volunteers and submitters.',
            'steps' => [['Rebuild', 'From existing data'], ['See counts', 'Subscribed / unsubscribed / SMS'], ['Browse', 'Recent contacts'], ['Use in email', 'Audiences come from here']]],
        'settings' => ['title' => 'Configure everything', 'text' => 'Brand, API keys, pricing, the AI voice, email (SES), SMS, chat and the platform theme.',
            'steps' => [['Brand & theme', 'Name, colours, logo, font'], ['Connect services', 'Stripe, SES, SMS, Chatwoot'], ['Train the AI', 'House voice + examples'], ['Updates', 'GitHub self-updater']]],
    ];

    public static function bento(string $key): void {
        $b = self::BENTOS[$key] ?? null;
        if (! $b) {
            return;
        }
        echo '<section class="oe-bento"><div class="oe-bento-kicker">' . esc_html__('What you can do here', 'october-events') . '</div>';
        echo '<h2>' . esc_html($b['title']) . '</h2><p>' . esc_html($b['text']) . '</p><div class="oe-bento-steps">';
        $n = 0;
        foreach ($b['steps'] as $step) {
            $n++;
            echo '<div class="oe-bento-step"><span class="n">' . (int) $n . '</span><span class="l">' . esc_html($step[0]) . '</span><span class="d">' . esc_html($step[1]) . '</span></div>';
        }
        echo '</div></section>';
    }

    /* ----------------------------------------------------------------- *
     * Pages
     * ----------------------------------------------------------------- */

    public function page_dashboard(): void {
        $counts = [];
        foreach (PostTypes::listing_types() as $type) {
            $counts[$type] = $this->count_by_status(PostTypes::slug($type));
        }
        require OE_DIR . 'admin/views/dashboard.php';
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
        require OE_DIR . 'admin/views/queue.php';
    }

    public function page_accounts(): void {
        $accounts = get_posts([
            'post_type'      => PostTypes::slug('account'),
            'post_status'    => 'any',
            'posts_per_page' => 200,
        ]);
        require OE_DIR . 'admin/views/accounts.php';
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
        require OE_DIR . 'admin/views/listing.php';
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
        require OE_DIR . 'admin/views/volunteers.php';
    }

    public function page_email(): void {
        require OE_DIR . 'admin/views/email.php';
    }

    public function page_contacts(): void {
        $counts   = \OE\Mail\Contacts::counts();
        $contacts = \OE\Mail\Contacts::search('', 50, 0);
        require OE_DIR . 'admin/views/contacts.php';
    }

    public function handle_rebuild_contacts(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('oe_rebuild_contacts');
        \OE\Mail\Contacts::backfill();
        wp_safe_redirect(add_query_arg('rebuilt', '1', admin_url('admin.php?page=oe-contacts')));
        exit;
    }

    public function handle_seed_planning(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('oe_seed_planning');
        $n = \OE\Planning\Events::seed_from_existing();
        wp_safe_redirect(add_query_arg('seeded', (string) $n, admin_url('admin.php?page=oe-planning')));
        exit;
    }

    public function handle_import_contacts(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('oe_import_contacts');
        $added = 0;
        if (! empty($_FILES['oe_csv']['tmp_name']) && is_uploaded_file($_FILES['oe_csv']['tmp_name'])) {
            $added = \OE\Mail\Contacts::import_csv((string) $_FILES['oe_csv']['tmp_name']);
        }
        wp_safe_redirect(add_query_arg('imported', (string) $added, admin_url('admin.php?page=oe-contacts')));
        exit;
    }

    /* ----------------------------------------------------------------- *
     * Actions
     * ----------------------------------------------------------------- */

    public function handle_approve(): void {
        $id = $this->verify_action('oe_approve');
        Submission::approve($id, false);
        $this->redirect_back();
    }

    public function handle_reject(): void {
        $id = $this->verify_action('oe_reject');
        Submission::reject($id);
        $this->redirect_back();
    }

    public function handle_volunteer_status(): void {
        $id = $this->verify_action('oe_volunteer_status'); // signup id (table row)
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
        check_admin_referer('oe_send_digest');
        (new \OE\Cron())->run_digest();
        wp_safe_redirect(add_query_arg('digest', 'sent', admin_url('admin.php?page=oe-email')));
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
        $back = wp_get_referer() ?: admin_url('admin.php?page=oe-queue');
        wp_safe_redirect($back);
        exit;
    }

    /* ----------------------------------------------------------------- *
     * CSV export (§8 tickets/volunteers)
     * ----------------------------------------------------------------- */

    public function maybe_export_csv(): void {
        if (empty($_GET['oe_export']) || ! current_user_can('manage_options')) {
            return;
        }
        check_admin_referer('oe_export');
        $what = sanitize_key((string) $_GET['oe_export']);

        // Ticket/order CSV is handled by TicketsAdmin::maybe_export_orders().

        if ($what === 'volunteers') {
            global $wpdb;
            $rows = $wpdb->get_results('SELECT * FROM ' . \OE\VolunteerSignups::table() . ' ORDER BY shift_start ASC');
            $this->stream_csv('oe-volunteers.csv', ['Name', 'Email', 'Phone', 'Opportunity', 'Shift', 'Status', 'Checked in'], array_map(static function ($r) {
                $shift = \OE\Volunteers::shift((int) $r->opportunity_id, $r->shift_id);
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
