<?php
declare(strict_types=1);

namespace ADF;

use ADF\Connectors\StripeConnector;
use ADF\Connectors\MapsConnector;

defined('ABSPATH') || exit;

/**
 * REST API (§2 dashboard backend, §4 webhooks, §7 map feed).
 *
 * Namespace: adf/v1. Authenticated endpoints require a logged-in user (cookie +
 * nonce from the dashboard). Public endpoints (map feed, Stripe webhook) are
 * explicitly marked. A simple per-user rate limit guards the submission
 * endpoint against spam (§10).
 */
final class RestApi {

    private static ?RestApi $instance = null;
    private const NS = 'adf/v1';

    public static function get_instance(): self {
        return self::$instance ??= new self();
    }

    public function init(): void {
        add_action('rest_api_init', [$this, 'register_routes']);
    }

    public function register_routes(): void {
        register_rest_route(self::NS, '/dashboard', [
            'methods'             => 'GET',
            'callback'            => [$this, 'get_dashboard'],
            'permission_callback' => [$this, 'require_login'],
        ]);

        register_rest_route(self::NS, '/listings', [
            'methods'             => 'GET',
            'callback'            => [$this, 'get_listings'],
            'permission_callback' => [$this, 'require_login'],
            'args'                => ['type' => ['sanitize_callback' => 'sanitize_key']],
        ]);

        register_rest_route(self::NS, '/submit', [
            'methods'             => 'POST',
            'callback'            => [$this, 'submit'],
            'permission_callback' => [$this, 'require_login_rate_limited'],
        ]);

        register_rest_route(self::NS, '/confirm-payment', [
            'methods'             => 'POST',
            'callback'            => [$this, 'confirm_payment'],
            'permission_callback' => [$this, 'require_login'],
            'args'                => ['intent_id' => ['required' => true, 'sanitize_callback' => 'sanitize_text_field']],
        ]);

        register_rest_route(self::NS, '/account', [
            'methods'             => 'POST',
            'callback'            => [$this, 'update_account'],
            'permission_callback' => [$this, 'require_login'],
        ]);

        // Volunteer signup to a specific opportunity + shift. Allowed without an
        // account (a logged-in user is linked automatically).
        register_rest_route(self::NS, '/volunteer-signup', [
            'methods'             => 'POST',
            'callback'            => [$this, 'volunteer_signup'],
            'permission_callback' => '__return_true',
            'args'                => [
                'opportunity_id' => ['required' => true, 'sanitize_callback' => 'absint'],
                'shift_id'       => ['required' => true, 'sanitize_callback' => 'sanitize_key'],
            ],
        ]);

        // Live shift availability for an opportunity (public, for the widget).
        register_rest_route(self::NS, '/volunteer-shifts', [
            'methods'             => 'GET',
            'callback'            => [$this, 'volunteer_shifts'],
            'permission_callback' => '__return_true',
            'args'                => ['opportunity_id' => ['required' => true, 'sanitize_callback' => 'absint']],
        ]);

        // Event checkout (public, Stripe).
        register_rest_route(self::NS, '/ticket-promo', [
            'methods'             => 'POST',
            'callback'            => [$this, 'ticket_promo'],
            'permission_callback' => '__return_true',
        ]);
        register_rest_route(self::NS, '/ticket-intent', [
            'methods'             => 'POST',
            'callback'            => [$this, 'ticket_intent'],
            'permission_callback' => '__return_true',
        ]);
        register_rest_route(self::NS, '/ticket-confirm', [
            'methods'             => 'POST',
            'callback'            => [$this, 'ticket_confirm'],
            'permission_callback' => '__return_true',
        ]);

        // Public map feed for Elementor/JetEngine or the fallback shortcode.
        register_rest_route(self::NS, '/map', [
            'methods'             => 'GET',
            'callback'            => [$this, 'map_pins'],
            'permission_callback' => '__return_true',
        ]);

        // Stripe webhook (public; verified by signature inside the connector).
        register_rest_route(self::NS, '/stripe-webhook', [
            'methods'             => 'POST',
            'callback'            => [$this, 'stripe_webhook'],
            'permission_callback' => '__return_true',
        ]);
    }

