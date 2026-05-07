<?php
declare(strict_types=1);

namespace OctoberTickets;

defined('ABSPATH') || exit;

/**
 * REST API endpoints for the check-in PWA and Stripe webhooks.
 */
class CheckInApi {

    private static ?CheckInApi $instance = null;
    const NAMESPACE = 'oct-tickets/v1';

    private function __construct() {}

    public static function get_instance(): self {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function init(): void {
        add_action('rest_api_init', [$this, 'register_routes']);
    }

    public function register_routes(): void {
        // Check-in: scan a ticket
        register_rest_route(self::NAMESPACE, '/checkin', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_checkin'],
            'permission_callback' => '__return_true',
            'args'                => [
                'token'      => ['required' => true, 'sanitize_callback' => 'sanitize_text_field'],
                'venue_name' => ['required' => true, 'sanitize_callback' => 'sanitize_text_field'],
                'event_id'   => ['required' => true, 'sanitize_callback' => 'absint'],
                'event_pin'  => ['required' => true, 'sanitize_callback' => 'sanitize_text_field'],
            ],
        ]);

        // Venues for an event
        register_rest_route(self::NAMESPACE, '/venues', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'handle_venues'],
            'permission_callback' => '__return_true',
            'args'                => [
                'event_id'  => ['required' => true, 'sanitize_callback' => 'absint'],
                'event_pin' => ['required' => true, 'sanitize_callback' => 'sanitize_text_field'],
            ],
        ]);

        // Stats for an event
        register_rest_route(self::NAMESPACE, '/stats', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'handle_stats'],
            'permission_callback' => '__return_true',
            'args'                => [
                'event_id'  => ['required' => true, 'sanitize_callback' => 'absint'],
                'event_pin' => ['required' => true, 'sanitize_callback' => 'sanitize_text_field'],
            ],
        ]);

        // List published events
        register_rest_route(self::NAMESPACE, '/events', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'handle_events'],
            'permission_callback' => '__return_true',
        ]);

        // Stripe webhook
        register_rest_route(self::NAMESPACE, '/stripe-webhook', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'handle_stripe_webhook'],
            'permission_callback' => '__return_true',
        ]);
    }

    // -------------------------------------------------------------------------
    // Check-in
    // -------------------------------------------------------------------------

    public function handle_checkin(\WP_REST_Request $request): \WP_REST_Response {
        $token      = $request->get_param('token');
        $venue_name = $request->get_param('venue_name');
        $event_id   = (int) $request->get_param('event_id');
        $event_pin  = $request->get_param('event_pin');

        // Validate PIN
        if (!$this->validate_pin($event_id, $event_pin)) {
            return new \WP_REST_Response(['status' => 'invalid_pin', 'message' => __('Invalid PIN.', 'october-event-tickets')], 403);
        }

        // Look up ticket
        $ticket = DB::get_ticket_by_token($token);
        if (!$ticket) {
            return new \WP_REST_Response([
                'status'  => 'invalid',
                'message' => __('Ticket not found.', 'october-event-tickets'),
            ], 200);
        }

        if ($ticket->status !== 'active') {
            return new \WP_REST_Response([
                'status'  => 'invalid',
                'message' => __('Ticket is cancelled.', 'october-event-tickets'),
            ], 200);
        }

        if ((int) $ticket->event_id !== $event_id) {
            return new \WP_REST_Response([
                'status'  => 'wrong_event',
                'message' => __('Ticket is for a different event.', 'october-event-tickets'),
            ], 200);
        }

        // Check for existing checkin at this venue
        $existing_checkins = DB::get_checkins_by_ticket((int) $ticket->id);
        $already_at_venue  = false;
        foreach ($existing_checkins as $ci) {
            if ($ci->venue_name === $venue_name) {
                $already_at_venue = true;
                break;
            }
        }

        // Record check-in regardless (allow re-entry, just warn)
        DB::insert_checkin([
            'ticket_id'  => (int) $ticket->id,
            'event_id'   => $event_id,
            'venue_name' => $venue_name,
        ]);

        $checkin_count = count(DB::get_checkins_by_ticket((int) $ticket->id));

        $ticket_data = [
            'attendee_name'      => $ticket->attendee_name,
            'ticket_type_label'  => $ticket->ticket_type_label,
            'ticket_number'      => (int) $ticket->ticket_number,
            'total_in_order'     => (int) $ticket->total_in_order,
        ];

        if ($already_at_venue) {
            return new \WP_REST_Response([
                'status'        => 'already_scanned',
                'message'       => __('Already scanned at this venue.', 'october-event-tickets'),
                'ticket'        => $ticket_data,
                'checkin_count' => $checkin_count,
            ], 200);
        }

        return new \WP_REST_Response([
            'status'        => 'valid',
            'message'       => __('Valid ticket.', 'october-event-tickets'),
            'ticket'        => $ticket_data,
            'checkin_count' => $checkin_count,
        ], 200);
    }

    // -------------------------------------------------------------------------
    // Venues
    // -------------------------------------------------------------------------

    public function handle_venues(\WP_REST_Request $request): \WP_REST_Response {
        $event_id  = (int) $request->get_param('event_id');
        $event_pin = $request->get_param('event_pin');

        if (!$this->validate_pin($event_id, $event_pin)) {
            return new \WP_REST_Response(['error' => 'invalid_pin'], 403);
        }

        $venues = EventMetaBox::get_instance()->get_venues($event_id);
        $names  = array_map(fn($v) => $v['name'] ?? '', $venues);
        $names  = array_filter($names);

        return new \WP_REST_Response(array_values($names), 200);
    }

    // -------------------------------------------------------------------------
    // Stats
    // -------------------------------------------------------------------------

    public function handle_stats(\WP_REST_Request $request): \WP_REST_Response {
        $event_id  = (int) $request->get_param('event_id');
        $event_pin = $request->get_param('event_pin');

        if (!$this->validate_pin($event_id, $event_pin)) {
            return new \WP_REST_Response(['error' => 'invalid_pin'], 403);
        }

        $venue_stats   = DB::get_checkin_stats($event_id);
        $unique_scans  = DB::get_unique_checkin_count($event_id);

        return new \WP_REST_Response([
            'venue_stats'  => $venue_stats,
            'unique_scans' => $unique_scans,
        ], 200);
    }

    // -------------------------------------------------------------------------
    // Events list
    // -------------------------------------------------------------------------

    public function handle_events(\WP_REST_Request $request): \WP_REST_Response {
        $events = get_posts([
            'post_type'      => 'events',
            'post_status'    => 'publish',
            'posts_per_page' => 100,
            'orderby'        => 'title',
            'order'          => 'ASC',
        ]);

        $data = array_map(function ($e) {
            return [
                'id'    => $e->ID,
                'title' => $e->post_title,
                'date'  => get_post_meta($e->ID, 'event_date', true),
            ];
        }, $events);

        return new \WP_REST_Response($data, 200);
    }

    // -------------------------------------------------------------------------
    // Stripe Webhook
    // -------------------------------------------------------------------------

    public function handle_stripe_webhook(\WP_REST_Request $request): \WP_REST_Response {
        $payload    = $request->get_body();
        $sig_header = $request->get_header('stripe-signature') ?? '';

        if (!StripeGateway::get_instance()->verify_webhook_signature($payload, $sig_header)) {
            return new \WP_REST_Response(['error' => 'Invalid signature'], 400);
        }

        $event = json_decode($payload, true);
        if (!$event || ($event['type'] ?? '') !== 'payment_intent.succeeded') {
            return new \WP_REST_Response(['received' => true], 200);
        }

        $pi = $event['data']['object'] ?? [];
        if (empty($pi['id'])) {
            return new \WP_REST_Response(['received' => true], 200);
        }

        // Check if order already created (by the frontend confirm action)
        global $wpdb;
        $existing = $wpdb->get_var(
            $wpdb->prepare(
                "SELECT id FROM {$wpdb->prefix}oct_orders WHERE payment_id = %s LIMIT 1",
                $pi['id']
            )
        );

        if ($existing) {
            // Order already created — webhook is just a backup
            return new \WP_REST_Response(['received' => true], 200);
        }

        // Reconstruct from metadata if frontend didn't get to create the order
        $meta = $pi['metadata'] ?? [];
        if (empty($meta['event_id']) || empty($meta['email']) || empty($meta['ticket_type_key'])) {
            return new \WP_REST_Response(['received' => true], 200);
        }

        $event_id        = (int) $meta['event_id'];
        $email           = sanitize_email($meta['email']);
        $ticket_type_key = sanitize_text_field($meta['ticket_type_key']);
        $qty             = max(1, (int) ($meta['qty'] ?? 1));
        $promo_code      = sanitize_text_field($meta['promo_code'] ?? '');

        $ticket_type = EventMetaBox::get_instance()->get_ticket_type_by_key($event_id, $ticket_type_key);
        if (!$ticket_type) {
            return new \WP_REST_Response(['received' => true], 200);
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

        $result = TicketGenerator::get_instance()->create_order_and_tickets(
            [
                'event_id'        => $event_id,
                'email'           => $email,
                'name'            => '',
                'qty'             => $qty,
                'promo_code'      => $promo_code,
                'discount_amount' => $discount_amount,
            ],
            $ticket_type,
            $pi['id'],
            'stripe'
        );

        if (!is_wp_error($result)) {
            $order      = DB::get_order($result['order_id']);
            $tickets_db = DB::get_tickets_by_order($result['order_id']);
            $wp_event   = get_post($event_id);
            $event_meta = TicketGenerator::get_instance()->get_event_meta($event_id);
            if ($order && $tickets_db && $wp_event) {
                Brevo::get_instance()->send_order_confirmation($order, $tickets_db, $wp_event, $event_meta);
            }
        }

        return new \WP_REST_Response(['received' => true], 200);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private function validate_pin(int $event_id, string $pin): bool {
        $stored_pin = get_post_meta($event_id, '_oct_checkin_pin', true);
        // Fall back to post ID as PIN if none has been set
        if ($stored_pin === '' || $stored_pin === false) {
            $stored_pin = (string) $event_id;
        }
        return hash_equals((string) $stored_pin, $pin);
    }
}
