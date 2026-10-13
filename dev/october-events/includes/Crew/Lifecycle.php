<?php
declare(strict_types=1);

namespace OE\Crew;

use OE\Mail\Transactional;
use OE\Settings;
use OE\Logger;

defined('ABSPATH') || exit;

/**
 * Planning-team lifecycle actions (CREW-MODULE §3, ADMIN-BUILD R5).
 *
 * Admin-triggered: send the role agreement, provision a role-scoped login
 * (always a set-your-own-password link, never an emailed password), send the
 * onboarding welcome, and offboard (revoke access). Public, no-login token
 * endpoints capture the agreement acceptance and the renewal accept / decline.
 *
 * All email goes through {@see Transactional::send()} so it uses the site's
 * configured transport (SES when on) and the branded wrapper.
 */
final class Lifecycle {

    public const ACT_AGREE = 'oe_crew_agree';  // public: accept the agreement
    public const ACT_RENEW = 'oe_crew_renew';  // public: renew / decline

    public static function init(): void {
        // Public token endpoints (logged-in and logged-out).
        add_action('admin_post_' . self::ACT_AGREE, [self::class, 'handle_agree']);
        add_action('admin_post_nopriv_' . self::ACT_AGREE, [self::class, 'handle_agree']);
        add_action('admin_post_' . self::ACT_RENEW, [self::class, 'handle_renew']);
        add_action('admin_post_nopriv_' . self::ACT_RENEW, [self::class, 'handle_renew']);
    }

    /* ------------------------------------------------- email: agreement -- */

    /** Send the role-agreement invite with a click-to-accept link. */
    public static function send_agreement(int $id): bool {
        $row = Crew::get($id);
        if (! $row || ! is_email((string) $row->email)) {
            return false;
        }
        $brand = (string) Settings::get('brand_name', 'October Events');
        $link  = self::token_url(self::ACT_AGREE, $row);
        $name  = (string) $row->name ?: __('there', 'october-events');
        $role  = (string) $row->role_title ?: __('your role', 'october-events');
        $term  = self::term_phrase($row);

        $html  = '<p>' . esc_html(sprintf(__('Hi %s,', 'october-events'), $name)) . '</p>'
            . '<p>' . esc_html(sprintf(__('We would like to confirm you as %1$s on the %2$s planning team%3$s.', 'october-events'), $role, $brand, $term !== '' ? ' ' . $term : '')) . '</p>'
            . '<p>' . esc_html__('This is a mutual commitment letter, not an employment contract. It sets out the role, the dates, the expected hours and the code of conduct. Please read it and click below to accept.', 'october-events') . '</p>';
        if ((string) $row->role_owns !== '') {
            $html .= '<p><strong>' . esc_html__('What the role owns:', 'october-events') . '</strong> ' . esc_html((string) $row->role_owns) . '</p>';
        }
        if ((string) $row->hours_month !== '') {
            $html .= '<p><strong>' . esc_html__('Expected hours:', 'october-events') . '</strong> ' . esc_html((string) $row->hours_month) . '</p>';
        }
        $html .= self::button($link, __('Read and accept the agreement', 'october-events'));

        return Transactional::send(
            'crew_agreement',
            ['email' => (string) $row->email, 'name' => (string) $row->name],
            [],
            sprintf(__('Your role agreement — %s', 'october-events'), $brand),
            $html
        );
    }

    /* ------------------------------------------------- login + onboard --- */

