<?php
declare(strict_types=1);

namespace OE\Frontend;

use OE\Planning\Events;
use OE\PostTypes;
use OE\Sections\Theme;

defined('ABSPATH') || exit;

/**
 * Organizer / partner portal (FRONTEND-BUILD slice H).
 *
 * `[oe_organizer_portal]` — a partner's front-end space with tabs: Overview,
 * Packages (the existing [oe_packages] matrix), Activities (their own events with
 * an ownership-guarded create/edit flow, approval-gated) and Account (profile).
 * A partner never needs wp-admin. Create/edit is guarded by post authorship, not
 * a WordPress capability, and new/edited events are set to pending for approval.
 */
final class OrganizerPortal {

    private const SAVE_EVENT     = 'oe_org_save_event';
    private const SAVE_ACCOUNT   = 'oe_org_save_account';
    private const SAVE_CHECKLIST = 'oe_org_save_checklist';
    private const TABS = ['overview', 'packages', 'activities', 'briefings', 'account'];

    public static function init(): void {
        add_shortcode('oe_organizer_portal', [self::class, 'render']);
        add_action('admin_post_' . self::SAVE_EVENT, [self::class, 'save_event']);
        add_action('admin_post_' . self::SAVE_ACCOUNT, [self::class, 'save_account']);
        add_action('admin_post_' . self::SAVE_CHECKLIST, [self::class, 'save_checklist']);
    }

    public static function render(): string {
        Theme::enqueue();
        TeamPortal::register();
        wp_enqueue_style(TeamPortal::HANDLE);

        if (! is_user_logged_in()) {
            $login = wp_login_url((string) get_permalink());
            return '<div class="oe-portal"><div class="oe-portal__login"><p>'
                . esc_html__('Please sign in to reach your partner space.', 'october-events')
                . '</p><p><a class="oe-btn" href="' . esc_url($login) . '">' . esc_html__('Sign in', 'october-events') . '</a></p></div></div>';
        }

        $user = wp_get_current_user();
        $tab  = isset($_GET['oe_tab']) ? sanitize_key((string) $_GET['oe_tab']) : 'overview';
        if (! in_array($tab, self::TABS, true)) {
            $tab = 'overview';
        }

        $head = '<div class="oe-portal__head"><div>'
            . '<h1 class="oe-portal__title">' . esc_html(sprintf(__('Welcome, %s', 'october-events'), $user->display_name ?: $user->user_login)) . '</h1>'
            . '<p class="oe-portal__sub">' . esc_html__('Your partner space: choose a package, add your activities, keep your details current.', 'october-events') . '</p>'
            . '</div></div>';

        $base = remove_query_arg(['oe_tab', 'oe_edit', 'oe_new', 'oe_saved']);
        $nav  = '<nav class="oe-portal__subnav">';
        foreach ([
            'overview'   => __('Overview', 'october-events'),
            'packages'   => __('Packages', 'october-events'),
            'activities' => __('Activities', 'october-events'),
            'briefings'  => __('Briefings', 'october-events'),
            'account'    => __('Account', 'october-events'),
        ] as $key => $label) {
            $url = esc_url(add_query_arg('oe_tab', $key, $base));
            $nav .= '<a class="' . ($tab === $key ? 'is-active' : '') . '" href="' . $url . '">' . esc_html($label) . '</a>';
        }
        $nav .= '</nav>';

        switch ($tab) {
            case 'packages':
                $body = self::tab_packages();
                break;
            case 'activities':
                $body = self::tab_activities($user);
                break;
            case 'briefings':
                $body = self::tab_briefings($user);
                break;
            case 'account':
                $body = self::tab_account($user);
                break;
            default:
                $body = self::tab_overview($user);
        }

        return '<div class="oe-portal">' . $head . $nav . $body . '</div>';
    }

    private static function flash(string $msg): string {
        return '<p class="oe-staff__msg oe-staff__msg--ok">' . esc_html($msg) . '</p>';
    }

