<?php
declare(strict_types=1);

namespace OE\Admin;

use OE\PostTypes;
use OE\Ticketing\TicketTypes;
use OE\Ticketing\Orders;
use OE\Ticketing\Promo;
use OE\Ticketing\Schema;

defined('ABSPATH') || exit;

/**
 * Ticketing admin: the ticket-type editor meta box on the `events` CPT, the
 * registrations (orders) screen with MANUAL order / comp creation and
 * cancel/refund, promo-code CRUD, and CSV export.
 */
final class TicketsAdmin {

    private static ?TicketsAdmin $instance = null;

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        $events = PostTypes::slug('event');
        add_action('add_meta_boxes', [$this, 'add_meta_boxes']);
        add_action('save_post_' . $events, [$this, 'save_event_meta']);

        add_action('admin_post_oe_create_order', [$this, 'handle_create_order']);
        add_action('admin_post_oe_cancel_order', [$this, 'handle_cancel_order']);
        add_action('admin_post_oe_delete_order', [$this, 'handle_delete_order']);
        add_action('admin_post_oe_refund_tickets', [$this, 'handle_refund_tickets']);
        add_action('admin_post_oe_resend_confirmation', [$this, 'handle_resend_confirmation']);
        add_action('admin_post_oe_save_promo', [$this, 'handle_save_promo']);
        add_action('admin_post_oe_delete_promo', [$this, 'handle_delete_promo']);
        add_action('admin_post_oe_waitlist_promote', [$this, 'handle_waitlist_promote']);
        add_action('admin_post_oe_waitlist_remove', [$this, 'handle_waitlist_remove']);
        add_action('admin_init', [$this, 'maybe_export_orders']);
    }

    /* ------------------------------------------------------------------ *
     * Event ticket-type meta box
     * ------------------------------------------------------------------ */

    public function add_meta_boxes(): void {
        if (! \OE\Features::enabled('tickets')) {
            return;
        }
        add_meta_box('oe_ticket_types', __('Tickets & check-in', 'october-events'), [$this, 'render_event_meta_box'], PostTypes::slug('event'), 'normal', 'high');
    }

    public function render_event_meta_box(\WP_Post $post): void {
        wp_nonce_field('oe_save_tickets', 'oe_tickets_nonce');
        wp_enqueue_media(); // for the per-event logo picker below
        $types  = TicketTypes::types($post->ID);
        $venues = TicketTypes::venues($post->ID);
        ?>
        <p class="description"><?php esc_html_e('Define one or more ticket types. "Admits" lets a single purchase generate multiple admissions (e.g. a couples ticket = 2).', 'october-events'); ?></p>
        <table class="widefat" id="oe-tt-table">
            <thead><tr>
                <th><?php esc_html_e('Label', 'october-events'); ?></th>
                <th><?php esc_html_e('Price', 'october-events'); ?></th>
                <th><?php esc_html_e('Sale', 'october-events'); ?></th>
                <th><?php esc_html_e('Admits', 'october-events'); ?></th>
                <th><?php esc_html_e('On sale from', 'october-events'); ?></th>
                <th><?php esc_html_e('until', 'october-events'); ?></th>
                <th><?php esc_html_e('Active', 'october-events'); ?></th>
                <th></th>
            </tr></thead>
            <tbody>
            <?php foreach (($types ?: [[]]) as $i => $t) { $this->type_row((int) $i, $t); } ?>
            </tbody>
        </table>
        <p><button type="button" class="button" id="oe-tt-add"><?php esc_html_e('+ Add ticket type', 'october-events'); ?></button></p>

        <?php
        // Event-wide capacity (replaces the old per-ticket-type capacity). For
        // events saved before this change, pre-fill from the sum of the old
        // per-type caps so the existing limit carries over on the next save.
        $event_cap = get_post_meta($post->ID, TicketTypes::META_CAPACITY, true);
        if ($event_cap === '' || $event_cap === false) {
            $legacy = 0; $had = false;
            foreach ($types as $t) {
                if (($t['capacity'] ?? null) !== null) { $legacy += (int) $t['capacity']; $had = true; }
            }
            $event_cap = $had ? (string) $legacy : '';
        }
        ?>
        <p><label><strong><?php esc_html_e('Event capacity', 'october-events'); ?></strong>
            <input type="number" min="0" name="oe_event_capacity" value="<?php echo esc_attr((string) $event_cap); ?>" style="width:90px" placeholder="∞"></label>
            <span class="description"><?php esc_html_e('Total tickets across all types for this event. Leave blank (or 0) for unlimited. When it’s reached, every ticket type shows “Sold out”.', 'october-events'); ?></span></p>

        <p><label><strong><?php esc_html_e('Close all sales at', 'october-events'); ?></strong>
            <input type="datetime-local" name="oe_sale_until" value="<?php echo esc_attr($this->dt_local((string) get_post_meta($post->ID, TicketTypes::META_SALE_UNTIL, true))); ?>"></label></p>
        <p><label><strong><?php esc_html_e('Check-in venues / doors', 'october-events'); ?></strong> — <?php esc_html_e('one per line', 'october-events'); ?><br>
            <textarea name="oe_venues" rows="3" class="large-text"><?php echo esc_textarea(implode("\n", array_map(static fn($v) => (string) ($v['name'] ?? ''), $venues))); ?></textarea></label></p>
        <?php $manual_pin = (string) get_post_meta($post->ID, TicketTypes::META_PIN, true); ?>
        <p><label><strong><?php esc_html_e('Check-in PIN', 'october-events'); ?></strong>
            <input type="text" name="oe_checkin_pin" value="<?php echo esc_attr($manual_pin); ?>" placeholder="<?php esc_attr_e('auto', 'october-events'); ?>" maxlength="6" size="8"></label>
            <span class="description"><?php esc_html_e('Leave blank to auto-generate a secure random PIN. Or set your own 4–6 digits for door staff.', 'october-events'); ?></span></p>

        <?php
        $logo_id  = (int) get_post_meta($post->ID, TicketTypes::META_LOGO, true);
        $logo_url = $logo_id ? (string) wp_get_attachment_image_url($logo_id, 'medium') : '';
        ?>
        <p><strong><?php esc_html_e('Ticket & email logo', 'october-events'); ?></strong> —
            <span class="description"><?php esc_html_e('shown top-left on the printable ticket and the confirmation email. Falls back to your brand logo if left empty.', 'october-events'); ?></span></p>
        <div id="oe-logo-field" style="margin:6px 0 4px">
            <input type="hidden" name="oe_ticket_logo" id="oe-ticket-logo" value="<?php echo esc_attr((string) $logo_id); ?>">
            <img id="oe-ticket-logo-preview" src="<?php echo esc_url($logo_url); ?>" alt="" style="max-height:64px;max-width:240px;display:<?php echo $logo_url ? 'block' : 'none'; ?>;margin-bottom:8px;background:#fff;padding:4px;border:1px solid #dcdcde">
            <button type="button" class="button" id="oe-ticket-logo-pick"><?php echo $logo_url ? esc_html__('Change logo', 'october-events') : esc_html__('Choose logo', 'october-events'); ?></button>
            <button type="button" class="button-link" id="oe-ticket-logo-clear" style="<?php echo $logo_url ? '' : 'display:none'; ?>;color:#b32d2e;margin-left:6px"><?php esc_html_e('Remove', 'october-events'); ?></button>
        </div>
        <script>
        (function(){
            var frame, pick=document.getElementById('oe-ticket-logo-pick'),
                clr=document.getElementById('oe-ticket-logo-clear'),
                input=document.getElementById('oe-ticket-logo'),
                prev=document.getElementById('oe-ticket-logo-preview');
            pick.addEventListener('click', function(e){
                e.preventDefault();
                if (frame) { frame.open(); return; }
                frame = wp.media({ title: '<?php echo esc_js(__('Select ticket logo', 'october-events')); ?>', button: { text: '<?php echo esc_js(__('Use this logo', 'october-events')); ?>' }, library: { type: 'image' }, multiple: false });
                frame.on('select', function(){
                    var a = frame.state().get('selection').first().toJSON();
                    var url = (a.sizes && a.sizes.medium) ? a.sizes.medium.url : a.url;
                    input.value = a.id; prev.src = url; prev.style.display = 'block';
                    clr.style.display = ''; pick.textContent = '<?php echo esc_js(__('Change logo', 'october-events')); ?>';
                });
                frame.open();
            });
            clr.addEventListener('click', function(e){
                e.preventDefault();
                input.value = ''; prev.src = ''; prev.style.display = 'none';
                clr.style.display = 'none'; pick.textContent = '<?php echo esc_js(__('Choose logo', 'october-events')); ?>';
            });
        })();
        </script>

        <script type="text/html" id="oe-tt-tpl"><?php $this->type_row(9999, []); ?></script>
        <script>
        (function(){
            var idx = <?php echo (int) max(1, count($types)); ?>;
            document.getElementById('oe-tt-add').addEventListener('click', function(){
                var html = document.getElementById('oe-tt-tpl').innerHTML.replace(/9999/g, idx++);
                var tb = document.querySelector('#oe-tt-table tbody');
                tb.insertAdjacentHTML('beforeend', html);
            });
            document.querySelector('#oe-tt-table').addEventListener('click', function(e){
                if (e.target.classList.contains('oe-tt-del')) { e.target.closest('tr').remove(); }
            });
        })();
        </script>
        <?php
    }

    private function type_row(int $i, array $t): void {
        $g = static fn($k, $d = '') => esc_attr((string) ($t[$k] ?? $d));
        ?>
        <tr>
            <td><input type="text" name="oe_tt[<?php echo $i; ?>][label]" value="<?php echo $g('label'); ?>" placeholder="General Admission">
                <input type="hidden" name="oe_tt[<?php echo $i; ?>][key]" value="<?php echo $g('key'); ?>"></td>
            <td><input type="number" step="0.01" min="0" name="oe_tt[<?php echo $i; ?>][price]" value="<?php echo $g('price'); ?>" style="width:80px"></td>
            <td><input type="number" step="0.01" min="0" name="oe_tt[<?php echo $i; ?>][sale_price]" value="<?php echo esc_attr($t['sale_price'] ?? ''); ?>" style="width:80px"></td>
            <td><input type="number" min="1" max="20" name="oe_tt[<?php echo $i; ?>][qty_per_purchase]" value="<?php echo $g('qty_per_purchase', '1'); ?>" style="width:55px"></td>
            <td><input type="datetime-local" name="oe_tt[<?php echo $i; ?>][sale_from]" value="<?php echo esc_attr($this->dt_local((string) ($t['sale_from'] ?? ''))); ?>"></td>
            <td><input type="datetime-local" name="oe_tt[<?php echo $i; ?>][sale_until]" value="<?php echo esc_attr($this->dt_local((string) ($t['sale_until'] ?? ''))); ?>"></td>
            <td style="text-align:center"><input type="checkbox" name="oe_tt[<?php echo $i; ?>][active]" value="1" <?php checked(! empty($t['active']) || $t === []); ?>></td>
            <td><button type="button" class="button-link oe-tt-del" title="Remove">✕</button></td>
        </tr>
        <?php
    }

    public function save_event_meta(int $post_id): void {
        if (! isset($_POST['oe_tickets_nonce']) || ! wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['oe_tickets_nonce'])), 'oe_save_tickets')) {
            return;
        }
        if ((defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) || ! current_user_can('edit_post', $post_id)) {
            return;
        }

        $rows = (array) ($_POST['oe_tt'] ?? []);
        $types = [];
        foreach ($rows as $r) {
            if (trim((string) ($r['label'] ?? '')) === '') {
                continue;
            }
            $types[] = [
                'label'            => $r['label'],
                'key'              => $r['key'] ?? '',
                'price'            => $r['price'] ?? 0,
                'sale_price'       => $r['sale_price'] ?? '',
                'qty_per_purchase' => $r['qty_per_purchase'] ?? 1,
                'active'           => ! empty($r['active']),
                'sale_from'        => $this->from_local((string) ($r['sale_from'] ?? '')),
                'sale_until'       => $this->from_local((string) ($r['sale_until'] ?? '')),
            ];
        }
        TicketTypes::set_types($post_id, $types);

        update_post_meta($post_id, TicketTypes::META_SALE_UNTIL, $this->from_local((string) ($_POST['oe_sale_until'] ?? '')));
        $venues = array_filter(array_map('trim', preg_split('/\r\n|\r|\n/', (string) wp_unslash($_POST['oe_venues'] ?? ''))));
        update_post_meta($post_id, TicketTypes::META_VENUES, wp_json_encode(array_map(static fn($n) => ['name' => sanitize_text_field($n)], $venues)));
        update_post_meta($post_id, TicketTypes::META_PIN, preg_replace('/\D/', '', (string) ($_POST['oe_checkin_pin'] ?? '')));
        update_post_meta($post_id, TicketTypes::META_LOGO, absint($_POST['oe_ticket_logo'] ?? 0));
        // Event-wide capacity (blank/0 = unlimited).
        update_post_meta($post_id, TicketTypes::META_CAPACITY, max(0, absint($_POST['oe_event_capacity'] ?? 0)));

        // Raising the event capacity (or re-activating a type) opens seats — offer
        // them to anyone already on the waitlist, first come first served.
        // promote() marks each notified, so nobody is emailed twice.
        foreach (TicketTypes::types($post_id) as $tt) {
            $key = (string) ($tt['key'] ?? '');
            if ($key !== ''
                && \OE\Ticketing\Waitlist::count($post_id, $key) > 0
                && TicketTypes::availability($post_id, $tt)['state'] === 'available') {
                \OE\Ticketing\Waitlist::notify_for_type($post_id, $key);
            }
        }
    }

    /* ------------------------------------------------------------------ *
     * Registrations (orders) screen + manual add
     * ------------------------------------------------------------------ */

    public function render_registrations(): void {
        global $wpdb;
        $event_filter = isset($_GET['event']) ? absint($_GET['event']) : 0;
        $where = $event_filter ? $wpdb->prepare('WHERE event_id = %d', $event_filter) : '';
        $orders = $wpdb->get_results("SELECT * FROM " . Schema::orders() . " {$where} ORDER BY id DESC LIMIT 500");
        // One query to load every event title the rows need (vs one per row).
        self::prime_event_titles($orders);
        // Active tickets per transaction (one query) for the refund panel — keyed
        // by payment id so a mixed cart's sibling orders all appear together.
        $txn_tickets = Orders::active_tickets_for_payments(array_map(static fn($o) => (string) $o->payment_id, (array) ($orders ?: [])));

        // All published events, for the manual-add form + filter (the form marks
        // which have ticket types — only those can have tickets issued).
        $events = get_posts(['post_type' => PostTypes::slug('event'), 'post_status' => 'publish', 'posts_per_page' => 200, 'orderby' => 'title', 'order' => 'ASC']);
        $event_types = [];
        foreach ($events as $ev) {
            $t = TicketTypes::types($ev->ID);
            if ($t) {
                $event_types[$ev->ID] = array_map(static fn($x) => ['key' => $x['key'], 'label' => $x['label']], $t);
            }
        }
        require OE_DIR . 'admin/views/registrations.php';
    }

    public function handle_create_order(): void {
        $this->guard('oe_create_order');
        $event_id = absint($_POST['event_id'] ?? 0);
        $type_key = sanitize_key((string) ($_POST['type_key'] ?? ''));
        $qty      = max(1, (int) ($_POST['qty'] ?? 1));
        $name     = sanitize_text_field((string) ($_POST['name'] ?? ''));
        $email    = sanitize_email((string) ($_POST['email'] ?? ''));
        $paid     = ($_POST['mode'] ?? 'comp') === 'paid';

        $result = Orders::create_manual($event_id, $type_key, $qty, $name, $email, $paid);
        $msg = is_wp_error($result) ? 'error' : 'created';
        wp_safe_redirect(add_query_arg(['page' => 'oe-tickets', 'oe_msg' => $msg], admin_url('admin.php')));
        exit;
    }

    public function handle_cancel_order(): void {
        $this->guard('oe_cancel_order');
        $order_id = absint($_REQUEST['id'] ?? 0);
        $refund   = ! empty($_REQUEST['refund']);
        Orders::cancel($order_id, $refund);
        wp_safe_redirect(wp_get_referer() ?: admin_url('admin.php?page=oe-tickets'));
        exit;
    }

    /** Refund selected tickets in an order (partial or full), with a reason. */
    public function handle_refund_tickets(): void {
        $this->guard('oe_refund_tickets');
        $order_id   = absint($_REQUEST['id'] ?? 0);
        $ticket_ids = array_map('absint', (array) ($_POST['ticket_ids'] ?? []));
        $reason     = sanitize_text_field((string) ($_POST['reason'] ?? ''));
        $res = Orders::refund_tickets($order_id, $ticket_ids, $reason);
        $back = wp_get_referer() ?: admin_url('admin.php?page=oe-tickets');
        wp_safe_redirect(add_query_arg('oe_msg', ! empty($res['ok']) ? 'refunded' : 'refund_failed', remove_query_arg('oe_msg', $back)));
        exit;
    }

    /** Permanently delete an order + its tickets + check-ins (e.g. test data). */
    public function handle_delete_order(): void {
        $this->guard('oe_delete_order');
        Orders::delete(absint($_REQUEST['id'] ?? 0));
        $back = wp_get_referer() ?: admin_url('admin.php?page=oe-tickets');
        wp_safe_redirect(add_query_arg('oe_msg', 'deleted', remove_query_arg('oe_msg', $back)));
        exit;
    }

    /** Re-send the confirmation email + tickets (for when a buyer loses theirs). */
    public function handle_resend_confirmation(): void {
        $this->guard('oe_resend_confirmation');
        $order_id = absint($_REQUEST['id'] ?? 0);
        $order    = $order_id ? Orders::get($order_id) : null;
        $sent     = $order && (string) $order->email !== '';
        if ($sent) {
            Orders::send_confirmation($order_id);
        }
        $back = wp_get_referer() ?: admin_url('admin.php?page=oe-tickets');
        wp_safe_redirect(add_query_arg('oe_msg', $sent ? 'resent' : 'resend_failed', remove_query_arg('oe_msg', $back)));
        exit;
    }

    /* ------------------------------------------------------------------ *
     * Promo codes
     * ------------------------------------------------------------------ */

    public function render_promos(): void {
        $promos = Promo::all();
        self::prime_event_titles($promos);
        $events = get_posts(['post_type' => PostTypes::slug('event'), 'post_status' => 'publish', 'posts_per_page' => 200]);
        // Editing an existing code? (?edit=<id>)
        $edit_id = isset($_GET['edit']) ? absint($_GET['edit']) : 0;
        $editing = null;
        if ($edit_id) {
            foreach ($promos as $p) {
                if ((int) $p->id === $edit_id) { $editing = $p; break; }
            }
        }
        require OE_DIR . 'admin/views/promos.php';
    }

    /* ------------------------------------------------------------------ *
     * Sales dashboard
     * ------------------------------------------------------------------ */

    public function render_sales(): void {
        $stats   = Orders::stats();
        $daily   = Orders::daily_sales(30);
        $events  = Orders::event_summary();
        self::prime_event_titles($events);
        $currency = strtoupper((string) \OE\Settings::get('currency', 'usd'));
        require OE_DIR . 'admin/views/sales.php';
    }

    /* ------------------------------------------------------------------ *
     * Transactions (orders grouped by payment)
     * ------------------------------------------------------------------ */

    public function render_transactions(): void {
        $event_filter = isset($_GET['event']) ? absint($_GET['event']) : 0;
        $txns = Orders::transactions($event_filter, 300);
        self::prime_event_titles($txns);
        // Active tickets across each transaction, for the refund panel.
        $txn_tickets = Orders::active_tickets_for_payments(array_map(static fn($x) => (string) $x->payment_id, $txns));
        $events = get_posts(['post_type' => PostTypes::slug('event'), 'post_status' => 'publish', 'posts_per_page' => 200, 'orderby' => 'title', 'order' => 'ASC']);
        require OE_DIR . 'admin/views/transactions.php';
    }

    /* ------------------------------------------------------------------ *
     * Failed payments
     * ------------------------------------------------------------------ */

    public function render_failed_payments(): void {
        $ready = \OE\Connectors\StripeConnector::is_ready();
        $days  = 90;
        // Cache the Stripe pull briefly — this tab can be reloaded often and each
        // load otherwise pages the charges API. A Refresh link busts it.
        $cache_key = 'oe_failed_charges_' . $days;
        if (! empty($_GET['refresh']) && check_admin_referer('oe_failed_refresh')) {
            delete_transient($cache_key);
        }
        $charges = $ready ? get_transient($cache_key) : [];
        if ($ready && ! is_array($charges)) {
            $charges = \OE\Connectors\StripeConnector::failed_charges($days, 300);
            set_transient($cache_key, $charges, 5 * MINUTE_IN_SECONDS);
        }
        $charges = is_array($charges) ? $charges : [];

        // Tally failures by reason for the pie chart (most common first).
        $reasons = [];
        foreach ($charges as $c) {
            $label = self::failure_label((string) ($c['code'] ?? ''));
            $reasons[$label] = ($reasons[$label] ?? 0) + 1;
        }
        arsort($reasons);
        require OE_DIR . 'admin/views/failed-payments.php';
    }

    /** Map a Stripe decline/failure code to a short, human label for the chart. */
    public static function failure_label(string $code): string {
        $map = [
            'insufficient_funds'      => __('Insufficient funds', 'october-events'),
            'generic_decline'         => __('Bank declined (generic)', 'october-events'),
            'do_not_honor'            => __('Bank declined (do not honor)', 'october-events'),
            'card_declined'           => __('Card declined', 'october-events'),
            'transaction_not_allowed' => __('Not allowed on this card', 'october-events'),
            'fraudulent'              => __('Flagged as fraud', 'october-events'),
            'lost_card'               => __('Reported lost', 'october-events'),
            'stolen_card'             => __('Reported stolen', 'october-events'),
            'expired_card'            => __('Expired card', 'october-events'),
            'incorrect_cvc'           => __('Wrong security code (CVC)', 'october-events'),
            'invalid_cvc'             => __('Wrong security code (CVC)', 'october-events'),
            'incorrect_number'        => __('Wrong card number', 'october-events'),
            'incorrect_zip'           => __('Wrong ZIP / postcode', 'october-events'),
            'card_not_supported'      => __('Card not supported', 'october-events'),
            'currency_not_supported'  => __('Currency not supported', 'october-events'),
            'processing_error'        => __('Processing error', 'october-events'),
            'authentication_required' => __('3-D Secure not completed', 'october-events'),
            'approve_with_id'         => __('Bank needs ID verification', 'october-events'),
            'try_again_later'         => __('Temporary — try again later', 'october-events'),
            'call_issuer'             => __('Call issuer', 'october-events'),
            'card_velocity_exceeded'  => __('Card limit reached', 'october-events'),
            'withdrawal_count_limit_exceeded' => __('Card limit reached', 'october-events'),
            'unknown'                 => __('Unknown', 'october-events'),
            ''                        => __('Unknown', 'october-events'),
        ];
        return $map[$code] ?? ucwords(str_replace('_', ' ', $code));
    }

    /* ------------------------------------------------------------------ *
     * Waitlist
     * ------------------------------------------------------------------ */

    public function render_waitlist(): void {
        $event_filter = isset($_GET['event']) ? absint($_GET['event']) : 0;
        $entries = \OE\Ticketing\Waitlist::all($event_filter);
        self::prime_event_titles($entries);
        $events  = get_posts(['post_type' => PostTypes::slug('event'), 'post_status' => 'publish', 'posts_per_page' => 200, 'orderby' => 'title', 'order' => 'ASC']);
        require OE_DIR . 'admin/views/waitlist.php';
    }

    public function handle_waitlist_promote(): void {
        $this->guard('oe_waitlist_promote');
        \OE\Ticketing\Waitlist::promote(absint($_REQUEST['id'] ?? 0));
        wp_safe_redirect(wp_get_referer() ?: admin_url('admin.php?page=oe-tickets&tab=waitlist'));
        exit;
    }

    public function handle_waitlist_remove(): void {
        $this->guard('oe_waitlist_remove');
        \OE\Ticketing\Waitlist::remove(absint($_REQUEST['id'] ?? 0));
        wp_safe_redirect(wp_get_referer() ?: admin_url('admin.php?page=oe-tickets&tab=waitlist'));
        exit;
    }

    /* ------------------------------------------------------------------ *
     * Check-in log
     * ------------------------------------------------------------------ */

    public function render_checkin_log(): void {
        $event_filter = isset($_GET['event']) ? absint($_GET['event']) : 0;
        $paged        = max(1, isset($_GET['paged']) ? absint($_GET['paged']) : 1);
        $per_page     = 50;
        $offset       = ($paged - 1) * $per_page;

        // Log rows are collapsed to one per ticket + door (repeat scans at the
        // same door become a "rescans" count); a different door is a new row.
        $rows   = \OE\Ticketing\CheckIn::log_grouped($event_filter, $per_page, $offset);
        $groups = \OE\Ticketing\CheckIn::log_groups_total($event_filter);
        self::prime_event_titles($rows);
        $total = \OE\Ticketing\CheckIn::log_total($event_filter);
        $stats = $event_filter ? \OE\Ticketing\CheckIn::stats($event_filter) : null;
        $pages = (int) ceil($groups / $per_page);

        // Chart data: scans per event+door, and scans by hour of the local day.
        $by_venue = \OE\Ticketing\CheckIn::scans_by_event_venue($event_filter);
        self::prime_event_titles($by_venue);
        $by_hour  = \OE\Ticketing\CheckIn::scans_by_hour($event_filter);

        // Events that have ticket types, for the filter dropdown.
        $events = get_posts(['post_type' => PostTypes::slug('event'), 'post_status' => 'publish', 'posts_per_page' => 200, 'orderby' => 'title', 'order' => 'ASC']);
        require OE_DIR . 'admin/views/checkin-log.php';
    }

    public function handle_save_promo(): void {
        $this->guard('oe_save_promo');
        Promo::save([
            'code'           => $_POST['code'] ?? '',
            'event_id'       => $_POST['event_id'] ?? '',
            'discount_type'  => $_POST['discount_type'] ?? 'percent',
            'discount_value' => $_POST['discount_value'] ?? 0,
            'max_uses'       => $_POST['max_uses'] ?? '',
            'expires_at'     => $_POST['expires_at'] ?? '',
            'active'         => ! empty($_POST['active']),
        ], absint($_POST['id'] ?? 0));
        wp_safe_redirect(admin_url('admin.php?page=oe-tickets&tab=promos'));
        exit;
    }

    public function handle_delete_promo(): void {
        $this->guard('oe_delete_promo');
        Promo::delete(absint($_REQUEST['id'] ?? 0));
        wp_safe_redirect(admin_url('admin.php?page=oe-tickets&tab=promos'));
        exit;
    }

    /* ------------------------------------------------------------------ *
     * CSV export
     * ------------------------------------------------------------------ */

    public function maybe_export_orders(): void {
        $type = isset($_GET['oe_export']) ? sanitize_key((string) $_GET['oe_export']) : '';
        if (! in_array($type, ['orders', 'attendees'], true) || ! current_user_can('manage_options')) {
            return;
        }
        check_admin_referer('oe_export');
        $event = isset($_GET['event']) ? absint($_GET['event']) : 0;
        if ($type === 'attendees') {
            $this->export_attendees($event);
        } else {
            $this->export_orders($event);
        }
    }

    /** One row per order (financial view). Honours the event filter. */
    private function export_orders(int $event): void {
        global $wpdb;
        $where = $event ? $wpdb->prepare('WHERE event_id = %d', $event) : '';
        $rows  = $wpdb->get_results("SELECT * FROM " . Schema::orders() . " {$where} ORDER BY id DESC");
        $out   = $this->csv_headers('orders', $event);
        fputcsv($out, ['Order', 'Event', 'Email', 'Name', 'Type', 'Qty', 'Total', 'Currency', 'Method', 'Status', 'Source', 'Date']);
        foreach (($rows ?: []) as $o) {
            fputcsv($out, [$o->id, get_the_title((int) $o->event_id), $o->email, $o->name, $o->ticket_type_label, $o->qty, $o->total, $o->currency, $o->payment_method, $o->status, $o->source, $o->created_at]);
        }
        fclose($out);
        exit;
    }

    /**
     * One row per ticket — the attendee list staff actually want at the door:
     * each admission with its name, type, buyer, and live check-in status.
     * Honours the event filter.
     */
    private function export_attendees(int $event): void {
        global $wpdb;
        $o = Schema::orders();
        $t = Schema::tickets();
        $c = Schema::checkins();
        $where = $event ? $wpdb->prepare('AND o.event_id = %d', $event) : '';
        $rows = $wpdb->get_results(
            "SELECT ti.id, ti.attendee_name, ti.ticket_type_label, ti.ticket_number, ti.total_in_order,
                    ti.token, ti.status AS ticket_status, o.id AS order_id, o.event_id, o.email, o.name AS buyer,
                    o.status AS order_status, o.created_at,
                    (SELECT COUNT(*) FROM {$c} ck WHERE ck.ticket_id = ti.id) AS scans,
                    (SELECT MIN(ck.scanned_at) FROM {$c} ck WHERE ck.ticket_id = ti.id) AS first_scan,
                    (SELECT ck.venue_name FROM {$c} ck WHERE ck.ticket_id = ti.id ORDER BY ck.id ASC LIMIT 1) AS venue
             FROM {$t} ti INNER JOIN {$o} o ON ti.order_id = o.id
             WHERE o.status = 'paid' {$where}
             ORDER BY o.event_id ASC, ti.id ASC"
        );
        $out = $this->csv_headers('attendees', $event);
        fputcsv($out, ['Event', 'Attendee', 'Ticket type', 'Ticket #', 'Buyer name', 'Buyer email', 'Order', 'Ticket status', 'Checked in', 'Check-in time', 'Door', 'Order date']);
        foreach (($rows ?: []) as $r) {
            fputcsv($out, [
                get_the_title((int) $r->event_id),
                $r->attendee_name,
                $r->ticket_type_label,
                $r->ticket_number . '/' . $r->total_in_order,
                $r->buyer,
                $r->email,
                $r->order_id,
                $r->ticket_status,
                ((int) $r->scans > 0) ? 'Yes' : 'No',
                (string) $r->first_scan,
                (string) $r->venue,
                $r->created_at,
            ]);
        }
        fclose($out);
        exit;
    }

    /** Emit CSV download headers and return the output handle. */
    private function csv_headers(string $kind, int $event)
    {
        nocache_headers();
        $suffix = $event ? ('-event-' . $event) : '';
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename=oe-' . $kind . $suffix . '.csv');
        $out = fopen('php://output', 'w');
        fwrite($out, "\xEF\xBB\xBF"); // UTF-8 BOM so Excel reads accents correctly
        return $out;
    }

    /* ------------------------------------------------------------------ */

    /** Load every event title a result set references in one query, not one per row. */
    private static function prime_event_titles(array $rows): void {
        $ids = [];
        foreach ($rows as $r) {
            $id = (int) ($r->event_id ?? 0);
            if ($id) {
                $ids[$id] = $id;
            }
        }
        if ($ids) {
            _prime_post_caches(array_values($ids), false, false);
        }
    }

    private function guard(string $action): void {
        if (! current_user_can('manage_options')) {
            wp_die('Forbidden', '', ['response' => 403]);
        }
        check_admin_referer($action);
    }

    /** Convert stored MySQL/ISO datetime to value for <input type=datetime-local>. */
    private function dt_local(string $v): string {
        if ($v === '') {
            return '';
        }
        $ts = strtotime($v);
        return $ts ? gmdate('Y-m-d\TH:i', $ts) : '';
    }

    /** Convert a datetime-local value back to a MySQL-ish string. */
    private function from_local(string $v): string {
        $v = trim($v);
        if ($v === '') {
            return '';
        }
        $ts = strtotime($v);
        return $ts ? gmdate('Y-m-d H:i:s', $ts) : '';
    }
}