    /**
     * Provision a role-scoped login and email a set-your-own-password link plus
     * the onboarding brief. Finds an existing user by email or creates one; the
     * password is never generated for the person to receive, only a reset link.
     *
     * @return array{ok:bool,message:string}
     */
    public static function provision_login(int $id): array {
        $row = Crew::get($id);
        if (! $row || ! is_email((string) $row->email)) {
            return ['ok' => false, 'message' => __('A valid email is needed before a login can be created.', 'october-events')];
        }
        $email = (string) $row->email;
        $user  = get_user_by('email', $email);
        if (! $user) {
            $login = self::unique_login($email);
            $uid   = wp_insert_user([
                'user_login'   => $login,
                'user_email'   => $email,
                'display_name' => (string) $row->name ?: $login,
                'first_name'   => (string) $row->name,
                'user_pass'    => wp_generate_password(24, true, true),
                'role'         => 'subscriber',
            ]);
            if (is_wp_error($uid)) {
                return ['ok' => false, 'message' => $uid->get_error_message()];
            }
            $user = get_user_by('id', (int) $uid);
        }
        if (! $user) {
            return ['ok' => false, 'message' => __('Could not create or find the user account.', 'october-events')];
        }

        Crew::update($id, ['user_id' => (int) $user->ID]);

        // Set-your-own-password link (core reset flow). Never email a password.
        $key   = get_password_reset_key($user);
        $reset = is_wp_error($key)
            ? wp_login_url()
            : network_site_url("wp-login.php?action=rp&key={$key}&login=" . rawurlencode($user->user_login), 'login');

        $brand = (string) Settings::get('brand_name', 'October Events');
        $role  = (string) $row->role_title ?: __('your role', 'october-events');
        $html  = '<p>' . esc_html(sprintf(__('Hi %s,', 'october-events'), (string) $row->name ?: $user->display_name)) . '</p>'
            . '<p>' . esc_html(sprintf(__('Your %1$s login as %2$s is ready. Set your password with the link below. For security we never send passwords by email.', 'october-events'), $brand, $role)) . '</p>'
            . self::button($reset, __('Set your password', 'october-events'))
            . '<p><strong>' . esc_html__('Your username:', 'october-events') . '</strong> ' . esc_html($user->user_login) . '</p>';
        if ((string) $row->role_email !== '') {
            $html .= '<p><strong>' . esc_html__('Your role address:', 'october-events') . '</strong> ' . esc_html((string) $row->role_email)
                . '<br><span style="color:#555">' . esc_html__('Mail to this address forwards to your own inbox.', 'october-events') . '</span></p>';
        }

        $sent = Transactional::send(
            'crew_welcome',
            ['email' => $email, 'name' => (string) $row->name],
            [],
            sprintf(__('Welcome to the %s team', 'october-events'), $brand),
            $html
        );

        Logger::log(sprintf('Crew: provisioned login for %s (user #%d)', $email, (int) $user->ID));
        return ['ok' => $sent, 'message' => $sent
            ? __('Login provisioned and the set-password email sent.', 'october-events')
            : __('Login provisioned but the email could not be sent.', 'october-events')];
    }

    /* ------------------------------------------------- renewal prompt ---- */

    /** Email the renewal accept / decline prompt. $stage is '60' or '30'. */
    public static function send_renewal(int $id, string $stage): bool {
        $row = Crew::get($id);
        if (! $row || ! is_email((string) $row->email)) {
            return false;
        }
        $brand   = (string) Settings::get('brand_name', 'October Events');
        $role    = (string) $row->role_title ?: __('your role', 'october-events');
        $accept  = self::token_url(self::ACT_RENEW, $row, ['decision' => 'accept']);
        $decline = self::token_url(self::ACT_RENEW, $row, ['decision' => 'decline']);
        $ends    = $row->term_end ? date_i18n(get_option('date_format'), strtotime((string) $row->term_end)) : '';

        $html = '<p>' . esc_html(sprintf(__('Hi %s,', 'october-events'), (string) $row->name)) . '</p>'
            . '<p>' . esc_html(sprintf(__('Your term as %1$s with the %2$s team%3$s is coming to an end. Would you like to continue for another year?', 'october-events'), $role, $brand, $ends !== '' ? sprintf(__(' (ends %s)', 'october-events'), $ends) : '')) . '</p>'
            . self::button($accept, __('Yes, renew my role', 'october-events'))
            . '<p style="margin-top:12px">' . sprintf(
                /* translators: %s: decline link */
                esc_html__('If you would rather step down, %s and we will hand the role over. Thank you either way.', 'october-events'),
                '<a href="' . esc_url($decline) . '">' . esc_html__('let us know here', 'october-events') . '</a>'
            ) . '</p>';

        $sent = Transactional::send(
            'crew_renewal',
            ['email' => (string) $row->email, 'name' => (string) $row->name],
            [],
            sprintf(__('Renew your %s role?', 'october-events'), $brand),
            $html
        );
        if ($sent) {
            Crew::mark_renewing($id, $stage);
        }
        return $sent;
    }

    /* ------------------------------------------------- offboard ---------- */

    /**
     * Revoke access, thank the person, archive and reopen the role. Security
     * step: a departed coordinator must lose their login.
     */
    public static function offboard(int $id, bool $reopen = true): array {
        $row = Crew::get($id);
        if (! $row) {
            return ['ok' => false, 'message' => __('Record not found.', 'october-events')];
        }
        // Revoke the login's capabilities without deleting the account, and never
        // touch an administrator account.
        if ($row->user_id) {
            $user = get_user_by('id', (int) $row->user_id);
            if ($user && ! user_can($user, 'manage_options')) {
                $user->set_role('');
            }
        }
        $name  = (string) $row->name;
        $email = (string) $row->email;
        $brand = (string) Settings::get('brand_name', 'October Events');
        $role  = (string) $row->role_title ?: __('your role', 'october-events');

        if (is_email($email)) {
            $html = '<p>' . esc_html(sprintf(__('Hi %s,', 'october-events'), $name)) . '</p>'
                . '<p>' . esc_html(sprintf(__('Thank you for everything you gave as %1$s. Your %2$s login and role access have now been wound down. We would love to have you back any time.', 'october-events'), $role, $brand)) . '</p>';
            Transactional::send(
                'crew_offboard',
                ['email' => $email, 'name' => $name],
                [],
                sprintf(__('Thank you from the %s team', 'october-events'), $brand),
                $html
            );
        }

        Crew::mark_offboarded($id);
        if ($reopen) {
            Crew::reopen($id);
        }
        Logger::log(sprintf('Crew: offboarded %s (role: %s)', $email !== '' ? $email : $name, $role));
        return ['ok' => true, 'message' => __('Offboarded. Access revoked and the role reopened.', 'october-events')];
    }

