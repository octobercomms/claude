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
        add_action('admin_post_oe_import_contacts', [$this, 'handle_import_contacts']);
        add_action('admin_post_oe_import_brevo', [$this, 'handle_import_brevo']);
        add_action('admin_post_oe_cleanup_contacts', [$this, 'handle_cleanup_contacts']);
        add_action('admin_init', [$this, 'maybe_export_csv']);
        Settings::get_instance()->init();
        TicketsAdmin::get_instance()->init();
        TasksAdmin::get_instance()->init();
    }

    public function register_menu(): void {
        $cap = 'manage_options';

        $brand = (string) \OE\Settings::get('brand_name', 'October Events');
        add_menu_page($brand, $brand, $cap, 'october-events', [$this, 'page_dashboard'], 'dashicons-art', 28);
        add_submenu_page('october-events', 'Dashboard', 'Dashboard', $cap, 'october-events', [$this, 'page_dashboard']);
        // Events: the native CPT list (managed in WordPress / JetEngine).
        add_submenu_page('october-events', 'Events', 'Events', $cap, 'edit.php?post_type=' . PostTypes::slug('event'));
        // Tickets: registrations + promo codes live here as tabs.
        // Per-site feature toggles (Settings → Features) hide the modules a site
        // doesn't use. Dashboard, Events and Settings are always available.
        $f = static fn(string $key): bool => \OE\Features::enabled($key);
        if ($f('tickets'))      { add_submenu_page('october-events', 'Tickets', 'Tickets', $cap, 'oe-tickets', [$this, 'page_tickets']); }
        if ($f('directory'))    { add_submenu_page('october-events', 'Directory', 'Directory', $cap, 'oe-directory', fn() => $this->page_listing('directory')); }
        if ($f('destinations')) { add_submenu_page('october-events', 'Destinations', 'Destinations', $cap, 'oe-destinations', fn() => $this->page_listing('destination')); }
        if ($f('products'))     { add_submenu_page('october-events', 'Products', 'Products', $cap, 'oe-products', fn() => $this->page_listing('product')); }
        if ($f('stories'))      { add_submenu_page('october-events', 'Stories', 'Stories', $cap, 'oe-stories', fn() => $this->page_listing('story')); }
        if ($f('accounts'))     { add_submenu_page('october-events', 'Accounts', 'Accounts', $cap, 'oe-accounts', [$this, 'page_accounts']); }
        if ($f('volunteers'))   { add_submenu_page('october-events', 'Volunteers', 'Volunteers', $cap, 'oe-volunteers', [$this, 'page_volunteers']); }
        if ($f('contacts'))     { add_submenu_page('october-events', 'Contacts', 'Contacts', $cap, 'oe-contacts', [$this, 'page_contacts']); }
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

    /**
     * Headline KPI cards — the festival's key numbers, identical to the platform
     * Dashboard (same `oe/v1/stats` data source). Renders a 4-card row.
     */
    public static function kpis(): void {
        $d   = \OE\Reports\Rest::data();
        $cur = (string) $d['currency'];
        $sym = ['USD' => '$', 'GBP' => '£', 'EUR' => '€'][$cur] ?? ($cur . ' ');
        $money = static function ($n) use ($sym): string {
            return $sym . number_format((float) $n, 0);
        };
        $tot   = (int) $d['events_total'];
        $live  = (int) ($d['events_live'] ?? 0);

        $cards = [
            ['Tickets sold', number_format_i18n((int) $d['tickets_year']), $d['year'] . ' to date',      true,  ''],
            ['Revenue',      $money($d['revenue_year']),                   $d['year'] . ' to date',      false, ''],
            ['Subscribers',  number_format_i18n((int) $d['subscribers']),  'on the email list',          false, ''],
            ['Events live',  $live . '/' . $tot,                           'published on the site',      false, ''],
        ];
        echo '<div class="oe-kpis">';
        foreach ($cards as [$label, $value, $sub, $dark, $dot]) {
            echo '<div class="oe-kpi' . ($dark ? ' dark' : '') . '">'
                . '<div class="k">' . esc_html($label) . '</div>'
                . '<div class="v">' . esc_html((string) $value) . '</div>'
                . '<div class="s">' . ($dot ? '<i class="dot ' . esc_attr($dot) . '"></i>' : '') . esc_html($sub) . '</div>'
                . '</div>';
        }
        echo '</div>';
    }

    /** The staff platform URL (Settings → platform_url, else first non-preview origin). */
    public static function platform_url(): string {
        $url = trim((string) \OE\Settings::get('platform_url', ''));
        if ($url === '') {
            $origins = array_values(array_filter((array) \OE\Settings::get('platform_origins', [])));
            // Prefer a real custom domain over the *.pages.dev build/preview host.
            foreach ($origins as $o) {
                if (strpos((string) $o, '.pages.dev') === false) {
                    $url = (string) $o;
                    break;
                }
            }
            if ($url === '') {
                $url = (string) ($origins[0] ?? '');
            }
        }
        return $url !== '' ? untrailingslashit($url) : '';
    }

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
        // Pending submissions, surfaced for inline approve/reject right here
        // (the approval queue lives on the dashboard now — no separate page).
        $pending = get_posts([
            'post_type'      => PostTypes::listing_slugs(),
            'post_status'    => 'any',
            'posts_per_page' => 50,
            'meta_query'     => [['key' => Fields::key('status'), 'value' => Fields::STATUS_PENDING_REVIEW]],
            'orderby'        => 'date',
            'order'          => 'ASC',
        ]);
        require OE_DIR . 'admin/views/dashboard.php';
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
        $tab = isset($_GET['tab']) ? sanitize_key((string) $_GET['tab']) : 'orders';
        if ($tab === 'promos') {
            TicketsAdmin::get_instance()->render_promos();
        } elseif ($tab === 'checkin') {
            TicketsAdmin::get_instance()->render_checkin_log();
        } elseif ($tab === 'waitlist') {
            TicketsAdmin::get_instance()->render_waitlist();
        } elseif ($tab === 'sales') {
            TicketsAdmin::get_instance()->render_sales();
        } elseif ($tab === 'failed') {
            TicketsAdmin::get_instance()->render_failed_payments();
        } elseif ($tab === 'transactions') {
            TicketsAdmin::get_instance()->render_transactions();
        } else {
            TicketsAdmin::get_instance()->render_registrations();
        }
    }

    /** Tab nav shared by the Tickets sub-screens. */
    public static function tickets_tabs(string $active): void {
        $tabs = [
            'orders'   => [__('Registrations', 'october-events'), admin_url('admin.php?page=oe-tickets')],
            'transactions' => [__('Transactions', 'october-events'), admin_url('admin.php?page=oe-tickets&tab=transactions')],
            'sales'    => [__('Sales', 'october-events'),         admin_url('admin.php?page=oe-tickets&tab=sales')],
            'promos'   => [__('Promo codes', 'october-events'),   admin_url('admin.php?page=oe-tickets&tab=promos')],
            'waitlist' => [__('Waitlist', 'october-events'),      admin_url('admin.php?page=oe-tickets&tab=waitlist')],
            'checkin'  => [__('Check-in log', 'october-events'),  admin_url('admin.php?page=oe-tickets&tab=checkin')],
            'failed'   => [__('Failed payments', 'october-events'), admin_url('admin.php?page=oe-tickets&tab=failed')],
        ];
        echo '<h2 class="nav-tab-wrapper">';
        foreach ($tabs as $key => $t) {
            printf(
                '<a href="%s" class="nav-tab%s">%s</a>',
                esc_url($t[1]),
                $active === $key ? ' nav-tab-active' : '',
                esc_html($t[0])
            );
        }
        echo '</h2>';
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


    public function page_contacts(): void {
        $counts   = \OE\Mail\Contacts::counts();
        $contacts = \OE\Mail\Contacts::search('', 50, 0);
        $lists    = \OE\Mail\Lists::all();
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

    public function handle_import_brevo(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('oe_import_brevo');
        @set_time_limit(0); // large one-shot import
        $res = ['ok' => false];
        if (! empty($_FILES['oe_brevo_csv']['tmp_name']) && is_uploaded_file($_FILES['oe_brevo_csv']['tmp_name'])) {
            $res = \OE\Mail\Lists::import_brevo((string) $_FILES['oe_brevo_csv']['tmp_name']);
        }
        set_transient('oe_brevo_import', $res, 120);
        wp_safe_redirect(admin_url('admin.php?page=oe-contacts'));
        exit;
    }

    public function handle_cleanup_contacts(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('oe_cleanup_contacts');
        @set_time_limit(0);
        $done = 0;
        // Process in chunks until caught up (capped so a runaway can't loop forever).
        for ($i = 0; $i < 60; $i++) {
            $n = \OE\Mail\Enrich::backfill(1000);
            $done += $n;
            if ($n < 1000) {
                break;
            }
        }
        set_transient('oe_cleanup_done', $done, 120);
        wp_safe_redirect(admin_url('admin.php?page=oe-contacts'));
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
        wp_safe_redirect(add_query_arg('digest', 'sent', admin_url('admin.php?page=oe-settings#email-tools')));
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
        $back = wp_get_referer() ?: admin_url('admin.php?page=october-events');
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
