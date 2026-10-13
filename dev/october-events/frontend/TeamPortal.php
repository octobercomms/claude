<?php
declare(strict_types=1);

namespace OE\Frontend;

use OE\Admin\SectionAccess;
use OE\PostTypes;
use OE\Sections\Theme;
use OE\Features;

defined('ABSPATH') || exit;

/**
 * Team portal (FRONTEND-BUILD slice G).
 *
 * `[oe_team_portal]` — a role-scoped front-end home for team logins. It shows
 * only the modules the current user's section capabilities (OE\Admin\SectionAccess)
 * grant, so a volunteer lead sees the volunteer tools and a door-crew login sees
 * only tickets/check-in. Capabilities are enforced on each destination screen
 * too; this is the scoped launcher, not a second gate.
 */
final class TeamPortal {

    public const HANDLE = 'oe-portal';

    public static function init(): void {
        add_shortcode('oe_team_portal', [self::class, 'render']);
        add_action('wp_enqueue_scripts', [self::class, 'register'], 1);
    }

    public static function register(): void {
        if (! wp_style_is(self::HANDLE, 'registered')) {
            wp_register_style(self::HANDLE, OE_URL . 'assets/css/portal.css', [], OE_VERSION);
        }
    }

    /** Section => [label, description, icon, admin URL]. */
    private static function modules(): array {
        $cpt = static fn(string $t): string => admin_url('edit.php?post_type=' . PostTypes::slug($t));
        $pg  = static fn(string $slug): string => admin_url('admin.php?page=' . $slug);
        return [
            'events'       => [__('Events', 'october-events'), __('Create and edit listings and their packs.', 'october-events'), '🗓', $cpt('event')],
            'tickets'      => [__('Tickets & check-in', 'october-events'), __('Sales, attendees, promo codes and door scanning.', 'october-events'), '🎟', $pg('oe-tickets')],
            'volunteers'   => [__('Volunteers', 'october-events'), __('Shifts, sign-ups and the recruitment pool.', 'october-events'), '🙋', $pg('oe-volunteers')],
            'contacts'     => [__('Contacts & people', 'october-events'), __('Marketing contacts and the merged people view.', 'october-events'), '👥', $pg('oe-contacts')],
            'packages'     => [__('Packages', 'october-events'), __('Partner packages and pricing.', 'october-events'), '🏷', $cpt('package')],
            'directory'    => [__('Directory', 'october-events'), __('Directory listings.', 'october-events'), '📇', $pg('oe-directory')],
            'destinations' => [__('Destinations', 'october-events'), __('Destination listings.', 'october-events'), '📍', $pg('oe-destinations')],
            'stories'      => [__('Stories', 'october-events'), __('Editorial stories.', 'october-events'), '📝', $pg('oe-stories')],
            'accounts'     => [__('Accounts', 'october-events'), __('Member and partner accounts.', 'october-events'), '🪪', $pg('oe-accounts')],
            'countdown'    => [__('Countdown', 'october-events'), __('The event countdown.', 'october-events'), '⏱', $pg('oe-countdown')],
            'settings'     => [__('Settings', 'october-events'), __('Plugin configuration.', 'october-events'), '⚙️', $pg('oe-settings')],
        ];
    }

    public static function render(): string {
        Theme::enqueue();
        self::register();
        wp_enqueue_style(self::HANDLE);

        if (! is_user_logged_in()) {
            $login = wp_login_url((string) get_permalink());
            return '<div class="oe-portal"><div class="oe-portal__login"><p>'
                . esc_html__('Please sign in to reach your team space.', 'october-events')
                . '</p><p><a class="oe-btn" href="' . esc_url($login) . '">' . esc_html__('Sign in', 'october-events') . '</a></p></div></div>';
        }

        $user = wp_get_current_user();
        $cards = '';
        foreach (self::modules() as $section => [$label, $desc, $icon, $url]) {
            if (! SectionAccess::can($section)) {
                continue;
            }
            // Hide modules a site's features switch off (events is always present).
            if ($section !== 'events' && $section !== 'settings' && ! Features::enabled($section)) {
                continue;
            }
            $cards .= '<a class="oe-module" href="' . esc_url($url) . '">'
                . '<span class="oe-module__ic" aria-hidden="true">' . $icon . '</span>'
                . '<span><span class="oe-module__t">' . esc_html((string) $label) . '</span>'
                . '<span class="oe-module__d">' . esc_html((string) $desc) . '</span></span></a>';
        }

        $initials = strtoupper(mb_substr((string) ($user->display_name ?: $user->user_login), 0, 2));
        $head = '<div class="oe-portal__head">'
            . '<div><h1 class="oe-portal__title">' . esc_html__('Your team space', 'october-events') . '</h1>'
            . '<p class="oe-portal__sub">' . esc_html__('The parts of the job you own. Access is set per role under User access.', 'october-events') . '</p></div>'
            . '<div class="oe-portal__user"><span class="oe-portal__avatar">' . esc_html($initials) . '</span>'
            . '<span>' . esc_html((string) ($user->display_name ?: $user->user_login)) . '</span></div></div>';

        if ($cards === '') {
            return '<div class="oe-portal">' . $head
                . '<div class="oe-portal__login"><p>'
                . esc_html__('Your login has no sections assigned yet. Ask an administrator to grant access under Settings → User access.', 'october-events')
                . '</p></div></div>';
        }

        return '<div class="oe-portal">' . $head . self::tiles()
            . '<div class="oe-portal__modules">' . $cards . '</div>'
            . '<p class="oe-portal__note">' . esc_html__('You see only what your role allows. The same limits are enforced on each screen.', 'october-events') . '</p>'
            . '</div>';
    }

    /** A small row of real counts. */
    private static function tiles(): string {
        $event = PostTypes::slug('event');
        $upcoming = 0;
        if ($event !== '') {
            $q = new \WP_Query([
                'post_type'      => $event,
                'post_status'    => 'publish',
                'posts_per_page' => 1,
                'fields'         => 'ids',
                'no_found_rows'  => false,
                'meta_query'     => [[
                    'key'     => \OE\Planning\Events::key('start_datetime'),
                    'value'   => current_time('Y-m-d'),
                    'compare' => '>=',
                    'type'    => 'CHAR',
                ]],
            ]);
            $upcoming = (int) $q->found_posts;
            wp_reset_postdata();
        }
        $published = $event !== '' ? (int) (wp_count_posts($event)->publish ?? 0) : 0;

        $volunteers = 0;
        if (Features::enabled('volunteers')) {
            global $wpdb;
            $table = $wpdb->prefix . 'oe_volunteer_signups';
            if ((string) $wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $table)) === $table) {
                $volunteers = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$table}");
            }
        }

        $tile = static fn(string $label, int $val, bool $feature = false): string =>
            '<div class="oe-tile' . ($feature ? ' oe-tile--feature' : '') . '">'
            . '<div class="oe-tile__l">' . esc_html($label) . '</div>'
            . '<div class="oe-tile__v">' . esc_html((string) $val) . '</div></div>';

        return '<div class="oe-portal__tiles">'
            . $tile(__('Upcoming events', 'october-events'), $upcoming, true)
            . $tile(__('Published events', 'october-events'), $published)
            . $tile(__('Volunteer sign-ups', 'october-events'), $volunteers)
            . '</div>';
    }
}
