<?php
declare(strict_types=1);

namespace OE\Volunteers\Pool;

use OE\Features;
use OE\Mail\Transactional;
use OE\Volunteers;

defined('ABSPATH') || exit;

/**
 * Invite-to-pick + switch (volunteer-pool.md steps 3/4, the slice Daniel kept).
 *
 * Once homes/events are confirmed as volunteer opportunities and their shifts
 * are tagged with a recruitment window, the pool is invited to choose a slot.
 * `[oe_volunteer_pick]` (reached via the no-login token link in the invite)
 * shows the open shifts in the windows that person ticked, grouped by window and
 * ordered most-need-first so homes fill evenly; they pick one, which books them
 * through the normal signup. Already-booked, they can switch to a different home
 * in a window they ticked (reusing Volunteers::move()). No auto-assign and no
 * cover pool — people always choose.
 */
final class Allocate {

    private const NONCE = 'oe_vol_pick';

    public static function init(): void {
        add_shortcode('oe_volunteer_pick', [self::class, 'render']);
        add_action('admin_post_nopriv_oe_vol_pick', [self::class, 'handle']);
        add_action('admin_post_oe_vol_pick', [self::class, 'handle']);
        add_action('admin_post_oe_vol_pool_invite', [self::class, 'invite_action']);
    }

    /** Admin action: email the pool their pick links (confirm-gated on the Board). */
    public static function invite_action(): void {
        if (! current_user_can('manage_options') || ! check_admin_referer('oe_vol_pool_invite')) {
            wp_die(esc_html__('Not allowed.', 'october-events'), '', ['response' => 403]);
        }
        $page = esc_url_raw((string) \OE\Settings::get('volunteer_pick_page', ''));
        $sent = ($page !== '') ? self::invite($page) : 0;
        wp_safe_redirect(add_query_arg('oe_pool_invited', $sent, admin_url('admin.php?page=oe-volunteer-pool')));
        exit;
    }

    /* ------------------------------------------------------------------ *
     * Candidate shifts
     * ------------------------------------------------------------------ */

    /**
     * Open shifts across all opportunities whose window is one of `$windows`,
     * grouped by window id and ordered within a window by spots-left descending
     * (most need first → even fill). Each entry: opportunity_id, title, shift.
     *
     * @param string[] $windows
     * @return array<string,array<int,array<string,mixed>>>
     */
    public static function candidates(array $windows): array {
        $windows = array_values(array_filter(array_map('strval', $windows)));
        if (! $windows) {
            return [];
        }
        $opp_pt = Volunteers::slug();
        $ids = get_posts([
            'post_type'      => $opp_pt,
            'post_status'    => 'publish',
            'posts_per_page' => 500,
            'fields'         => 'ids',
        ]);
        $byWindow = [];
        foreach ($ids as $oid) {
            $oid = (int) $oid;
            if (get_post_meta($oid, '_oe_signups_open', true) === '0') {
                continue;
            }
            foreach (Volunteers::shifts($oid) as $shift) {
                $win = (string) ($shift['window'] ?? '');
                if ($win === '' || ! in_array($win, $windows, true)) {
                    continue;
                }
                $left = Volunteers::spots_left($oid, (string) $shift['id']);
                if ($left <= 0) {
                    continue;
                }
                $byWindow[$win][] = [
                    'opportunity_id' => $oid,
                    'title'          => (string) (get_the_title($oid) ?: __('Opportunity', 'october-events')),
                    'shift'          => $shift,
                    'spots_left'     => $left,
                ];
            }
        }
        foreach ($byWindow as &$list) {
            usort($list, static fn($a, $b): int => $b['spots_left'] <=> $a['spots_left']);
        }
        unset($list);
        return $byWindow;
    }

    /* ------------------------------------------------------------------ *
     * Front end
     * ------------------------------------------------------------------ */

