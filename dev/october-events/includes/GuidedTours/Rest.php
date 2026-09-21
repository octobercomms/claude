<?php
declare(strict_types=1);

namespace OE\GuidedTours;

use OE\Settings;

defined('ABSPATH') || exit;

/**
 * Guided-tour public endpoints and background jobs.
 *
 *  - POST oe/v1/guided/unlock   {email, tour}            → check a ticket, set the unlock cookie
 *  - POST oe/v1/guided/reserve  {location, slot, tour}   → reserve (or waitlist) for the unlocked email
 *  - GET  /?oe_gt=confirm|release&token=…                → one-click reconfirm / release links from email
 *  - cron oe_gt_reconfirm                                → 48h-before reconfirm emails
 *
 * Anonymous, so each write carries a nonce (action "oe_gt"); the email is never
 * taken from the request on reserve, only from the signed unlock cookie.
 */
final class Rest {

    private const NS = 'oe/v1';

    public static function init(): void {
        add_action('rest_api_init', [self::class, 'register_routes']);
        add_action('template_redirect', [self::class, 'handle_links']);
        add_action('oe_gt_reconfirm', [self::class, 'run_reconfirm']);
        if (! wp_next_scheduled('oe_gt_reconfirm')) {
            wp_schedule_event(time() + HOUR_IN_SECONDS, 'hourly', 'oe_gt_reconfirm');
        }
    }

