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
        add_action('admin_post_oe_save_promo', [$this, 'handle_save_promo']);
        add_action('admin_post_oe_delete_promo', [$this, 'handle_delete_promo']);
        add_action('admin_init', [$this, 'maybe_export_orders']);
    }

    /* ------------------------------------------------------------------ *
     * Event ticket-type meta box
     * ------------------------------------------------------------------ */

    public function add_meta_boxes(): void {
        add_meta_box('oe_ticket_types', __('ADF — Tickets', 'october-events'), [$this, 'render_event_meta_box'], PostTypes::slug('event'), 'normal', 'high');
    }

    public function render_event_meta_box(\WP_Post $post): void {
        wp_nonce_field('oe_save_tickets', 'oe_tickets_nonce');
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
                <th><?php esc_html_e('Capacity', 'october-events'); ?></th>
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

        <p><label><strong><?php esc_html_e('Close all sales at', 'october-events'); ?></strong>
            <input type="datetime-local" name="oe_sale_until" value="<?php echo esc_attr($this->dt_local((string) get_post_meta($post->ID, TicketTypes::META_SALE_UNTIL, true))); ?>"></label></p>
        <p><label><strong><?php esc_html_e('Check-in venues / doors', 'october-events'); ?></strong> — <?php esc_html_e('one per line', 'october-events'); ?><br>
            <textarea name="oe_venues" rows="3" class="large-text"><?php echo esc_textarea(implode("\n", array_map(static fn($v) => (string) ($v['name'] ?? ''), $venues))); ?></textarea></label></p>
        <p><label><strong><?php esc_html_e('Check-in PIN', 'october-events'); ?></strong>
            <input type="text" name="oe_checkin_pin" value="<?php echo esc_attr(TicketTypes::pin($post->ID)); ?>" maxlength="6" size="8"></label>
            <span class="description"><?php esc_html_e('4–6 digits, given to door staff for the check-in app.', 'october-events'); ?></span></p>

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
            <td><input type="number" min="0" name="oe_tt[<?php echo $i; ?>][capacity]" value="<?php echo esc_attr($t['capacity'] ?? ''); ?>" style="width:70px" placeholder="∞"></td>
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
                'capacity'         => $r['capacity'] ?? '',
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
    }

    /* ------------------------------------------------------------------ *
     * Registrations (orders) screen + manual add
     * ------------------------------------------------------------------ */

    public function render_registrations(): void {
        global $wpdb;
        $event_filter = isset($_GET['event']) ? absint($_GET['event']) : 0;
        $where = $event_filter ? $wpdb->prepare('WHERE event_id = %d', $event_filter) : '';
        $orders = $wpdb->get_results("SELECT * FROM " . Schema::orders() . " {$where} ORDER BY id DESC LIMIT 500");

        // Events that have ticket types, for the manual-add form + filter.
        $events = get_posts(['post_type' => PostTypes::slug('event'), 'post_status' => 'publish', 'posts_per_page' => 200]);
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

    /* ------------------------------------------------------------------ *
     * Promo codes
     * ------------------------------------------------------------------ */

    public function render_promos(): void {
        $promos = Promo::all();
        $events = get_posts(['post_type' => PostTypes::slug('event'), 'post_status' => 'publish', 'posts_per_page' => 200]);
        require OE_DIR . 'admin/views/promos.php';
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
        wp_safe_redirect(admin_url('admin.php?page=oe-promos'));
        exit;
    }

    public function handle_delete_promo(): void {
        $this->guard('oe_delete_promo');
        Promo::delete(absint($_REQUEST['id'] ?? 0));
        wp_safe_redirect(admin_url('admin.php?page=oe-promos'));
        exit;
    }

    /* ------------------------------------------------------------------ *
     * CSV export
     * ------------------------------------------------------------------ */

    public function maybe_export_orders(): void {
        if (empty($_GET['oe_export']) || $_GET['oe_export'] !== 'orders' || ! current_user_can('manage_options')) {
            return;
        }
        check_admin_referer('oe_export');
        global $wpdb;
        $rows = $wpdb->get_results("SELECT * FROM " . Schema::orders() . " ORDER BY id DESC");
        nocache_headers();
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename=oe-registrations.csv');
        $out = fopen('php://output', 'w');
        fputcsv($out, ['Order', 'Event', 'Email', 'Name', 'Type', 'Qty', 'Total', 'Currency', 'Method', 'Status', 'Source', 'Date']);
        foreach (($rows ?: []) as $o) {
            fputcsv($out, [$o->id, get_the_title((int) $o->event_id), $o->email, $o->name, $o->ticket_type_label, $o->qty, $o->total, $o->currency, $o->payment_method, $o->status, $o->source, $o->created_at]);
        }
        fclose($out);
        exit;
    }

    /* ------------------------------------------------------------------ */

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