    private static function tab_overview(\WP_User $user): string {
        $uid   = (int) $user->ID;
        $mine  = self::own_events($uid);
        $live  = 0;
        foreach ($mine as $p) {
            if ($p->post_status === 'publish') {
                $live++;
            }
        }
        $tiles = '<div class="oe-portal__tiles">'
            . '<div class="oe-tile oe-tile--feature"><div class="oe-tile__l">' . esc_html__('Your activities', 'october-events') . '</div><div class="oe-tile__v">' . count($mine) . '</div></div>'
            . '<div class="oe-tile"><div class="oe-tile__l">' . esc_html__('Published', 'october-events') . '</div><div class="oe-tile__v">' . $live . '</div></div>'
            . '<div class="oe-tile"><div class="oe-tile__l">' . esc_html__('Pending review', 'october-events') . '</div><div class="oe-tile__v">' . (count($mine) - $live) . '</div></div>'
            . '</div>';
        $base = remove_query_arg(['oe_tab', 'oe_edit', 'oe_new', 'oe_saved']);
        $links = '<div class="oe-portal__modules">'
            . '<a class="oe-module" href="' . esc_url(add_query_arg('oe_tab', 'packages', $base)) . '"><span class="oe-module__ic">🏷</span><span><span class="oe-module__t">' . esc_html__('Choose a package', 'october-events') . '</span><span class="oe-module__d">' . esc_html__('Compare partner packages and pick one.', 'october-events') . '</span></span></a>'
            . '<a class="oe-module" href="' . esc_url(add_query_arg('oe_tab', 'activities', $base)) . '"><span class="oe-module__ic">🗓</span><span><span class="oe-module__t">' . esc_html__('Add an activity', 'october-events') . '</span><span class="oe-module__d">' . esc_html__('Submit an event for the program.', 'october-events') . '</span></span></a>'
            . '</div>';
        return $tiles . $links;
    }

    private static function tab_packages(): string {
        $matrix = trim((string) do_shortcode('[oe_packages]'));
        if ($matrix === '') {
            return '<div class="oe-card"><p>' . esc_html__('No packages are available yet.', 'october-events') . '</p></div>';
        }
        return $matrix;
    }

    /** Briefings + the onboarding checklist (ROADMAP R4). */
    private static function tab_briefings(\WP_User $user): string {
        $uid       = (int) $user->ID;
        $briefings = \OE\Briefings\Briefings::briefings();
        $checklist = \OE\Briefings\Briefings::checklist();
        $state     = \OE\Briefings\Briefings::state($uid);
        $prog      = \OE\Briefings\Briefings::progress($uid);

        $out = '';
        if (isset($_GET['oe_saved']) && $_GET['oe_saved'] === 'checklist') {
            $out .= self::flash(__('Your checklist is saved.', 'october-events'));
        }

        // Checklist.
        if ($checklist) {
            $action = esc_url(admin_url('admin-post.php'));
            $nonce  = wp_create_nonce(self::SAVE_CHECKLIST);
            $out .= '<div class="oe-card oe-briefings-check">'
                . '<h2>' . esc_html__('Your onboarding checklist', 'october-events') . '</h2>'
                . '<p class="oe-portal__sub">' . esc_html(sprintf(__('%1$d of %2$d done (%3$d%%)', 'october-events'), $prog['done'], $prog['total'], $prog['pct'])) . '</p>'
                . '<div class="oe-check-bar"><span style="width:' . (int) $prog['pct'] . '%"></span></div>'
                . '<form method="post" action="' . $action . '">'
                . '<input type="hidden" name="action" value="' . esc_attr(self::SAVE_CHECKLIST) . '">'
                . '<input type="hidden" name="_oe_nonce" value="' . esc_attr($nonce) . '">'
                . '<ul class="oe-check-list">';
            foreach ($checklist as $c) {
                $done = ! empty($state[$c['id']]);
                $out .= '<li><label><input type="checkbox" name="done[]" value="' . esc_attr($c['id']) . '"' . checked($done, true, false) . '> '
                    . '<span><strong>' . esc_html($c['label']) . '</strong>'
                    . ($c['desc'] !== '' ? '<span class="oe-check-desc">' . esc_html($c['desc']) . '</span>' : '')
                    . '</span></label></li>';
            }
            $out .= '</ul><p><button type="submit" class="oe-btn">' . esc_html__('Save checklist', 'october-events') . '</button></p></form></div>';
        }

        // Briefings.
        if ($briefings) {
            $out .= '<div class="oe-card oe-briefings-list"><h2>' . esc_html__('Briefings', 'october-events') . '</h2>';
            foreach ($briefings as $b) {
                $out .= '<div class="oe-brief"><h3>' . esc_html($b['title']) . '</h3>';
                if ($b['body'] !== '') {
                    $out .= '<p>' . nl2br(esc_html($b['body'])) . '</p>';
                }
                if ($b['link'] !== '') {
                    $out .= '<p><a class="oe-btn oe-btn--ghost" href="' . esc_url($b['link']) . '" target="_blank" rel="noopener">' . esc_html__('Open', 'october-events') . '</a></p>';
                }
                $out .= '</div>';
            }
            $out .= '</div>';
        }

        if ($out === '') {
            $out = '<div class="oe-card"><p>' . esc_html__('No briefings yet. Your coordinator will add them here.', 'october-events') . '</p></div>';
        }
        return $out;
    }