    public static function render($atts = []): string {
        if (! Features::enabled('volunteers')) {
            return '';
        }
        $token = isset($_GET['oe_vp']) ? sanitize_text_field((string) wp_unslash($_GET['oe_vp'])) : '';
        $person = self::by_token($token);
        if (! $person) {
            return '<div class="oe-vpick"><p>' . esc_html__('This link is no longer valid. Please get in touch and we\'ll sort it out.', 'october-events') . '</p></div>';
        }

        $state = isset($_GET['oe_vp_done']) ? sanitize_key((string) $_GET['oe_vp_done']) : '';
        $notice = '';
        if ($state === 'picked') {
            $notice = '<div class="oe-vpick__ok"><p>' . esc_html__('You\'re booked — thank you! We\'ve emailed your confirmation.', 'october-events') . '</p></div>';
        } elseif ($state === 'switched') {
            $notice = '<div class="oe-vpick__ok"><p>' . esc_html__('Done — we\'ve moved you to your new choice.', 'october-events') . '</p></div>';
        } elseif ($state === 'full') {
            $notice = '<div class="oe-vpick__err"><p>' . esc_html__('Sorry — someone just took the last spot there. Please pick another.', 'october-events') . '</p></div>';
        }

        $windows = self::person_windows($person);
        $current = self::current_signup($person);

        ob_start();
        echo '<div class="oe-vpick">';
        echo $notice;
        echo '<p>' . esc_html(sprintf(__('Hi %s — the homes are live. Choose the one you\'d like to help at.', 'october-events'), (string) $person->name)) . '</p>';

        if ($current) {
            $opp = (int) $current->opportunity_id;
            $sh  = Volunteers::shift($opp, (string) $current->shift_id);
            echo '<div class="oe-vpick__current" style="border:2px solid #111;border-radius:6px;padding:12px 14px;margin:0 0 16px">';
            echo '<strong>' . esc_html__('Your current choice', 'october-events') . ':</strong> ';
            echo esc_html((string) get_the_title($opp) . ($sh ? ' — ' . (string) $sh['label'] : ''));
            echo '<p class="description" style="margin:6px 0 0">' . esc_html__('Prefer a different home? Choose another below and we\'ll move you.', 'october-events') . '</p>';
            echo '</div>';
        }

        $cands = self::candidates($windows);
        if (! $cands) {
            echo '<p>' . esc_html__('There are no open homes in your chosen slots right now. We\'ll be in touch.', 'october-events') . '</p></div>';
            return (string) ob_get_clean();
        }

        $labels = [];
        foreach (Windows::all() as $w) {
            $labels[(string) $w['id']] = (string) $w['label'];
        }

        foreach ($cands as $win => $list) {
            echo '<h3 style="margin:18px 0 8px">' . esc_html($labels[$win] ?? __('Available', 'october-events')) . '</h3>';
            echo '<div style="display:grid;gap:10px">';
            foreach ($list as $c) {
                $sh = $c['shift'];
                $is_current = $current && (int) $current->opportunity_id === (int) $c['opportunity_id'] && (string) $current->shift_id === (string) $sh['id'];
                echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="display:flex;align-items:center;gap:12px;border:1px solid #ddd;border-radius:6px;padding:10px 12px">';
                echo '<input type="hidden" name="action" value="oe_vol_pick">';
                echo '<input type="hidden" name="token" value="' . esc_attr((string) $person->token) . '">';
                echo '<input type="hidden" name="opportunity" value="' . esc_attr((string) $c['opportunity_id']) . '">';
                echo '<input type="hidden" name="shift" value="' . esc_attr((string) $sh['id']) . '">';
                echo '<input type="hidden" name="return" value="' . esc_attr((string) self::current_url()) . '">';
                wp_nonce_field(self::NONCE, self::NONCE);
                echo '<span style="flex:1"><strong>' . esc_html((string) $c['title']) . '</strong>';
                if (! empty($sh['label'])) { echo '<br><span class="description">' . esc_html((string) $sh['label']) . '</span>'; }
                echo '</span>';
                echo '<span class="description" style="white-space:nowrap">' . esc_html(sprintf(_n('%d spot left', '%d spots left', (int) $c['spots_left'], 'october-events'), (int) $c['spots_left'])) . '</span>';
                if ($is_current) {
                    echo '<span class="oe-btn" style="opacity:.5;pointer-events:none">' . esc_html__('Your choice', 'october-events') . '</span>';
                } else {
                    echo '<button type="submit" class="oe-btn">' . ($current ? esc_html__('Move me here', 'october-events') : esc_html__('Choose this', 'october-events')) . '</button>';
                }
                echo '</form>';
            }
            echo '</div>';
        }
        echo '</div>';
        return (string) ob_get_clean();
    }

