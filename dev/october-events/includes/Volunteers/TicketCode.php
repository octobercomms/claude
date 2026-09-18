<?php
declare(strict_types=1);

namespace OE\Volunteers;

use OE\Settings;
use OE\Ticketing\Promo;

defined('ABSPATH') || exit;

/**
 * The volunteer thank-you ticket code: a single 100%-off promo the 48-hour
 * reminder hands out, so anyone who cancels before then never receives it. The
 * code renews itself every year — it is <prefix><year> (e.g. VOLUNTEER2026) and
 * the matching promo is created automatically the first time the code is needed,
 * so there's nothing to remember to rotate.
 */
final class TicketCode {

    public static function enabled(): bool {
        return ! empty(Settings::get('volunteer_code_enabled', false));
    }

    /** The code string for this year, e.g. VOLUNTEER2026. No side effects. */
    public static function peek(): string {
        if (! self::enabled()) {
            return '';
        }
        $prefix = strtoupper((string) preg_replace('/[^A-Za-z0-9]/', '', (string) Settings::get('volunteer_code_prefix', 'VOLUNTEER')));
        if ($prefix === '') {
            $prefix = 'VOLUNTEER';
        }
        return $prefix . wp_date('Y');
    }

    /** The code for this year, creating its promo if it doesn't exist yet. */
    public static function current(): string {
        $code = self::peek();
        if ($code !== '') {
            self::ensure_promo($code);
        }
        return $code;
    }

    /* ---- checkout-side gates (run on the ticket-selling site) ---- */

    public static function verify_enabled(): bool {
        return ! empty(Settings::get('volunteer_code_verify_enabled', false));
    }

    /**
     * Is this email a current volunteer? Asks the volunteer site's
     * /volunteer-check endpoint (they live in a different install). Cached ~10 min.
     * Off when verification isn't enabled. A definitive "no" blocks; a network or
     * config problem fails OPEN, so a real volunteer is never blocked by a hiccup.
     */
    public static function is_volunteer_email(string $email): bool {
        if (! self::verify_enabled()) {
            return true;
        }
        $email = strtolower(trim($email));
        if (! is_email($email)) {
            return false;
        }
        $url   = trim((string) Settings::get('volunteer_verify_url', ''));
        $token = trim((string) Settings::get('volunteer_verify_token', ''));
        if ($url === '' || $token === '') {
            return true; // enabled but not configured — don't block a real volunteer
        }
        $key    = 'oe_volchk_' . md5($email);
        $cached = get_transient($key);
        if ($cached === 'yes') {
            return true;
        }
        if ($cached === 'no') {
            return false;
        }
        $resp = wp_remote_get(add_query_arg(['email' => rawurlencode($email)], $url), [
            'timeout' => 8,
            'headers' => ['X-OE-Vol-Token' => $token],
        ]);
        if (is_wp_error($resp) || (int) wp_remote_retrieve_response_code($resp) !== 200) {
            return true; // endpoint unreachable — fail open rather than block a volunteer
        }
        $body = json_decode((string) wp_remote_retrieve_body($resp), true);
        $ok   = is_array($body) && ! empty($body['volunteer']);
        set_transient($key, $ok ? 'yes' : 'no', 10 * MINUTE_IN_SECONDS);
        return $ok;
    }

    /** Has this email already redeemed this code on a paid order (this site)? */
    public static function email_used(string $email, string $code): bool {
        global $wpdb;
        $email = strtolower(trim($email));
        $code  = strtoupper(trim($code));
        if ($email === '' || $code === '') {
            return false;
        }
        return (bool) $wpdb->get_var($wpdb->prepare(
            'SELECT id FROM ' . \OE\Ticketing\Schema::orders() . " WHERE promo_code = %s AND LOWER(email) = %s AND status = 'paid' LIMIT 1",
            $code, $email
        ));
    }

    /**
     * Where volunteers redeem it. Prefers an explicit redeem URL (so an email on
     * one site can point at the tickets page on another), else the configured
     * local event's page, else the site home.
     */
    public static function redeem_url(): string {
        $url = trim((string) Settings::get('volunteer_code_redeem_url', ''));
        if ($url !== '') {
            return $url;
        }
        $event = (int) Settings::get('volunteer_code_event', 0);
        $local = $event ? (string) get_permalink($event) : '';
        return $local !== '' ? $local : home_url('/');
    }

    /**
     * Create the year's promo, but only on the site that actually sells the
     * tickets — i.e. where the configured event is a real, published ticket
     * event in THIS install. Tickets and their promo codes live per-site, so the
     * site that only sends the volunteer email (a different WordPress install)
     * must not create a useless local code. Safe to call from cron / on save.
     */
    public static function maybe_ensure(): void {
        if (! self::enabled()) {
            return;
        }
        $event = (int) Settings::get('volunteer_code_event', 0);
        if ($event <= 0
            || get_post_type($event) !== \OE\PostTypes::slug('event')
            || get_post_status($event) !== 'publish') {
            return;
        }
        $code = self::peek();
        if ($code !== '') {
            self::ensure_promo($code);
        }
    }

    /** Create the year's 100%-off promo once, matching the settings. */
    private static function ensure_promo(string $code): void {
        if (Promo::get_by_code($code)) {
            return;
        }
        $event = (int) Settings::get('volunteer_code_event', 0);
        $types = array_values(array_filter(array_map(
            static fn($k) => sanitize_key(trim((string) $k)),
            preg_split('/[\r\n,]+/', (string) Settings::get('volunteer_code_ticket_types', '')) ?: []
        )));
        $max   = (int) Settings::get('volunteer_code_max_uses', 0);
        Promo::save([
            'code'             => $code,
            'event_id'         => $event > 0 ? $event : '',
            'discount_type'    => 'percent',
            'discount_value'   => 100,
            'ticket_type_keys' => $types,
            'max_uses'         => $max > 0 ? $max : '',
            // Expire at the end of the code's year so a stale code can't linger.
            'expires_at'       => wp_date('Y') . '-12-31 23:59:59',
            'active'           => 1,
        ]);
    }
}