    public static function save_checklist(): void {
        if (! is_user_logged_in()) {
            wp_safe_redirect(home_url('/'));
            exit;
        }
        $nonce = isset($_POST['_oe_nonce']) ? sanitize_text_field(wp_unslash((string) $_POST['_oe_nonce'])) : '';
        $uid   = get_current_user_id();
        if ($nonce === '' || ! wp_verify_nonce($nonce, self::SAVE_CHECKLIST) || ! $uid) {
            wp_safe_redirect(wp_get_referer() ?: home_url('/'));
            exit;
        }
        $done = isset($_POST['done']) && is_array($_POST['done']) ? array_map('strval', (array) wp_unslash($_POST['done'])) : [];
        \OE\Briefings\Briefings::set_all((int) $uid, $done);
        $back = add_query_arg(['oe_tab' => 'briefings', 'oe_saved' => 'checklist'], wp_get_referer() ?: home_url('/'));
        wp_safe_redirect($back);
        exit;
    }

    private static function tab_activities(\WP_User $user): string {
        $uid  = (int) $user->ID;
        $out  = '';
        if (isset($_GET['oe_saved'])) {
            $out .= self::flash(__('Saved. Your activity is pending review.', 'october-events'));
        }

        // The create/edit form (new, or an owned event).
        $edit_id = isset($_GET['oe_edit']) ? (int) $_GET['oe_edit'] : 0;
        $show_form = isset($_GET['oe_new']) || ($edit_id && self::owns($edit_id, $uid));
        if ($show_form) {
            $out .= self::event_form($edit_id && self::owns($edit_id, $uid) ? $edit_id : 0);
        }

        $base = remove_query_arg(['oe_edit', 'oe_new', 'oe_saved']);
        $out .= '<div class="oe-card"><div class="oe-card__title">' . esc_html__('Your activities', 'october-events')
            . '<a class="oe-btn" style="float:right" href="' . esc_url(add_query_arg('oe_new', '1', $base)) . '">' . esc_html__('New activity', 'october-events') . '</a></div>';

        $mine = self::own_events($uid);
        if (! $mine) {
            $out .= '<p>' . esc_html__('You have not added any activities yet.', 'october-events') . '</p></div>';
            return $out;
        }
        $out .= '<table class="oe-ptable"><thead><tr><th>' . esc_html__('Activity', 'october-events') . '</th><th>'
            . esc_html__('When', 'october-events') . '</th><th>' . esc_html__('Status', 'october-events') . '</th><th></th></tr></thead><tbody>';
        foreach ($mine as $p) {
            $pid    = (int) $p->ID;
            $status = $p->post_status === 'publish'
                ? '<span class="oe-pstatus oe-pstatus--done">' . esc_html__('Published', 'october-events') . '</span>'
                : '<span class="oe-pstatus oe-pstatus--warn">' . esc_html__('Pending', 'october-events') . '</span>';
            $when = esc_html(trim((string) Events::get($pid, 'start_datetime', '')));
            $edit = esc_url(add_query_arg(['oe_edit' => $pid], $base));
            $out .= '<tr><td>' . esc_html(get_the_title($pid)) . '</td><td>' . $when . '</td><td>' . $status
                . '</td><td><a href="' . $edit . '">' . esc_html__('Edit', 'october-events') . '</a></td></tr>';
        }
        $out .= '</tbody></table></div>';
        return $out;
    }

