<?php
declare(strict_types=1);

namespace OE;

defined('ABSPATH') || exit;

/**
 * Per-site feature toggles. The plugin ships with everything on; a site can
 * switch off modules it doesn't use (Settings → Features) — e.g. a Directory
 * site that doesn't sell tickets, or an events site with no Products.
 *
 * Disabling is non-destructive: it hides the module's wp-admin screens, makes
 * its front-end shortcodes/route inert, and tells the companion platform to drop
 * it from the nav. Nothing is deleted — flip it back on and it returns.
 */
final class Features {

    /** Toggleable feature key => admin label. Core (Dashboard/Events/Settings) is always on. */
    public const FEATURES = [
        'tickets'      => 'Tickets & check-in',
        'directory'    => 'Directory',
        'destinations' => 'Destinations',
        'products'     => 'Products',
        'stories'      => 'Stories',
        'accounts'     => 'Accounts',
        'volunteers'   => 'Volunteers',
        'contacts'     => 'Contacts & email',
    ];

    /** True unless explicitly switched off. Unknown keys default to on. */
    public static function enabled(string $key): bool {
        if (! array_key_exists($key, self::FEATURES)) {
            return true;
        }
        $f = (array) Settings::get('features', []);
        return ($f[$key] ?? '1') !== '0';
    }

    /** @return array<string,bool> every feature key => enabled */
    public static function all(): array {
        $f = (array) Settings::get('features', []);
        $out = [];
        foreach (array_keys(self::FEATURES) as $k) {
            $out[$k] = ($f[$k] ?? '1') !== '0';
        }
        return $out;
    }

    /** Sanitize a posted features map (checkbox group) to '1'/'0' per key. */
    public static function sanitize(array $posted): array {
        $clean = [];
        foreach (array_keys(self::FEATURES) as $k) {
            $clean[$k] = empty($posted[$k]) ? '0' : '1';
        }
        return $clean;
    }
}