    /* ----------------------------------------------------------------- *
     * Permissions
     * ----------------------------------------------------------------- */

    public function require_login(): bool {
        return is_user_logged_in();
    }

    public function require_login_rate_limited() {
        if (! is_user_logged_in()) {
            return false;
        }
        $key   = 'adf_rl_' . get_current_user_id();
        $count = (int) get_transient($key);
        if ($count >= 10) {
            return new \WP_Error('adf_rate_limited', __('Too many submissions, please wait a minute.', 'adf-festival'), ['status' => 429]);
        }
        set_transient($key, $count + 1, MINUTE_IN_SECONDS);
        return true;
    }

    private function account_id(): int {
        return Account::ensure(get_current_user_id());
    }

    /* ----------------------------------------------------------------- *
     * Handlers
     * ----------------------------------------------------------------- */

    public function get_dashboard(\WP_REST_Request $req): \WP_REST_Response {
        $account_id = $this->account_id();

        $pending = get_posts([
            'post_type'      => PostTypes::listing_slugs(),
            'post_status'    => 'any',
            'fields'         => 'ids',
            'posts_per_page' => -1,
            'meta_query'     => [
                ['key' => Fields::key('submitter_account_id'), 'value' => $account_id],
                ['key' => Fields::key('status'), 'value' => Fields::STATUS_PENDING_REVIEW],
            ],
            'no_found_rows'  => true,
        ]);

        return new \WP_REST_Response([
            'account' => [
                'id'     => $account_id,
                'name'   => Account::name($account_id),
                'status' => get_post_meta($account_id, '_adf_account_status', true) ?: 'active',
            ],
            'pending_count'  => count($pending),
            'tickets'        => array_map([$this, 'ticket_dto'], \ADF\Ticketing\Orders::for_account($account_id)),
            'volunteer'      => array_map([$this, 'volunteer_dto'], Volunteers::for_account($account_id)),
            'invoices'       => Invoice::for_account($account_id),
        ], 200);
    }

    public function get_listings(\WP_REST_Request $req): \WP_REST_Response {
        $account_id = $this->account_id();
        $type = (string) $req->get_param('type');
        $slugs = $type && PostTypes::slug($type) ? [PostTypes::slug($type)] : PostTypes::listing_slugs();

        $ids = get_posts([
            'post_type'      => $slugs,
            'post_status'    => 'any',
            'fields'         => 'ids',
            'posts_per_page' => 200,
            'meta_key'       => Fields::key('submitter_account_id'),
            'meta_value'     => $account_id,
            'orderby'        => 'modified',
            'order'          => 'DESC',
        ]);

        return new \WP_REST_Response(array_map([$this, 'listing_dto'], $ids), 200);
    }

    public function submit(\WP_REST_Request $req): \WP_REST_Response {
        $account_id = $this->account_id();
        $type = sanitize_key((string) $req->get_param('type'));
        $tier = sanitize_key((string) ($req->get_param('tier') ?: Fields::TIER_FREE));

        $result = Submission::create($type, [
            'title'   => $req->get_param('title'),
            'content' => $req->get_param('content'),
            'meta'    => (array) $req->get_param('meta'),
        ], $account_id, $tier);

        if (is_wp_error($result)) {
            return new \WP_REST_Response(['error' => $result->get_error_message()], 400);
        }
        return new \WP_REST_Response($result, 200);
    }

    public function confirm_payment(\WP_REST_Request $req): \WP_REST_Response {
        $intent_id = (string) $req->get_param('intent_id');
        // Verify with Stripe that the intent actually succeeded before advancing.
        $intent = StripeConnector::retrieve_payment_intent($intent_id);
        if (($intent['status'] ?? '') !== 'succeeded') {
            return new \WP_REST_Response(['error' => 'payment_not_complete', 'status' => $intent['status'] ?? 'unknown'], 402);
        }
        Submission::confirm_payment($intent_id);
        return new \WP_REST_Response(['ok' => true], 200);
    }

