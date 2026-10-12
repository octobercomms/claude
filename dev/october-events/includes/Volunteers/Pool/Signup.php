<?php
declare(strict_types=1);

namespace OE\Volunteers\Pool;

use OE\Features;
use OE\Mail\Contacts;

defined('ABSPATH') || exit;

/**
 * Public volunteer-pool registration (volunteer-pool.md step 2). A home-agnostic
 * "I want to volunteer this year" form: contact + zipcode + the window×roles the
 * person can do (at least one required). Stored in the pool table and captured
 * into the contact list; deduped on email so a repeat submit updates in place.
 *
 *   [oe_volunteer_pool_signup]
 *
 * No login required. The form posts to admin-post with a nonce; success redirects
 * back to the page with a flag so the thank-you shows without JavaScript.
 */
final class Signup {

    private const NONCE = 'oe_vol_pool_signup';

    public static function init(): void {
        add_shortcode('oe_volunteer_pool_signup', [self::class, 'render']);
        add_action('admin_post_nopriv_oe_vol_pool_signup', [self::class, 'handle']);
        add_action('admin_post_oe_vol_pool_signup', [self::class, 'handle']);
    }

    public static function render($atts = []): string {
        if (! Features::enabled('volunteers')) {
            return '';
        }
        $windows = Windows::active();
        if (! $windows) {
            return '<div class="oe-vpool"><p>' . esc_html__('Volunteer registration isn\'t open yet. Please check back soon.', 'october-events') . '</p></div>';
        }

        if (isset($_GET['oe_vpool']) && $_GET['oe_vpool'] === 'ok') {
            return '<div class="oe-vpool oe-vpool--done"><p>' . esc_html__('Thank you — you\'re on the list. We\'ll be in touch when the homes and events are confirmed so you can pick your slot.', 'october-events') . '</p></div>';
        }

        $action = esc_url(admin_url('admin-post.php'));

        ob_start();
        echo '<form class="oe-vpool" method="post" action="' . $action . '" style="display:grid;gap:1rem;max-width:560px">';
        echo '<input type="hidden" name="action" value="oe_vol_pool_signup">';
        wp_nonce_field(self::NONCE, self::NONCE);
        echo '<input type="hidden" name="return" value="' . esc_attr((string) self::current_url()) . '">';

        self::field('name', __('Your name', 'october-events'), 'text', true);
        self::field('email', __('Email', 'october-events'), 'email', true);
        self::field('phone', __('Phone', 'october-events'), 'tel', false);
        self::field('zip', __('Home ZIP / postcode', 'october-events'), 'text', true, __('So we can match you to the nearest homes.', 'october-events'));

        echo '<fieldset style="border:1px solid #ddd;border-radius:6px;padding:12px 14px"><legend style="font-weight:700">' . esc_html__('When can you help? Tick every slot that works.', 'october-events') . '</legend>';
        foreach ($windows as $w) {
            printf(
                '<label style="display:block;margin:4px 0"><input type="checkbox" name="windows[]" value="%s"> %s</label>',
                esc_attr((string) $w['id']),
                esc_html((string) $w['label'])
            );
        }
        echo '</fieldset>';

        self::field('travel', __('Willing to travel (optional)', 'october-events'), 'text', false, __('e.g. up to 10 miles', 'october-events'));
        echo '<p><label style="font-weight:600;display:block;margin-bottom:4px">' . esc_html__('Anything else? (optional)', 'october-events') . '</label>';
        echo '<textarea name="notes" style="width:100%;min-height:70px"></textarea></p>';

        echo '<p><button type="submit" class="oe-btn">' . esc_html__('Register as a volunteer', 'october-events') . '</button></p>';
        echo '</form>';
        return (string) ob_get_clean();
    }

    private static function field(string $name, string $label, string $type, bool $required, string $hint = ''): void {
        printf(
            '<p><label style="font-weight:600;display:block;margin-bottom:4px">%s%s</label><input type="%s" name="%s"%s style="width:100%%">%s</p>',
            esc_html($label),
            $required ? ' <span style="color:#c62828">*</span>' : '',
            esc_attr($type),
            esc_attr($name),
            $required ? ' required' : '',
            $hint !== '' ? '<span style="display:block;color:#777;font-size:.85em;margin-top:2px">' . esc_html($hint) . '</span>' : ''
        );
    }

    public static function handle(): void {
        $nonce = isset($_POST[self::NONCE]) ? sanitize_text_field(wp_unslash((string) $_POST[self::NONCE])) : '';
        if ($nonce === '' || ! wp_verify_nonce($nonce, self::NONCE)) {
            wp_die(esc_html__('Your session expired. Please go back and try again.', 'october-events'), '', ['response' => 403]);
        }
        $return = esc_url_raw((string) wp_unslash($_POST['return'] ?? ''));
        if ($return === '' || wp_parse_url($return, PHP_URL_HOST) !== wp_parse_url(home_url(), PHP_URL_HOST)) {
            $return = home_url('/');
        }

        $email = sanitize_email((string) wp_unslash($_POST['email'] ?? ''));
        $name  = sanitize_text_field((string) wp_unslash($_POST['name'] ?? ''));
        if (! is_email($email) || $name === '') {
            self::redirect($return, 'err');
        }

        $wanted = [];
        foreach ((array) ($_POST['windows'] ?? []) as $wid) {
            $wid = sanitize_text_field((string) $wid);
            if (Windows::exists($wid)) {
                $wanted[] = $wid;
            }
        }
        if (! $wanted) {
            self::redirect($return, 'err'); // at least one window required
        }

        self::save([
            'name'   => $name,
            'email'  => strtolower($email),
            'phone'  => sanitize_text_field((string) wp_unslash($_POST['phone'] ?? '')),
            'zip'    => sanitize_text_field((string) wp_unslash($_POST['zip'] ?? '')),
            'travel' => sanitize_text_field((string) wp_unslash($_POST['travel'] ?? '')),
            'notes'  => sanitize_textarea_field((string) wp_unslash($_POST['notes'] ?? '')),
            'windows' => $wanted,
        ]);

        Contacts::capture(strtolower($email), ['name' => $name, 'phone' => sanitize_text_field((string) wp_unslash($_POST['phone'] ?? '')), 'source' => 'volunteer_pool']);

        self::redirect($return, 'ok');
    }

    /** Insert or update (dedupe on email) a pool registration. */
    public static function save(array $d): int {
        global $wpdb;
        $t   = Schema::table();
        $now = current_time('mysql');
        $row = [
            'name'       => (string) $d['name'],
            'email'      => (string) $d['email'],
            'phone'      => (string) ($d['phone'] ?? ''),
            'zip'        => (string) ($d['zip'] ?? ''),
            'travel'     => (string) ($d['travel'] ?? ''),
            'notes'      => (string) ($d['notes'] ?? ''),
            'windows'    => wp_json_encode(array_values((array) ($d['windows'] ?? []))) ?: '[]',
            'updated_at' => $now,
        ];
        $existing = $wpdb->get_var($wpdb->prepare("SELECT id FROM {$t} WHERE email = %s", $row['email']));
        if ($existing) {
            $wpdb->update($t, $row, ['id' => (int) $existing]);
            return (int) $existing;
        }
        $row['status']     = 'registered';
        $row['token']      = substr(wp_generate_password(32, false), 0, 32);
        $row['created_at'] = $now;
        $wpdb->insert($t, $row);
        return (int) $wpdb->insert_id;
    }

    private static function redirect(string $url, string $flag): void {
        wp_safe_redirect(add_query_arg('oe_vpool', $flag, $url));
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
