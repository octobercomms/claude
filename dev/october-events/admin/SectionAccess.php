<?php
declare(strict_types=1);

namespace OE\Admin;

use OE\PostTypes;
use OE\Settings;

defined('ABSPATH') || exit;

/**
 * Section-level dashboard access control (BUILD-PLAN M5).
 *
 * Lets a site give a WordPress user a login that sees only some October Events
 * screens — e.g. a "Volunteer lead" who sees only the volunteer screens. Backed
 * by real WordPress capabilities (one `oe_sec_*` cap per section) granted to
 * roles, so WordPress itself enforces the gate: the submenu is hidden AND a
 * direct URL to the page is refused.
 *
 * Safe by construction:
 *   - Administrators always hold every section cap, so no access map can lock an
 *     admin out.
 *   - Until the admin assigns sections to a role (Settings → User access), only
 *     roles that already had `manage_options` see anything — identical to today.
 *   - A role granted any section also gets the dashboard cap, so it can reach
 *     the menu and landing screen; it sees nothing else it wasn't granted.
 *
 * The role → sections map lives in the `section_access` setting; saving it syncs
 * the caps onto the roles.
 */
final class SectionAccess {

    /** Gateable section key => label. The menu slug for each is in slug(). */
    public const SECTIONS = [
        'dashboard'    => 'Dashboard',
        'events'       => 'Events',
        'tickets'      => 'Tickets',
        'directory'    => 'Directory',
        'destinations' => 'Destinations',
        'products'     => 'Products',
        'stories'      => 'Stories',
        'accounts'     => 'Accounts',
        'volunteers'   => 'Volunteers',
        'team'         => 'Team',
        'contacts'     => 'Contacts',
        'packages'     => 'Packages',
        'countdown'    => 'Countdown',
        'settings'     => 'Settings',
    ];

    /** The capability that gates a section. */
    public static function cap(string $section): string {
        return 'oe_sec_' . $section;
    }

    /** Can the current user see this section? */
    public static function can(string $section): bool {
        if (! isset(self::SECTIONS[$section])) {
            return current_user_can('manage_options');
        }
        return current_user_can(self::cap($section));
    }

    public static function init(): void {
        // Block direct access to the two CPT list screens (events, packages)
        // whose menu cap WordPress doesn't enforce on edit.php itself.
        add_action('current_screen', [self::class, 'guard_cpt_screens']);
    }

    /** wp_die on a gated CPT list screen the current user wasn't granted. */
    public static function guard_cpt_screens(\WP_Screen $screen): void {
        if (current_user_can('manage_options')) {
            return;
        }
        $map = [
            PostTypes::slug('event')   => 'events',
            PostTypes::slug('package') => 'packages',
        ];
        $pt = (string) $screen->post_type;
        if ($pt !== '' && isset($map[$pt]) && ! current_user_can(self::cap($map[$pt]))) {
            wp_die(
                esc_html__('You do not have access to this section.', 'october-events'),
                '',
                ['response' => 403, 'back_link' => true]
            );
        }
    }

    /* ------------------------------------------------------------------ *
     * Capability sync
     * ------------------------------------------------------------------ */

    /** The stored role => [section keys] map. */
    public static function map(): array {
        $m = Settings::get('section_access', []);
        return is_array($m) ? $m : [];
    }

    /**
     * Sync every role's `oe_sec_*` caps to match the stored map. Administrators
     * always get all; a role granted any section also gets `dashboard`. Roles
     * absent from the map keep whatever manage_options already gives them (the
     * caps are simply not added), so an unconfigured site behaves as before.
     */
    public static function sync(): void {
        if (! function_exists('get_role')) {
            return;
        }
        $all   = array_keys(self::SECTIONS);
        $map   = self::map();
        $roles = function_exists('wp_roles') ? wp_roles()->get_names() : [];

        foreach (array_keys($roles) as $role_slug) {
            $role = get_role($role_slug);
            if (! $role) {
                continue;
            }
            // Administrators (or any role that can manage_options) get everything.
            $is_admin = $role->has_cap('manage_options');
            $granted  = $is_admin ? $all : array_values(array_intersect($all, (array) ($map[$role_slug] ?? [])));
            if (! $is_admin && $granted) {
                $granted[] = 'dashboard'; // so the menu + landing are reachable
                $granted   = array_values(array_unique($granted));
            }
            foreach ($all as $section) {
                $cap = self::cap($section);
                if (in_array($section, $granted, true)) {
                    $role->add_cap($cap);
                } else {
                    $role->remove_cap($cap);
                }
            }
        }
    }

    /** Roles an admin can assign sections to (everything except administrators). */
    public static function assignable_roles(): array {
        if (! function_exists('wp_roles')) {
            return [];
        }
        $out = [];
        foreach (wp_roles()->roles as $slug => $role) {
            if (! empty($role['capabilities']['manage_options'])) {
                continue; // admins already see everything
            }
            $out[$slug] = (string) ($role['name'] ?? $slug);
        }
        return $out;
    }

    /**
     * Sanitise a posted map (role => [sections]) down to known roles/sections.
     *
     * @return array<string,array<int,string>>
     */
    public static function sanitize_map($posted): array {
        $posted = is_array($posted) ? $posted : [];
        $roles  = self::assignable_roles();
        $out    = [];
        foreach ($roles as $slug => $_name) {
            $chosen = (array) ($posted[$slug] ?? []);
            $clean  = array_values(array_intersect(array_keys(self::SECTIONS), array_map('sanitize_key', $chosen)));
            if ($clean) {
                $out[$slug] = $clean;
            }
        }
        return $out;
    }
}