    public function update_account(\WP_REST_Request $req): \WP_REST_Response {
        $account_id = $this->account_id();
        $map = [
            'organisation_name' => 'sanitize_text_field',
            'contact_name'      => 'sanitize_text_field',
            'phone'             => 'sanitize_text_field',
            'billing_address'   => 'sanitize_textarea_field',
        ];
        foreach ($map as $field => $cb) {
            $value = $req->get_param($field);
            if ($value !== null) {
                update_post_meta($account_id, '_adf_' . $field, call_user_func($cb, (string) $value));
            }
        }
        return new \WP_REST_Response(['ok' => true], 200);
    }

    public function volunteer_signup(\WP_REST_Request $req): \WP_REST_Response {
        $account_id = is_user_logged_in() ? Account::ensure(get_current_user_id()) : 0;

        $result = Volunteers::signup(
            (int) $req->get_param('opportunity_id'),
            (string) $req->get_param('shift_id'),
            [
                'name'       => $req->get_param('name'),
                'email'      => $req->get_param('email'),
                'phone'      => $req->get_param('phone'),
                'sms_opt_in' => $req->get_param('sms_opt_in'),
            ],
            $account_id
        );

        if (is_wp_error($result)) {
            return new \WP_REST_Response(['error' => $result->get_error_message()], 400);
        }
        return new \WP_REST_Response(['ok' => true, 'id' => $result], 200);
    }

    public function volunteer_shifts(\WP_REST_Request $req): \WP_REST_Response {
        $opportunity_id = (int) $req->get_param('opportunity_id');
        $out = [];
        foreach (Volunteers::shifts($opportunity_id) as $s) {
            $s['spots_left'] = Volunteers::spots_left($opportunity_id, $s['id']);
            $s['full']       = Volunteers::shift_full($opportunity_id, $s['id']);
            $out[] = $s;
        }
        return new \WP_REST_Response($out, 200);
    }

    /* ----------------------------------------------------------------- *
     * Event checkout (Stripe only)
     * ----------------------------------------------------------------- */

    /**
     * Resolve + price a checkout request. Returns [type, qty, unit, subtotal,
     * discount, total, promo] or a \WP_Error.
     */
    private function price_checkout(\WP_REST_Request $req) {
        $event_id = absint($req->get_param('event_id'));
        $type_key = sanitize_key((string) $req->get_param('type_key'));
        $qty      = max(1, min(10, (int) $req->get_param('qty')));

        $type = \ADF\Ticketing\TicketTypes::type($event_id, $type_key);
        if (! $type) {
            return new \WP_Error('adf_bad_type', __('Unknown ticket type.', 'adf-festival'), ['status' => 400]);
        }
        $avail = \ADF\Ticketing\TicketTypes::availability($event_id, $type);
        if ($avail['state'] !== 'available') {
            return new \WP_Error('adf_unavailable', __('Those tickets are not currently on sale.', 'adf-festival'), ['status' => 409]);
        }

        $unit     = \ADF\Ticketing\TicketTypes::effective_price($type);
        $subtotal = round($unit * $qty, 2);
        $discount = 0.0;
        $promo    = null;
        $code     = trim((string) $req->get_param('promo_code'));
        if ($code !== '') {
            $res = \ADF\Ticketing\Promo::validate($code, $event_id, $subtotal);
            if (is_wp_error($res)) {
                return $res;
            }
            $discount = (float) $res['discount_amount'];
            $promo    = ['code' => strtoupper($code), 'promo_id' => $res['promo_id']];
        }
        $total = max(0, round($subtotal - $discount, 2));

        return compact('event_id', 'type', 'qty', 'unit', 'subtotal', 'discount', 'total', 'promo');
    }

    public function ticket_promo(\WP_REST_Request $req): \WP_REST_Response {
        $priced = $this->price_checkout($req);
        if (is_wp_error($priced)) {
            return new \WP_REST_Response(['error' => $priced->get_error_message()], 400);
        }
        return new \WP_REST_Response([
            'discount' => $priced['discount'],
            'total'    => $priced['total'],
        ], 200);
    }

