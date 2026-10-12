<?php
declare(strict_types=1);

namespace OE\Mail;

use OE\Settings;

defined('ABSPATH') || exit;

/**
 * Public marketing-list signup with configurable double opt-in (BUILD-PLAN M6).
 *
 *   [oe_subscribe]                       all manual lists shown as checkboxes
 *   [oe_subscribe lists="2,5"]           restrict to specific list ids
 *   [oe_subscribe heading="Stay in touch" button="Subscribe"]
 *
 * With double opt-in on (the default), a signup captures the contact as
 * `pending` and emails a confirm link; the chosen lists are held against the
 * token and applied only when they click. With it off, the signup subscribes
 * and joins the lists at once. Either way this is the marketing path only — the
 * transactional captures (ticket buyer, volunteer, account) are untouched.
 *
 * Lets a person pick which lists to join from one form (e.g. festival and/or
 * tours when both lists live on this install).
 */
final class Subscribe {

    private const NONCE = 'oe_subscribe';

    public static function init(): void {
        add_shortcode('oe_subscribe', [self::class, 'render']);
        add_action('admin_post_nopriv_oe_subscribe', [self::class, 'handle']);
        add_action('admin_post_oe_subscribe', [self::class, 'handle']);
        add_action('template_redirect', [self::class, 'maybe_confirm']);
    }

    /** @param array<string,string>|string $atts */
    public static function render($atts): string {
        $a = shortcode_atts([
            'lists'   => '',
            'heading' => '',
            'button'  => __('Subscribe', 'october-events'),
        ], (array) $atts, 'oe_subscribe');

        $state = isset($_GET['oe_subscribed']) ? sanitize_key((string) $_GET['oe_subscribed']) : '';
        if ($state === 'pending') {
            return '<div class="oe-subscribe oe-subscribe--pending"><p>' . esc_html__('Almost there — check your inbox and click the link to confirm your subscription.', 'october-events') . '</p></div>';
        }
        if ($state === 'ok') {
            return '<div class="oe-subscribe oe-subscribe--ok"><p>' . esc_html__('You\'re subscribed. Thank you!', 'october-events') . '</p></div>';
        }
        if ($state === 'confirmed') {
            return '<div class="oe-subscribe oe-subscribe--ok"><p>' . esc_html__('Your subscription is confirmed. Thank you!', 'october-events') . '</p></div>';
        }

        $lists = self::offer_lists((string) $a['lists']);

        ob_start();
        echo '<form class="oe-subscribe" method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="display:grid;gap:.75rem;max-width:460px">';
        echo '<input type="hidden" name="action" value="oe_subscribe">';
        wp_nonce_field(self::NONCE, self::NONCE);
        echo '<input type="hidden" name="return" value="' . esc_attr((string) self::current_url()) . '">';
        if ((string) $a['heading'] !== '') {
            echo '<h3 class="oe-subscribe__heading" style="margin:0">' . esc_html((string) $a['heading']) . '</h3>';
        }
        echo '<p style="margin:0"><label><input type="text" name="name" placeholder="' . esc_attr__('Your name (optional)', 'october-events') . '" style="width:100%"></label></p>';
        echo '<p style="margin:0"><label><input type="email" name="email" required placeholder="' . esc_attr__('Email address', 'october-events') . '" style="width:100%"></label></p>';

        if (count($lists) > 1) {
            echo '<fieldset style="border:1px solid #ddd;border-radius:6px;padding:8px 10px"><legend>' . esc_html__('What would you like to hear about?', 'october-events') . '</legend>';
            foreach ($lists as $l) {
                printf(
                    '<label style="display:block;margin:2px 0"><input type="checkbox" name="lists[]" value="%d" checked> %s</label>',
                    (int) $l->id,
                    esc_html((string) $l->name)
                );
            }
            echo '</fieldset>';
        } elseif (count($lists) === 1) {
            echo '<input type="hidden" name="lists[]" value="' . esc_attr((string) $lists[0]->id) . '">';
        }

        echo '<p style="margin:0"><button type="submit" class="oe-btn">' . esc_html((string) $a['button']) . '</button></p>';
        echo '</form>';
        return (string) ob_get_clean();
    }

