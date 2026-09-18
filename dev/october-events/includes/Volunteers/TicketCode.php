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

    /** Where volunteers redeem it — the configured event's page, else the site. */
    public static function redeem_url(): string {
        $event = (int) Settings::get('volunteer_code_event', 0);
        $url   = $event ? (string) get_permalink($event) : '';
        return $url !== '' ? $url : home_url('/');
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
