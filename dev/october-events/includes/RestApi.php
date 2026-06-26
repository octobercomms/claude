<?php
declare(strict_types=1);

namespace OE;

use OE\Connectors\StripeConnector;
use OE\Connectors\MapsConnector;

defined('ABSPATH') || exit;

/**
 * REST API (§2 dashboard backend, §4 webhooks, §7 map feed).
 *
 * Namespace: oe/v1. Authenticated endpoints require a logged-in user (cookie +
 * nonce from the dashboard). Public endpoints (map feed, Stripe webhook) are
 * explicitly marked. A simple per-user rate limit guards the submission
 * endpoint against spam (§10).
 */
final class RestApi {

    private static ?RestApi $instance = null;
    private const NS = 'oe/v1';

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
                // Single shift_id OR shift_ids[] (multi-select) — the handler
                // requires at least one, so neither is "required" at the route.
                'shift_id'       => ['sanitize_callback' => 'sanitize_key'],
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
        // PayPal: create an approved order, then capture + issue tickets.
        register_rest_route(self::NS, '/paypal-create', [
            'methods'             => 'POST',
            'callback'            => [$this, 'paypal_create'],
            'permission_callback' => '__return_true',
        ]);
        register_rest_route(self::NS, '/paypal-capture', [
            'methods'             => 'POST',
            'callback'            => [$this, 'paypal_capture'],
            'permission_callback' => '__return_true',
        ]);
        register_rest_route(self::NS, '/waitlist-join', [
            'methods'             => 'POST',
            'callback'            => [$this, 'waitlist_join'],
            'permission_callback' => '__return_true',
        ]);

