<?php
declare(strict_types=1);

namespace OE\Mail;

use OE\Settings;

defined('ABSPATH') || exit;

/**
 * Native transactional email — the Brevo replacement for per-recipient,
 * triggered messages (welcome, ticket delivery, submission updates, volunteer
 * confirmations/reminders, reports). Renders a branded HTML email and sends it
 * through the site {@see Mailer} (SES when configured, otherwise the site's
 * default transport). No external service, no template IDs.
 */
final class Transactional {

    /** @var array<string,string> */
    private const SUBJECTS = [
        'account_welcome'            => 'Welcome to %s',
        'submission_received'        => 'We received your submission',
        'submission_approved'        => 'Your listing is approved',
        'submission_rejected_free'   => 'About your submission',
        'submission_rejected_refund' => 'About your submission (refunded)',
        'payment_confirmed'          => 'Payment received',
        'ticket_delivery'            => 'Your tickets',
        'volunteer_confirmed'        => 'Your volunteer shift is confirmed',
        'volunteer_declined'         => 'About your volunteer signup',
        'volunteer_reminder'         => 'Your volunteer shift is coming up',
        'event_reminder'             => 'Reminder: %2$s is coming up',
        'sales_report'               => 'Daily ticket sales',
    ];

    /**
     * @param array{email:string,name?:string} $to
     * @param array<int,string> $attachments File paths to attach (e.g. an .ics).
     */
    public static function send(string $trigger, array $to, array $params = [], string $subject = '', string $html = '', array $attachments = []): bool {
        $email = (string) ($to['email'] ?? '');
        if (! is_email($email)) {
            return false;
        }
        $brand = (string) Settings::get('brand_name', 'October Events');
        // Subject templates may reference %1$s = brand, %2$s = event name.
        $tmpl  = (string) (self::SUBJECTS[$trigger] ?? ucwords(str_replace('_', ' ', $trigger)));
        $subject = $subject !== '' ? $subject : sprintf($tmpl, $brand, (string) ($params['event_name'] ?? ''));
        $inner = $html !== '' ? $html : self::body($trigger, $to, $params);
        $body  = self::wrap($brand, $inner);
        return wp_mail($email, $subject, $body, ['Content-Type: text/html; charset=UTF-8'], $attachments);
    }

    /** SMS via AWS End User Messaging (no-op until configured in Settings). */
    public static function send_sms(string $to, string $content): bool {
        return \OE\Connectors\SmsConnector::send($to, $content);
    }

    /* ------------------------------------------------------------------ *
     * Bodies
     * ------------------------------------------------------------------ */

    /** @param array{email:string,name?:string} $to */
    private static function body(string $trigger, array $to, array $params): string {
        $name = (string) ($to['name'] ?? ($params['contact_name'] ?? ''));
        $hi   = $name !== '' ? '<p>Hi ' . esc_html($name) . ',</p>' : '';

        switch ($trigger) {
            case 'account_welcome':
                return $hi . '<p>' . esc_html__('Welcome aboard — your account is ready. You can submit and manage your listings any time from your dashboard.', 'october-events') . '</p>';

            case 'payment_confirmed':
                return $hi . '<p>' . sprintf(esc_html__('We\'ve received your payment for %s. Thank you!', 'october-events'), '<strong>' . esc_html((string) ($params['listing_name'] ?? '')) . '</strong>') . '</p>';

            case 'submission_received':
                return $hi . '<p>' . sprintf(esc_html__('Thanks for submitting %1$s (%2$s). It\'s now in review — we\'ll email you when it\'s approved.', 'october-events'),
                    '<strong>' . esc_html((string) ($params['listing_name'] ?? '')) . '</strong>', esc_html((string) ($params['listing_type'] ?? ''))) . '</p>';

            case 'submission_approved':
                return $hi . '<p>' . sprintf(esc_html__('Good news — %s is approved and now live.', 'october-events'),
                    '<strong>' . esc_html((string) ($params['listing_name'] ?? '')) . '</strong>') . '</p>'
                    . self::button(__('View your listing', 'october-events'), (string) ($params['listing_url'] ?? ''));

            case 'submission_rejected_free':
            case 'submission_rejected_refund':
                // The full message copy is pre-composed by Submission::rejection_copy().
                return $hi . '<p>' . nl2br(esc_html((string) ($params['copy'] ?? ''))) . '</p>';

            case 'ticket_delivery':
                return self::ticket_body($hi, $params);

            case 'waitlist_spot':
                return $hi . '<p>' . sprintf(esc_html__('Good news — a spot has opened up for %s.', 'october-events'),
                    '<strong>' . esc_html((string) ($params['event_name'] ?? '')) . '</strong>')
                    . ($params['ticket_type'] ? ' (' . esc_html((string) $params['ticket_type']) . ')' : '') . '</p>'
                    . '<p>' . esc_html__('Tickets are limited and offered first-come — grab yours now:', 'october-events') . '</p>'
                    . self::button(__('Get your tickets', 'october-events'), (string) ($params['checkout_url'] ?? ''));

            case 'volunteer_confirmed':
            case 'volunteer_declined':
            case 'volunteer_reminder':
                return self::volunteer_body($trigger, $hi, $params);

            case 'event_reminder':
                return self::event_reminder_body($hi, $params);
        }

        // Generic fallback: greeting + any scalar params.
        $rows = '';
        foreach ($params as $k => $v) {
            if (is_scalar($v) && ! in_array($k, ['contact_name', 'context'], true)) {
                $rows .= '<p><strong>' . esc_html(ucwords(str_replace('_', ' ', (string) $k))) . ':</strong> ' . esc_html((string) $v) . '</p>';
            }
        }
        return $hi . ($rows ?: '<p>' . esc_html__('See your dashboard for details.', 'october-events') . '</p>');
    }