    public static function handle(): void {
        $nonce = isset($_POST[self::NONCE]) ? sanitize_text_field(wp_unslash((string) $_POST[self::NONCE])) : '';
        if ($nonce === '' || ! wp_verify_nonce($nonce, self::NONCE)) {
            wp_die(esc_html__('Your session expired. Please reopen the link from your email.', 'october-events'), '', ['response' => 403]);
        }
        $person = self::by_token((string) wp_unslash($_POST['token'] ?? ''));
        $return = self::safe_return((string) wp_unslash($_POST['return'] ?? ''));
        if (! $person) {
            wp_die(esc_html__('This link is no longer valid.', 'october-events'), '', ['response' => 403]);
        }
        $opp   = absint($_POST['opportunity'] ?? 0);
        $shift = sanitize_key((string) wp_unslash($_POST['shift'] ?? ''));

        // Guard: the shift must belong to a window this person actually ticked.
        $shift_meta = Volunteers::shift($opp, $shift);
        if (! $shift_meta || ! in_array((string) ($shift_meta['window'] ?? ''), self::person_windows($person), true)) {
            self::redirect($return, 'full');
        }

        $current = self::current_signup($person);
        if ($current) {
            $res = Volunteers::move((int) $current->id, $opp, $shift, true);
            if (is_wp_error($res)) {
                self::redirect($return, 'full');
            }
            self::set_signup($person, (int) $current->id);
            self::redirect($return, 'switched');
        }

        $res = Volunteers::signup($opp, $shift, [
            'name'  => (string) $person->name,
            'email' => (string) $person->email,
            'phone' => (string) $person->phone,
        ]);
        if (is_wp_error($res)) {
            self::redirect($return, 'full');
        }
        self::set_signup($person, (int) $res);
        self::redirect($return, 'picked');
    }

    /* ------------------------------------------------------------------ *
     * Invite
     * ------------------------------------------------------------------ */

    /**
     * Email every registered pool member their no-login pick link. Returns how
     * many were emailed. `$page` is the page carrying the [oe_volunteer_pick]
     * shortcode.
     */
    public static function invite(string $page_url): int {
        global $wpdb;
        $rows = $wpdb->get_results("SELECT * FROM " . Schema::table() . " WHERE status <> 'withdrawn' AND email <> ''") ?: [];
        $sent = 0;
        foreach ($rows as $r) {
            $link = add_query_arg('oe_vp', rawurlencode((string) $r->token), $page_url);
            $ok = Transactional::send('volunteer_pick_invite', ['email' => (string) $r->email, 'name' => (string) $r->name], [
                'name'     => (string) $r->name,
                'pick_url' => $link,
            ]);
            if ($ok) {
                $sent++;
            }
        }
        return $sent;
    }

    /* ------------------------------------------------------------------ *
     * Helpers
     * ------------------------------------------------------------------ */

    private static function by_token(string $token): ?object {
        $token = preg_replace('/[^A-Za-z0-9]/', '', $token) ?? '';
        if (strlen($token) < 10) {
            return null;
        }
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . Schema::table() . ' WHERE token = %s', $token)) ?: null;
    }

    /** @return string[] the window ids this person ticked at registration */
    private static function person_windows(object $person): array {
        $w = json_decode((string) ($person->windows ?? '[]'), true);
        return is_array($w) ? array_values(array_filter(array_map('strval', $w))) : [];
    }

    /** Their current live signup (from the stored signup_id), or null. */
    private static function current_signup(object $person): ?object {
        $sid = (int) ($person->signup_id ?? 0);
        if ($sid <= 0) {
            return null;
        }
        $s = \OE\VolunteerSignups::get($sid);
        if (! $s) {
            return null;
        }
        $live = in_array((string) $s->status, [\OE\VolunteerSignups::STATUS_PENDING, \OE\VolunteerSignups::STATUS_CONFIRMED], true);
        return $live ? $s : null;
    }

    private static function set_signup(object $person, int $signup_id): void {
        global $wpdb;
        $wpdb->update(Schema::table(), ['signup_id' => $signup_id, 'status' => 'picked', 'updated_at' => current_time('mysql')], ['id' => (int) $person->id]);
    }

    private static function safe_return(string $url): string {
        $url = esc_url_raw($url);
        if ($url === '' || wp_parse_url($url, PHP_URL_HOST) !== wp_parse_url(home_url(), PHP_URL_HOST)) {
            return home_url('/');
        }
        return $url;
    }

    private static function redirect(string $url, string $flag): void {
        wp_safe_redirect(add_query_arg('oe_vp_done', $flag, $url));
        exit;
    }

    private static function current_url(): string {
        $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
        $uri  = (string) ($_SERVER['REQUEST_URI'] ?? '/');
        if ($host === '') {
            return home_url('/');
        }
        return (is_ssl() ? 'https://' : 'http://') . $host . $uri;
    }
}
