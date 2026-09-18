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

    /**
     * Explicitly create this year's promo now, regardless of cron timing — used by
     * the admin self-test's "Create the code now" action. Returns the code, or ''
     * if the feature is off. Unlike maybe_ensure() this doesn't require the event
     * to be published, so an admin can pre-create the code while still drafting the
     * event; the promo still respects the configured event/types/limit.
     */
    public static function create_now(): string {
        $code = self::peek();
        if ($code !== '') {
            self::ensure_promo($code);
        }
        return $code;
    }

    /**
     * Does this install actually sell the tickets for this code — i.e. is the
     * configured event a real, published ticket event here? (The email-only site
     * has no such event, so it never hosts the promo.)
     */
    public static function is_ticket_site(): bool {
        $event = (int) Settings::get('volunteer_code_event', 0);
        return $event > 0
            && get_post_type($event) === \OE\PostTypes::slug('event')
            && get_post_status($event) === 'publish';
    }

    /**
     * One live call to a volunteer-check endpoint (this site's own or the partner's),
     * bypassing the 10-minute cache, so the admin self-test reflects reality now.
     * Returns a plain shape the diagnostics rows read: reachable, authorized, the
     * boolean answer, the HTTP code and any error string.
     *
     * @return array{reachable:bool,authorized:bool,volunteer:?bool,code:int,error:string}
     */
    public static function probe(string $url, string $token, string $email): array {
        $out = ['reachable' => false, 'authorized' => false, 'volunteer' => null, 'code' => 0, 'error' => ''];
        $url = trim($url);
        if ($url === '') {
            $out['error'] = 'no_url';
            return $out;
        }
        $resp = wp_remote_get(add_query_arg(['email' => rawurlencode($email)], $url), [
            'timeout' => 8,
            'headers' => $token !== '' ? ['X-OE-Vol-Token' => $token] : [],
        ]);
        if (is_wp_error($resp)) {
            $out['error'] = $resp->get_error_message();
            return $out;
        }
        $out['reachable'] = true;
        $out['code']      = (int) wp_remote_retrieve_response_code($resp);
        if ($out['code'] === 200) {
            $body = json_decode((string) wp_remote_retrieve_body($resp), true);
            if (is_array($body) && array_key_exists('volunteer', $body)) {
                $out['authorized'] = true;
                $out['volunteer']  = ! empty($body['volunteer']);
            }
        }
        return $out;
    }

    /**
     * Full self-test for the settings screen: a role-aware list of pass/warn/fail
     * rows an admin can read at a glance on either site, plus whether the code can
     * be created now. $email (optional) is used for the live verification probe.
     *
     * @return array{code:string,can_create:bool,rows:array<int,array{label:string,state:string,detail:string}>}
     */
    public static function diagnostics(string $email = ''): array {
        $rows       = [];
        $can_create = false;
        $row = static function (string $label, string $state, string $detail) use (&$rows): void {
            $rows[] = ['label' => $label, 'state' => $state, 'detail' => $detail];
        };

        if (! self::enabled()) {
            $row(__('Feature', 'october-events'), 'fail', __('Off. Tick “Include a free-ticket code in the 48-hour reminder” above and save.', 'october-events'));
            return ['code' => '', 'can_create' => false, 'rows' => $rows];
        }
        $row(__('Feature', 'october-events'), 'ok', __('On.', 'october-events'));

        $code = self::peek();
        $row(__('This year’s code', 'october-events'), 'info', $code);

        $ticket_site = self::is_ticket_site();
        if ($ticket_site) {
            $row(__('This site’s role', 'october-events'), 'ok', __('Sells the tickets — it creates and hosts the promo code.', 'october-events'));
            $promo = Promo::get_by_code($code);
            if (! $promo) {
                $can_create = true;
                $row(__('Promo code', 'october-events'), 'fail', __('Not created yet. Click “Create the code now” below, or it’s created automatically on save and by the daily job.', 'october-events'));
            } else {
                $bits = [sprintf(__('%d%% off', 'october-events'), (int) $promo->discount_value)];
                $types = trim((string) ($promo->ticket_type_keys ?? ''));
                $bits[] = $types !== '' ? sprintf(__('ticket type(s): %s', 'october-events'), $types) : __('whole event', 'october-events');
                $max = (int) ($promo->max_uses ?? 0);
                $bits[] = $max > 0 ? sprintf(__('used %d of %d', 'october-events'), (int) ($promo->used_count ?? 0), $max) : sprintf(__('used %d (no cap)', 'october-events'), (int) ($promo->used_count ?? 0));
                $expired = $promo->expires_at !== null && strtotime((string) $promo->expires_at) < current_time('timestamp', true);
                $state = 'ok';
                if (empty($promo->active)) { $state = 'fail'; $bits[] = __('INACTIVE', 'october-events'); }
                elseif ($expired) { $state = 'fail'; $bits[] = __('EXPIRED', 'october-events'); }
                $row(__('Promo code', 'october-events'), $state, implode(' · ', $bits));
            }
        } else {
            $row(__('This site’s role', 'october-events'), 'info', __('Sends the volunteer email only — tickets are hosted on the other site (no local event set). The email prints the code and links across via the Redeem URL.', 'october-events'));
        }

        $redeem = self::redeem_url();
        $home = trailingslashit(home_url());
        if (! $ticket_site && (trailingslashit($redeem) === $home)) {
            $row(__('Redeem URL', 'october-events'), 'warn', __('Not set. On the email-only site, set the Redeem URL to the tickets page on the other site, or the email links back here.', 'october-events'));
        } else {
            $row(__('Redeem URL', 'october-events'), 'info', $redeem);
        }

        // 48h reminder must be on — the code only rides that one.
        $offsets = (array) Settings::get('reminder_offsets', array_keys(\OE\Reminders::OFFSETS));
        if (in_array('48h', $offsets, true)) {
            $row(__('48-hour reminder', 'october-events'), 'ok', __('On — the code rides this send.', 'october-events'));
        } else {
            $row(__('48-hour reminder', 'october-events'), 'fail', __('Off. The code is only sent in the 48-hour reminder, so nothing goes out. Enable it under Reminders.', 'october-events'));
        }

        // Verification, ticket side (this site calls the partner).
        if (self::verify_enabled()) {
            $vurl   = trim((string) Settings::get('volunteer_verify_url', ''));
            $vtoken = trim((string) Settings::get('volunteer_verify_token', ''));
            if ($vurl === '' || $vtoken === '') {
                $row(__('Volunteer verification', 'october-events'), 'warn', __('Enabled but not fully configured (needs the check URL and shared token). Until configured, any email can use the code.', 'october-events'));
            } else {
                $probe_email = is_email($email) ? strtolower(trim($email)) : ('selftest-' . time() . '@example.invalid');
                $p = self::probe($vurl, $vtoken, $probe_email);
                if (! $p['reachable']) {
                    $row(__('Volunteer verification', 'october-events'), 'warn', sprintf(__('Couldn’t reach the volunteer site (%s). Checkout fails open, so a real volunteer isn’t blocked, but the check isn’t running.', 'october-events'), $p['error'] ?: 'network error'));
                } elseif ($p['code'] === 404) {
                    $row(__('Volunteer verification', 'october-events'), 'fail', __('Endpoint not found (404). Update October Events on the volunteer site so /volunteer-check exists.', 'october-events'));
                } elseif (! $p['authorized']) {
                    $row(__('Volunteer verification', 'october-events'), 'fail', sprintf(__('Reached the volunteer site but the token was rejected (HTTP %d). The Shared token must be identical on both sites.', 'october-events'), $p['code']));
                } else {
                    $answer = is_email($email)
                        ? ($p['volunteer'] ? sprintf(__('%s is a current volunteer ✓', 'october-events'), $email) : sprintf(__('%s is NOT a current volunteer ✗', 'october-events'), $email))
                        : __('token accepted (enter an email below to test a specific person)', 'october-events');
                    $row(__('Volunteer verification', 'october-events'), 'ok', sprintf(__('Volunteer site reachable, token accepted — %s', 'october-events'), $answer));
                }
            }
        } else {
            $row(__('Volunteer verification', 'october-events'), 'info', __('Off — any email can redeem the code (still one order per email). Turn it on to require a current volunteer.', 'october-events'));
        }

        // This install as a verification target: is our own endpoint live + token set?
        $own_token = trim((string) Settings::get('volunteer_verify_token', ''));
        $self_url  = rest_url(self::REST_CHECK);
        if ($own_token === '') {
            $row(__('This site’s check endpoint', 'october-events'), 'info', sprintf(__('No shared token set here, so this site can’t answer incoming volunteer checks. If the OTHER site verifies against this one, set a matching token. Endpoint: %s', 'october-events'), $self_url));
        } else {
            $sp = self::probe($self_url, $own_token, is_email($email) ? $email : ('selftest-' . time() . '@example.invalid'));
            if (! $sp['reachable']) {
                $row(__('This site’s check endpoint', 'october-events'), 'warn', sprintf(__('Couldn’t reach own endpoint (%s) — often a host blocking loopback requests, not necessarily broken for the partner site. Endpoint: %s', 'october-events'), $sp['error'] ?: 'network error', $self_url));
            } elseif ($sp['code'] === 404) {
                $row(__('This site’s check endpoint', 'october-events'), 'fail', __('Own /volunteer-check returns 404 — flush permalinks (Settings → Permalinks → Save) so the route registers.', 'october-events'));
            } elseif (! $sp['authorized']) {
                $row(__('This site’s check endpoint', 'october-events'), 'warn', sprintf(__('Own endpoint answered HTTP %d with the local token — unexpected; check the token field saved.', 'october-events'), $sp['code']));
            } else {
                $row(__('This site’s check endpoint', 'october-events'), 'ok', sprintf(__('Live and answering. The partner site verifies against: %s', 'october-events'), $self_url));
            }
        }

        // FAQ link on volunteer emails.
        $faq = trim((string) Settings::get('volunteer_faq_url', ''));
        $row(__('Volunteer FAQ link', 'october-events'), $faq !== '' ? 'ok' : 'info', $faq !== '' ? $faq : __('Not set — no FAQ link in volunteer emails.', 'october-events'));

        return ['code' => $code, 'can_create' => $can_create, 'rows' => $rows];
    }

    /** REST route for the cross-site volunteer check. */
    private const REST_CHECK = 'oe/v1/volunteer-check';

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