    private static function ticket_body(string $hi, array $params): string {
        $out = $hi . '<p>' . sprintf(esc_html__('Here are your tickets for %s.', 'october-events'),
            '<strong>' . esc_html((string) ($params['event_name'] ?? '')) . '</strong>') . '</p>';
        $tickets = is_array($params['tickets'] ?? null) ? $params['tickets'] : [];
        foreach ($tickets as $t) {
            $num   = esc_html((string) ($t['number'] ?? ''));
            $url   = (string) ($t['url'] ?? '');
            $token = (string) ($t['token'] ?? '');
            $out .= '<div style="margin:16px 0;padding:14px;border:1px solid #eee;border-radius:8px;text-align:center">';
            $out .= '<p style="margin:0 0 8px"><strong>' . esc_html__('Ticket', 'october-events') . ' ' . $num . '</strong></p>';
            if ($token !== '') {
                // Scannable QR embedded in the email (in case they don't open the
                // ticket page) — rendered by a QR image service so it shows in
                // every email client.
                $qr = 'https://api.qrserver.com/v1/create-qr-code/?size=170x170&qzone=1&data=' . rawurlencode($token);
                $out .= '<img src="' . esc_url($qr) . '" alt="' . esc_attr__('Ticket QR code', 'october-events') . '" width="170" height="170" style="display:block;margin:0 auto 8px">';
            }
            $out .= '<p style="margin:0">' . self::link(__('view / add to wallet', 'october-events'), $url) . '</p></div>';
        }
        return $out;
    }

    private static function event_reminder_body(string $hi, array $params): string {
        $event = (string) ($params['event_name'] ?? '');
        $when  = (string) ($params['when'] ?? '');
        $where = (string) ($params['location'] ?? '');
        $out = $hi . '<p>' . sprintf(esc_html__('Just a reminder — %s is almost here. We look forward to seeing you!', 'october-events'),
            '<strong>' . esc_html($event) . '</strong>') . '</p>';
        $rows = [
            __('When', 'october-events')  => $when,
            __('Where', 'october-events') => $where,
        ];
        foreach ($rows as $label => $val) {
            if ($val !== '') { $out .= '<p><strong>' . esc_html((string) $label) . ':</strong> ' . esc_html($val) . '</p>'; }
        }
        $out .= '<p>' . esc_html__('Your ticket QR codes are in your original confirmation email — have them ready at the door.', 'october-events') . '</p>';
        if (! empty($params['event_url'])) {
            $out .= self::button(__('View event details', 'october-events'), (string) $params['event_url']);
        }
        return $out;
    }

    private static function volunteer_body(string $trigger, string $hi, array $params): string {
        $intro = $trigger === 'volunteer_declined'
            ? esc_html__('Thanks for offering to help. This shift didn\'t go ahead for you this time — we hope to see you at another.', 'october-events')
            : esc_html__('Thanks for volunteering! Here are your shift details:', 'october-events');
        $out = $hi . '<p>' . $intro . '</p>';
        $rows = [
            __('Opportunity', 'october-events') => (string) ($params['opportunity'] ?? ''),
            __('Shift', 'october-events')       => (string) ($params['shift'] ?? ''),
            __('Location', 'october-events')    => (string) ($params['location'] ?? ''),
        ];
        $list = '';
        foreach ($rows as $label => $val) {
            if ($val !== '') { $list .= '<p><strong>' . esc_html((string) $label) . ':</strong> ' . esc_html($val) . '</p>'; }
        }
        $out .= $list;
        if (! empty($params['url'])) {
            $out .= self::button(__('View details', 'october-events'), (string) $params['url']);
        }
        return $out;
    }

    /* ------------------------------------------------------------------ *
     * Presentation
     * ------------------------------------------------------------------ */

    private static function accent(): string {
        $a = trim((string) Settings::get('theme_accent', ''));
        return $a !== '' ? $a : '#E7CD41';
    }

    private static function button(string $label, string $url): string {
        if ($url === '') { return ''; }
        return '<p style="margin:18px 0"><a href="' . esc_url($url) . '" style="display:inline-block;background:' . esc_attr(self::accent())
            . ';color:#1a1a1a;font-weight:bold;text-decoration:none;padding:11px 22px;border-radius:999px">' . esc_html($label) . '</a></p>';
    }

    private static function link(string $label, string $url): string {
        return $url === '' ? esc_html($label) : '<a href="' . esc_url($url) . '">' . esc_html($label) . '</a>';
    }

    private static function wrap(string $brand, string $inner): string {
        $home = esc_url(home_url('/'));
        return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f5;padding:24px;font-family:Arial,Helvetica,sans-serif">'
            . '<tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border-radius:12px;border:1px solid #e3e2db">'
            . '<tr><td style="padding:22px 26px;border-bottom:1px solid #e3e2db;font-weight:bold;font-size:18px;color:#1a1a1a">' . esc_html($brand) . '</td></tr>'
            . '<tr><td style="padding:26px;font-size:15px;line-height:1.6;color:#333">' . $inner . '</td></tr>'
            . '<tr><td style="padding:18px 26px;border-top:1px solid #e3e2db;font-size:12px;color:#888">'
            . esc_html($brand) . ' · <a href="' . $home . '" style="color:#888">' . esc_html((string) wp_parse_url($home, PHP_URL_HOST)) . '</a></td></tr>'
            . '</table></td></tr></table>';
    }
}
