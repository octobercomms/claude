<?php
declare(strict_types=1);

namespace OE\Mail;

use OE\Settings;

defined('ABSPATH') || exit;

/**
 * Site-wide mailer.
 *
 * Phase 1 of the email platform (see docs/october-events/EMAIL-PLATFORM.md):
 * October Events becomes the site's outgoing-mail transport and log so the
 * single-purpose SMTP/log plugins can be retired.
 *
 *  - When **Amazon SES** is enabled and configured, every `wp_mail()` is routed
 *    through SES via SMTP (configured on `phpmailer_init`). When it isn't, the
 *    site keeps using its existing default transport — nothing changes.
 *  - Every send is recorded in the {@see EmailLog} (replaces "Check & Log Email").
 *  - The {@see Suppression} list is honoured: suppressed recipients are stripped,
 *    and a fully-suppressed message is skipped (logged, never sent).
 *
 * Designed to degrade gracefully: with no SES config it is a transparent logger.
 */
final class Mailer {

    public static function init(): void {
        // Transport: route through SES SMTP when configured.
        add_action('phpmailer_init', [self::class, 'configure_transport']);

        // From identity (only when we're actively the SES mailer).
        add_filter('wp_mail_from', [self::class, 'from_email']);
        add_filter('wp_mail_from_name', [self::class, 'from_name']);

        // Suppression + logging.
        add_filter('pre_wp_mail', [self::class, 'maybe_skip'], 10, 2);
        add_filter('wp_mail', [self::class, 'strip_suppressed']);
        add_action('wp_mail_succeeded', [self::class, 'on_success']);
        add_action('wp_mail_failed', [self::class, 'on_failure']);
    }

    /** True when SES is enabled and has the credentials it needs. */
    public static function ses_active(): bool {
        if (! Settings::get('ses_enabled', false)) {
            return false;
        }
        $region = (string) Settings::get('ses_region', '');
        $user   = (string) Settings::get('ses_smtp_user', '');
        $pass   = (string) Settings::get('ses_smtp_password', '');
        return $region !== '' && $user !== '' && $pass !== '';
    }

    public static function smtp_host(): string {
        $region = (string) Settings::get('ses_region', 'us-east-1');
        return 'email-smtp.' . $region . '.amazonaws.com';
    }

    /**
     * Point PHPMailer at the SES SMTP endpoint. Only fires when SES is fully
     * configured, so a half-set config can never break the site's mail.
     *
     * @param \PHPMailer\PHPMailer\PHPMailer $phpmailer
     */
    public static function configure_transport($phpmailer): void {
        if (! self::ses_active()) {
            return;
        }
        $phpmailer->isSMTP();
        $phpmailer->Host       = self::smtp_host();
        $phpmailer->Port       = 587;
        $phpmailer->SMTPAuth   = true;
        $phpmailer->SMTPSecure = 'tls';
        $phpmailer->Username   = (string) Settings::get('ses_smtp_user', '');
        $phpmailer->Password   = (string) Settings::get('ses_smtp_password', '');
    }

    public static function from_email($email) {
        if (self::ses_active()) {
            $configured = (string) Settings::get('mail_from_email', '');
            if (is_email($configured)) {
                return $configured;
            }
        }
        return $email;
    }

    public static function from_name($name) {
        if (self::ses_active()) {
            $configured = (string) Settings::get('mail_from_name', '');
            if ($configured !== '') {
                return $configured;
            }
        }
        return $name;
    }

    /**
     * Short-circuit a send when every recipient is on the suppression list.
     *
     * @param null|bool           $pre
     * @param array<string,mixed> $atts
     * @return null|bool
     */
    public static function maybe_skip($pre, $atts) {
        if ($pre !== null) {
            return $pre; // someone else already short-circuited
        }
        $to = $atts['to'] ?? [];
        $to = is_array($to) ? $to : preg_split('/,\s*/', (string) $to);
        $to = array_filter(array_map('trim', (array) $to));
        if (! $to) {
            return $pre;
        }
        $allowed = array_filter($to, static function ($addr) {
            return ! Suppression::is_suppressed(self::address($addr));
        });
        if (! $allowed) {
            EmailLog::record($atts, 'suppressed', self::driver_label());
            return true; // pretend success; nothing sent
        }
        return $pre;
    }

    /**
     * Remove individually-suppressed recipients from a multi-recipient send.
     *
     * @param array<string,mixed> $atts
     * @return array<string,mixed>
     */
    public static function strip_suppressed($atts) {
        if (empty($atts['to'])) {
            return $atts;
        }
        $to = is_array($atts['to']) ? $atts['to'] : preg_split('/,\s*/', (string) $atts['to']);
        $kept = array_values(array_filter((array) $to, static function ($addr) {
            return ! Suppression::is_suppressed(self::address((string) $addr));
        }));
        if ($kept) {
            $atts['to'] = $kept;
        }
        return $atts;
    }

    /** @param array<string,mixed>|mixed $mail_data */
    public static function on_success($mail_data): void {
        $data = is_array($mail_data) ? $mail_data : [];
        EmailLog::record($data, 'sent', self::driver_label());
    }

    /** @param \WP_Error $error */
    public static function on_failure($error): void {
        $data = [];
        if (is_wp_error($error)) {
            $ed = $error->get_error_data();
            if (is_array($ed)) {
                $data = $ed;
            }
            EmailLog::record($data, 'failed', self::driver_label(), $error->get_error_message());
        }
    }

    private static function driver_label(): string {
        return self::ses_active() ? 'ses' : 'default';
    }

    /** Extract a bare email address from a "Name <email>" recipient string. */
    private static function address(string $recipient): string {
        if (preg_match('/<([^>]+)>/', $recipient, $m)) {
            return trim($m[1]);
        }
        return trim($recipient);
    }

    /**
     * Send a test email to confirm the transport works (used by the admin
     * "send test" button). Returns true on success.
     */
    public static function send_test(string $to): bool {
        if (! is_email($to)) {
            return false;
        }
        $brand = (string) Settings::get('brand_name', 'October Events');
        return wp_mail(
            $to,
            sprintf('[%s] Test email', $brand),
            "This is a test email from October Events.\n\nTransport: " . (self::ses_active() ? 'Amazon SES' : 'site default') . ".\nIf you received it, outgoing mail is working."
        );
    }
}