    /** The manual lists offered on the form (all, or a restricted set). */
    private static function offer_lists(string $restrict): array {
        $all = Lists::all();
        $all = array_values(array_filter($all, static fn($l): bool => (string) ($l->type ?? 'manual') === 'manual'));
        $restrict = trim($restrict);
        if ($restrict === '') {
            return $all;
        }
        $ids = array_filter(array_map('intval', preg_split('/[\s,]+/', $restrict) ?: []));
        return array_values(array_filter($all, static fn($l): bool => in_array((int) $l->id, $ids, true)));
    }

    public static function handle(): void {
        $nonce = isset($_POST[self::NONCE]) ? sanitize_text_field(wp_unslash((string) $_POST[self::NONCE])) : '';
        if ($nonce === '' || ! wp_verify_nonce($nonce, self::NONCE)) {
            wp_die(esc_html__('Your session expired. Please go back and try again.', 'october-events'), '', ['response' => 403]);
        }
        $return = self::safe_return((string) wp_unslash($_POST['return'] ?? ''));
        $email  = sanitize_email((string) wp_unslash($_POST['email'] ?? ''));
        $name   = sanitize_text_field((string) wp_unslash($_POST['name'] ?? ''));
        if (! is_email($email)) {
            self::redirect($return, 'err');
        }

        $list_ids = array_values(array_filter(array_map('intval', (array) ($_POST['lists'] ?? []))));
        // Only accept ids that are real manual lists.
        $valid = array_map(static fn($l): int => (int) $l->id, self::offer_lists(''));
        $list_ids = array_values(array_intersect($list_ids, $valid));

        if (! self::double_optin()) {
            $cid = Contacts::capture($email, ['name' => $name, 'source' => 'subscribe']);
            if ($cid > 0) {
                Contacts::resubscribe($email); // a subscribe intent clears a prior unsub
                self::join_lists($cid, $list_ids);
            }
            self::redirect($return, 'ok');
        }

        $res = Contacts::start_confirmation($email, ['name' => $name, 'source' => 'subscribe']);
        if (($res['id'] ?? 0) <= 0) {
            self::redirect($return, 'err');
        }
        if (! empty($res['already'])) {
            // Already a confirmed subscriber — just apply any new list choices.
            self::join_lists((int) $res['id'], $list_ids);
            self::redirect($return, 'ok');
        }
        // Hold the chosen lists against the token until they confirm.
        if ($list_ids) {
            set_transient('oe_sub_lists_' . $res['token'], $list_ids, DAY_IN_SECONDS * 3);
        }
        self::send_confirm($email, $name, (string) $res['token'], $return);
        self::redirect($return, 'pending');
    }

    /** The confirm-link handler (template_redirect on ?oe_confirm=token). */
    public static function maybe_confirm(): void {
        if (! isset($_GET['oe_confirm'])) {
            return;
        }
        $token   = sanitize_text_field((string) wp_unslash($_GET['oe_confirm']));
        $contact = Contacts::confirm($token);
        $return  = self::safe_return((string) wp_unslash($_GET['r'] ?? ''));
        if ($contact) {
            $lists = get_transient('oe_sub_lists_' . $token);
            if (is_array($lists)) {
                self::join_lists((int) $contact->id, array_map('intval', $lists));
                delete_transient('oe_sub_lists_' . $token);
            }
            self::redirect($return, 'confirmed');
        }
        self::redirect($return, 'err');
    }

    private static function join_lists(int $contact_id, array $list_ids): void {
        foreach ($list_ids as $lid) {
            if ($lid > 0) {
                Lists::add_contact($lid, $contact_id);
            }
        }
    }

    private static function send_confirm(string $email, string $name, string $token, string $return): void {
        $link = add_query_arg(
            ['oe_confirm' => rawurlencode($token), 'r' => rawurlencode($return)],
            home_url('/')
        );
        Transactional::send('subscribe_confirm', ['email' => $email, 'name' => $name], [
            'contact_name' => $name,
            'confirm_url'  => $link,
        ]);
    }

    private static function double_optin(): bool {
        return (bool) Settings::get('double_optin', true);
    }

    private static function safe_return(string $url): string {
        $url = esc_url_raw($url);
        if ($url === '' || wp_parse_url($url, PHP_URL_HOST) !== wp_parse_url(home_url(), PHP_URL_HOST)) {
            return home_url('/');
        }
        return $url;
    }

    private static function redirect(string $url, string $flag): void {
        wp_safe_redirect(add_query_arg('oe_subscribed', $flag, $url));
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