    /* ------------------------------------------------- public endpoints -- */

    public static function handle_agree(): void {
        $row = self::verify_token();
        if (! $row) {
            self::page(__('Link expired', 'october-events'), __('This agreement link is no longer valid. Please ask your coordinator to resend it.', 'october-events'));
        }
        if (in_array((string) $row->status, [Crew::STATUS_INVITED], true)) {
            Crew::mark_agreed((int) $row->id);
        }
        $brand = (string) Settings::get('brand_name', 'October Events');
        self::page(
            __('Agreement accepted', 'october-events'),
            sprintf(__('Thank you. Your role agreement with the %s team is recorded. Your coordinator will be in touch with your login and next steps.', 'october-events'), $brand)
        );
    }

    public static function handle_renew(): void {
        $row = self::verify_token();
        if (! $row) {
            self::page(__('Link expired', 'october-events'), __('This renewal link is no longer valid. Please ask your coordinator to resend it.', 'october-events'));
        }
        $decision = isset($_GET['decision']) ? sanitize_key((string) $_GET['decision']) : '';
        $brand    = (string) Settings::get('brand_name', 'October Events');
        if ($decision === 'accept') {
            Crew::renew((int) $row->id);
            self::page(__('Role renewed', 'october-events'), sprintf(__('Thank you. Your role with the %s team is renewed for another year.', 'october-events'), $brand));
        }
        // Decline (or anything else) offboards and reopens the role.
        self::offboard((int) $row->id);
        self::page(__('Role handed over', 'october-events'), sprintf(__('Thank you for your time with the %s team. We have started the handover.', 'october-events'), $brand));
    }

    /* ------------------------------------------------- helpers ----------- */

    private static function verify_token(): ?object {
        $id    = isset($_GET['id']) ? (int) $_GET['id'] : 0;
        $token = isset($_GET['token']) ? sanitize_text_field(wp_unslash((string) $_GET['token'])) : '';
        if (! $id || $token === '') {
            return null;
        }
        $row = Crew::get($id);
        if (! $row || ! hash_equals((string) $row->token, $token)) {
            return null;
        }
        return $row;
    }

    private static function token_url(string $action, object $row, array $extra = []): string {
        $args = array_merge([
            'action' => $action,
            'id'     => (int) $row->id,
            'token'  => (string) $row->token,
        ], $extra);
        return add_query_arg($args, admin_url('admin-post.php'));
    }

    private static function term_phrase(object $row): string {
        $fmt = get_option('date_format');
        $s = $row->term_start ? date_i18n($fmt, strtotime((string) $row->term_start)) : '';
        $e = $row->term_end ? date_i18n($fmt, strtotime((string) $row->term_end)) : '';
        if ($s !== '' && $e !== '') {
            return sprintf(__('from %1$s to %2$s', 'october-events'), $s, $e);
        }
        return '';
    }

    private static function button(string $url, string $label): string {
        return '<p style="margin:22px 0"><a href="' . esc_url($url) . '" style="display:inline-block;background:#dd4b14;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">'
            . esc_html($label) . '</a></p>';
    }

    private static function unique_login(string $email): string {
        $base = sanitize_user(current(explode('@', $email)), true) ?: 'crew';
        $login = $base;
        $i = 1;
        while (username_exists($login)) {
            $login = $base . $i;
            $i++;
        }
        return $login;
    }

    /** Render a minimal branded confirmation page and exit. */
    private static function page(string $title, string $body): void {
        $brand = (string) Settings::get('brand_name', 'October Events');
        nocache_headers();
        status_header(200);
        header('Content-Type: text/html; charset=utf-8');
        echo '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            . '<title>' . esc_html($title) . ' — ' . esc_html($brand) . '</title>'
            . '<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#faf9f5;color:#1a1a1a;margin:0;padding:48px 16px}'
            . '.box{max-width:520px;margin:0 auto;background:#fff;border:2px solid #e3e2db;border-radius:14px;padding:32px}'
            . 'h1{font-size:22px;margin:0 0 12px}p{color:#555;line-height:1.55;margin:0 0 10px}'
            . '.b{color:#dd4b14;font-weight:700;letter-spacing:.02em;text-transform:uppercase;font-size:12px;margin:0 0 18px}</style></head><body>'
            . '<div class="box"><div class="b">' . esc_html($brand) . '</div>'
            . '<h1>' . esc_html($title) . '</h1><p>' . esc_html($body) . '</p></div></body></html>';
        exit;
    }
}