    private static function event_form(int $event_id): string {
        $g = static fn(string $f): string => $event_id ? (string) Events::get($event_id, $f, '') : '';
        $title = $event_id ? get_the_title($event_id) : '';
        $action = esc_url(admin_url('admin-post.php'));
        $nonce  = wp_create_nonce(self::SAVE_EVENT);
        $heading = $event_id ? __('Edit activity', 'october-events') : __('New activity', 'october-events');

        $field = static function (string $name, string $label, string $val, string $type = 'text') : string {
            return '<label class="oe-field"><span>' . esc_html($label) . '</span><input type="' . esc_attr($type) . '" name="oe_event[' . esc_attr($name) . ']" value="' . esc_attr($val) . '"></label>';
        };

        return '<div class="oe-card"><div class="oe-card__title">' . esc_html($heading) . '</div>'
            . '<form class="oe-form" method="post" action="' . $action . '">'
            . '<input type="hidden" name="action" value="' . esc_attr(self::SAVE_EVENT) . '">'
            . '<input type="hidden" name="event_id" value="' . esc_attr((string) $event_id) . '">'
            . '<input type="hidden" name="_oe_nonce" value="' . esc_attr($nonce) . '">'
            . '<label class="oe-field"><span>' . esc_html__('Name', 'october-events') . '</span><input type="text" name="oe_event[name]" value="' . esc_attr($g('name') ?: $title) . '" required></label>'
            . '<label class="oe-field oe-field--wide"><span>' . esc_html__('Description', 'october-events') . '</span><textarea name="oe_event[description]" rows="4">' . esc_textarea($g('description')) . '</textarea></label>'
            . $field('start_datetime', __('Start (YYYY-MM-DD HH:MM)', 'october-events'), $g('start_datetime'))
            . $field('end_datetime', __('End (YYYY-MM-DD HH:MM)', 'october-events'), $g('end_datetime'))
            . $field('location', __('Location', 'october-events'), $g('location'))
            . $field('price', __('Display price', 'october-events'), $g('price'))
            . '<div class="oe-form__actions"><button type="submit" class="oe-btn">' . esc_html__('Save activity', 'october-events') . '</button></div>'
            . '</form></div>';
    }

    private static function tab_account(\WP_User $user): string {
        $out = '';
        if (isset($_GET['oe_saved'])) {
            $out .= self::flash(__('Your details have been updated.', 'october-events'));
        }
        $action = esc_url(admin_url('admin-post.php'));
        $nonce  = wp_create_nonce(self::SAVE_ACCOUNT);
        $out .= '<div class="oe-card" style="max-width:520px"><div class="oe-card__title">' . esc_html__('Account', 'october-events') . '</div>'
            . '<form class="oe-form" method="post" action="' . $action . '">'
            . '<input type="hidden" name="action" value="' . esc_attr(self::SAVE_ACCOUNT) . '">'
            . '<input type="hidden" name="_oe_nonce" value="' . esc_attr($nonce) . '">'
            . '<label class="oe-field"><span>' . esc_html__('Name', 'october-events') . '</span><input type="text" name="display_name" value="' . esc_attr($user->display_name) . '" required></label>'
            . '<label class="oe-field"><span>' . esc_html__('Email', 'october-events') . '</span><input type="email" name="user_email" value="' . esc_attr($user->user_email) . '" required></label>'
            . '<label class="oe-field"><span>' . esc_html__('New password (leave blank to keep)', 'october-events') . '</span><input type="password" name="new_password" autocomplete="new-password" value=""></label>'
            . '<div class="oe-form__actions"><button type="submit" class="oe-btn">' . esc_html__('Save', 'october-events') . '</button></div>'
            . '</form></div>';
        return $out;
    }

