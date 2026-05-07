<?php
declare(strict_types=1);

namespace OctoberTickets;

defined('ABSPATH') || exit;

/**
 * Handles the [oct_checkout] shortcode and all checkout AJAX actions.
 */
class Checkout {

    private static ?Checkout $instance = null;

    private function __construct() {}

    public static function get_instance(): self {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function init(): void {
        add_shortcode('oct_checkout', [$this, 'render_shortcode']);

        // Stripe
        add_action('wp_ajax_oct_create_payment_intent',        [$this, 'ajax_create_payment_intent']);
        add_action('wp_ajax_nopriv_oct_create_payment_intent', [$this, 'ajax_create_payment_intent']);
        add_action('wp_ajax_oct_confirm_stripe_payment',        [$this, 'ajax_confirm_stripe_payment']);
        add_action('wp_ajax_nopriv_oct_confirm_stripe_payment', [$this, 'ajax_confirm_stripe_payment']);

        // PayPal
        add_action('wp_ajax_oct_create_paypal_order',        [$this, 'ajax_create_paypal_order']);
        add_action('wp_ajax_nopriv_oct_create_paypal_order', [$this, 'ajax_create_paypal_order']);
        add_action('wp_ajax_oct_capture_paypal_order',        [$this, 'ajax_capture_paypal_order']);
        add_action('wp_ajax_nopriv_oct_capture_paypal_order', [$this, 'ajax_capture_paypal_order']);
    }

    // -------------------------------------------------------------------------
    // Shortcode
    // -------------------------------------------------------------------------

    public function render_shortcode(array $atts): string {
        $atts = shortcode_atts(['event_id' => 0], $atts, 'oct_checkout');

        $event_id = $atts['event_id'] ? (int) $atts['event_id'] : get_the_ID();
        if (!$event_id) {
            return '<p class="oct-error">' . esc_html__('No event specified.', 'october-event-tickets') . '</p>';
        }

        $event = get_post($event_id);
        if (!$event || $event->post_type !== 'events' || $event->post_status !== 'publish') {
            return '<p class="oct-error">' . esc_html__('Event not found.', 'october-event-tickets') . '</p>';
        }

        // Check event-wide sale close date
        $meta     = EventMetaBox::get_instance();
        $sale_until = $meta->get_event_sale_until($event_id);
        if ($sale_until && current_time('timestamp') > strtotime($sale_until)) {
            return '<p class="oct-notice">' . esc_html__('Ticket sales for this event have now closed.', 'october-event-tickets') . '</p>';
        }

        $ticket_types = $meta->get_ticket_types($event_id);
        $active_types = array_filter($ticket_types, fn($tt) => !empty($tt['active']));

        if (empty($active_types)) {
            return '<p class="oct-notice">' . esc_html__('Ticket sales are not currently available for this event.', 'october-event-tickets') . '</p>';
        }

        // Enrich each ticket type with its availability status
        $typed_tickets = [];
        $any_available = false;
        foreach ($active_types as $tt) {
            $availability = $meta->get_ticket_availability($tt, $event_id);
            $tt['_availability'] = $availability;
            $typed_tickets[] = $tt;
            if ($availability['status'] === 'available') {
                $any_available = true;
            }
        }

        $settings        = Settings::get_instance();
        $currency_symbol = $settings->get_currency_symbol();
        $currency        = strtoupper($settings->get('currency', 'USD'));

        ob_start();
        // $typed_tickets replaces $active_types in the template
        $active_types = $typed_tickets;
        include OCT_TICKETS_DIR . 'templates/checkout.php';
        return ob_get_clean() ?: '';
    }

    // -------------------------------------------------------------------------
    // AJAX: Stripe — Create PaymentIntent
    // -------------------------------------------------------------------------

    public function ajax_create_payment_intent(): void {
        check_ajax_referer('oct_checkout_nonce', 'nonce');

        $event_id        = (int) ($_POST['event_id'] ?? 0);
        $ticket_type_key = sanitize_text_field($_POST['ticket_type_key'] ?? '');
        $qty             = max(1, (int) ($_POST['qty'] ?? 1));
        $promo_code      = strtoupper(sanitize_text_field($_POST['promo_code'] ?? ''));
        $email           = sanitize_email($_POST['email'] ?? '');

        if (!$event_id || !$ticket_type_key || !$email) {
            wp_send_json_error(['message' => __('Missing required fields.', 'october-event-tickets')]);
        }

        $meta_box = EventMetaBox::get_instance();

        // Check event sale close
        $event_sale_until = $meta_box->get_event_sale_until($event_id);
        if ($event_sale_until && current_time('timestamp') > strtotime($event_sale_until)) {
            wp_send_json_error(['message' => __('Ticket sales for this event have closed.', 'october-event-tickets')]);
        }

        $ticket_type = $meta_box->get_ticket_type_by_key($event_id, $ticket_type_key);
        if (!$ticket_type || empty($ticket_type['active'])) {
            wp_send_json_error(['message' => __('Invalid ticket type.', 'october-event-tickets')]);
        }

        // Check ticket-type availability
        $availability = $meta_box->get_ticket_availability($ticket_type, $event_id);
        if ($availability['status'] !== 'available') {
            wp_send_json_error(['message' => __('This ticket type is not currently available.', 'october-event-tickets')]);
        }

        $effective_price = isset($ticket_type['sale_price']) && $ticket_type['sale_price'] !== null
            ? (float) $ticket_type['sale_price']
            : (float) $ticket_type['price'];

        $subtotal        = round($effective_price * $qty, 2);
        $discount_amount = 0.0;

        if ($promo_code) {
            $promo_result = PromoCodes::get_instance()->validate($promo_code, $event_id, $subtotal);
            if (!is_wp_error($promo_result)) {
                $discount_amount = $promo_result['discount_amount'];
            }
        }

        $total        = max(0, $subtotal - $discount_amount);
        $amount_cents = (int) round($total * 100);

        if ($amount_cents < 50) {
            wp_send_json_error(['message' => __('Order total is too low for card payment.', 'october-event-tickets')]);
        }

        $currency = strtoupper(Settings::get_instance()->get('currency', 'USD'));

        $result = StripeGateway::get_instance()->create_payment_intent(
            $amount_cents,
            $currency,
            [
                'event_id'        => $event_id,
                'email'           => $email,
                'ticket_type_key' => $ticket_type_key,
                'qty'             => $qty,
                'promo_code'      => $promo_code,
            ]
        );

        if (is_wp_error($result)) {
            wp_send_json_error(['message' => $result->get_error_message()]);
        }

        wp_send_json_success([
            'client_secret'     => $result['client_secret'],
            'payment_intent_id' => $result['payment_intent_id'],
            'amount'            => $amount_cents,
            'subtotal'          => $subtotal,
            'discount_amount'   => $discount_amount,
            'total'             => $total,
        ]);
    }

    // -------------------------------------------------------------------------
    // AJAX: Stripe — Confirm Payment
    // -------------------------------------------------------------------------

    public function ajax_confirm_stripe_payment(): void {
        check_ajax_referer('oct_checkout_nonce', 'nonce');

        $payment_intent_id = sanitize_text_field($_POST['payment_intent_id'] ?? '');
        $event_id          = (int) ($_POST['event_id'] ?? 0);
        $ticket_type_key   = sanitize_text_field($_POST['ticket_type_key'] ?? '');
        $qty               = max(1, (int) ($_POST['qty'] ?? 1));
        $name              = sanitize_text_field($_POST['name'] ?? '');
        $email             = sanitize_email($_POST['email'] ?? '');
        $promo_code        = strtoupper(sanitize_text_field($_POST['promo_code'] ?? ''));

        if (!$payment_intent_id || !$event_id || !$ticket_type_key || !$email) {
            wp_send_json_error(['message' => __('Missing required fields.', 'october-event-tickets')]);
        }

        // Verify PaymentIntent with Stripe
        $pi = StripeGateway::get_instance()->get_payment_intent($payment_intent_id);
        if (is_wp_error($pi)) {
            wp_send_json_error(['message' => $pi->get_error_message()]);
        }

        if (($pi['status'] ?? '') !== 'succeeded') {
            wp_send_json_error(['message' => __('Payment has not been completed.', 'october-event-tickets')]);
        }

        // Idempotency: check if order already exists for this payment_intent
        global $wpdb;
        $existing = $wpdb->get_var(
            $wpdb->prepare(
                "SELECT id FROM {$wpdb->prefix}oct_orders WHERE payment_id = %s LIMIT 1",
                $payment_intent_id
            )
        );
        if ($existing) {
            $tickets = DB::get_tickets_by_order((int) $existing);
            $urls    = array_map(fn($t) => home_url('/oct-ticket/' . $t->token . '/'), $tickets);
            wp_send_json_success([
                'order_id'       => (int) $existing,
                'ticket_urls'    => $urls,
                'already_exists' => true,
            ]);
        }

        $ticket_type = EventMetaBox::get_instance()->get_ticket_type_by_key($event_id, $ticket_type_key);
        if (!$ticket_type) {
            wp_send_json_error(['message' => __('Ticket type not found.', 'october-event-tickets')]);
        }

        // Validate promo server-side
        $discount_amount = 0.0;
        if ($promo_code) {
            $effective_price = isset($ticket_type['sale_price']) && $ticket_type['sale_price'] !== null
                ? (float) $ticket_type['sale_price']
                : (float) $ticket_type['price'];
            $subtotal = round($effective_price * $qty, 2);
            $promo_result = PromoCodes::get_instance()->validate($promo_code, $event_id, $subtotal);
            if (!is_wp_error($promo_result)) {
                $discount_amount = $promo_result['discount_amount'];
            }
        }

        $result = TicketGenerator::get_instance()->create_order_and_tickets(
            [
                'event_id'        => $event_id,
                'email'           => $email,
                'name'            => $name,
                'qty'             => $qty,
                'promo_code'      => $promo_code,
                'discount_amount' => $discount_amount,
            ],
            $ticket_type,
            $payment_intent_id,
            'stripe'
        );

        if (is_wp_error($result)) {
            wp_send_json_error(['message' => $result->get_error_message()]);
        }

        $this->send_confirmation_email($result['order_id']);

        $ticket_urls = array_map(fn($t) => $t['print_url'], $result['tickets']);

        wp_send_json_success([
            'order_id'    => $result['order_id'],
            'ticket_urls' => $ticket_urls,
        ]);
    }

    // -------------------------------------------------------------------------
    // AJAX: PayPal — Create Order
    // -------------------------------------------------------------------------

    public function ajax_create_paypal_order(): void {
        check_ajax_referer('oct_checkout_nonce', 'nonce');

        $event_id        = (int) ($_POST['event_id'] ?? 0);
        $ticket_type_key = sanitize_text_field($_POST['ticket_type_key'] ?? '');
        $qty             = max(1, (int) ($_POST['qty'] ?? 1));
        $promo_code      = strtoupper(sanitize_text_field($_POST['promo_code'] ?? ''));
        $email           = sanitize_email($_POST['email'] ?? '');

        if (!$event_id || !$ticket_type_key) {
            wp_send_json_error(['message' => __('Missing required fields.', 'october-event-tickets')]);
        }

        $ticket_type = EventMetaBox::get_instance()->get_ticket_type_by_key($event_id, $ticket_type_key);
        if (!$ticket_type || empty($ticket_type['active'])) {
            wp_send_json_error(['message' => __('Invalid ticket type.', 'october-event-tickets')]);
        }

        $effective_price = isset($ticket_type['sale_price']) && $ticket_type['sale_price'] !== null
            ? (float) $ticket_type['sale_price']
            : (float) $ticket_type['price'];

        $subtotal        = round($effective_price * $qty, 2);
        $discount_amount = 0.0;

        if ($promo_code) {
            $promo_result = PromoCodes::get_instance()->validate($promo_code, $event_id, $subtotal);
            if (!is_wp_error($promo_result)) {
                $discount_amount = $promo_result['discount_amount'];
            }
        }

        $total    = max(0.01, $subtotal - $discount_amount);
        $currency = strtoupper(Settings::get_instance()->get('currency', 'USD'));
        $event    = get_post($event_id);

        $description = sprintf(
            '%dx %s — %s',
            $qty,
            $ticket_type['label'],
            $event ? $event->post_title : "Event #{$event_id}"
        );

        $result = PayPalGateway::get_instance()->create_order(
            $total,
            $currency,
            $description,
            [
                'event_id'        => $event_id,
                'ticket_type_key' => $ticket_type_key,
                'qty'             => $qty,
                'promo_code'      => $promo_code,
                'email'           => $email,
            ]
        );

        if (is_wp_error($result)) {
            wp_send_json_error(['message' => $result->get_error_message()]);
        }

        wp_send_json_success(['paypal_order_id' => $result['id']]);
    }

    // -------------------------------------------------------------------------
    // AJAX: PayPal — Capture Order
    // -------------------------------------------------------------------------

    public function ajax_capture_paypal_order(): void {
        check_ajax_referer('oct_checkout_nonce', 'nonce');

        $paypal_order_id = sanitize_text_field($_POST['paypal_order_id'] ?? '');
        $event_id        = (int) ($_POST['event_id'] ?? 0);
        $ticket_type_key = sanitize_text_field($_POST['ticket_type_key'] ?? '');
        $qty             = max(1, (int) ($_POST['qty'] ?? 1));
        $name            = sanitize_text_field($_POST['name'] ?? '');
        $email           = sanitize_email($_POST['email'] ?? '');
        $promo_code      = strtoupper(sanitize_text_field($_POST['promo_code'] ?? ''));

        if (!$paypal_order_id || !$event_id || !$ticket_type_key || !$email) {
            wp_send_json_error(['message' => __('Missing required fields.', 'october-event-tickets')]);
        }

        // Idempotency check
        global $wpdb;
        $existing = $wpdb->get_var(
            $wpdb->prepare(
                "SELECT id FROM {$wpdb->prefix}oct_orders WHERE payment_id = %s LIMIT 1",
                $paypal_order_id
            )
        );
        if ($existing) {
            $tickets  = DB::get_tickets_by_order((int) $existing);
            $urls     = array_map(fn($t) => home_url('/oct-ticket/' . $t->token . '/'), $tickets);
            wp_send_json_success([
                'order_id'       => (int) $existing,
                'ticket_urls'    => $urls,
                'already_exists' => true,
            ]);
        }

        // Capture with PayPal
        $capture = PayPalGateway::get_instance()->capture_order($paypal_order_id);
        if (is_wp_error($capture)) {
            wp_send_json_error(['message' => $capture->get_error_message()]);
        }

        if (!PayPalGateway::get_instance()->is_capture_complete($capture)) {
            wp_send_json_error(['message' => __('PayPal payment not completed.', 'october-event-tickets')]);
        }

        $ticket_type = EventMetaBox::get_instance()->get_ticket_type_by_key($event_id, $ticket_type_key);
        if (!$ticket_type) {
            wp_send_json_error(['message' => __('Ticket type not found.', 'october-event-tickets')]);
        }

        $discount_amount = 0.0;
        if ($promo_code) {
            $effective_price = isset($ticket_type['sale_price']) && $ticket_type['sale_price'] !== null
                ? (float) $ticket_type['sale_price']
                : (float) $ticket_type['price'];
            $subtotal = round($effective_price * $qty, 2);
            $promo_result = PromoCodes::get_instance()->validate($promo_code, $event_id, $subtotal);
            if (!is_wp_error($promo_result)) {
                $discount_amount = $promo_result['discount_amount'];
            }
        }

        $capture_id = PayPalGateway::get_instance()->get_capture_id($capture);

        $result = TicketGenerator::get_instance()->create_order_and_tickets(
            [
                'event_id'        => $event_id,
                'email'           => $email,
                'name'            => $name,
                'qty'             => $qty,
                'promo_code'      => $promo_code,
                'discount_amount' => $discount_amount,
            ],
            $ticket_type,
            $capture_id ?: $paypal_order_id,
            'paypal'
        );

        if (is_wp_error($result)) {
            wp_send_json_error(['message' => $result->get_error_message()]);
        }

        $this->send_confirmation_email($result['order_id']);

        $ticket_urls = array_map(fn($t) => $t['print_url'], $result['tickets']);

        wp_send_json_success([
            'order_id'    => $result['order_id'],
            'ticket_urls' => $ticket_urls,
        ]);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private function send_confirmation_email(int $order_id): void {
        $order      = DB::get_order($order_id);
        $tickets_db = DB::get_tickets_by_order($order_id);
        $event      = get_post((int) $order->event_id);
        $event_meta = TicketGenerator::get_instance()->get_event_meta((int) $order->event_id);

        if ($order && $tickets_db && $event) {
            Brevo::get_instance()->send_order_confirmation($order, $tickets_db, $event, $event_meta);
        }
    }
}
