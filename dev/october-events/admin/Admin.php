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
        add_action('admin_post_oe_volunteer_delete', [$this, 'handle_volunteer_delete']);
        add_action('admin_post_oe_preview_volunteer_email', [$this, 'handle_preview_volunteer_email']);
        add_action('admin_post_oe_volunteer_blast', [$this, 'handle_volunteer_blast']);
        add_action('admin_post_oe_sync_partner_vol', [$this, 'handle_sync_partner_vol']);
        add_action('admin_post_oe_gt_reservation_remove', [$this, 'handle_gt_reservation_remove']);
        add_action('admin_post_oe_gt_reservation_add', [$this, 'handle_gt_reservation_add']);
        add_action('admin_post_oe_preview_guided_email', [$this, 'handle_preview_guided_email']);
        add_action('admin_post_oe_preview_ticket_email', [$this, 'handle_preview_ticket_email']);
        add_action('admin_post_oe_gt_release_save', [$this, 'handle_gt_release_save']);
        add_action('admin_post_oe_gt_release_delete', [$this, 'handle_gt_release_delete']);
        add_action('admin_post_oe_event_broadcast', [$this, 'handle_event_broadcast']);
        add_action('admin_post_oe_membership_repair', [$this, 'handle_membership_repair']);
        add_action('admin_post_oe_send_digest', [$this, 'handle_send_digest']);
        add_action('admin_post_oe_rebuild_contacts', [$this, 'handle_rebuild_contacts']);
        add_action('admin_post_oe_import_contacts', [$this, 'handle_import_contacts']);
        add_action('admin_post_oe_import_brevo', [$this, 'handle_import_brevo']);
        add_action('admin_post_oe_cleanup_contacts', [$this, 'handle_cleanup_contacts']);
        add_action('admin_init', [$this, 'maybe_export_csv']);
        add_filter('admin_title', [$this, 'filter_tickets_title'], 10, 2);
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
        add_submenu_page('october-events', 'Countdown', 'Countdown', $cap, 'oe-countdown', [$this, 'page_countdown']);
        // Reachable by URL from the Membership settings, not shown in the menu.
        add_submenu_page('', 'Membership repair', '', $cap, 'oe-membership-repair', [$this, 'page_membership_repair']);
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
        } elseif ($tab === 'prices') {
            TicketsAdmin::get_instance()->render_prices();
        } elseif ($tab === 'analytics') {
            TicketsAdmin::get_instance()->render_analytics();
        } elseif ($tab === 'failed') {
            TicketsAdmin::get_instance()->render_failed_payments();
        } elseif ($tab === 'abandoned') {
            TicketsAdmin::get_instance()->render_abandoned_carts();
        } elseif ($tab === 'transactions' || $tab === 'payments') {
            TicketsAdmin::get_instance()->render_transactions();
        } elseif ($tab === 'guided') {
            $this->render_guided();
        } elseif ($tab === 'message') {
            $this->render_message_attendees();
        } else {
            TicketsAdmin::get_instance()->render_registrations();
        }
    }

    /** Top-level Tickets tabs, keyed by slug. Sales and Payments each hold a sub-nav. */
    public static function tickets_tab_labels(): array {
        return [
            'orders'   => __('Attendees', 'october-events'),
            'sales'    => __('Sales', 'october-events'),
            'payments' => __('Payments', 'october-events'),
            'promos'   => __('Promo codes', 'october-events'),
            'waitlist' => __('Waitlist', 'october-events'),
            'checkin'  => __('Check-in log', 'october-events'),
            'guided'   => __('Guided tours', 'october-events'),
            'message'  => __('Message attendees', 'october-events'),
        ];
    }

    /**
     * Second-level tabs grouped under a top-level parent. The array key is the
     * parent tab; each child's key is its own `tab=` slug (so old links still work).
     */
    public static function tickets_subgroups(): array {
        return [
            'sales' => [
                'sales'     => __('Overview', 'october-events'),
                'prices'    => __('Ticket prices', 'october-events'),
                'analytics' => __('Sales analytics', 'october-events'),
            ],
            'payments' => [
                'payments'  => __('Transactions', 'october-events'),
                'failed'    => __('Failed payments', 'october-events'),
                'abandoned' => __('Abandoned carts', 'october-events'),
            ],
        ];
    }

    /**
     * Legacy `tab=` slugs that were renamed to a sub-tab key. Old bookmarks and
     * redirects keep working by resolving to the current key first. (`prices` and
     * `analytics` did not change slug — they are real sub-tab keys already.)
     */
    private const TICKETS_LEGACY = ['transactions' => 'payments'];

    /** Which top-level tab a given (possibly sub- or legacy) slug belongs to. */
    private static function tickets_parent(string $active): string {
        $active = self::TICKETS_LEGACY[$active] ?? $active;
        foreach (self::tickets_subgroups() as $parent => $children) {
            if ($active === $parent || isset($children[$active])) {
                return $parent;
            }
        }
        return $active;
    }

    /** Tab nav shared by the Tickets sub-screens (highlights the parent of a sub-tab). */
    public static function tickets_tabs(string $active): void {
        $parent = self::tickets_parent($active);
        echo '<h2 class="nav-tab-wrapper">';
        foreach (self::tickets_tab_labels() as $key => $label) {
            $url = $key === 'orders'
                ? admin_url('admin.php?page=oe-tickets')
                : admin_url('admin.php?page=oe-tickets&tab=' . $key);
            printf(
                '<a href="%s" class="nav-tab%s">%s</a>',
                esc_url($url),
                $parent === $key ? ' nav-tab-active' : '',
                esc_html($label)
            );
        }
        echo '</h2>';
        // Render the sub-nav for this group, if the active tab is in one.
        $groups = self::tickets_subgroups();
        if (isset($groups[$parent])) {
            // Resolve legacy slugs (e.g. transactions -> payments) to the current key.
            $active_norm  = self::TICKETS_LEGACY[$active] ?? $active;
            $active_child = isset($groups[$parent][$active_norm]) ? $active_norm : $parent;
            echo '<div class="oe-subtabs" style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 4px">';
            foreach ($groups[$parent] as $ckey => $clabel) {
                $curl = admin_url('admin.php?page=oe-tickets&tab=' . $ckey);
                $on   = $active_child === $ckey;
                printf(
                    '<a href="%s" style="text-decoration:none;font-size:13px;padding:5px 12px;border-radius:999px;border:1px solid %s;background:%s;color:%s">%s</a>',
                    esc_url($curl),
                    $on ? '#2271b1' : '#dcdcde',
                    $on ? '#2271b1' : '#fff',
                    $on ? '#fff' : '#2c3338',
                    esc_html($clabel)
                );
            }
            echo '</div>';
        }
    }

    /**
     * Put the active Tickets sub-tab in the browser tab title, so several open
     * Tickets screens are told apart (otherwise every one reads just "Tickets").
     */
    public function filter_tickets_title(string $admin_title, string $title): string {
        if (! is_admin() || ($_GET['page'] ?? '') !== 'oe-tickets') {
            return $admin_title;
        }
        $tab = isset($_GET['tab']) ? sanitize_key((string) $_GET['tab']) : 'orders';
        // Resolve legacy slugs (e.g. transactions -> payments) so old links stay titled.
        $tab = self::TICKETS_LEGACY[$tab] ?? $tab;
        // Prefer a top-level label, else a sub-tab label.
        $label = self::tickets_tab_labels()[$tab] ?? '';
        if ($label === '') {
            foreach (self::tickets_subgroups() as $children) {
                if (isset($children[$tab])) { $label = $children[$tab]; break; }
            }
        }
        return $label !== '' ? $label . ' · ' . $admin_title : $admin_title;
    }

    public function page_volunteers(): void {
        // Opportunities (the adopted `volunteer` CPT) with their shifts +
        // signups. The dashboard read model does per-opportunity fill, headline
        // KPIs and cross-opportunity clash detection in one pass.
        $ids = array_map('intval', get_posts([
            'post_type'      => Volunteers::slug(),
            'post_status'    => 'publish',
            'posts_per_page' => 200,
            'orderby'        => 'title',
            'order'          => 'ASC',
            'fields'         => 'ids',
        ]));

        // Compose screen (tick opportunities → email/SMS blast).
        if (isset($_GET['view']) && $_GET['view'] === 'compose') {
            $compose_opps = [];
            foreach ($ids as $id) {
                $sum = Volunteers::opportunity_summary((int) $id);
                if ((int) $sum['shifts'] === 0) {
                    continue;
                }
                $compose_opps[] = [
                    'id'        => (int) $id,
                    'title'     => (string) $sum['title'],
                    'confirmed' => max(0, (int) $sum['filled'] - (int) $sum['pending']),
                    'pending'   => (int) $sum['pending'],
                ];
            }
            $sms_ready   = \OE\Connectors\Sms::is_ready();
            $merge_tags  = Volunteers::message_merge_tags();
            $sent_notice = get_transient('oe_vol_blast_' . get_current_user_id());
            if ($sent_notice) {
                delete_transient('oe_vol_blast_' . get_current_user_id());
            }
            require OE_DIR . 'admin/views/volunteer-message.php';
            return;
        }

        $dash = Volunteers::dashboard($ids);
        require OE_DIR . 'admin/views/volunteers.php';
    }

    /**
     * Send a volunteer email or SMS blast to the volunteers of the ticked
     * opportunities, with [tag] merge fields resolved per recipient. One message
     * per person per opportunity (deduped within an opportunity).
     */
    public function handle_volunteer_blast(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('oe_volunteer_blast');

        $mode     = (($_POST['oe_do'] ?? 'send') === 'test') ? 'test' : 'send';
        $channel  = isset($_POST['channel']) ? sanitize_key((string) $_POST['channel']) : 'email';
        $opp_ids  = array_map('intval', (array) ($_POST['opps'] ?? []));
        $statuses = array_map('sanitize_key', (array) ($_POST['statuses'] ?? []));
        $statuses = array_values(array_intersect($statuses, ['pending', 'confirmed']));
        if (! $statuses) {
            $statuses = ['pending', 'confirmed']; // default: everyone still active
        }
        $subject = sanitize_text_field(wp_unslash((string) ($_POST['subject'] ?? '')));
        $body    = sanitize_textarea_field(wp_unslash((string) ($_POST['body'] ?? '')));

        // Keep what was typed so a test send (or a validation error) doesn't wipe
        // the draft on the redirect back — the compose form repopulates from this.
        $draft = [
            'channel'  => $channel,
            'subject'  => $subject,
            'body'     => $body,
            'test_to'  => sanitize_textarea_field(wp_unslash((string) ($_POST['test_to'] ?? ''))),
            'opps'     => $opp_ids,
            'statuses' => $statuses,
        ];

        $back = admin_url('admin.php?page=oe-volunteers&view=compose');
        $fail = static function (string $msg) use ($back, $draft): void {
            set_transient('oe_vol_blast_' . get_current_user_id(), ['error' => $msg, 'draft' => $draft], 60);
            wp_safe_redirect($back);
            exit;
        };

        // Shared validation (both a real blast and a test need these).
        if ($body === '') {
            $fail(__('Write a message first.', 'october-events'));
        }
        if ($channel === 'sms' && ! \OE\Connectors\Sms::is_ready()) {
            $fail(__('SMS isn’t configured yet (Settings → Email & SMS). No messages were sent.', 'october-events'));
        }
        if ($channel === 'email' && $subject === '') {
            $fail(__('Add a subject for the email.', 'october-events'));
        }

        // Test send: to the comma/newline-separated addresses/numbers the user
        // typed, with sample details filled into the merge tags.
        if ($mode === 'test') {
            $raw = (string) ($_POST['test_to'] ?? '');
            $recipients = array_values(array_filter(array_map('trim', preg_split('/[\r\n,]+/', $raw) ?: [])));
            if (! $recipients) {
                $fail(__('Enter at least one test address or number.', 'october-events'));
            }
            $vals = Volunteers::sample_merge_values();
            $subj = Volunteers::apply_merge_values($subject, $vals);
            $tsent = $tfailed = 0;
            foreach ($recipients as $r) {
                if ($channel === 'sms') {
                    if (\OE\Connectors\Sms::send($r, Volunteers::apply_merge_values($body, $vals))) { $tsent++; } else { $tfailed++; }
                } else {
                    if (! is_email($r)) { $tfailed++; continue; }
                    $html = nl2br(esc_html(Volunteers::apply_merge_values($body, $vals)));
                    if (\OE\Mail\Transactional::send('volunteer_blast', ['email' => $r, 'name' => ''], [], $subj, $html)) { $tsent++; } else { $tfailed++; }
                }
            }
            set_transient('oe_vol_blast_' . get_current_user_id(), [
                'test'    => true,
                'channel' => $channel,
                'sent'    => $tsent,
                'skipped' => 0,
                'failed'  => $tfailed,
                'draft'   => $draft, // keep the message + test address for another send
            ], 60);
            wp_safe_redirect($back);
            exit;
        }

        if (! $opp_ids) {
            $fail(__('Pick at least one opportunity.', 'october-events'));
        }

        $sent = $skipped = $failed = 0;
        $seen = []; // dedupe: one message per person per opportunity

        foreach ($opp_ids as $oid) {
            foreach (\OE\VolunteerSignups::for_opportunity($oid) as $s) {
                if (! in_array($s->status, $statuses, true)) {
                    continue;
                }
                if ($channel === 'sms') {
                    $phone = trim((string) $s->phone);
                    if ($phone === '') { $skipped++; continue; }
                    $key = $oid . '|' . preg_replace('/\D+/', '', $phone);
                    if (isset($seen[$key])) { continue; }
                    $seen[$key] = true;
                    $text = Volunteers::apply_merge($body, $s);
                    if (\OE\Connectors\Sms::send($phone, $text)) { $sent++; } else { $failed++; }
                } else {
                    $email = sanitize_email((string) $s->email);
                    if ($email === '' || ! is_email($email)) { $skipped++; continue; }
                    $key = $oid . '|' . strtolower($email);
                    if (isset($seen[$key])) { continue; }
                    $seen[$key] = true;
                    $subj = Volunteers::apply_merge($subject, $s);
                    $html = nl2br(esc_html(Volunteers::apply_merge($body, $s)));
                    if (\OE\Mail\Transactional::send('volunteer_blast', ['email' => $email, 'name' => $s->name], [], $subj, $html)) { $sent++; } else { $failed++; }
                }
            }
        }

        \OE\AuditLog::record('volunteer_blast', 0, 'volunteer', $channel . ':' . $sent);
        set_transient('oe_vol_blast_' . get_current_user_id(), [
            'channel' => $channel,
            'sent'    => $sent,
            'skipped' => $skipped,
            'failed'  => $failed,
        ], 60);
        wp_safe_redirect($back);
        exit;
    }


    public function page_contacts(): void {
        $counts   = \OE\Mail\Contacts::counts();
        $contacts = \OE\Mail\Contacts::search('', 50, 0);
        $lists    = \OE\Mail\Lists::all();
        require OE_DIR . 'admin/views/contacts.php';
    }

    public function page_countdown(): void {
        require OE_DIR . 'admin/views/countdown.php';
    }

    /** Guided-tour signups: list per building, add/remove people, export CSV. */
    /** Recover memberships that never got created after a members-only ticket sale. */
    public function page_membership_repair(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        $candidates = \OE\Membership\Repair::candidates();
        $results    = get_transient('oe_mem_repair_' . get_current_user_id());
        if ($results) {
            delete_transient('oe_mem_repair_' . get_current_user_id());
        }
        require OE_DIR . 'admin/views/membership-repair.php';
    }

    public function handle_membership_repair(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('oe_membership_repair');
        $which = isset($_POST['which']) ? sanitize_text_field((string) $_POST['which']) : '';
        $ids   = [];
        if ($which === 'all') {
            foreach (\OE\Membership\Repair::candidates() as $c) {
                $ids[] = (int) $c['order_id'];
            }
        } elseif (ctype_digit($which)) {
            $ids[] = (int) $which;
        }
        $results = [];
        foreach ($ids as $id) {
            $res = \OE\Membership\Repair::repair_order($id);
            $results[] = ['order_id' => $id, 'ok' => $res['ok'], 'status' => $res['status'], 'message' => $res['message']];
        }
        set_transient('oe_mem_repair_' . get_current_user_id(), $results, 120);
        wp_safe_redirect(admin_url('admin.php?page=oe-membership-repair'));
        exit;
    }

    /** Guided-tour signups — a tab on the Tickets screen. */
    public function render_guided(): void {
        $location     = isset($_GET['building']) ? absint($_GET['building']) : 0;
        $buildings    = \OE\GuidedTours\Slots::locations_with_slots();
        $reservations = \OE\GuidedTours\Reservations::all($location);
        $releases     = \OE\GuidedTours\Releases::all();
        $notice       = get_transient('oe_gt_notice_' . get_current_user_id());
        if ($notice) {
            delete_transient('oe_gt_notice_' . get_current_user_id());
        }
        require OE_DIR . 'admin/views/guided-tours.php';
    }

    /** Save (or update) a tour's release schedule. */
    public function handle_gt_release_save(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('oe_gt_release_save');
        $city = sanitize_text_field((string) wp_unslash($_POST['city'] ?? ''));
        $year = preg_replace('/[^0-9]/', '', (string) ($_POST['year'] ?? ''));
        $tour = \OE\GuidedTours\Rest::tour_key($city . '|' . $year);
        if ($city === '' || $year === '') {
            $this->gt_notice(__('Enter a city and year for the tour.', 'october-events'));
            $this->redirect_guided();
        }
        // The datetime-local field is in the site's timezone; store UTC unix.
        $local = sanitize_text_field((string) ($_POST['release_at'] ?? ''));
        $ts    = 0;
        if ($local !== '') {
            try {
                $ts = (new \DateTime($local, wp_timezone()))->getTimestamp();
            } catch (\Throwable $e) {
                $ts = 0;
            }
        }
        \OE\GuidedTours\Releases::save($tour, [
            'city'        => $city,
            'year'        => $year,
            'event_id'    => absint($_POST['event_id'] ?? 0),
            'release_at'  => $ts,
            'booking_url' => esc_url_raw((string) wp_unslash($_POST['booking_url'] ?? '')),
        ]);
        $this->gt_notice(__('Tour release schedule saved.', 'october-events'));
        $this->redirect_guided();
    }

    /** Remove a tour's release schedule (booking reverts to always-open). */
    public function handle_gt_release_delete(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        $tour = \OE\GuidedTours\Rest::tour_key((string) wp_unslash($_REQUEST['tour'] ?? ''));
        check_admin_referer('oe_gt_release_delete_' . $tour);
        \OE\GuidedTours\Releases::delete($tour);
        $this->gt_notice(__('Tour release schedule removed.', 'october-events'));
        $this->redirect_guided();
    }

    private function gt_notice(string $msg): void {
        set_transient('oe_gt_notice_' . get_current_user_id(), ['ok' => $msg], 60);
    }

    /* ----------------------------------------------------------------- *
     * Message attendees — broadcast an email to an event's registrations
     * ----------------------------------------------------------------- */

    /** The "Message attendees" tab on the Tickets screen. */
    public function render_message_attendees(): void {
        // Ticketed events, each with its live registration count for the picker.
        // Counts are fetched in a single grouped query to avoid a COUNT per event.
        $picker = [];
        foreach (\OE\Ticketing\CheckIn::events() as $e) {
            if ((int) $e['id'] === \OE\Ticketing\CheckIn::TEST_EVENT_ID) {
                continue;
            }
            $picker[] = ['id' => (int) $e['id'], 'title' => (string) $e['title']];
        }
        $counts = \OE\Ticketing\Orders::event_recipient_counts(array_column($picker, 'id'));
        $events = [];
        foreach ($picker as $e) {
            $events[] = [
                'id'    => $e['id'],
                'title' => $e['title'],
                'count' => $counts[$e['id']] ?? 0,
            ];
        }
        $result = get_transient('oe_evt_msg_' . get_current_user_id());
        if ($result) {
            delete_transient('oe_evt_msg_' . get_current_user_id());
        }
        require OE_DIR . 'admin/views/message-attendees.php';
    }

    /** Send (or test) a broadcast email to one event's registrations. */
    public function handle_event_broadcast(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('oe_event_broadcast');

        $event_id = absint($_POST['event_id'] ?? 0);
        $subject  = sanitize_text_field(wp_unslash((string) ($_POST['subject'] ?? '')));
        $body     = sanitize_textarea_field(wp_unslash((string) ($_POST['body'] ?? '')));
        $mode     = (($_POST['oe_do'] ?? 'send') === 'test') ? 'test' : 'send';

        // Keep what was typed so a test send (or a validation error) doesn't wipe
        // the draft on the redirect back — the compose form repopulates from this.
        $draft = [
            'subject' => $subject,
            'body'    => $body,
            'test_to' => sanitize_textarea_field(wp_unslash((string) ($_POST['test_to'] ?? ''))),
        ];

        $back = admin_url('admin.php?page=oe-tickets&tab=message' . ($event_id ? '&event=' . $event_id : ''));
        $fail = static function (string $msg) use ($back, $draft): void {
            set_transient('oe_evt_msg_' . get_current_user_id(), ['error' => $msg, 'draft' => $draft], 60);
            wp_safe_redirect($back);
            exit;
        };

        if ($subject === '') {
            $fail(__('Add a subject.', 'october-events'));
        }
        if ($body === '') {
            $fail(__('Write a message first.', 'october-events'));
        }
        if ($event_id <= 0) {
            $fail(__('Pick an event.', 'october-events'));
        }
        $event_title = get_the_title($event_id) ?: '';

        // Test: send only to the addresses typed, with sample merge values.
        if ($mode === 'test') {
            $raw = (string) ($_POST['test_to'] ?? '');
            $recipients = array_values(array_filter(array_map('trim', preg_split('/[\r\n,]+/', $raw) ?: [])));
            if (! $recipients) {
                $fail(__('Enter at least one test address.', 'october-events'));
            }
            $sent = $failed = 0;
            foreach ($recipients as $to) {
                if (! is_email($to)) { $failed++; continue; }
                $subj = $this->broadcast_merge($subject, __('there', 'october-events'), $event_title);
                $html = nl2br(esc_html($this->broadcast_merge($body, __('there', 'october-events'), $event_title)));
                if (\OE\Mail\Transactional::send('event_broadcast', ['email' => $to, 'name' => ''], [], $subj, $html)) { $sent++; } else { $failed++; }
            }
            set_transient('oe_evt_msg_' . get_current_user_id(), ['test' => true, 'sent' => $sent, 'failed' => $failed, 'draft' => $draft], 60);
            wp_safe_redirect($back);
            exit;
        }

        // Guard against a double-send: a slow send + an impatient second click,
        // or a retry after a mid-send timeout, must not re-mail the list. One
        // send per event is allowed to run at a time; the lock clears when it
        // finishes (or expires, so a genuinely stuck send can be retried later).
        $lock = 'oe_evt_msg_lock_' . $event_id;
        if (get_transient($lock)) {
            $fail(__('A send for this event is already in progress. Give it a minute, then check the result before sending again.', 'october-events'));
        }
        set_transient($lock, 1, 10 * MINUTE_IN_SECONDS);

        $sent = $failed = 0;
        foreach (\OE\Ticketing\Orders::event_recipients($event_id) as $r) {
            if (! is_email($r['email'])) { continue; }
            $name = (string) $r['name'];
            $subj = $this->broadcast_merge($subject, $name, $event_title);
            $html = nl2br(esc_html($this->broadcast_merge($body, $name, $event_title)));
            if (\OE\Mail\Transactional::send('event_broadcast', ['email' => $r['email'], 'name' => $name], [], $subj, $html)) { $sent++; } else { $failed++; }
        }
        delete_transient($lock);
        \OE\AuditLog::record('event_broadcast', $event_id, 'event', 'sent:' . $sent);
        set_transient('oe_evt_msg_' . get_current_user_id(), ['sent' => $sent, 'failed' => $failed, 'event' => $event_title], 60);
        wp_safe_redirect($back);
        exit;
    }

    /** Fill {name} and {event} in broadcast subject/body. */
    private function broadcast_merge(string $text, string $name, string $event_title): string {
        $name = trim($name) !== '' ? trim($name) : __('there', 'october-events');
        return str_replace(['{name}', '{event}'], [$name, $event_title], $text);
    }

    private function redirect_guided(): void {
        wp_safe_redirect(admin_url('admin.php?page=oe-tickets&tab=guided'));
        exit;
    }

    /** Cancel a guided-tour reservation (promotes the waitlist if it held a seat). */
    public function handle_gt_reservation_remove(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        $id = isset($_REQUEST['id']) ? absint($_REQUEST['id']) : 0;
        check_admin_referer('oe_gt_reservation_remove_' . $id);
        \OE\GuidedTours\Reservations::admin_remove($id);
        $this->redirect_back();
    }

    /** Add a person to a slot by hand (bypasses the ticket gate). */
    public function handle_gt_reservation_add(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('oe_gt_reservation_add');
        $location = absint($_POST['building'] ?? 0);
        $slot     = isset($_POST['slot']) ? preg_replace('/[^a-z0-9]/', '', strtolower((string) $_POST['slot'])) : '';
        $name     = sanitize_text_field(wp_unslash((string) ($_POST['name'] ?? '')));
        $email    = sanitize_email((string) ($_POST['email'] ?? ''));
        $party    = max(1, absint($_POST['party'] ?? 1));
        $res      = \OE\GuidedTours\Reservations::admin_add($location, (string) $slot, $email, $name, $party);
        if (is_wp_error($res)) {
            $notice = ['error' => $res->get_error_message()];
        } else {
            $notice = ['ok' => $res['status'] === \OE\GuidedTours\Reservations::STATUS_WAITLIST
                ? __('Added to the waitlist — that slot was full.', 'october-events')
                : __('Added, and emailed them a confirmation.', 'october-events')];
        }
        set_transient('oe_gt_notice_' . get_current_user_id(), $notice, 60);
        $this->redirect_back();
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

    /** Permanently remove a signup row. No email/SMS is sent to the volunteer. */
    public function handle_volunteer_delete(): void {
        $id = $this->verify_action('oe_volunteer_delete');
        Volunteers::delete_signup($id);
        $this->redirect_back();
    }

    /**
     * Render a volunteer email with sample data so staff can preview exactly
     * what volunteers receive. Reflects the currently SAVED intro copy.
     */
    public function handle_preview_volunteer_email(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('oe_preview_volunteer_email');
        $key   = isset($_GET['type']) ? sanitize_key((string) $_GET['type']) : 'on_signup';
        $valid = ['on_signup', 'reminder', 'week', '48h', 'morning', 'confirmed', 'declined'];
        if (! in_array($key, $valid, true)) {
            $key = 'on_signup';
        }
        nocache_headers();
        header('Content-Type: text/html; charset=utf-8');
        echo \OE\Mail\Transactional::volunteer_preview_html($key); // phpcs:ignore WordPress.Security.EscapeOutput -- a complete, self-escaped HTML email document
        exit;
    }

    public function handle_preview_guided_email(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('oe_preview_guided_email');
        $type  = isset($_GET['type']) ? sanitize_key((string) $_GET['type']) : 'reserved';
        $valid = ['reserved', 'waitlist', 'promoted', 'reconfirm'];
        if (! in_array($type, $valid, true)) {
            $type = 'reserved';
        }
        nocache_headers();
        header('Content-Type: text/html; charset=utf-8');
        echo \OE\GuidedTours\Mailer::preview($type); // phpcs:ignore WordPress.Security.EscapeOutput -- a complete, self-escaped HTML email document
        exit;
    }

    /** Preview the ticket confirmation or the pre-event reminder email. */
    public function handle_preview_ticket_email(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('oe_preview_ticket_email');
        $type = isset($_GET['type']) ? sanitize_key((string) $_GET['type']) : 'ticket';
        if (! in_array($type, ['ticket', 'reminder'], true)) {
            $type = 'ticket';
        }
        nocache_headers();
        header('Content-Type: text/html; charset=utf-8');
        echo \OE\Mail\Transactional::preview($type); // phpcs:ignore WordPress.Security.EscapeOutput -- a complete, self-escaped HTML email document
        exit;
    }

    public function handle_sync_partner_vol(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('oe_sync_partner_vol');
        $result = Volunteers::sync_partner_feed();
        set_transient('oe_vol_sync_' . get_current_user_id(), $result, 60);
        wp_safe_redirect(admin_url('admin.php?page=oe-settings#volunteer-locations'));
        exit;
    }

    public function handle_send_digest(): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer('oe_send_digest');
        if (! \OE\Cron::DIGEST_ENABLED) {
            $msg = 'disabled'; // feature not ready — never sends
        } else {
            // run_digest is locked to once per calendar month; 0 back = already sent.
            $msg = (new \OE\Cron())->run_digest() > 0 ? 'sent' : 'already';
        }
        wp_safe_redirect(add_query_arg('digest', $msg, admin_url('admin.php?page=oe-settings#email-tools')));
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

        if ($what === 'guided') {
            $rows = \OE\GuidedTours\Reservations::all();
            $this->stream_csv('guided-tours.csv', ['Building', 'When', 'Name', 'Email', 'Seats', 'Status', 'Booked'], array_map(static function ($r) {
                $ts = \OE\GuidedTours\Slots::start_ts((int) $r->location_id, (string) $r->slot_uid);
                return [
                    get_the_title((int) $r->location_id),
                    $ts ? wp_date('Y-m-d g:i A', $ts) : '',
                    $r->name,
                    $r->email,
                    (string) max(1, (int) ($r->party_size ?? 1)),
                    $r->status,
                    (string) $r->created_at,
                ];
            }, $rows));
        }

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