    /* ---- data + handlers -------------------------------------------------- */

    /** @return \WP_Post[] the current partner's own events, newest first. */
    private static function own_events(int $uid): array {
        $pt = PostTypes::slug('event');
        if ($pt === '' || ! $uid) {
            return [];
        }
        return get_posts([
            'post_type'      => $pt,
            'author'         => $uid,
            'post_status'    => ['publish', 'pending', 'draft'],
            'posts_per_page' => 100,
            'orderby'        => 'date',
            'order'          => 'DESC',
        ]);
    }

    private static function owns(int $event_id, int $uid): bool {
        return $event_id > 0 && $uid > 0
            && get_post_type($event_id) === PostTypes::slug('event')
            && (int) get_post_field('post_author', $event_id) === $uid;
    }

    public static function save_event(): void {
        $uid = get_current_user_id();
        $nonce = isset($_POST['_oe_nonce']) ? sanitize_text_field(wp_unslash((string) $_POST['_oe_nonce'])) : '';
        if (! $uid || ! wp_verify_nonce($nonce, self::SAVE_EVENT)) {
            self::back('activities');
        }
        $event_id = isset($_POST['event_id']) ? (int) $_POST['event_id'] : 0;
        $input    = isset($_POST['oe_event']) && is_array($_POST['oe_event']) ? wp_unslash($_POST['oe_event']) : [];
        $name     = sanitize_text_field((string) ($input['name'] ?? ''));
        if ($name === '') {
            self::back('activities');
        }

        if ($event_id) {
            // Edit: ownership-guarded, stays pending for re-approval.
            if (! self::owns($event_id, $uid)) {
                self::back('activities');
            }
            wp_update_post(['ID' => $event_id, 'post_title' => $name, 'post_status' => 'pending']);
        } else {
            // Create: authored by the partner, pending approval.
            $event_id = (int) wp_insert_post([
                'post_type'   => PostTypes::slug('event'),
                'post_title'  => $name,
                'post_status' => 'pending',
                'post_author' => $uid,
            ]);
            if (! $event_id) {
                self::back('activities');
            }
        }
        Events::save_fields($event_id, $input);
        self::back('activities', true);
    }

    public static function save_account(): void {
        $uid = get_current_user_id();
        $nonce = isset($_POST['_oe_nonce']) ? sanitize_text_field(wp_unslash((string) $_POST['_oe_nonce'])) : '';
        if (! $uid || ! wp_verify_nonce($nonce, self::SAVE_ACCOUNT)) {
            self::back('account');
        }
        $data = ['ID' => $uid];
        $name = sanitize_text_field(wp_unslash((string) ($_POST['display_name'] ?? '')));
        if ($name !== '') {
            $data['display_name'] = $name;
        }
        $email = sanitize_email(wp_unslash((string) ($_POST['user_email'] ?? '')));
        if ($email !== '' && is_email($email)) {
            $data['user_email'] = $email;
        }
        $pass = (string) ($_POST['new_password'] ?? '');
        if ($pass !== '') {
            $data['user_pass'] = $pass;
        }
        wp_update_user($data);
        self::back('account', true);
    }

    private static function back(string $tab, bool $saved = false): void {
        $url = add_query_arg('oe_tab', $tab, (string) wp_get_referer() ?: home_url('/'));
        $url = remove_query_arg(['oe_edit', 'oe_new'], $url);
        if ($saved) {
            $url = add_query_arg('oe_saved', '1', $url);
        }
        wp_safe_redirect($url);
        exit;
    }
}
