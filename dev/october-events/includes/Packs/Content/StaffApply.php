<?php
declare(strict_types=1);

namespace OE\Packs\Content;

use OE\PostTypes;

defined('ABSPATH') || exit;

/**
 * Staff pack apply-by-email handler (FRONTEND-BUILD slice E).
 *
 * Renders the per-role application form and handles the submission via
 * admin-post (logged-in and logged-out), emailing the role's application
 * address (falling back to the event author, then the site admin) with a
 * reply-to of the applicant. A honeypot drops bots silently. Mail routes through
 * wp_mail, so it uses the plugin's configured transport (SES -> Brevo).
 */
final class StaffApply {

    private const ACTION = 'oe_staff_apply';

    public static function init(): void {
        add_action('admin_post_' . self::ACTION, [self::class, 'submit']);
        add_action('admin_post_nopriv_' . self::ACTION, [self::class, 'submit']);
    }

    /** The inline application form for one role. */
    public static function form(int $event_id, int $index, string $role): string {
        $action = esc_url(admin_url('admin-post.php'));
        $nonce  = wp_create_nonce(self::ACTION . '_' . $event_id);
        return '<form class="oe-staff__form" method="post" action="' . $action . '">'
            . '<input type="hidden" name="action" value="' . esc_attr(self::ACTION) . '">'
            . '<input type="hidden" name="event_id" value="' . esc_attr((string) $event_id) . '">'
            . '<input type="hidden" name="role_index" value="' . esc_attr((string) $index) . '">'
            . '<input type="hidden" name="_oe_nonce" value="' . esc_attr($nonce) . '">'
            . '<input type="text" name="oe_hp" value="" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">'
            . '<input type="text" name="applicant_name" placeholder="' . esc_attr__('Your name', 'october-events') . '" required>'
            . '<input type="email" name="applicant_email" placeholder="' . esc_attr__('Your email', 'october-events') . '" required>'
            . '<button type="submit" class="oe-btn">' . esc_html(sprintf(__('Apply: %s', 'october-events'), $role)) . '</button>'
            . '</form>';
    }

    public static function submit(): void {
        $event_id = isset($_POST['event_id']) ? (int) $_POST['event_id'] : 0;
        $nonce    = isset($_POST['_oe_nonce']) ? sanitize_text_field(wp_unslash((string) $_POST['_oe_nonce'])) : '';
        if (! $event_id || ! wp_verify_nonce($nonce, self::ACTION . '_' . $event_id)) {
            self::redirect($event_id, 'error');
        }
        if (get_post_type($event_id) !== PostTypes::slug('event')) {
            self::redirect($event_id, 'error');
        }
        // Honeypot: a filled hidden field is a bot. Pretend success, send nothing.
        if (trim((string) ($_POST['oe_hp'] ?? '')) !== '') {
            self::redirect($event_id, 'sent');
        }

        $name  = sanitize_text_field(wp_unslash((string) ($_POST['applicant_name'] ?? '')));
        $email = sanitize_email(wp_unslash((string) ($_POST['applicant_email'] ?? '')));
        $index = isset($_POST['role_index']) ? (int) $_POST['role_index'] : 0;
        if ($name === '' || ! is_email($email)) {
            self::redirect($event_id, 'error');
        }

        $roles = Store::get($event_id, 'staff', 'roles');
        $row   = $roles[$index] ?? null;
        $role  = is_array($row) ? trim((string) ($row['role'] ?? '')) : '';
        if ($role === '') {
            self::redirect($event_id, 'error');
        }

        $to = is_array($row) ? sanitize_email((string) ($row['apply_email'] ?? '')) : '';
        if (! is_email($to)) {
            $author = (int) get_post_field('post_author', $event_id);
            $to     = $author ? (string) get_the_author_meta('user_email', $author) : '';
        }
        if (! is_email($to)) {
            $to = (string) get_option('admin_email');
        }

        $title   = get_the_title($event_id);
        $subject = sprintf(__('Role application: %1$s — %2$s', 'october-events'), $role, $title);
        $body    = sprintf(
            /* translators: 1: role, 2: event, 3: name, 4: email */
            __("New application for \"%1\$s\" on \"%2\$s\".\n\nName: %3\$s\nEmail: %4\$s", 'october-events'),
            $role,
            $title,
            $name,
            $email
        );
        $headers = ['Reply-To: ' . $name . ' <' . $email . '>'];
        $sent    = wp_mail($to, $subject, $body, $headers);

        self::redirect($event_id, $sent ? 'sent' : 'error');
    }

    private static function redirect(int $event_id, string $status): void {
        $url = $event_id ? get_permalink($event_id) : home_url('/');
        $url = add_query_arg('oe_staff', $status, (string) $url) . '#staff';
        wp_safe_redirect($url);
        exit;
    }
}