    public function ticket_intent(\WP_REST_Request $req): \WP_REST_Response {
        if (! \ADF\Connectors\StripeConnector::is_ready()) {
            return new \WP_REST_Response(['error' => 'payments_unavailable'], 503);
        }
        $priced = $this->price_checkout($req);
        if (is_wp_error($priced)) {
            return new \WP_REST_Response(['error' => $priced->get_error_message()], (int) ($priced->get_error_data()['status'] ?? 400));
        }

        $cents = (int) round($priced['total'] * 100);
        if ($cents < 50) {
            // Free/comp orders skip Stripe — create immediately.
            $order = \ADF\Ticketing\Orders::create([
                'event_id' => $priced['event_id'], 'type' => $priced['type'], 'qty' => $priced['qty'],
                'email' => sanitize_email((string) $req->get_param('email')), 'name' => sanitize_text_field((string) $req->get_param('name')),
                'unit_price' => $priced['unit'], 'discount' => $priced['discount'], 'total' => $priced['total'],
                'promo' => $priced['promo'],
            ], '', 'free', 'public');
            if (is_wp_error($order)) {
                return new \WP_REST_Response(['error' => $order->get_error_message()], 400);
            }
            return new \WP_REST_Response(['free' => true, 'tickets' => $order['tickets']], 200);
        }

        $intent = \ADF\Connectors\StripeConnector::create_payment_intent($cents, (string) \ADF\Settings::get('currency', 'usd'), '', [
            'kind'     => 'ticket',
            'event_id' => $priced['event_id'],
            'type_key' => $priced['type']['key'],
            'qty'      => $priced['qty'],
            'email'    => sanitize_email((string) $req->get_param('email')),
            'name'     => sanitize_text_field((string) $req->get_param('name')),
            'promo'    => $priced['promo']['code'] ?? '',
        ]);
        if (($intent['id'] ?? '') === '') {
            return new \WP_REST_Response(['error' => 'payment_init_failed'], 502);
        }
        return new \WP_REST_Response([
            'client_secret' => $intent['client_secret'],
            'intent_id'     => $intent['id'],
            'amount'        => $cents,
        ], 200);
    }

    public function ticket_confirm(\WP_REST_Request $req): \WP_REST_Response {
        $intent_id = sanitize_text_field((string) $req->get_param('intent_id'));
        $pi = \ADF\Connectors\StripeConnector::retrieve_payment_intent($intent_id);
        if (($pi['status'] ?? '') !== 'succeeded') {
            return new \WP_REST_Response(['error' => 'payment_incomplete'], 402);
        }
        // Re-price server-side from the (verified) request to avoid trusting client totals.
        $priced = $this->price_checkout($req);
        if (is_wp_error($priced)) {
            return new \WP_REST_Response(['error' => $priced->get_error_message()], 400);
        }
        $order = \ADF\Ticketing\Orders::create([
            'event_id' => $priced['event_id'], 'type' => $priced['type'], 'qty' => $priced['qty'],
            'email' => sanitize_email((string) $req->get_param('email')), 'name' => sanitize_text_field((string) $req->get_param('name')),
            'unit_price' => $priced['unit'], 'discount' => $priced['discount'], 'total' => $priced['total'],
            'promo' => $priced['promo'],
        ], $intent_id, 'stripe', 'public');
        if (is_wp_error($order)) {
            return new \WP_REST_Response(['error' => $order->get_error_message()], 400);
        }
        return new \WP_REST_Response(['ok' => true, 'tickets' => $order['tickets']], 200);
    }

    public function map_pins(\WP_REST_Request $req): \WP_REST_Response {
        $cats = array_filter(array_map('sanitize_key', explode(',', (string) $req->get_param('categories'))));
        return new \WP_REST_Response(MapsConnector::pins($cats), 200);
    }

