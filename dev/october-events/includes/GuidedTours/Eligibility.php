<?php
declare(strict_types=1);

namespace OE\GuidedTours;

use OE\Settings;
use OE\Ticketing\Schema;

defined('ABSPATH') || exit;

/**
 * Ticket-holder eligibility for guided-tour booking, and the signed unlock that
 * carries it. Someone enters the email they bought their tour ticket with; if it
 * matches a paid order we sign a short-lived, tour-scoped cookie. The reserve
 * endpoint trusts that cookie for the email, so a page reload keeps them unlocked
 * without re-checking.
 */
final class Eligibility {

    private const COOKIE   = 'oe_gt_unlock';
    private const TTL      = 12 * HOUR_IN_SECONDS;

    /**
     * Does this email hold a qualifying ticket for the tour? A tour (city+year)
     * can be mapped to a specific ticket event in settings; with no mapping, any
     * paid order for the email qualifies (the single-tour default).
     *
     * @return array{ok:bool,name:string}
     */
    public static function check(string $email, string $tour_key): array {
        global $wpdb;
        $email = strtolower(trim($email));
        if (! is_email($email)) {
            return ['ok' => false, 'name' => ''];
        }
        $orders  = Schema::orders();
        $event_id = self::mapped_event($tour_key);
        if ($event_id > 0) {
            $row = $wpdb->get_row($wpdb->prepare(
                "SELECT name FROM {$orders} WHERE email = %s AND status = 'paid' AND event_id = %d ORDER BY id DESC LIMIT 1",
                $email, $event_id
            ));
        } else {
            $row = $wpdb->get_row($wpdb->prepare(
                "SELECT name FROM {$orders} WHERE email = %s AND status = 'paid' ORDER BY id DESC LIMIT 1",
                $email
            ));
        }
        return $row ? ['ok' => true, 'name' => (string) $row->name] : ['ok' => false, 'name' => ''];
    }

    /** The event id mapped to a tour key in settings, or 0 for "any paid ticket". */
    private static function mapped_event(string $tour_key): int {
        $map = Settings::get('guided_ticket_map', []);
        return is_array($map) ? (int) ($map[$tour_key] ?? 0) : 0;
    }

    /** Set the unlock cookie for this email + tour. */
    public static function unlock(string $email, string $tour_key): void {
        $email = strtolower(trim($email));
        $exp   = time() + self::TTL;
        $value = rawurlencode($email) . '.' . $exp . '.' . self::sig($email, $tour_key, $exp);
        // Cookie is scoped per tour so an Atlanta unlock can't book Boston.
        setcookie(self::cookie_name($tour_key), $value, [
            'expires'  => $exp,
            'path'     => '/',
            'secure'   => is_ssl(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        $_COOKIE[self::cookie_name($tour_key)] = $value;
    }

    /** The verified email from the unlock cookie for this tour, or '' if none/invalid. */
    public static function unlocked_email(string $tour_key): string {
        $raw = isset($_COOKIE[self::cookie_name($tour_key)]) ? (string) $_COOKIE[self::cookie_name($tour_key)] : '';
        if ($raw === '') {
            return '';
        }
        $parts = explode('.', $raw);
        if (count($parts) !== 3) {
            return '';
        }
        [$enc, $exp, $sig] = $parts;
        $email = rawurldecode($enc);
        $exp   = (int) $exp;
        if ($exp < time() || ! hash_equals(self::sig($email, $tour_key, $exp), $sig)) {
            return '';
        }
        return is_email($email) ? $email : '';
    }

    private static function cookie_name(string $tour_key): string {
        return self::COOKIE . '_' . substr(md5($tour_key), 0, 8);
    }

    private static function sig(string $email, string $tour_key, int $exp): string {
        return hash_hmac('sha256', $email . '|' . $tour_key . '|' . $exp, wp_salt('auth'));
    }
}
