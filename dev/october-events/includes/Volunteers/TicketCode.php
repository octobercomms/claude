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

    /** scheme://host(:port) of a URL, or '' if it has no host. */
    private static function origin_of(string $url): string {
        $p = wp_parse_url(trim($url));
        if (empty($p['host'])) {
            return '';
        }
        return (($p['scheme'] ?? 'https')) . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : '');
    }

    /**
     * The single linked partner site (no trailing slash). Prefers the merged
     * `volunteer_partner_url`, falling back to the older feed URL (festival side)
     * or the host of the older verify URL (ticket side) so existing setups keep
     * working before the field is re-saved.
     */
    public static function partner_url(): string {
        $u = trim((string) Settings::get('volunteer_partner_url', ''));
        if ($u === '') {
            $u = trim((string) Settings::get('volunteer_feed_url', ''));
        }
        if ($u === '') {
            $u = self::origin_of((string) Settings::get('volunteer_verify_url', ''));
        }
        return untrailingslashit($u);
    }

    /** The volunteer-check endpoint on the partner site (derived), or an explicit override. */
    public static function verify_endpoint(): string {
        $explicit = trim((string) Settings::get('volunteer_verify_url', ''));
        if ($explicit !== '') {
            return $explicit;
        }
        $p = self::partner_url();
        return $p !== '' ? trailingslashit($p) . 'wp-json/oe/v1/volunteer-check' : '';
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
        $url   = self::verify_endpoint();
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

        $code = self::peek(); // kept for the return value; the per-event rows below are what matter.

        // Where the volunteer email links now (per-event model): the reward tour
        // synced from the ticket site carries its own tickets URL — there is no
        // single global "Redeem URL" any more. On the email-sending site, confirm
        // the default reward tour resolves to a tickets page.
        if (\OE\Features::enabled('volunteers')) {
            $def = EventCodes::default_reward_code();
            if ($def !== '') {
                $tour = null;
                foreach (EventCodes::synced() as $t) {
                    if (strtoupper((string) $t['code']) === $def) { $tour = $t; break; }
                }
                if (! $tour) {
                    $row(__('Default reward tour', 'october-events'), 'warn', __('Set, but that tour isn’t in the synced list — run Save & sync now.', 'october-events'));
                } else {
                    $u = trim((string) ($tour['url'] ?? ''));
                    $row(__('Default reward tour', 'october-events'), $u !== '' ? 'ok' : 'warn',
                        $u !== ''
                            ? sprintf(__('%1$s → %2$s (the email links here, code auto-applied)', 'october-events'), (string) $tour['label'], $u)
                            : sprintf(__('%s has no Tickets URL — set it on the ticket site’s offer table.', 'october-events'), (string) $tour['label']));
                }
            } else {
                $row(__('Default reward tour', 'october-events'), 'info', __('None set. Volunteers are matched by their event or by City + Year instead; set a default to cover everyone else.', 'october-events'));
            }
        }

        // 48h reminder must be on — the code only rides that one. Only relevant on
        // the site that actually sends volunteer emails (Volunteers feature on); the
        // tickets-only site hosts the code but doesn't send the reminder.
        if (\OE\Features::enabled('volunteers')) {
            $offsets = (array) Settings::get('reminder_offsets', array_keys(\OE\Reminders::OFFSETS));
            if (in_array('48h', $offsets, true)) {
                $row(__('48-hour reminder', 'october-events'), 'ok', __('On — the code rides this send.', 'october-events'));
            } else {
                $row(__('48-hour reminder', 'october-events'), 'fail', __('Off. The code is only sent in the 48-hour reminder, so nothing goes out. Enable it under Reminders.', 'october-events'));
            }
        }

        // Verification, ticket side (this site calls the partner).
        if (self::verify_enabled()) {
            $vurl   = self::verify_endpoint();
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

        // FAQ link on volunteer emails — only meaningful where emails are sent.
        if (\OE\Features::enabled('volunteers')) {
            $faq = trim((string) Settings::get('volunteer_faq_url', ''));
            $row(__('Volunteer FAQ link', 'october-events'), $faq !== '' ? 'ok' : 'info', $faq !== '' ? $faq : __('Not set — no FAQ link in volunteer emails.', 'october-events'));
        }

        // Per-event codes: what each offering event hosts (ticket site), and what
        // tours have been synced for the reward picker (festival site).
        $offering = EventCodes::offering_events();
        if ($offering) {
            foreach ($offering as $eid) {
                $eid   = (int) $eid;
                $ecode = EventCodes::code_for($eid);
                $exists = \OE\Ticketing\Promo::get_by_code($ecode);
                $row((string) get_the_title($eid) ?: ('#' . $eid),
                    $exists ? 'ok' : 'fail',
                    $exists ? sprintf(__('%s — created', 'october-events'), $ecode)
                            : sprintf(__('%s — not created yet (save the event or click Create).', 'october-events'), $ecode));
                if (! $exists) {
                    $can_create = true;
                }
            }
        }
        if (\OE\Features::enabled('volunteers')) {
            $synced = EventCodes::synced();
            $row(__('Tours synced', 'october-events'),
                $synced ? 'ok' : 'info',
                $synced ? sprintf(__('%d tour(s) available for the reward picker.', 'october-events'), count($synced))
                        : __('None yet — use “Save & sync now” on the linked-site connection.', 'october-events'));
        }

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