    public function stripe_webhook(\WP_REST_Request $req): \WP_REST_Response {
        $payload = $req->get_body();
        $sig     = $req->get_header('stripe_signature') ?? '';
        $event   = StripeConnector::parse_webhook($payload, (string) $sig);
        if ($event === null) {
            return new \WP_REST_Response(['error' => 'invalid_signature'], 400);
        }

        $type   = (string) ($event['type'] ?? '');
        $object = $event['data']['object'] ?? [];

        if ($type === 'payment_intent.succeeded') {
            $meta = (array) ($object['metadata'] ?? []);
            if (($meta['kind'] ?? '') === 'ticket') {
                // Backup ticket-order creation (idempotent on payment_id).
                $this->create_ticket_order_from_meta((string) ($object['id'] ?? ''), $meta);
            } else {
                Submission::confirm_payment((string) ($object['id'] ?? ''));
            }
        } elseif ($type === 'charge.refunded') {
            $intent = (string) ($object['payment_intent'] ?? '');
            $post   = $intent ? Submission::find_by_intent($intent) : 0;
            if ($post) {
                Invoice::mark_refunded($post);
            }
        }
        // payment_intent.payment_failed: nothing to advance; the draft stays
        // in pending_payment for the user to retry.

        return new \WP_REST_Response(['received' => true], 200);
    }

    /**
     * Reconstruct + create a ticket order from PaymentIntent metadata (webhook
     * safety net when the client never calls /ticket-confirm). Idempotent.
     */
    private function create_ticket_order_from_meta(string $intent_id, array $meta): void {
        if ($intent_id === '' || \ADF\Ticketing\Orders::by_payment($intent_id)) {
            return;
        }
        $event_id = (int) ($meta['event_id'] ?? 0);
        $type = \ADF\Ticketing\TicketTypes::type($event_id, (string) ($meta['type_key'] ?? ''));
        if (! $type) {
            return;
        }
        $qty      = max(1, (int) ($meta['qty'] ?? 1));
        $unit     = \ADF\Ticketing\TicketTypes::effective_price($type);
        $subtotal = round($unit * $qty, 2);
        $discount = 0.0;
        $promo    = null;
        if (! empty($meta['promo'])) {
            $res = \ADF\Ticketing\Promo::validate((string) $meta['promo'], $event_id, $subtotal);
            if (! is_wp_error($res)) {
                $discount = (float) $res['discount_amount'];
                $promo    = ['code' => strtoupper((string) $meta['promo']), 'promo_id' => $res['promo_id']];
            }
        }
        \ADF\Ticketing\Orders::create([
            'event_id' => $event_id, 'type' => $type, 'qty' => $qty,
            'email' => sanitize_email((string) ($meta['email'] ?? '')), 'name' => sanitize_text_field((string) ($meta['name'] ?? '')),
            'unit_price' => $unit, 'discount' => $discount, 'total' => max(0, round($subtotal - $discount, 2)),
            'promo' => $promo,
        ], $intent_id, 'stripe', 'public');
    }

    /* ----------------------------------------------------------------- *
     * DTOs
     * ----------------------------------------------------------------- */

    private function listing_dto(int $id): array {
        return [
            'id'      => $id,
            'title'   => get_the_title($id),
            'type'    => Fields::get($id, 'listing_type'),
            'status'  => Fields::status($id),
            'tier'    => Fields::tier($id),
            'url'     => get_permalink($id),
            'paid'    => Fields::is_paid($id),
        ];
    }

    private function ticket_dto(object $t): array {
        return [
            'id'         => (int) $t->id,
            'number'     => $t->ticket_number . '/' . $t->total_in_order,
            'event'      => get_the_title((int) $t->event_id),
            'type'       => $t->ticket_type_label,
            'checked_in' => \ADF\Ticketing\Orders::checked_in((int) $t->id),
            'url'        => \ADF\Ticketing\Orders::ticket_url($t->token),
        ];
    }

    private function volunteer_dto(object $signup): array {
        $shift = Volunteers::shift((int) $signup->opportunity_id, $signup->shift_id);
        return [
            'id'          => (int) $signup->id,
            'opportunity' => get_the_title((int) $signup->opportunity_id),
            'shift'       => $shift['label'] ?? '',
            'status'      => $signup->status,
            'checked_in'  => (bool) $signup->checked_in,
        ];
    }
}