    public static function register_routes(): void {
        register_rest_route(self::NS, '/guided/unlock', [
            'methods'             => 'POST',
            'callback'            => [self::class, 'unlock'],
            'permission_callback' => [self::class, 'verify_nonce'],
        ]);
        register_rest_route(self::NS, '/guided/reserve', [
            'methods'             => 'POST',
            'callback'            => [self::class, 'reserve'],
            'permission_callback' => [self::class, 'verify_nonce'],
        ]);
        register_rest_route(self::NS, '/guided/change', [
            'methods'             => 'POST',
            'callback'            => [self::class, 'change'],
            'permission_callback' => [self::class, 'verify_nonce'],
        ]);
        register_rest_route(self::NS, '/guided/cancel', [
            'methods'             => 'POST',
            'callback'            => [self::class, 'cancel'],
            'permission_callback' => [self::class, 'verify_nonce'],
        ]);
        // The unlocked visitor's own bookings + seat allowance, read from the
        // signed cookie. Never cached (it is per-visitor and changes on booking).
        register_rest_route(self::NS, '/guided/state', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'state'],
            'permission_callback' => '__return_true',
        ]);
        // A fresh nonce, fetched at runtime. The gate/slots markup is often served
        // from full-page cache (StackCache / Cloudflare), which freezes a printed
        // nonce until it expires and every unlock then 403s. Fetching it live keeps
        // it valid for whoever is actually viewing.
        register_rest_route(self::NS, '/guided/nonce', [
            'methods'             => 'GET',
            'callback'            => [self::class, 'nonce'],
            'permission_callback' => '__return_true',
        ]);
    }

    /** A fresh oe_gt nonce for the current visitor; never cached. */
    public static function nonce(\WP_REST_Request $req): \WP_REST_Response {
        $res = new \WP_REST_Response(['nonce' => wp_create_nonce('oe_gt')], 200);
        $res->header('Cache-Control', 'no-store, max-age=0');
        return $res;
    }

    /** CSRF: the shortcodes print a nonce for action "oe_gt". */
    public static function verify_nonce(\WP_REST_Request $req): bool {
        $nonce = (string) ($req->get_param('nonce') ?: $req->get_header('X-OE-GT-Nonce'));
        return (bool) wp_verify_nonce($nonce, 'oe_gt');
    }

    public static function unlock(\WP_REST_Request $req): \WP_REST_Response {
        $email = strtolower(trim((string) $req->get_param('email')));
        $tour  = self::tour_key((string) $req->get_param('tour'));
        $res   = Eligibility::check($email, $tour);
        if (! $res['ok']) {
            return new \WP_REST_Response([
                'ok'    => false,
                'error' => __('This email address isn’t linked to a ticket for the Architecture Tours, Metro Atlanta. Please buy your ticket first, then revisit this page.', 'october-events'),
            ], 200);
        }
        Eligibility::unlock($email, $tour);
        return new \WP_REST_Response(['ok' => true, 'name' => $res['name']], 200);
    }

    public static function reserve(\WP_REST_Request $req): \WP_REST_Response {
        $tour  = self::tour_key((string) $req->get_param('tour'));
        $email = Eligibility::unlocked_email($tour);
        if ($email === '') {
            return new \WP_REST_Response(['ok' => false, 'error' => __('Please verify your ticket email again.', 'october-events')], 200);
        }
        $location = (int) $req->get_param('location');
        $slot     = self::clean_slot((string) $req->get_param('slot'));
        $name     = sanitize_text_field((string) $req->get_param('name'));
        $party    = max(1, (int) $req->get_param('party'));
        if ($location <= 0 || $slot === '') {
            return new \WP_REST_Response(['ok' => false, 'error' => __('Something went wrong. Please try again.', 'october-events')], 200);
        }
        $allowance = Eligibility::ticket_allowance($email, $tour);
        $out       = Reservations::reserve($location, $slot, $tour, $email, $name, $party, $allowance);
        if (is_wp_error($out)) {
            return new \WP_REST_Response(['ok' => false, 'error' => $out->get_error_message(), 'state' => self::state_payload($email, $tour)], 200);
        }
        return new \WP_REST_Response([
            'ok'         => true,
            'status'     => $out['status'],
            'spots_left' => $out['spots_left'],
            'state'      => self::state_payload($email, $tour),
        ], 200);
    }

    /** Move one of the caller's bookings to another slot (or building). */
    public static function change(\WP_REST_Request $req): \WP_REST_Response {
        $tour  = self::tour_key((string) $req->get_param('tour'));
        $email = Eligibility::unlocked_email($tour);
        if ($email === '') {
            return new \WP_REST_Response(['ok' => false, 'error' => __('Please verify your ticket email again.', 'october-events')], 200);
        }
        $id       = (int) $req->get_param('id');
        $location = (int) $req->get_param('location');
        $slot     = self::clean_slot((string) $req->get_param('slot'));
        if ($id <= 0 || $location <= 0 || $slot === '') {
            return new \WP_REST_Response(['ok' => false, 'error' => __('Something went wrong. Please try again.', 'october-events')], 200);
        }
        $out = Reservations::change_slot($id, $email, $tour, $location, $slot);
        if (is_wp_error($out)) {
            return new \WP_REST_Response(['ok' => false, 'error' => $out->get_error_message(), 'state' => self::state_payload($email, $tour)], 200);
        }
        return new \WP_REST_Response(['ok' => true, 'state' => self::state_payload($email, $tour)], 200);
    }

    /** Cancel one of the caller's bookings and free the seats to the waitlist. */
    public static function cancel(\WP_REST_Request $req): \WP_REST_Response {
        $tour  = self::tour_key((string) $req->get_param('tour'));
        $email = Eligibility::unlocked_email($tour);
        if ($email === '') {
            return new \WP_REST_Response(['ok' => false, 'error' => __('Please verify your ticket email again.', 'october-events')], 200);
        }
        $id = (int) $req->get_param('id');
        if ($id <= 0 || ! Reservations::cancel_for_email($id, $email, $tour)) {
            return new \WP_REST_Response(['ok' => false, 'error' => __('We couldn’t cancel that booking.', 'october-events'), 'state' => self::state_payload($email, $tour)], 200);
        }
        return new \WP_REST_Response(['ok' => true, 'state' => self::state_payload($email, $tour)], 200);
    }

    /** The unlocked visitor's own bookings + seat allowance for this tour. */
    public static function state(\WP_REST_Request $req): \WP_REST_Response {
        $tour    = self::tour_key((string) $req->get_param('tour'));
        $email   = Eligibility::unlocked_email($tour);
        $payload = $email === '' ? ['ok' => false] : self::state_payload($email, $tour);
        $res     = new \WP_REST_Response($payload, 200);
        $res->header('Cache-Control', 'no-store, max-age=0');
        return $res;
    }

    /**
     * Everything the booking page needs to reflect the current visitor: their
     * seat allowance, seats already used, and each active booking (which slot, at
     * which building, and its party size and status).
     *
     * @return array<string,mixed>
     */
    private static function state_payload(string $email, string $tour): array {
        $allowance = Eligibility::ticket_allowance($email, $tour);
        // Informational total across tours (not a cap): a ticket is a pass, so the
        // buyer may join every tour bringing up to their party each time.
        $used      = Reservations::party_used($email, $tour);
        $mine      = [];
        foreach (Reservations::active_for_email($email, $tour) as $r) {
            $location = (int) $r->location_id;
            $mine[]   = [
                'id'       => (int) $r->id,
                'location' => $location,
                'slot'     => (string) $r->slot_uid,
                'status'   => (string) $r->status,
                'party'    => max(1, (int) $r->party_size),
                'building' => get_the_title($location) ?: '',
                'when'     => self::slot_when($location, (string) $r->slot_uid),
            ];
        }
        return [
            'ok'        => true,
            'allowance' => $allowance,
            'used'      => $used,
            // A ticket is a pass: the full party allowance is available for each
            // tour, so "remaining" is the per-booking cap (group size), not a pool
            // that shrinks as they add tours. Capacity is enforced per slot.
            'remaining' => $allowance,
            'mine'      => $mine,
        ];
    }

    /** Human "Sat Oct 3 · 12:00 PM" for a slot. */
    private static function slot_when(int $location_id, string $slot_uid): string {
        $ts = Slots::start_ts($location_id, $slot_uid);
        return $ts ? wp_date('D M j · g:i A', $ts) : '';
    }

    private static function clean_slot(string $raw): string {
        return (string) preg_replace('/[^a-z0-9]/', '', strtolower($raw));
    }

    /** Handle the confirm / release links from the reconfirm email. */
    public static function handle_links(): void {
        $action = isset($_GET['oe_gt']) ? sanitize_key((string) $_GET['oe_gt']) : '';
        if ($action !== 'confirm' && $action !== 'release') {
            return;
        }
        $token = isset($_GET['token']) ? preg_replace('/[^A-Za-z0-9]/', '', (string) $_GET['token']) : '';
        $ok    = false;
        if ($token !== '') {
            $ok = $action === 'confirm' ? Reservations::confirm_by_token($token) : Reservations::release_by_token($token);
        }
        $title = $action === 'confirm' ? __('Spot confirmed', 'october-events') : __('Spot released', 'october-events');
        $msg   = $ok
            ? ($action === 'confirm'
                ? __('Thanks — your guided tour spot is confirmed. See you there.', 'october-events')
                : __('Your spot has been released and offered to the next person on the waitlist. Thanks for letting us know.', 'october-events'))
            : __('This link is no longer valid. The spot may already have been confirmed, released, or the tour has passed.', 'october-events');
        wp_die('<h1 style="font:700 24px system-ui">' . esc_html($title) . '</h1><p style="font:16px system-ui;max-width:40em">' . esc_html($msg) . '</p>', esc_html($title), ['response' => 200]);
    }

    /** Hourly: email reserved holders ~N hours before their slot to confirm or release. */
    public static function run_reconfirm(): void {
        global $wpdb;
        $hours = max(1, (int) Settings::get('guided_reconfirm_hours', 48));
        $t     = Reservations::table();
        $now   = time();
        $window_end = gmdate('Y-m-d H:i:s', $now + $hours * HOUR_IN_SECONDS);
        $now_str    = gmdate('Y-m-d H:i:s', $now);
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT * FROM {$t} WHERE status = %s AND reconfirm_sent = 0 AND slot_start IS NOT NULL AND slot_start > %s AND slot_start <= %s ORDER BY id ASC LIMIT 200",
            Reservations::STATUS_RESERVED, $now_str, $window_end
        )) ?: [];
        foreach ($rows as $row) {
            Mailer::reconfirm($row);
            $wpdb->update($t, ['reconfirm_sent' => 1], ['id' => (int) $row->id]);
        }
    }

    /** Normalise a tour key from the shortcode ("city|year"), lowercased. */
    public static function tour_key(string $raw): string {
        $raw = strtolower(trim($raw));
        return preg_replace('/[^a-z0-9|_-]/', '', $raw);
    }
}
