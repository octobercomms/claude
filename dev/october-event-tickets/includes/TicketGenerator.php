<?php
declare(strict_types=1);

namespace OctoberTickets;

defined('ABSPATH') || exit;

/**
 * Ticket creation, QR generation, and print template serving.
 */
class TicketGenerator {

    private static ?TicketGenerator $instance = null;

    private function __construct() {}

    public static function get_instance(): self {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function init(): void {
        // Nothing to hook at init time; methods called from Checkout and REST endpoints.
    }

    // -------------------------------------------------------------------------
    // Create tickets for a confirmed order
    // -------------------------------------------------------------------------

    /**
     * Create an order record and associated ticket records.
     *
     * @param array  $order_data  Validated order data.
     * @param array  $ticket_type Full ticket type definition from EventMetaBox.
     * @param string $payment_id  Gateway transaction / PaymentIntent ID.
     * @param string $payment_method 'stripe' or 'paypal'.
     * @return array{order_id: int, tickets: array}|\WP_Error
     */
    public function create_order_and_tickets(
        array $order_data,
        array $ticket_type,
        string $payment_id,
        string $payment_method
    ) {
        $qty_purchased    = (int) $order_data['qty'];
        $qty_per_purchase = (int) ($ticket_type['qty_per_purchase'] ?? 1);
        $total_tickets    = $qty_purchased * $qty_per_purchase;

        // Determine effective price
        $effective_price = isset($ticket_type['sale_price']) && $ticket_type['sale_price'] !== null
            ? (float) $ticket_type['sale_price']
            : (float) $ticket_type['price'];

        $subtotal        = $effective_price * $qty_purchased;
        $discount_amount = (float) ($order_data['discount_amount'] ?? 0);
        $total           = max(0, $subtotal - $discount_amount);

        $currency = strtoupper(Settings::get_instance()->get('currency', 'USD'));

        // Insert order
        $order_id = DB::insert_order([
            'event_id'          => (int) $order_data['event_id'],
            'email'             => sanitize_email($order_data['email']),
            'name'              => sanitize_text_field($order_data['name'] ?? ''),
            'ticket_type_key'   => sanitize_text_field($ticket_type['key']),
            'ticket_type_label' => sanitize_text_field($ticket_type['label']),
            'qty'               => $qty_purchased,
            'unit_price'        => $effective_price,
            'promo_code'        => !empty($order_data['promo_code']) ? strtoupper(sanitize_text_field($order_data['promo_code'])) : null,
            'discount_amount'   => $discount_amount,
            'total'             => $total,
            'currency'          => $currency,
            'payment_method'    => $payment_method,
            'payment_id'        => $payment_id,
            'status'            => 'paid',
        ]);

        if (!$order_id) {
            return new \WP_Error('db_error', __('Failed to create order record.', 'october-event-tickets'));
        }

        // Insert individual tickets
        $tickets = [];
        for ($i = 1; $i <= $total_tickets; $i++) {
            $token = bin2hex(random_bytes(32));

            $ticket_id = DB::insert_ticket([
                'order_id'          => $order_id,
                'event_id'          => (int) $order_data['event_id'],
                'ticket_type_label' => sanitize_text_field($ticket_type['label']),
                'attendee_name'     => sanitize_text_field($order_data['name'] ?? ''),
                'token'             => $token,
                'ticket_number'     => $i,
                'total_in_order'    => $total_tickets,
                'status'            => 'active',
            ]);

            $tickets[] = [
                'id'             => $ticket_id,
                'token'          => $token,
                'ticket_number'  => $i,
                'total_in_order' => $total_tickets,
                'print_url'      => home_url('/oct-ticket/' . $token . '/'),
            ];
        }

        // Increment promo code usage if applicable
        if (!empty($order_data['promo_code'])) {
            $promo = DB::get_promo_by_code($order_data['promo_code']);
            if ($promo) {
                DB::increment_promo_usage((int) $promo->id);
            }
        }

        return [
            'order_id' => $order_id,
            'tickets'  => $tickets,
        ];
    }

    // -------------------------------------------------------------------------
    // Print template rendering
    // -------------------------------------------------------------------------

    public function render_ticket_print(string $token): void {
        global $wpdb;

        $ticket = DB::get_ticket_by_token($token);

        if (!$ticket || $ticket->status !== 'active') {
            wp_die(
                esc_html__('This ticket is invalid or has been cancelled.', 'october-event-tickets'),
                esc_html__('Invalid Ticket', 'october-event-tickets'),
                ['response' => 404]
            );
        }

        $order = DB::get_order((int) $ticket->order_id);
        $event = get_post((int) $ticket->event_id);

        if (!$order || !$event) {
            wp_die(
                esc_html__('Ticket data not found.', 'october-event-tickets'),
                esc_html__('Error', 'october-event-tickets'),
                ['response' => 404]
            );
        }

        $event_meta = $this->get_event_meta((int) $ticket->event_id);

        include OCT_TICKETS_DIR . 'templates/ticket-print.php';
    }

    public function render_order_print(int $order_id): void {
        $order = DB::get_order($order_id);

        if (!$order) {
            wp_die(
                esc_html__('Order not found.', 'october-event-tickets'),
                esc_html__('Not Found', 'october-event-tickets'),
                ['response' => 404]
            );
        }

        // Basic access control: require email GET param or valid nonce
        $nonce_valid = isset($_GET['_nonce']) &&
            wp_verify_nonce(sanitize_text_field(wp_unslash($_GET['_nonce'])), 'oct_order_' . $order_id);
        $email_match = isset($_GET['email']) &&
            strtolower(sanitize_email(wp_unslash($_GET['email']))) === strtolower($order->email);

        if (!$nonce_valid && !$email_match && !current_user_can('manage_options')) {
            wp_die(
                esc_html__('Access denied.', 'october-event-tickets'),
                esc_html__('Access Denied', 'october-event-tickets'),
                ['response' => 403]
            );
        }

        $tickets    = DB::get_tickets_by_order($order_id);
        $event      = get_post((int) $order->event_id);
        $event_meta = $this->get_event_meta((int) $order->event_id);

        include OCT_TICKETS_DIR . 'templates/order-print.php';
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    public function get_event_meta(int $event_id): array {
        return [
            'ticket_types' => EventMetaBox::get_instance()->get_ticket_types($event_id),
            'venues'       => EventMetaBox::get_instance()->get_venues($event_id),
            'checkin_pin'  => get_post_meta($event_id, '_oct_checkin_pin', true),
            'event_date'   => get_post_meta($event_id, 'event_date', true), // JetEngine field
            'event_venue'  => get_post_meta($event_id, 'event_venue', true),
        ];
    }

    public function get_ticket_print_url(string $token): string {
        return home_url('/oct-ticket/' . rawurlencode($token) . '/');
    }

    public function get_order_print_url(int $order_id, string $email = ''): string {
        $url = home_url('/oct-ticket/order/' . $order_id . '/');
        if ($email) {
            $url = add_query_arg('email', rawurlencode($email), $url);
        }
        return $url;
    }
}
