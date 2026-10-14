<?php
declare(strict_types=1);

namespace OE\Frontend;

use OE\Demographics\Store;
use OE\Sections\Theme;

defined('ABSPATH') || exit;

/**
 * Consent-gated demographics capture (ROADMAP R2, §11 phase B, safe variant).
 *
 * `[oe_demographics]` renders an optional survey for the SIGNED-IN person only,
 * pre-filled from their own account (never from anyone else's — the data is
 * account-backed, so there is no un-authenticated read path and no PII leak).
 * Honest copy, explicit consent, and a quiet Skip; no dark pattern. Logged-out
 * visitors see a short sign-in prompt, not the form.
 */
final class Demographics {

    private const SAVE = 'oe_save_demographics';

    public static function init(): void {
        add_shortcode('oe_demographics', [self::class, 'render']);
        add_action('admin_post_' . self::SAVE, [self::class, 'save']);
    }

    public static function render(): string {
        Theme::enqueue();
        if (! is_user_logged_in()) {
            $login = wp_login_url((string) get_permalink());
            return '<div class="oe-sec oe-demo"><p>' . esc_html__('Sign in to add or update your details.', 'october-events')
                . ' <a class="oe-btn" href="' . esc_url($login) . '">' . esc_html__('Sign in', 'october-events') . '</a></p></div>';
        }
        $uid   = get_current_user_id();
        $saved = Store::get((int) $uid);
        $fields = Store::fields();

        $out = '<div class="oe-sec oe-demo">';
        if (isset($_GET['oe_demo']) && $_GET['oe_demo'] === 'saved') {
            $out .= '<p class="oe-demo__ok">' . esc_html__('Thanks — your details are saved.', 'october-events') . '</p>';
        } elseif (isset($_GET['oe_demo']) && $_GET['oe_demo'] === 'skipped') {
            $out .= '<p class="oe-demo__ok">' . esc_html__('No problem — skipped.', 'october-events') . '</p>';
        }
        $out .= '<h2>' . esc_html__('A little about you (optional)', 'october-events') . '</h2>'
            . '<p class="oe-demo__intro">' . esc_html__('This helps us shape the program. It is entirely optional, never shared, and you can clear it any time.', 'october-events') . '</p>';

        $action = esc_url(admin_url('admin-post.php'));
        $out .= '<form class="oe-demo__form" method="post" action="' . $action . '">'
            . '<input type="hidden" name="action" value="' . esc_attr(self::SAVE) . '">'
            . wp_nonce_field(self::SAVE, '_oe_nonce', true, false);

        foreach ($fields as $field => $spec) {
            $cur = (string) ($saved[$field] ?? '');
            $out .= '<label class="oe-demo__field"><span>' . esc_html($spec['label']) . '</span><select name="' . esc_attr($field) . '">';
            $out .= '<option value="">' . esc_html__('—', 'october-events') . '</option>';
            foreach ($spec['options'] as $ov => $ol) {
                $out .= '<option value="' . esc_attr($ov) . '"' . selected($cur, $ov, false) . '>' . esc_html($ol) . '</option>';
            }
            $out .= '</select></label>';
        }

        $consent = Store::has_consent((int) $uid);
        $out .= '<label class="oe-demo__consent"><input type="checkbox" name="consent" value="1"' . checked($consent, true, false) . '> '
            . esc_html__('I agree to October storing these details to understand its audience. Unticking and saving clears them.', 'october-events') . '</label>';

        $out .= '<div class="oe-demo__actions">'
            . '<button type="submit" class="oe-btn">' . esc_html__('Save', 'october-events') . '</button>'
            . '<button type="submit" name="skip" value="1" class="oe-demo__skip">' . esc_html__('Skip', 'october-events') . '</button>'
            . '</div></form></div>';
        return $out;
    }

    public static function save(): void {
        if (! is_user_logged_in()) {
            wp_safe_redirect(home_url('/'));
            exit;
        }
        $nonce = isset($_POST['_oe_nonce']) ? sanitize_text_field(wp_unslash((string) $_POST['_oe_nonce'])) : '';
        $uid   = get_current_user_id();
        $back  = wp_get_referer() ?: home_url('/');
        if ($nonce === '' || ! wp_verify_nonce($nonce, self::SAVE) || ! $uid) {
            wp_safe_redirect($back);
            exit;
        }
        if (! empty($_POST['skip'])) {
            wp_safe_redirect(add_query_arg('oe_demo', 'skipped', $back));
            exit;
        }
        $data = [];
        foreach (array_keys(Store::fields()) as $field) {
            $data[$field] = sanitize_key((string) wp_unslash($_POST[$field] ?? ''));
        }
        Store::save((int) $uid, $data, ! empty($_POST['consent']));
        wp_safe_redirect(add_query_arg('oe_demo', 'saved', $back));
        exit;
    }
}
