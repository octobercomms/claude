<?php
declare(strict_types=1);

namespace OE\Frontend;

use OE\Mail\Contacts;
use OE\Sections\Theme;

defined('ABSPATH') || exit;

/**
 * Attendee email preferences (FRONTEND-BUILD slice I).
 *
 * `[oe_email_preferences]` — a logged-in attendee opts their own email in or out
 * of the marketing list, wired to the Contacts engine. Rendered inside the
 * account dashboard's Account tab, and usable standalone. Transactional email
 * (receipts, ticket and volunteer messages) is unaffected; this governs the
 * marketing subscription only.
 */
final class EmailPreferences {

    private const ACTION = 'oe_email_prefs';

    public static function init(): void {
        add_shortcode('oe_email_preferences', [self::class, 'render']);
        add_action('admin_post_' . self::ACTION, [self::class, 'save']);
    }

    public static function render(): string {
        if (! is_user_logged_in()) {
            return '';
        }
        Theme::enqueue();
        TeamPortal::register();
        wp_enqueue_style(TeamPortal::HANDLE);

        $email      = (string) wp_get_current_user()->user_email;
        $contact    = $email !== '' ? Contacts::get($email) : null;
        $subscribed = $contact && (string) $contact->status === Contacts::STATUS_SUBSCRIBED;

        $flash = '';
        if (isset($_GET['oe_prefs']) && $_GET['oe_prefs'] === 'saved') {
            $flash = '<p class="oe-staff__msg oe-staff__msg--ok">' . esc_html__('Your email preferences have been saved.', 'october-events') . '</p>';
        }

        $action = esc_url(admin_url('admin-post.php'));
        $nonce  = wp_create_nonce(self::ACTION);

        return '<div class="oe-card" style="max-width:520px"><div class="oe-card__title">' . esc_html__('Email preferences', 'october-events') . '</div>'
            . $flash
            . '<form method="post" action="' . $action . '">'
            . '<input type="hidden" name="action" value="' . esc_attr(self::ACTION) . '">'
            . '<input type="hidden" name="_oe_nonce" value="' . esc_attr($nonce) . '">'
            . '<label style="display:flex;gap:.6rem;align-items:flex-start;font-size:.95rem">'
            . '<input type="checkbox" name="subscribe" value="1"' . checked($subscribed, true, false) . '>'
            . '<span>' . esc_html(sprintf(__('Send news and event updates to %s. You can opt out any time.', 'october-events'), $email)) . '</span>'
            . '</label>'
            . '<p style="margin-top:1rem"><button type="submit" class="oe-btn">' . esc_html__('Save preferences', 'october-events') . '</button></p>'
            . '</form></div>';
    }

    public static function save(): void {
        $uid   = get_current_user_id();
        $nonce = isset($_POST['_oe_nonce']) ? sanitize_text_field(wp_unslash((string) $_POST['_oe_nonce'])) : '';
        if (! $uid || ! wp_verify_nonce($nonce, self::ACTION)) {
            self::back();
        }
        $email = (string) wp_get_current_user()->user_email;
        if ($email === '' || ! is_email($email)) {
            self::back();
        }
        $want = ! empty($_POST['subscribe']);
        if ($want) {
            // Resubscribe an existing contact, or capture a new subscribed one.
            if (Contacts::get($email)) {
                Contacts::resubscribe($email);
            } else {
                Contacts::capture($email, ['name' => (string) wp_get_current_user()->display_name, 'source' => 'account']);
            }
        } else {
            Contacts::unsubscribe($email);
        }
        self::back(true);
    }

    private static function back(bool $saved = false): void {
        $url = (string) wp_get_referer() ?: home_url('/');
        if ($saved) {
            $url = add_query_arg('oe_prefs', 'saved', $url);
        }
        wp_safe_redirect($url);
        exit;
    }
}
