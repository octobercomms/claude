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
        'stories'      => 'Stories',
        'accounts'     => 'Accounts',
        'volunteers'   => 'Volunteers',
        'team'         => 'Team',
        'contacts'     => 'Contacts',
        'ads'          => 'Ad manager',
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
        // Portal-only roles (Door crew, Organizer): no wp-admin, no admin bar.
        add_action('admin_init', [self::class, 'enforce_portal'], 1);
        add_filter('show_admin_bar', [self::class, 'filter_admin_bar']);
    }

    /** Redirect portal-only users out of wp-admin to the front-end portal. */
    public static function enforce_portal(): void {
        if (wp_doing_ajax() || (defined('DOING_CRON') && DOING_CRON)) {
            return;
        }
        // Leave the form/async endpoints the portal itself may post to.
        $script = isset($_SERVER['PHP_SELF']) ? basename((string) $_SERVER['PHP_SELF']) : '';
        if (in_array($script, ['admin-post.php', 'admin-ajax.php', 'async-upload.php'], true)) {
            return;
        }
        if (! self::current_user_is_portal_only()) {
            return;
        }
        wp_safe_redirect(self::portal_url());
        exit;
    }

    /** Hide the admin bar on the front end for portal-only users. */
    public static function filter_admin_bar($show) {
        return self::current_user_is_portal_only() ? false : $show;
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

    /** Persist a role => [sections] map and re-sync the caps onto the roles. */
    public static function save_map(array $map): void {
        Settings::update(['section_access' => self::sanitize_map($map)]);
        self::sync();
    }

    /**
     * Named role presets, for one-click assignment on the access screen.
     *
     * `portal` marks a preset whose people work from the front-end portal and
     * never need wp-admin (Door crew, Organizer): applying it ticks the
     * "portal only" box so those users are redirected out of wp-admin.
     *
     * @return array<string,array{label:string,sections:array<int,string>,portal:bool}>
     */
    public static function presets(): array {
        return [
            'director'  => ['label' => __('Director', 'october-events'),  'sections' => array_keys(self::SECTIONS), 'portal' => false],
            'lead'      => ['label' => __('Lead', 'october-events'),      'sections' => ['dashboard', 'events', 'tickets', 'volunteers', 'team', 'contacts', 'accounts'], 'portal' => false],
            'door'      => ['label' => __('Door crew', 'october-events'), 'sections' => ['tickets'], 'portal' => true],
            'organizer' => ['label' => __('Organizer', 'october-events'), 'sections' => ['events', 'packages'], 'portal' => true],
            'none'      => ['label' => __('No access', 'october-events'),  'sections' => [], 'portal' => false],
        ];
    }

    /* ------------------------------------------------------------------ *
     * Portal-only roles: blocked from wp-admin, sent to the front-end portal
     * ------------------------------------------------------------------ */

    /** Role slugs whose users work from the portal and never reach wp-admin. */
    public static function portal_only_roles(): array {
        $r = Settings::get('section_portal_only', []);
        return is_array($r) ? array_values(array_filter(array_map('strval', $r))) : [];
    }

    /** Persist the portal-only role list (sanitised to assignable roles). */
    public static function save_portal_only(array $roles): void {
        $valid = array_keys(self::assignable_roles());
        $clean = array_values(array_intersect($valid, array_map('sanitize_key', $roles)));
        Settings::update(['section_portal_only' => $clean]);
        delete_transient('oe_portal_url');
    }

    /** Is the current user confined to the portal (never an administrator)? */
    public static function current_user_is_portal_only(): bool {
        if (! is_user_logged_in() || current_user_can('manage_options')) {
            return false;
        }
        $portal = self::portal_only_roles();
        if (! $portal) {
            return false;
        }
        $roles = (array) (wp_get_current_user()->roles ?? []);
        return (bool) array_intersect($roles, $portal);
    }

    /**
     * Where portal-only users are sent: the configured page, else a page that
     * hosts a portal shortcode, else the site root. Never a wp-admin URL (that
     * would loop against the redirect below).
     */
    public static function portal_url(): string {
        $set = (string) Settings::get('portal_page_url', '');
        $url = $set !== '' ? esc_url_raw($set) : self::detect_portal_url();
        $path = (string) wp_parse_url((string) $url, PHP_URL_PATH);
        if ($url === '' || strpos($path, '/wp-admin') !== false) {
            $url = home_url('/');
        }
        return (string) $url;
    }

    /** Find (and cache for a day) a published page that hosts a portal shortcode. */
    private static function detect_portal_url(): string {
        $cached = get_transient('oe_portal_url');
        if ($cached !== false) {
            return (string) $cached;
        }
        $url   = '';
        $pages = get_posts(['post_type' => 'page', 'post_status' => 'publish', 'numberposts' => 200, 'fields' => 'ids']);
        foreach ($pages as $pid) {
            $content = (string) get_post_field('post_content', (int) $pid);
            if (has_shortcode($content, 'oe_team_portal') || has_shortcode($content, 'oe_organizer_portal')) {
                $url = (string) get_permalink((int) $pid);
                break;
            }
        }
        set_transient('oe_portal_url', $url, DAY_IN_SECONDS);
        return $url;
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
