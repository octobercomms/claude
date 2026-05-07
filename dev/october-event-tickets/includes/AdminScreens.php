<?php
declare(strict_types=1);

namespace OctoberTickets;

defined('ABSPATH') || exit;

/**
 * Admin screens: Registrations, Check-in Log, Promo Codes.
 */
class AdminScreens {

    private static ?AdminScreens $instance = null;

    private function __construct() {}

    public static function get_instance(): self {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function init(): void {
        add_action('admin_menu', [$this, 'register_menus']);
        add_action('admin_post_oct_cancel_order',      [$this, 'handle_cancel_order']);
        add_action('admin_post_oct_export_orders',     [$this, 'handle_export_orders']);
        add_action('admin_post_oct_save_promo',        [$this, 'handle_save_promo']);
        add_action('admin_post_oct_delete_promo',      [$this, 'handle_delete_promo']);
        add_action('admin_enqueue_scripts',            [$this, 'enqueue_assets']);
    }

    public function enqueue_assets(string $hook): void {
        if (strpos($hook, 'oct-') === false && strpos($hook, 'october') === false) {
            return;
        }
        wp_enqueue_style('oct-admin', OCT_TICKETS_URL . 'assets/css/admin.css', [], OCT_TICKETS_VERSION);

        if (strpos($hook, 'oct-dashboard') !== false) {
            wp_enqueue_script(
                'chart-js',
                'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js',
                [],
                '4',
                true
            );
        }
    }

    public function register_menus(): void {
        add_menu_page(
            __('Event Tickets', 'october-event-tickets'),
            __('Event Tickets', 'october-event-tickets'),
            'manage_options',
            'oct-registrations',
            [$this, 'render_registrations'],
            'dashicons-tickets-alt',
            30
        );

        add_submenu_page(
            'oct-registrations',
            __('Dashboard', 'october-event-tickets'),
            __('Dashboard', 'october-event-tickets'),
            'manage_options',
            'oct-dashboard',
            [$this, 'render_dashboard']
        );

        add_submenu_page(
            'oct-registrations',
            __('Registrations', 'october-event-tickets'),
            __('Registrations', 'october-event-tickets'),
            'manage_options',
            'oct-registrations',
            [$this, 'render_registrations']
        );

        add_submenu_page(
            'oct-registrations',
            __('Check-in Log', 'october-event-tickets'),
            __('Check-in Log', 'october-event-tickets'),
            'manage_options',
            'oct-checkin-log',
            [$this, 'render_checkin_log']
        );

        add_submenu_page(
            'oct-registrations',
            __('Promo Codes', 'october-event-tickets'),
            __('Promo Codes', 'october-event-tickets'),
            'manage_options',
            'oct-promo-codes',
            [$this, 'render_promo_codes']
        );

        add_submenu_page(
            'oct-registrations',
            __('Waitlist', 'october-event-tickets'),
            __('Waitlist', 'october-event-tickets'),
            'manage_options',
            'oct-waitlist',
            [$this, 'render_waitlist']
        );
    }

    // =========================================================================
    // Dashboard Screen
    // =========================================================================

    public function render_dashboard(): void {
        if (!current_user_can('manage_options')) {
            return;
        }

        $settings        = Settings::get_instance();
        $currency_symbol = $settings->get_currency_symbol();
        $stats           = DB::get_overall_stats();
        $per_event       = DB::get_event_sales_summary();
        $daily           = DB::get_daily_sales(30);

        // Build chart data — fill in missing days with zeroes
        $labels         = [];
        $ticket_data    = [];
        $revenue_data   = [];
        $daily_indexed  = [];
        foreach ($daily as $row) {
            $daily_indexed[$row->sale_date] = $row;
        }
        for ($i = 29; $i >= 0; $i--) {
            $date            = date('Y-m-d', strtotime("-{$i} days"));
            $labels[]        = date('M j', strtotime($date));
            $ticket_data[]   = isset($daily_indexed[$date]) ? (int) $daily_indexed[$date]->tickets_count : 0;
            $revenue_data[]  = isset($daily_indexed[$date]) ? round((float) $daily_indexed[$date]->revenue, 2) : 0;
        }
        ?>
        <div class="wrap oct-dashboard">
            <h1><?php esc_html_e('Ticket Sales Dashboard', 'october-event-tickets'); ?></h1>

            <!-- Summary Cards -->
            <div class="oct-stat-cards">
                <div class="oct-stat-card">
                    <span class="oct-stat-value"><?php echo esc_html((string)(int)$stats->total_tickets); ?></span>
                    <span class="oct-stat-label"><?php esc_html_e('Total Tickets Sold', 'october-event-tickets'); ?></span>
                </div>
                <div class="oct-stat-card oct-stat-card--green">
                    <span class="oct-stat-value"><?php echo esc_html($currency_symbol . number_format((float)$stats->total_revenue, 2)); ?></span>
                    <span class="oct-stat-label"><?php esc_html_e('Total Revenue', 'october-event-tickets'); ?></span>
                </div>
                <div class="oct-stat-card oct-stat-card--blue">
                    <span class="oct-stat-value"><?php echo esc_html((string)(int)$stats->tickets_today); ?></span>
                    <span class="oct-stat-label"><?php esc_html_e('Tickets Sold Today', 'october-event-tickets'); ?></span>
                </div>
                <div class="oct-stat-card oct-stat-card--amber">
                    <span class="oct-stat-value"><?php echo esc_html($currency_symbol . number_format((float)$stats->revenue_today, 2)); ?></span>
                    <span class="oct-stat-label"><?php esc_html_e('Revenue Today', 'october-event-tickets'); ?></span>
                </div>
            </div>

            <!-- Charts -->
            <div class="oct-charts-row">
                <div class="oct-chart-wrap">
                    <h2><?php esc_html_e('Tickets Sold — Last 30 Days', 'october-event-tickets'); ?></h2>
                    <canvas id="oct-tickets-chart" height="80"></canvas>
                </div>
                <div class="oct-chart-wrap">
                    <h2><?php esc_html_e('Revenue — Last 30 Days', 'october-event-tickets'); ?></h2>
                    <canvas id="oct-revenue-chart" height="80"></canvas>
                </div>
            </div>

            <!-- Per-Event Table -->
            <h2 style="margin-top:30px;"><?php esc_html_e('Sales by Event', 'october-event-tickets'); ?></h2>
            <table class="wp-list-table widefat fixed striped">
                <thead>
                    <tr>
                        <th><?php esc_html_e('Event', 'october-event-tickets'); ?></th>
                        <th style="width:120px;"><?php esc_html_e('Tickets Sold', 'october-event-tickets'); ?></th>
                        <th style="width:140px;"><?php esc_html_e('Revenue', 'october-event-tickets'); ?></th>
                        <th style="width:160px;"><?php esc_html_e('Last Sale', 'october-event-tickets'); ?></th>
                        <th style="width:100px;"></th>
                    </tr>
                </thead>
                <tbody>
                <?php if (empty($per_event)) : ?>
                    <tr><td colspan="5"><?php esc_html_e('No sales yet.', 'october-event-tickets'); ?></td></tr>
                <?php else : ?>
                    <?php foreach ($per_event as $row) : ?>
                    <tr>
                        <td><strong><?php echo esc_html($row->event_title); ?></strong></td>
                        <td><?php echo esc_html((string)(int)$row->total_tickets); ?></td>
                        <td><?php echo esc_html($currency_symbol . number_format((float)$row->total_revenue, 2)); ?></td>
                        <td><?php echo esc_html(date_i18n(get_option('date_format') . ' ' . get_option('time_format'), strtotime($row->last_sale))); ?></td>
                        <td>
                            <a href="<?php echo esc_url(admin_url('admin.php?page=oct-registrations&event_id=' . intval($row->event_id))); ?>">
                                <?php esc_html_e('View Orders', 'october-event-tickets'); ?>
                            </a>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                <?php endif; ?>
                </tbody>
            </table>

            <!-- Events & Check-in PINs -->
            <?php
            $all_events = get_posts([
                'post_type'      => 'events',
                'post_status'    => 'publish',
                'posts_per_page' => -1,
                'orderby'        => 'title',
                'order'          => 'ASC',
            ]);
            $checkin_base = home_url('/checkin/');
            ?>
            <h2 style="margin-top:30px;"><?php esc_html_e('Events &amp; Check-in PINs', 'october-event-tickets'); ?></h2>
            <table class="wp-list-table widefat fixed striped">
                <thead>
                    <tr>
                        <th><?php esc_html_e('Event', 'october-event-tickets'); ?></th>
                        <th style="width:120px;"><?php esc_html_e('Check-in PIN', 'october-event-tickets'); ?></th>
                        <th><?php esc_html_e('Check-in App URL', 'october-event-tickets'); ?></th>
                        <th style="width:100px;"></th>
                    </tr>
                </thead>
                <tbody>
                <?php if (empty($all_events)) : ?>
                    <tr><td colspan="4"><?php esc_html_e('No published events found.', 'october-event-tickets'); ?></td></tr>
                <?php else : ?>
                    <?php foreach ($all_events as $ev) :
                        $pin = get_post_meta($ev->ID, '_oct_checkin_pin', true);
                        if ($pin === '' || $pin === false) $pin = (string) $ev->ID;
                    ?>
                    <tr>
                        <td><strong><?php echo esc_html($ev->post_title); ?></strong></td>
                        <td><code style="font-size:1.1em;"><?php echo esc_html($pin); ?></code></td>
                        <td><a href="<?php echo esc_url($checkin_base); ?>" target="_blank"><?php echo esc_html($checkin_base); ?></a></td>
                        <td>
                            <a href="<?php echo esc_url(get_edit_post_link($ev->ID)); ?>">
                                <?php esc_html_e('Edit Event', 'october-event-tickets'); ?>
                            </a>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                <?php endif; ?>
                </tbody>
            </table>
        </div>

        <script>
        (function() {
            const labels  = <?php echo wp_json_encode($labels); ?>;
            const tickets = <?php echo wp_json_encode($ticket_data); ?>;
            const revenue = <?php echo wp_json_encode($revenue_data); ?>;
            const accent  = '#C8A96E';
            const blue    = '#4A90D9';
            const opts    = {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true } }
            };

            new Chart(document.getElementById('oct-tickets-chart'), {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{ data: tickets, backgroundColor: accent, borderRadius: 3 }]
                },
                options: opts
            });

