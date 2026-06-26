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
        'order_refunded'             => 'Your refund for %2$s',
        'order_cancelled'            => 'Your order has been cancelled',
        'sales_report'               => 'Daily ticket sales',
    ];

    /**
     * @param array{email:string,name?:string} $to
     * @param array<int,string> $attachments File paths to attach (e.g. an .ics).
     */
    public static function send(string $trigger, array $to, array $params = [], string $subject = '', string $html = '', array $attachments = [], bool $wrap = true): bool {
        $email = (string) ($to['email'] ?? '');
        if (! is_email($email)) {
            return false;
        }
        $brand = (string) Settings::get('brand_name', 'October Events');
        // Subject templates may reference %1$s = brand, %2$s = event name.
        $tmpl  = (string) (self::SUBJECTS[$trigger] ?? ucwords(str_replace('_', ' ', $trigger)));
        $subject = $subject !== '' ? $subject : sprintf($tmpl, $brand, (string) ($params['event_name'] ?? ''));
        // Volunteer emails render as branded, self-styled documents (matching
        // the ticket confirmation), unless the caller supplied its own $html.
        $volunteer_doc = $html === '' && in_array($trigger, ['volunteer_confirmed', 'volunteer_declined', 'volunteer_reminder'], true);
        if ($volunteer_doc) {
            $body = self::volunteer_email_html($trigger, $params);
        } else {
            $inner = $html !== '' ? $html : self::body($trigger, $to, $params);
            // $wrap = false lets a caller pass a complete, self-styled document
            // (e.g. the branded ticket email) without the generic brand chrome.
            $body = $wrap ? self::wrap($brand, $inner) : $inner;
        }
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

            // ticket_delivery is sent as a full self-styled document via
            // ticket_email_html() + send(..., $wrap=false); no body() case needed.

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

            case 'order_refunded':
                return $hi . '<p>' . sprintf(esc_html__('Your order for %s has been cancelled and refunded.', 'october-events'),
                    '<strong>' . esc_html((string) ($params['event_name'] ?? '')) . '</strong>') . '</p>'
                    . (! empty($params['amount']) ? '<p><strong>' . esc_html__('Refund amount:', 'october-events') . '</strong> ' . esc_html((string) $params['amount']) . '</p>' : '')
                    . '<p>' . esc_html__('The refund goes back to your original payment method and usually appears within 5–10 business days. Your tickets are no longer valid.', 'october-events') . '</p>';

            case 'order_cancelled':
                return $hi . '<p>' . sprintf(esc_html__('Your order for %s has been cancelled, and the tickets are no longer valid.', 'october-events'),
                    '<strong>' . esc_html((string) ($params['event_name'] ?? '')) . '</strong>') . '</p>'
                    . '<p>' . esc_html__('If you believe this was a mistake, please get in touch and we\'ll be glad to help.', 'october-events') . '</p>';
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

    /**
     * The complete, self-styled ticket confirmation email (print-first language:
     * square corners, near-monochrome, the event logo top-left). Sent with
     * $wrap = false so it isn't re-wrapped in the generic brand chrome.
     *
     * @param array $params event_name, when, location, order_id, logo, brand,
     *                       tickets[{number,attendee,type,url,token}]
     */
    public static function ticket_email_html(array $params): string {
        $name  = (string) ($params['contact_name'] ?? $params['name'] ?? '');
        $event = (string) ($params['event_name'] ?? '');
        $when  = (string) ($params['when'] ?? '');
        $where = (string) ($params['location'] ?? '');
        $order = (string) ($params['order_id'] ?? '');
        $logo  = (string) ($params['logo'] ?? '');
        $brand = (string) ($params['brand'] ?? Settings::get('brand_name', 'October Events'));
        $home  = esc_url(home_url('/'));
        $host  = esc_html((string) wp_parse_url($home, PHP_URL_HOST));
        $tickets = is_array($params['tickets'] ?? null) ? $params['tickets'] : [];

        $head_left = $logo !== ''
            ? '<img src="' . esc_url($logo) . '" alt="' . esc_attr($brand) . '" style="max-height:46px;max-width:240px;display:block">'
            : '<span style="font-weight:800;font-size:17px;color:#111">' . esc_html($brand) . '</span>';
        $head_right = $order !== ''
            ? '<span style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#888">' . esc_html(sprintf(__('Order #%s', 'october-events'), $order)) . '</span>'
            : '';

        $rows = '';
        foreach ($tickets as $t) {
            $tnum  = esc_html((string) ($t['number'] ?? ''));
            $att   = (string) ($t['attendee'] ?? '');
            $ttype = (string) ($t['type'] ?? '');
            $url   = (string) ($t['url'] ?? '');
            $token = (string) ($t['token'] ?? '');
            $qr    = $token !== '' ? 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&qzone=1&data=' . rawurlencode($token) : '';
            $sub   = trim($ttype . ($tnum !== '' ? ' · ' . sprintf(__('Ticket %s', 'october-events'), $tnum) : ''), ' ·');
            $rows .= '<tr><td style="padding:0 0 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid #111"><tr>'
                . '<td width="108" style="padding:12px" valign="middle">'
                . ($qr !== '' ? '<img src="' . esc_url($qr) . '" alt="' . esc_attr__('Ticket QR code', 'october-events') . '" width="84" height="84" style="display:block">' : '')
                . '</td>'
                . '<td style="padding:12px 12px 12px 0" valign="middle">'
                . ($att !== '' ? '<div style="font-weight:800;font-size:15px;color:#111">' . esc_html($att) . '</div>' : '')
                . '<div style="font-size:13px;color:#555;margin:2px 0 10px">' . esc_html($sub) . '</div>'
                . ($url !== '' ? '<a href="' . esc_url($url) . '" style="display:inline-block;background:#111;color:#fff;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;text-decoration:none;padding:9px 16px">' . esc_html__('View ticket', 'october-events') . '</a>' : '')
                . '</td></tr></table></td></tr>';
        }

        $count   = count($tickets);
        $intro   = $count === 1
            ? esc_html__('You\'re all set — here is your ticket. Bring the QR code (printed or on your phone) to the event.', 'october-events')
            : esc_html(sprintf(__('You\'re all set — here are your %d tickets. Bring the QR codes (printed or on your phone) to the event.', 'october-events'), $count));
        $hi      = $name !== '' ? '<p style="margin:0 0 12px;font-size:15px;color:#222">' . sprintf(esc_html__('Hi %s,', 'october-events'), esc_html($name)) . '</p>' : '';
        $ev_meta = trim($when . ($where !== '' ? ($when !== '' ? '<br>' : '') . esc_html($where) : ''));
        if ($when !== '') { $ev_meta = esc_html($when) . ($where !== '' ? '<br>' . esc_html($where) : ''); }

        return '<!doctype html><html><body style="margin:0;background:#eceae6">'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eceae6;padding:24px;font-family:Arial,Helvetica,sans-serif">'
            . '<tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border:2px solid #111">'
            // header
            . '<tr><td style="padding:16px 22px;border-bottom:3px solid #111"><table role="presentation" width="100%"><tr>'
            . '<td valign="middle">' . $head_left . '</td>'
            . '<td align="right" valign="middle">' . $head_right . '</td>'
            . '</tr></table></td></tr>'
            // body
            . '<tr><td style="padding:22px">'
            . $hi
            . '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#222">' . $intro . '</p>'
            // event summary block
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid #111;margin:0 0 18px"><tr><td style="padding:14px 16px">'
            . '<div style="font-size:18px;font-weight:800;color:#111;line-height:1.2;margin-bottom:' . ($ev_meta !== '' ? '6px' : '0') . '">' . esc_html($event) . '</div>'
            . ($ev_meta !== '' ? '<div style="font-size:13px;color:#444;line-height:1.5">' . $ev_meta . '</div>' : '')
            . '<div style="margin-top:10px;font-size:13px;font-weight:700;color:#111;text-decoration:underline">' . esc_html__('Add to calendar (.ics attached)', 'october-events') . '</div>'
            . '</td></tr></table>'
            // tickets
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' . $rows . '</table>'
            . '</td></tr>'
            // footer
            . '<tr><td style="padding:16px 22px;border-top:2px solid #111;font-size:12px;color:#777">'
            . esc_html($brand) . ' · <a href="' . $home . '" style="color:#777">' . $host . '</a> · ' . esc_html__('Questions? Just reply to this email.', 'october-events')
            . '</td></tr>'
            . '</table></td></tr></table></body></html>';
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

    /**
     * Branded volunteer email (same print-first language as the ticket
     * confirmation): logo header, a bordered shift-detail block and a button.
     * Sent for confirmed / declined / reminder, with copy varying by trigger.
     */
    public static function volunteer_email_html(string $trigger, array $params): string {
        $name  = (string) ($params['name'] ?? $params['contact_name'] ?? '');
        $opp   = (string) ($params['opportunity'] ?? '');
        $shift = (string) ($params['shift'] ?? '');
        $where = (string) ($params['location'] ?? '');
        $url   = (string) ($params['url'] ?? '');
        $ctx   = (string) ($params['context'] ?? '');
        $brand = (string) Settings::get('brand_name', 'October Events');
        // Reuse the linked event's logo when there is one, else the brand logo.
        $oid   = (int) ($params['opportunity_id'] ?? 0);
        $logo  = $oid ? \OE\Ticketing\TicketTypes::logo_url(\OE\Volunteers::linked_event($oid)) : '';
        $home  = esc_url(home_url('/'));
        $host  = esc_html((string) wp_parse_url($home, PHP_URL_HOST));

        if ($trigger === 'volunteer_declined') {
            $intro = esc_html__('Thanks for offering to help. This shift didn\'t go ahead for you this time — we hope to see you at another. Here\'s what you signed up for:', 'october-events');
        } elseif ($trigger === 'volunteer_confirmed') {
            $intro = esc_html__('Your volunteer shift is confirmed — thank you! Here are the details:', 'october-events');
        } elseif ($ctx === 'on_signup') {
            $intro = esc_html__('Thanks for volunteering — you\'re all set! Here are your shift details:', 'october-events');
        } else {
            $intro = esc_html__('Just a reminder — your volunteer shift is coming up. Here are the details:', 'october-events');
        }

        $head_left = $logo !== ''
            ? '<img src="' . esc_url($logo) . '" alt="' . esc_attr($brand) . '" style="max-height:46px;max-width:240px;display:block">'
            : '<span style="font-weight:800;font-size:17px;color:#111">' . esc_html($brand) . '</span>';

        $row = static function (string $label, string $value): string {
            return $value === '' ? '' : '<tr><td style="padding:4px 0;font-size:13px;color:#777;width:110px;vertical-align:top">' . esc_html($label) . '</td>'
                . '<td style="padding:4px 0;font-size:14px;font-weight:700;color:#111">' . esc_html($value) . '</td></tr>';
        };

        return '<!doctype html><html><body style="margin:0;background:#eceae6">'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eceae6;padding:24px;font-family:Arial,Helvetica,sans-serif">'
            . '<tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border:2px solid #111">'
            . '<tr><td style="padding:16px 22px;border-bottom:3px solid #111">' . $head_left . '</td></tr>'
            . '<tr><td style="padding:22px">'
            . ($name !== '' ? '<p style="margin:0 0 12px;font-size:15px;color:#222">' . sprintf(esc_html__('Hi %s,', 'october-events'), esc_html($name)) . '</p>' : '')
            . '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#222">' . $intro . '</p>'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid #111;margin:0 0 18px"><tr><td style="padding:14px 16px">'
            . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
            . $row(__('Opportunity', 'october-events'), $opp)
            . $row(__('Shift', 'october-events'), $shift)
            . $row(__('Location', 'october-events'), $where)
            . '</table></td></tr></table>'
            . ($url !== '' ? '<a href="' . esc_url($url) . '" style="display:inline-block;background:#111;color:#fff;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;text-decoration:none;padding:11px 18px">' . esc_html__('View details', 'october-events') . '</a>' : '')
            . '</td></tr>'
            . '<tr><td style="padding:16px 22px;border-top:2px solid #111;font-size:12px;color:#777">'
            . esc_html($brand) . ' · <a href="' . $home . '" style="color:#777">' . $host . '</a> · ' . esc_html__('Questions? Just reply to this email.', 'october-events')
            . '</td></tr>'
            . '</table></td></tr></table></body></html>';
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