        // Check-in PWA (PIN-gated, not WP-login gated).
        register_rest_route(self::NS, '/checkin-events', [
            'methods' => 'GET', 'callback' => [$this, 'checkin_events'], 'permission_callback' => '__return_true',
        ]);
        register_rest_route(self::NS, '/checkin-venues', [
            'methods' => 'GET', 'callback' => [$this, 'checkin_venues'], 'permission_callback' => '__return_true',
        ]);
        register_rest_route(self::NS, '/checkin-scan', [
            'methods' => 'POST', 'callback' => [$this, 'checkin_scan'], 'permission_callback' => '__return_true',
        ]);
        register_rest_route(self::NS, '/checkin-stats', [
            'methods' => 'GET', 'callback' => [$this, 'checkin_stats'], 'permission_callback' => '__return_true',
        ]);
        // Offline support: cache the valid-token manifest on PIN entry, then flush
        // queued scans back when connectivity returns.
        register_rest_route(self::NS, '/checkin-manifest', [
            'methods' => 'GET', 'callback' => [$this, 'checkin_manifest'], 'permission_callback' => '__return_true',
        ]);
        register_rest_route(self::NS, '/checkin-sync', [
            'methods' => 'POST', 'callback' => [$this, 'checkin_sync'], 'permission_callback' => '__return_true',
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
        $key   = 'oe_rl_' . get_current_user_id();
        $count = (int) get_transient($key);
        if ($count >= 10) {
            return new \WP_Error('oe_rate_limited', __('Too many submissions, please wait a minute.', 'october-events'), ['status' => 429]);
        }
        set_transient($key, $count + 1, MINUTE_IN_SECONDS);
        return true;
    }

    private function account_id(): int {
        return Account::ensure(get_current_user_id());
    }

    /** Best-effort client IP for rate limiting (hashed before storage). */
    private function client_ip(): string {
        // Cloudflare sets CF-Connecting-IP and overwrites any client-supplied
        // value, so it's trustworthy behind CF. Do NOT trust the generic
        // X-Forwarded-For / X-Real-IP headers — a client can forge them to rotate
        // a fresh "IP" per request and evade every rate limiter (incl. the
        // check-in PIN brute-force throttle). REMOTE_ADDR is the safe floor.
        if (! empty($_SERVER['HTTP_CF_CONNECTING_IP'])) {
            return trim((string) wp_unslash($_SERVER['HTTP_CF_CONNECTING_IP']));
        }
        return ! empty($_SERVER['REMOTE_ADDR']) ? trim((string) wp_unslash($_SERVER['REMOTE_ADDR'])) : 'unknown';
    }

    /**
     * Simple per-IP fixed-window rate limit (ADF-04). Returns false when the
     * caller has exceeded $limit requests in $window seconds for $bucket.
     */
    private function rl(string $bucket, int $limit = 20, int $window = MINUTE_IN_SECONDS): bool {
        $key = 'oe_rl_' . $bucket . '_' . md5($this->client_ip());
        $n   = (int) get_transient($key);
        if ($n >= $limit) {
            return false;
        }
        set_transient($key, $n + 1, $window);
        return true;
    }

    private function too_many(): \WP_REST_Response {
        return new \WP_REST_Response(['error' => 'rate_limited'], 429);
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
                'status' => get_post_meta($account_id, '_oe_account_status', true) ?: 'active',
            ],
            'pending_count'  => count($pending),
            'tickets'        => array_map([$this, 'ticket_dto'], \OE\Ticketing\Orders::for_account($account_id)),
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
        // ADF-06: only the listing's own submitter may advance it.
        $listing = Submission::find_by_intent($intent_id);
        if ($listing && (int) Fields::get($listing, 'submitter_account_id') !== $this->account_id()) {
            return new \WP_REST_Response(['error' => 'forbidden'], 403);
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
                update_post_meta($account_id, '_oe_' . $field, call_user_func($cb, (string) $value));
            }
        }
        return new \WP_REST_Response(['ok' => true], 200);
    }

    public function volunteer_signup(\WP_REST_Request $req): \WP_REST_Response {
        if (! $this->rl('volunteer', 10)) {
            return $this->too_many();
        }
        $account_id = is_user_logged_in() ? Account::ensure(get_current_user_id()) : 0;
        $opp        = (int) $req->get_param('opportunity_id');

        // Accept a single shift_id (back-compat) or shift_ids[] (multi-select).
        $ids = $req->get_param('shift_ids');
        if (! is_array($ids) || ! $ids) {
            $single = (string) $req->get_param('shift_id');
            $ids = $single !== '' ? [$single] : [];
        }
        if (! $ids) {
            return new \WP_REST_Response(['error' => __('Please choose at least one shift.', 'october-events')], 400);
        }

        $person = [
            'name'  => $req->get_param('name'),
            'email' => $req->get_param('email'),
            'phone' => $req->get_param('phone'),
        ];
        $booked = [];
        $failed = [];
        foreach (array_slice($ids, 0, 10) as $sid) {
            $sid = sanitize_text_field((string) $sid);
            if ($sid === '') {
                continue;
            }
            $res = Volunteers::signup($opp, $sid, $person, $account_id);
            if (is_wp_error($res)) {
                $shift    = Volunteers::shift($opp, $sid);
                $failed[] = ($shift['label'] ?? $sid) . ': ' . $res->get_error_message();
            } else {
                $booked[] = (int) $res;
            }
        }

        // All requested shifts failed — surface why (e.g. all full).
        if (! $booked) {
            return new \WP_REST_Response(['error' => $failed ? implode('; ', $failed) : __('Could not sign you up.', 'october-events')], 400);
        }
        return new \WP_REST_Response(['ok' => true, 'booked' => count($booked), 'ids' => $booked, 'failed' => $failed], 200);
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
    /**
     * Price a checkout — a cart of one or more ticket lines. Accepts either a
     * `cart` param ([{type_key, qty}, …]) or a single `type_key`/`qty` pair
     * (back-compat). Returns event_id, priced lines, subtotal, discount, total,
     * promo. Promo discount applies once to the cart subtotal.
     */
    private function price_checkout(\WP_REST_Request $req) {
        $event_id = absint($req->get_param('event_id'));
        $cart_in  = $req->get_param('cart');
        $raw      = [];
        if (is_array($cart_in) && $cart_in) {
            foreach ($cart_in as $c) {
                $raw[] = ['type_key' => sanitize_key((string) ($c['type_key'] ?? '')), 'qty' => max(0, min(10, (int) ($c['qty'] ?? 0)))];
            }
        } else {
            $raw[] = ['type_key' => sanitize_key((string) $req->get_param('type_key')), 'qty' => max(1, min(10, (int) $req->get_param('qty')))];
        }

        $lines = [];
        $subtotal = 0.0;
        foreach ($raw as $li) {
            if ($li['qty'] < 1) {
                continue;
            }
            $type = \OE\Ticketing\TicketTypes::type($event_id, $li['type_key']);
            if (! $type) {
                return new \WP_Error('oe_bad_type', __('Unknown ticket type.', 'october-events'), ['status' => 400]);
            }
            $avail = \OE\Ticketing\TicketTypes::availability($event_id, $type);
            if ($avail['state'] !== 'available') {
                return new \WP_Error('oe_unavailable', __('Those tickets are not currently on sale.', 'october-events'), ['status' => 409]);
            }
            $unit = \OE\Ticketing\TicketTypes::effective_price($type);
            $subtotal += round($unit * $li['qty'], 2);
            $lines[] = ['type' => $type, 'qty' => $li['qty'], 'unit' => $unit];
        }
        if (! $lines) {
            return new \WP_Error('oe_empty_cart', __('Please choose at least one ticket.', 'october-events'), ['status' => 400]);
        }
        $subtotal = round($subtotal, 2);

        $discount = 0.0;
        $promo    = null;
        $code     = trim((string) $req->get_param('promo_code'));
        if ($code !== '') {
            $res = \OE\Ticketing\Promo::validate($code, $event_id, $subtotal);
            if (is_wp_error($res)) {
                return $res;
            }
            $discount = (float) $res['discount_amount'];
            $promo    = ['code' => strtoupper($code), 'promo_id' => $res['promo_id']];
        }
        $total = max(0, round($subtotal - $discount, 2));

        return compact('event_id', 'lines', 'subtotal', 'discount', 'total', 'promo');
    }

    /** A cart's lines as a compact [{type_key, qty}] list for PI metadata. */
    private function cart_meta(array $lines): string {
        $out = array_map(static fn($l) => ['type_key' => (string) $l['type']['key'], 'qty' => (int) $l['qty']], $lines);
        return wp_json_encode($out) ?: '[]';
    }

    public function ticket_promo(\WP_REST_Request $req): \WP_REST_Response {
        if (! $this->rl('promo', 20)) {
            return $this->too_many();
        }
        $priced = $this->price_checkout($req);
        if (is_wp_error($priced)) {
            return new \WP_REST_Response(['error' => $priced->get_error_message()], 400);
        }
        return new \WP_REST_Response([
            'discount' => $priced['discount'],
            'total'    => $priced['total'],
        ], 200);
    }

    public function waitlist_join(\WP_REST_Request $req): \WP_REST_Response {
        if (! $this->rl('waitlist', 20)) {
            return $this->too_many();
        }
        $event_id = absint($req->get_param('event_id'));
        $type_key = sanitize_key((string) $req->get_param('type_key'));
        $email    = sanitize_email((string) $req->get_param('email'));
        $name     = sanitize_text_field((string) $req->get_param('name'));
        if (! $event_id || ! is_email($email)) {
            return new \WP_REST_Response(['error' => 'Enter a valid email address.'], 400);
        }
        $id = \OE\Ticketing\Waitlist::join($event_id, $type_key, $email, $name);
        if (! $id) {
            return new \WP_REST_Response(['error' => 'Could not join the waitlist.'], 400);
        }
        return new \WP_REST_Response(['ok' => true], 200);
    }

    public function ticket_intent(\WP_REST_Request $req): \WP_REST_Response {
        if (! $this->rl('ticket_intent', 15)) {
            return $this->too_many();
        }
        if (! \OE\Connectors\StripeConnector::is_ready()) {
            return new \WP_REST_Response(['error' => 'payments_unavailable'], 503);
        }
        $priced = $this->price_checkout($req);
        if (is_wp_error($priced)) {
            return new \WP_REST_Response(['error' => $priced->get_error_message()], (int) ($priced->get_error_data()['status'] ?? 400));
        }

        $cart  = array_map(static fn($l) => ['type' => $l['type'], 'qty' => $l['qty']], $priced['lines']);
        $buyer = ['email' => sanitize_email((string) $req->get_param('email')), 'name' => sanitize_text_field((string) $req->get_param('name'))];

        $cents = (int) round($priced['total'] * 100);
        if ($cents < 50) {
            // Free/comp orders skip Stripe — create immediately.
            $order = \OE\Ticketing\Orders::create_cart($priced['event_id'], $cart, $buyer, '', 'free', 'public', $priced['promo'], $this->attendee_names_param($req), $priced['discount']);
            if (is_wp_error($order)) {
                return new \WP_REST_Response(['error' => $order->get_error_message()], 400);
            }
            return new \WP_REST_Response(['free' => true, 'tickets' => $order['tickets']], 200);
        }

        // Cart + attendee names ride along in the PaymentIntent metadata
        // (server-set = trusted), JSON-encoded and trimmed to Stripe's limits.
        $attendees = $this->attendee_names_param($req);
        $att_json  = wp_json_encode($attendees) ?: '[]';
        while (strlen($att_json) > 480 && $attendees) { array_pop($attendees); $att_json = wp_json_encode($attendees) ?: '[]'; }

        $intent = \OE\Connectors\StripeConnector::create_payment_intent($cents, (string) \OE\Settings::get('currency', 'usd'), '', [
            'kind'      => 'ticket',
            'event_id'  => $priced['event_id'],
            'cart'      => $this->cart_meta($priced['lines']),
            'email'     => $buyer['email'],
            'name'      => $buyer['name'],
            'promo'     => $priced['promo']['code'] ?? '',
            'attendees' => $att_json,
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
        if (! $this->rl('ticket_confirm', 30)) {
            return $this->too_many();
        }
        $intent_id = sanitize_text_field((string) $req->get_param('intent_id'));
        $pi = \OE\Connectors\StripeConnector::retrieve_payment_intent($intent_id);
        if (($pi['status'] ?? '') !== 'succeeded') {
            return new \WP_REST_Response(['error' => 'payment_incomplete'], 402);
        }
        // ADF-01: trust ONLY the PaymentIntent — its metadata was set server-side
        // at /ticket-intent and amount_received is what Stripe actually captured.
        // The confirm request body is NOT used to price or shape the order.
        $meta = (array) ($pi['metadata'] ?? []);
        if (($meta['kind'] ?? '') !== 'ticket') {
            return new \WP_REST_Response(['error' => 'not_a_ticket_payment'], 400);
        }
        $paid   = (int) ($pi['amount_received'] ?? $pi['amount'] ?? 0);
        $result = $this->create_ticket_order_from_meta($intent_id, $meta, $paid);
        if (! is_array($result)) {
            return new \WP_REST_Response(['error' => 'order_failed'], 400);
        }
        return new \WP_REST_Response(['ok' => true, 'tickets' => $result['tickets']], 200);
    }

    /**
     * Create a PayPal order for the priced cart. The cart + buyer + attendees are
     * stashed server-side (a transient keyed by the PayPal order id) so capture
     * can rebuild the order from trusted data — PayPal's custom_id is too small to
     * carry it, unlike Stripe's PaymentIntent metadata.
     */
    public function paypal_create(\WP_REST_Request $req): \WP_REST_Response {
        if (! $this->rl('paypal_create', 15)) {
            return $this->too_many();
        }
        if (! \OE\Connectors\PayPalConnector::is_ready()) {
            return new \WP_REST_Response(['error' => 'paypal_unavailable'], 503);
        }
        $priced = $this->price_checkout($req);
        if (is_wp_error($priced)) {
            return new \WP_REST_Response(['error' => $priced->get_error_message()], (int) ($priced->get_error_data()['status'] ?? 400));
        }
        $cents = (int) round($priced['total'] * 100);
        if ($cents < 50) {
            // Free/comp orders don't go through PayPal.
            return new \WP_REST_Response(['error' => 'amount_too_low'], 400);
        }
        $currency = (string) \OE\Settings::get('currency', 'usd');
        $order_id = \OE\Connectors\PayPalConnector::create_order($cents, $currency, 'event-' . $priced['event_id']);
        if ($order_id === '') {
            return new \WP_REST_Response(['error' => 'paypal_init_failed'], 502);
        }
        // Stash the trusted order shape for capture (server-set, never the body).
        set_transient('oe_pp_' . $order_id, [
            'event_id'  => $priced['event_id'],
            'cart'      => $this->cart_meta($priced['lines']),
            'email'     => sanitize_email((string) $req->get_param('email')),
            'name'      => sanitize_text_field((string) $req->get_param('name')),
            'promo'     => $priced['promo']['code'] ?? '',
            'attendees' => $this->attendee_names_param($req),
        ], HOUR_IN_SECONDS);

        return new \WP_REST_Response(['paypal_order_id' => $order_id], 200);
    }

    /**
     * Capture an approved PayPal order and issue tickets. Trust comes from
     * PayPal's capture response (status + amount actually taken), not the request
     * body; the cart is the one we stashed at /paypal-create. Idempotent.
     */
    public function paypal_capture(\WP_REST_Request $req): \WP_REST_Response {
        if (! $this->rl('paypal_capture', 30)) {
            return $this->too_many();
        }
        if (! \OE\Connectors\PayPalConnector::is_ready()) {
            return new \WP_REST_Response(['error' => 'paypal_unavailable'], 503);
        }
        $order_id = sanitize_text_field((string) $req->get_param('paypal_order_id'));
        $pending  = $order_id !== '' ? get_transient('oe_pp_' . $order_id) : false;
        if (! is_array($pending)) {
            return new \WP_REST_Response(['error' => 'unknown_order'], 400);
        }
        $cap = \OE\Connectors\PayPalConnector::capture_order($order_id);
        if (($cap['status'] ?? '') !== 'COMPLETED' || $cap['capture_id'] === '') {
            return new \WP_REST_Response(['error' => 'payment_incomplete'], 402);
        }
        // Rebuild meta in the same shape create_ticket_order_from_meta expects.
        $meta = [
            'kind'      => 'ticket',
            'event_id'  => (int) ($pending['event_id'] ?? 0),
            'cart'      => (string) ($pending['cart'] ?? ''),
            'email'     => (string) ($pending['email'] ?? ''),
            'name'      => (string) ($pending['name'] ?? ''),
            'promo'     => (string) ($pending['promo'] ?? ''),
            'attendees' => wp_json_encode($pending['attendees'] ?? []) ?: '[]',
        ];
        // Idempotency + refunds key on the capture id (what we can refund later).
        $result = $this->create_ticket_order_from_meta($cap['capture_id'], $meta, (int) $cap['amount_cents'], 'paypal');
        if (! is_array($result)) {
            return new \WP_REST_Response(['error' => 'order_failed'], 400);
        }
        delete_transient('oe_pp_' . $order_id);
        return new \WP_REST_Response(['ok' => true, 'tickets' => $result['tickets']], 200);
    }

    /* ----------------------------------------------------------------- *
     * Check-in PWA
     * ----------------------------------------------------------------- */

    public function checkin_events(\WP_REST_Request $req): \WP_REST_Response {
        return new \WP_REST_Response(\OE\Ticketing\CheckIn::events(), 200);
    }

    private function checkin_pin_guard(\WP_REST_Request $req): int {
        $event_id = absint($req->get_param('event_id'));
        // ADF-03: throttle PIN attempts per IP+event to stop brute-forcing the PIN.
        $key  = 'oe_pinfail_' . md5($this->client_ip() . '|' . $event_id);
        if ((int) get_transient($key) >= 10) {
            return 0; // locked for the window
        }
        if (! \OE\Ticketing\CheckIn::pin_ok($event_id, (string) $req->get_param('pin'))) {
            set_transient($key, (int) get_transient($key) + 1, 15 * MINUTE_IN_SECONDS);
            return 0;
        }
        delete_transient($key);
        return $event_id;
    }

    public function checkin_venues(\WP_REST_Request $req): \WP_REST_Response {
        $event_id = $this->checkin_pin_guard($req);
        if (! $event_id) {
            return new \WP_REST_Response(['error' => 'bad_pin'], 403);
        }
        return new \WP_REST_Response(\OE\Ticketing\CheckIn::venues($event_id), 200);
    }

    public function checkin_scan(\WP_REST_Request $req): \WP_REST_Response {
        $event_id = $this->checkin_pin_guard($req);
        if (! $event_id) {
            return new \WP_REST_Response(['error' => 'bad_pin'], 403);
        }
        $result = \OE\Ticketing\CheckIn::scan(
            sanitize_text_field((string) $req->get_param('token')),
            $event_id,
            (string) $req->get_param('venue')
        );
        return new \WP_REST_Response($result, 200);
    }

    public function checkin_stats(\WP_REST_Request $req): \WP_REST_Response {
        $event_id = $this->checkin_pin_guard($req);
        if (! $event_id) {
            return new \WP_REST_Response(['error' => 'bad_pin'], 403);
        }
        return new \WP_REST_Response(\OE\Ticketing\CheckIn::stats($event_id), 200);
    }

    public function checkin_manifest(\WP_REST_Request $req): \WP_REST_Response {
        $event_id = $this->checkin_pin_guard($req);
        if (! $event_id) {
            return new \WP_REST_Response(['error' => 'bad_pin'], 403);
        }
        return new \WP_REST_Response(\OE\Ticketing\CheckIn::manifest($event_id), 200);
    }

    /**
     * Flush a batch of scans recorded offline. Each carries its real scan time so
     * the log reflects when the attendee actually arrived, not when Wi-Fi
     * returned. The server is the source of truth, so it re-validates every token
     * and dedupes — two offline doors that scanned the same ticket reconcile here
     * (first kept, repeats flagged "already").
     */
    public function checkin_sync(\WP_REST_Request $req): \WP_REST_Response {
        $event_id = $this->checkin_pin_guard($req);
        if (! $event_id) {
            return new \WP_REST_Response(['error' => 'bad_pin'], 403);
        }
        $scans = $req->get_param('scans');
        if (! is_array($scans)) {
            $scans = [];
        }
        $results = [];
        foreach (array_slice($scans, 0, 2000) as $s) {
            if (! is_array($s)) {
                continue;
            }
            $token = sanitize_text_field((string) ($s['token'] ?? ''));
            if ($token === '') {
                continue;
            }
            $res = \OE\Ticketing\CheckIn::scan(
                $token,
                $event_id,
                (string) ($s['venue'] ?? ''),
                $this->coerce_utc_datetime((string) ($s['scanned_at'] ?? ''))
            );
            $res['token'] = $token;
            $results[] = $res;
        }
        return new \WP_REST_Response(['results' => $results], 200);
    }

    /** Coerce a client timestamp (ISO 8601) to a UTC MySQL datetime, or null. */
    private function coerce_utc_datetime(string $s): ?string {
        $ts = strtotime($s);
        if (! $ts) {
            return null; // fall back to "now" in the model
        }
        // Ignore clock skew into the future (a phone with a wrong clock).
        $now = time();
        if ($ts > $now + 300) {
            $ts = $now;
        }
        return gmdate('Y-m-d H:i:s', $ts);
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
                $paid = (int) ($object['amount_received'] ?? $object['amount'] ?? 0);
                $this->create_ticket_order_from_meta((string) ($object['id'] ?? ''), $meta, $paid);
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
    /**
     * Create a ticket order from a verified PaymentIntent's metadata. Shared by
     * /ticket-confirm and the Stripe webhook. Idempotent on payment_id.
     *
     * @param int $amount_paid Captured amount in cents; when >= 0 the order total
     *                         must not exceed it (ADF-01 anti-tampering guard).
     * @return array{order_id:int,tickets:array}|null
     */
    private function create_ticket_order_from_meta(string $intent_id, array $meta, int $amount_paid = -1, string $method = 'stripe'): ?array {
        if ($intent_id === '') {
            return null;
        }
        if (\OE\Ticketing\Orders::by_payment($intent_id)) {
            return ['tickets' => \OE\Ticketing\Orders::ticket_dtos_for($intent_id)];
        }
        $event_id = (int) ($meta['event_id'] ?? 0);

        // Rebuild the cart from metadata (single type_key/qty for older intents).
        $raw = [];
        if (! empty($meta['cart'])) {
            $decoded = json_decode((string) $meta['cart'], true);
            if (is_array($decoded)) {
                foreach ($decoded as $c) { $raw[] = ['type_key' => (string) ($c['type_key'] ?? ''), 'qty' => (int) ($c['qty'] ?? 0)]; }
            }
        } elseif (! empty($meta['type_key'])) {
            $raw[] = ['type_key' => (string) $meta['type_key'], 'qty' => (int) ($meta['qty'] ?? 1)];
        }

        $lines = [];
        $subtotal = 0.0;
        foreach ($raw as $li) {
            if ($li['qty'] < 1) { continue; }
            $type = \OE\Ticketing\TicketTypes::type($event_id, $li['type_key']);
            if (! $type) { return null; }
            $unit = \OE\Ticketing\TicketTypes::effective_price($type);
            $subtotal += round($unit * $li['qty'], 2);
            $lines[] = ['type' => $type, 'qty' => $li['qty']];
        }
        if (! $lines) {
            return null;
        }

        $discount = 0.0;
        $promo    = null;
        if (! empty($meta['promo'])) {
            $res = \OE\Ticketing\Promo::validate((string) $meta['promo'], $event_id, round($subtotal, 2));
            if (! is_wp_error($res)) {
                $discount = (float) $res['discount_amount'];
                $promo    = ['code' => strtoupper((string) $meta['promo']), 'promo_id' => $res['promo_id']];
            }
        }
        $total = max(0, round($subtotal - $discount, 2));

        // ADF-01: never issue tickets worth more than was actually captured.
        if ($amount_paid >= 0 && (int) round($total * 100) > $amount_paid) {
            \OE\Logger::log('Ticket order rejected — amount mismatch', ['intent' => $intent_id, 'total_cents' => (int) round($total * 100), 'paid' => $amount_paid]);
            return null;
        }

        $attendees = [];
        if (! empty($meta['attendees'])) {
            $decoded = json_decode((string) $meta['attendees'], true);
            if (is_array($decoded)) { $attendees = array_map('sanitize_text_field', $decoded); }
        }
        $buyer = ['email' => sanitize_email((string) ($meta['email'] ?? '')), 'name' => sanitize_text_field((string) ($meta['name'] ?? ''))];

        $order = \OE\Ticketing\Orders::create_cart($event_id, $lines, $buyer, $intent_id, $method, 'public', $promo, $attendees, $discount);
        return is_wp_error($order) ? null : $order;
    }

    /** @return array<int,string> sanitized attendee names from the request (capped) */
    private function attendee_names_param(\WP_REST_Request $req): array {
        $raw = $req->get_param('attendee_names');
        if (! is_array($raw)) {
            return [];
        }
        $out = [];
        foreach (array_slice($raw, 0, 50) as $n) {
            $out[] = sanitize_text_field((string) $n);
        }
        return $out;
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
            'checked_in' => \OE\Ticketing\Orders::checked_in((int) $t->id),
            'url'        => \OE\Ticketing\Orders::ticket_url($t->token),
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