            new Chart(document.getElementById('oct-revenue-chart'), {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        data: revenue,
                        borderColor: blue,
                        backgroundColor: blue + '22',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 3
                    }]
                },
                options: opts
            });
        })();
        </script>

        <style>
        .oct-dashboard .oct-stat-cards {
            display: flex; gap: 16px; flex-wrap: wrap; margin: 20px 0;
        }
        .oct-stat-card {
            background: #fff; border: 1px solid #ddd; border-radius: 6px;
            padding: 20px 24px; min-width: 160px; text-align: center;
            border-top: 4px solid #C8A96E;
        }
        .oct-stat-card--green  { border-top-color: #46b450; }
        .oct-stat-card--blue   { border-top-color: #4A90D9; }
        .oct-stat-card--amber  { border-top-color: #f0a500; }
        .oct-stat-value { display: block; font-size: 2rem; font-weight: 700; color: #1a1a1a; }
        .oct-stat-label { display: block; font-size: 0.8rem; color: #666; margin-top: 4px; }
        .oct-charts-row { display: flex; gap: 24px; flex-wrap: wrap; margin: 24px 0; }
        .oct-chart-wrap { flex: 1; min-width: 300px; background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 16px; }
        .oct-chart-wrap h2 { margin-top: 0; font-size: 1rem; }
        </style>
        <?php
    }

    // =========================================================================
    // Registrations Screen
    // =========================================================================

    public function render_registrations(): void {
        if (!current_user_can('manage_options')) {
            return;
        }

        // Handle bulk cancel
        if (isset($_POST['action']) && $_POST['action'] === 'cancel_selected' &&
            check_admin_referer('oct_bulk_cancel')) {
            $ids = array_map('intval', (array) ($_POST['order_ids'] ?? []));
            foreach ($ids as $id) {
                DB::update_order_status($id, 'cancelled');
                DB::cancel_tickets_by_order($id);
            }
            echo '<div class="notice notice-success"><p>' . esc_html__('Selected orders cancelled.', 'october-event-tickets') . '</p></div>';
        }

        $search   = sanitize_text_field($_GET['search'] ?? '');
        $status   = sanitize_text_field($_GET['status'] ?? '');
        $event_id = (int) ($_GET['event_id'] ?? 0);
        $paged    = max(1, (int) ($_GET['paged'] ?? 1));
        $per_page = 30;

        $args  = array_filter([
            'email'    => $search,
            'status'   => $status,
            'event_id' => $event_id ?: null,
            'limit'    => $per_page,
            'offset'   => ($paged - 1) * $per_page,
        ]);
        $total  = DB::count_orders($args);
        $orders = DB::get_orders($args);

        $events = get_posts(['post_type' => 'events', 'posts_per_page' => 200, 'post_status' => 'any']);
        ?>
        <div class="wrap">
            <h1 class="wp-heading-inline"><?php esc_html_e('Registrations', 'october-event-tickets'); ?></h1>
            <a href="<?php echo esc_url(admin_url('admin-post.php?action=oct_export_orders&' . http_build_query(['search' => $search, 'status' => $status, 'event_id' => $event_id, '_nonce' => wp_create_nonce('oct_export_orders')]))); ?>"
               class="page-title-action"><?php esc_html_e('Export CSV', 'october-event-tickets'); ?></a>
            <hr class="wp-header-end">

            <!-- Filters -->
            <form method="get" class="oct-filters">
                <input type="hidden" name="page" value="oct-registrations">
                <input type="text" name="search" value="<?php echo esc_attr($search); ?>" placeholder="<?php esc_attr_e('Search email…', 'october-event-tickets'); ?>">
                <select name="event_id">
                    <option value=""><?php esc_html_e('All Events', 'october-event-tickets'); ?></option>
                    <?php foreach ($events as $e) : ?>
                        <option value="<?php echo esc_attr((string) $e->ID); ?>" <?php selected($event_id, $e->ID); ?>><?php echo esc_html($e->post_title); ?></option>
                    <?php endforeach; ?>
                </select>
                <select name="status">
                    <option value=""><?php esc_html_e('All Statuses', 'october-event-tickets'); ?></option>
                    <?php foreach (['pending', 'paid', 'cancelled', 'refunded'] as $s) : ?>
                        <option value="<?php echo esc_attr($s); ?>" <?php selected($status, $s); ?>><?php echo esc_html(ucfirst($s)); ?></option>
                    <?php endforeach; ?>
                </select>
                <?php submit_button(__('Filter', 'october-event-tickets'), 'secondary', '', false); ?>
            </form>

            <!-- Bulk action -->
            <form method="post">
                <?php wp_nonce_field('oct_bulk_cancel'); ?>
                <input type="hidden" name="action" value="cancel_selected">
                <input type="hidden" name="page" value="oct-registrations">

                <table class="wp-list-table widefat fixed striped">
                    <thead>
                        <tr>
                            <th class="check-column"><input type="checkbox" id="oct-check-all"></th>
                            <th><?php esc_html_e('#', 'october-event-tickets'); ?></th>
                            <th><?php esc_html_e('Event', 'october-event-tickets'); ?></th>
                            <th><?php esc_html_e('Email', 'october-event-tickets'); ?></th>
                            <th><?php esc_html_e('Name', 'october-event-tickets'); ?></th>
                            <th><?php esc_html_e('Ticket Type', 'october-event-tickets'); ?></th>
                            <th><?php esc_html_e('Qty', 'october-event-tickets'); ?></th>
                            <th><?php esc_html_e('Total', 'october-event-tickets'); ?></th>
                            <th><?php esc_html_e('Payment', 'october-event-tickets'); ?></th>
                            <th><?php esc_html_e('Status', 'october-event-tickets'); ?></th>
                            <th><?php esc_html_e('Date', 'october-event-tickets'); ?></th>
                            <th><?php esc_html_e('Actions', 'october-event-tickets'); ?></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php if (empty($orders)) : ?>
                            <tr><td colspan="12"><?php esc_html_e('No orders found.', 'october-event-tickets'); ?></td></tr>
                        <?php else : ?>
                            <?php foreach ($orders as $order) : ?>
                                <tr>
                                    <td><input type="checkbox" name="order_ids[]" value="<?php echo esc_attr((string) $order->id); ?>"></td>
                                    <td><?php echo esc_html((string) $order->id); ?></td>
                                    <td><?php echo esc_html(get_the_title((int) $order->event_id) ?: "#{$order->event_id}"); ?></td>
                                    <td><?php echo esc_html($order->email); ?></td>
                                    <td><?php echo esc_html($order->name); ?></td>
                                    <td><?php echo esc_html($order->ticket_type_label); ?></td>
                                    <td><?php echo esc_html((string) $order->qty); ?></td>
                                    <td><?php echo esc_html(number_format((float) $order->total, 2) . ' ' . $order->currency); ?></td>
                                    <td><?php echo esc_html(ucfirst($order->payment_method)); ?></td>
                                    <td><span class="oct-status oct-status--<?php echo esc_attr($order->status); ?>"><?php echo esc_html(ucfirst($order->status)); ?></span></td>
                                    <td><?php echo esc_html(date_i18n(get_option('date_format'), strtotime($order->created_at))); ?></td>
                                    <td>
                                        <a href="<?php echo esc_url(home_url('/oct-ticket/order/' . $order->id . '/?_nonce=' . wp_create_nonce('oct_order_' . $order->id))); ?>" target="_blank"><?php esc_html_e('Tickets', 'october-event-tickets'); ?></a>
                                        <?php if ($order->status !== 'cancelled') : ?>
                                            | <a href="<?php echo esc_url(admin_url('admin-post.php?action=oct_cancel_order&order_id=' . $order->id . '&_nonce=' . wp_create_nonce('oct_cancel_' . $order->id))); ?>"
                                                onclick="return confirm('<?php esc_attr_e('Cancel this order?', 'october-event-tickets'); ?>')"
                                                class="oct-link-danger"><?php esc_html_e('Cancel', 'october-event-tickets'); ?></a>
                                        <?php endif; ?>
                                    </td>
                                </tr>
                            <?php endforeach; ?>
                        <?php endif; ?>
                    </tbody>
                </table>

                <div class="oct-bulk-bar">
                    <button type="submit" class="button"><?php esc_html_e('Cancel Selected', 'october-event-tickets'); ?></button>
                </div>
            </form>

            <?php $this->render_pagination($total, $per_page, $paged, 'oct-registrations'); ?>
        </div>
        <?php
    }

    // =========================================================================
    // Check-in Log Screen
    // =========================================================================

    public function render_checkin_log(): void {
        if (!current_user_can('manage_options')) {
            return;
        }

        $event_id = (int) ($_GET['event_id'] ?? 0);
        $paged    = max(1, (int) ($_GET['paged'] ?? 1));
        $per_page = 50;

        $args     = array_filter(['event_id' => $event_id ?: null, 'limit' => $per_page, 'offset' => ($paged - 1) * $per_page]);
        $checkins = DB::get_checkins($args);
        $events   = get_posts(['post_type' => 'events', 'posts_per_page' => 200, 'post_status' => 'any']);

        if ($event_id) {
            $venue_stats  = DB::get_checkin_stats($event_id);
            $unique_scans = DB::get_unique_checkin_count($event_id);
        }
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('Check-in Log', 'october-event-tickets'); ?></h1>

            <form method="get" class="oct-filters">
                <input type="hidden" name="page" value="oct-checkin-log">
                <select name="event_id">
                    <option value=""><?php esc_html_e('All Events', 'october-event-tickets'); ?></option>
                    <?php foreach ($events as $e) : ?>
                        <option value="<?php echo esc_attr((string) $e->ID); ?>" <?php selected($event_id, $e->ID); ?>><?php echo esc_html($e->post_title); ?></option>
                    <?php endforeach; ?>
                </select>
                <?php submit_button(__('Filter', 'october-event-tickets'), 'secondary', '', false); ?>
            </form>

            <?php if ($event_id && !empty($venue_stats)) : ?>
                <div class="oct-stats-summary">
                    <h3><?php esc_html_e('Stats Summary', 'october-event-tickets'); ?></h3>
                    <p><strong><?php esc_html_e('Unique Tickets Scanned:', 'october-event-tickets'); ?></strong> <?php echo esc_html((string) $unique_scans); ?></p>
                    <table class="widefat" style="max-width:400px">
                        <thead><tr><th><?php esc_html_e('Venue', 'october-event-tickets'); ?></th><th><?php esc_html_e('Scans', 'october-event-tickets'); ?></th></tr></thead>
                        <tbody>
                            <?php foreach ($venue_stats as $vs) : ?>
                                <tr><td><?php echo esc_html($vs->venue_name); ?></td><td><?php echo esc_html((string) $vs->count); ?></td></tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>
            <?php endif; ?>

            <table class="wp-list-table widefat fixed striped">
                <thead>
                    <tr>
                        <th><?php esc_html_e('Ticket ID', 'october-event-tickets'); ?></th>
                        <th><?php esc_html_e('Event', 'october-event-tickets'); ?></th>
                        <th><?php esc_html_e('Attendee', 'october-event-tickets'); ?></th>
                        <th><?php esc_html_e('Ticket Type', 'october-event-tickets'); ?></th>
                        <th><?php esc_html_e('Ticket #', 'october-event-tickets'); ?></th>
                        <th><?php esc_html_e('Venue', 'october-event-tickets'); ?></th>
                        <th><?php esc_html_e('Scanned At', 'october-event-tickets'); ?></th>
                    </tr>
                </thead>
                <tbody>
                    <?php if (empty($checkins)) : ?>
                        <tr><td colspan="7"><?php esc_html_e('No check-ins found.', 'october-event-tickets'); ?></td></tr>
                    <?php else : ?>
                        <?php foreach ($checkins as $ci) : ?>
                            <tr>
                                <td><?php echo esc_html((string) $ci->ticket_id); ?></td>
                                <td><?php echo esc_html(get_the_title((int) $ci->event_id) ?: "#{$ci->event_id}"); ?></td>
                                <td><?php echo esc_html($ci->attendee_name ?? ''); ?></td>
                                <td><?php echo esc_html($ci->ticket_type_label ?? ''); ?></td>
                                <td><?php echo esc_html(isset($ci->ticket_number) ? "{$ci->ticket_number}/{$ci->total_in_order}" : ''); ?></td>
                                <td><?php echo esc_html($ci->venue_name); ?></td>
                                <td><?php echo esc_html(date_i18n(get_option('date_format') . ' ' . get_option('time_format'), strtotime($ci->scanned_at))); ?></td>
                            </tr>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </tbody>
            </table>
        </div>
        <?php
    }

    // =========================================================================
    // Promo Codes Screen
    // =========================================================================

    public function render_promo_codes(): void {
        if (!current_user_can('manage_options')) {
            return;
        }

        $promos = DB::get_all_promos();
        $events = get_posts(['post_type' => 'events', 'posts_per_page' => 200, 'post_status' => 'any']);

        // Show add form
        $edit_promo = null;
        if (isset($_GET['edit']) && is_numeric($_GET['edit'])) {
            global $wpdb;
            $edit_promo = $wpdb->get_row($wpdb->prepare(
                "SELECT * FROM {$wpdb->prefix}oct_promo_codes WHERE id = %d",
                (int) $_GET['edit']
            ));
        }
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('Promo Codes', 'october-event-tickets'); ?></h1>

            <!-- Add / Edit Form -->
            <div class="oct-card">
                <h2><?php echo $edit_promo ? esc_html__('Edit Promo Code', 'october-event-tickets') : esc_html__('Add New Promo Code', 'october-event-tickets'); ?></h2>
                <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                    <input type="hidden" name="action" value="oct_save_promo">
                    <?php if ($edit_promo) : ?>
                        <input type="hidden" name="promo_id" value="<?php echo esc_attr((string) $edit_promo->id); ?>">
                    <?php endif; ?>
                    <?php wp_nonce_field('oct_save_promo'); ?>

                    <table class="form-table">
                        <tr>
                            <th><?php esc_html_e('Code', 'october-event-tickets'); ?></th>
                            <td><input type="text" name="code" value="<?php echo esc_attr($edit_promo->code ?? ''); ?>" required style="text-transform:uppercase"></td>
                        </tr>
                        <tr>
                            <th><?php esc_html_e('Event', 'october-event-tickets'); ?></th>
                            <td>
                                <select name="event_id">
                                    <option value=""><?php esc_html_e('All Events', 'october-event-tickets'); ?></option>
                                    <?php foreach ($events as $e) : ?>
                                        <option value="<?php echo esc_attr((string) $e->ID); ?>" <?php selected($edit_promo->event_id ?? '', $e->ID); ?>><?php echo esc_html($e->post_title); ?></option>
                                    <?php endforeach; ?>
                                </select>
                            </td>
                        </tr>
                        <tr>
                            <th><?php esc_html_e('Discount Type', 'october-event-tickets'); ?></th>
                            <td>
                                <select name="discount_type">
                                    <option value="percent" <?php selected(($edit_promo->discount_type ?? 'percent'), 'percent'); ?>><?php esc_html_e('Percent (%)', 'october-event-tickets'); ?></option>
                                    <option value="fixed" <?php selected(($edit_promo->discount_type ?? ''), 'fixed'); ?>><?php esc_html_e('Fixed Amount', 'october-event-tickets'); ?></option>
                                </select>
                            </td>
                        </tr>
                        <tr>
                            <th><?php esc_html_e('Discount Value', 'october-event-tickets'); ?></th>
                            <td><input type="number" name="discount_value" value="<?php echo esc_attr((string) ($edit_promo->discount_value ?? '')); ?>" min="0" step="0.01" required></td>
                        </tr>
                        <tr>
                            <th><?php esc_html_e('Max Uses', 'october-event-tickets'); ?></th>
                            <td><input type="number" name="max_uses" value="<?php echo esc_attr((string) ($edit_promo->max_uses ?? '')); ?>" min="0" placeholder="<?php esc_attr_e('Unlimited', 'october-event-tickets'); ?>"></td>
                        </tr>
                        <tr>
                            <th><?php esc_html_e('Expires At', 'october-event-tickets'); ?></th>
                            <td><input type="datetime-local" name="expires_at" value="<?php echo esc_attr(isset($edit_promo->expires_at) && $edit_promo->expires_at ? date('Y-m-d\TH:i', strtotime($edit_promo->expires_at)) : ''); ?>"></td>
                        </tr>
                        <tr>
                            <th><?php esc_html_e('Active', 'october-event-tickets'); ?></th>
                            <td><input type="checkbox" name="active" value="1" <?php checked(($edit_promo->active ?? 1), 1); ?>></td>
                        </tr>
                    </table>

                    <?php submit_button($edit_promo ? __('Update Promo Code', 'october-event-tickets') : __('Add Promo Code', 'october-event-tickets')); ?>
                </form>
            </div>

            <!-- Promo Codes List -->
            <table class="wp-list-table widefat fixed striped">
                <thead>
                    <tr>
                        <th><?php esc_html_e('Code', 'october-event-tickets'); ?></th>
                        <th><?php esc_html_e('Event', 'october-event-tickets'); ?></th>
                        <th><?php esc_html_e('Type', 'october-event-tickets'); ?></th>
                        <th><?php esc_html_e('Value', 'october-event-tickets'); ?></th>
                        <th><?php esc_html_e('Uses', 'october-event-tickets'); ?></th>
                        <th><?php esc_html_e('Expires', 'october-event-tickets'); ?></th>
                        <th><?php esc_html_e('Active', 'october-event-tickets'); ?></th>
                        <th><?php esc_html_e('Actions', 'october-event-tickets'); ?></th>
                    </tr>
                </thead>
                <tbody>
                    <?php if (empty($promos)) : ?>
                        <tr><td colspan="8"><?php esc_html_e('No promo codes yet.', 'october-event-tickets'); ?></td></tr>
                    <?php else : ?>
                        <?php foreach ($promos as $promo) : ?>
                            <tr>
                                <td><strong><?php echo esc_html($promo->code); ?></strong></td>
                                <td><?php echo $promo->event_id ? esc_html(get_the_title((int) $promo->event_id) ?: "#{$promo->event_id}") : esc_html__('All Events', 'october-event-tickets'); ?></td>
                                <td><?php echo esc_html(ucfirst($promo->discount_type)); ?></td>
                                <td><?php echo $promo->discount_type === 'percent' ? esc_html((string) $promo->discount_value) . '%' : Settings::get_instance()->get_currency_symbol() . esc_html(number_format((float) $promo->discount_value, 2)); ?></td>
                                <td><?php echo esc_html((string) $promo->used_count); ?><?php echo $promo->max_uses !== null ? ' / ' . esc_html((string) $promo->max_uses) : ''; ?></td>
                                <td><?php echo $promo->expires_at ? esc_html(date_i18n(get_option('date_format'), strtotime($promo->expires_at))) : esc_html__('Never', 'october-event-tickets'); ?></td>
                                <td><?php echo $promo->active ? '✓' : '✗'; ?></td>
                                <td>
                                    <a href="<?php echo esc_url(admin_url('admin.php?page=oct-promo-codes&edit=' . $promo->id)); ?>"><?php esc_html_e('Edit', 'october-event-tickets'); ?></a>
                                    |
                                    <a href="<?php echo esc_url(admin_url('admin-post.php?action=oct_delete_promo&promo_id=' . $promo->id . '&_nonce=' . wp_create_nonce('oct_delete_promo_' . $promo->id))); ?>"
                                       onclick="return confirm('<?php esc_attr_e('Delete this promo code?', 'october-event-tickets'); ?>')"
                                       class="oct-link-danger"><?php esc_html_e('Delete', 'october-event-tickets'); ?></a>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </tbody>
            </table>
        </div>
        <?php
    }

    // =========================================================================
    // Action Handlers
    // =========================================================================

    public function handle_cancel_order(): void {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('Permission denied.', 'october-event-tickets'));
        }

        $order_id = (int) ($_GET['order_id'] ?? 0);
        if (!$order_id || !wp_verify_nonce(sanitize_text_field($_GET['_nonce'] ?? ''), 'oct_cancel_' . $order_id)) {
            wp_die(esc_html__('Invalid request.', 'october-event-tickets'));
        }

        DB::update_order_status($order_id, 'cancelled');
        DB::cancel_tickets_by_order($order_id);

        // Notify waitlist that a ticket may be available
        $cancelled_order = DB::get_order($order_id);
        if ($cancelled_order) {
            Waitlist::get_instance()->notify_availability(
                (int) $cancelled_order->event_id,
                $cancelled_order->ticket_type_key
            );
        }

        wp_safe_redirect(admin_url('admin.php?page=oct-registrations&cancelled=' . $order_id));
        exit;
    }

    public function handle_export_orders(): void {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('Permission denied.', 'october-event-tickets'));
        }
        if (!wp_verify_nonce(sanitize_text_field($_GET['_nonce'] ?? ''), 'oct_export_orders')) {
            wp_die(esc_html__('Invalid nonce.', 'october-event-tickets'));
        }

        $args = array_filter([
            'email'    => sanitize_text_field($_GET['search'] ?? ''),
            'status'   => sanitize_text_field($_GET['status'] ?? ''),
            'event_id' => (int) ($_GET['event_id'] ?? 0) ?: null,
            'limit'    => 10000,
            'offset'   => 0,
        ]);
        $orders = DB::get_orders($args);

        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="registrations-' . date('Y-m-d') . '.csv"');

        $out = fopen('php://output', 'w');
        fputcsv($out, ['Order ID', 'Event', 'Email', 'Name', 'Ticket Type', 'Qty', 'Unit Price', 'Promo Code', 'Discount', 'Total', 'Currency', 'Payment Method', 'Payment ID', 'Status', 'Date']);

        foreach ($orders as $order) {
            fputcsv($out, [
                $order->id,
                get_the_title((int) $order->event_id),
                $order->email,
                $order->name,
                $order->ticket_type_label,
                $order->qty,
                $order->unit_price,
                $order->promo_code,
                $order->discount_amount,
                $order->total,
                $order->currency,
                $order->payment_method,
                $order->payment_id,
                $order->status,
                $order->created_at,
            ]);
        }

        fclose($out);
        exit;
    }

    public function handle_save_promo(): void {
        if (!current_user_can('manage_options') || !check_admin_referer('oct_save_promo')) {
            wp_die(esc_html__('Permission denied.', 'october-event-tickets'));
        }

        $promo_id = (int) ($_POST['promo_id'] ?? 0);
        $data     = [
            'code'           => strtoupper(sanitize_text_field($_POST['code'] ?? '')),
            'event_id'       => (int) ($_POST['event_id'] ?? 0) ?: null,
            'discount_type'  => in_array($_POST['discount_type'] ?? '', ['percent', 'fixed'], true) ? $_POST['discount_type'] : 'percent',
            'discount_value' => round(floatval($_POST['discount_value'] ?? 0), 2),
            'max_uses'       => strlen($_POST['max_uses'] ?? '') ? max(1, (int) $_POST['max_uses']) : null,
            'expires_at'     => !empty($_POST['expires_at']) ? sanitize_text_field($_POST['expires_at']) : null,
            'active'         => !empty($_POST['active']) ? 1 : 0,
        ];

        if (!$data['code']) {
            wp_safe_redirect(admin_url('admin.php?page=oct-promo-codes&error=invalid_code'));
            exit;
        }

        if ($promo_id) {
            DB::update_promo($promo_id, $data);
        } else {
            DB::insert_promo($data);
        }

        wp_safe_redirect(admin_url('admin.php?page=oct-promo-codes&saved=1'));
        exit;
    }

    public function handle_delete_promo(): void {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('Permission denied.', 'october-event-tickets'));
        }

        $promo_id = (int) ($_GET['promo_id'] ?? 0);
        if (!$promo_id || !wp_verify_nonce(sanitize_text_field($_GET['_nonce'] ?? ''), 'oct_delete_promo_' . $promo_id)) {
            wp_die(esc_html__('Invalid request.', 'october-event-tickets'));
        }

        DB::delete_promo($promo_id);
        wp_safe_redirect(admin_url('admin.php?page=oct-promo-codes&deleted=1'));
        exit;
    }

    // =========================================================================
    // Waitlist Screen
    // =========================================================================

    public function render_waitlist(): void {
        if (!current_user_can('manage_options')) {
            return;
        }

        $event_id = (int) ($_GET['event_id'] ?? 0);

        // Get all published events for the filter
        $all_events = get_posts([
            'post_type'      => 'events',
            'post_status'    => 'publish',
            'posts_per_page' => -1,
            'orderby'        => 'title',
            'order'          => 'ASC',
        ]);

        $waitlist = $event_id ? DB::get_waitlist($event_id) : [];
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('Waitlist', 'october-event-tickets'); ?></h1>

            <form method="get" style="margin-bottom:16px;">
                <input type="hidden" name="page" value="oct-waitlist">
                <select name="event_id" onchange="this.form.submit()">
                    <option value=""><?php esc_html_e('— Select Event —', 'october-event-tickets'); ?></option>
                    <?php foreach ($all_events as $ev) : ?>
                        <option value="<?php echo esc_attr($ev->ID); ?>" <?php selected($event_id, $ev->ID); ?>>
                            <?php echo esc_html($ev->post_title); ?>
                        </option>
                    <?php endforeach; ?>
                </select>
            </form>

            <?php if ($event_id) : ?>
                <p><?php echo esc_html(sprintf(__('%d people on the waitlist for this event.', 'october-event-tickets'), count($waitlist))); ?></p>
                <table class="wp-list-table widefat fixed striped">
                    <thead>
                        <tr>
                            <th><?php esc_html_e('Name', 'october-event-tickets'); ?></th>
                            <th><?php esc_html_e('Email', 'october-event-tickets'); ?></th>
                            <th><?php esc_html_e('Ticket Type', 'october-event-tickets'); ?></th>
                            <th><?php esc_html_e('Joined', 'october-event-tickets'); ?></th>
                            <th><?php esc_html_e('Last Notified', 'october-event-tickets'); ?></th>
                        </tr>
                    </thead>
                    <tbody>
                    <?php if (empty($waitlist)) : ?>
                        <tr><td colspan="5"><?php esc_html_e('No waitlist entries for this event.', 'october-event-tickets'); ?></td></tr>
                    <?php else : ?>
                        <?php foreach ($waitlist as $entry) : ?>
                            <tr>
                                <td><?php echo esc_html($entry->name ?: '—'); ?></td>
                                <td><?php echo esc_html($entry->email); ?></td>
                                <td><?php echo esc_html($entry->ticket_type_key); ?></td>
                                <td><?php echo esc_html(date_i18n(get_option('date_format') . ' ' . get_option('time_format'), strtotime($entry->created_at))); ?></td>
                                <td><?php echo $entry->notified_at ? esc_html(date_i18n(get_option('date_format'), strtotime($entry->notified_at))) : '—'; ?></td>
                            </tr>
                        <?php endforeach; ?>
                    <?php endif; ?>
                    </tbody>
                </table>
            <?php else : ?>
                <p><?php esc_html_e('Select an event above to view its waitlist.', 'october-event-tickets'); ?></p>
            <?php endif; ?>
        </div>
        <?php
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private function render_pagination(int $total, int $per_page, int $current, string $page_slug): void {
        $total_pages = (int) ceil($total / $per_page);
        if ($total_pages <= 1) {
            return;
        }

        echo '<div class="tablenav bottom"><div class="tablenav-pages">';
        echo '<span class="displaying-num">' . sprintf(
            /* translators: %d: number of items */
            esc_html(_n('%d item', '%d items', $total, 'october-event-tickets')),
            esc_html((string) $total)
        ) . '</span> ';

        for ($p = 1; $p <= $total_pages; $p++) {
            $url = admin_url('admin.php?page=' . $page_slug . '&paged=' . $p);
            if ($p === $current) {
                echo '<span class="current">' . esc_html((string) $p) . '</span> ';
            } else {
                echo '<a href="' . esc_url($url) . '">' . esc_html((string) $p) . '</a> ';
            }
        }

        echo '</div></div>';
    }
}
