<?php
namespace OE\Ticketing;

use OE\Mail\Transactional;
use OE\Settings;

defined('ABSPATH') || exit;

/**
 * Abandoned-cart recovery emails.
 *
 * Manual only — an operator presses "Send recovery" (per row or in bulk) on the
 * Transactions screen; nothing is ever sent automatically, so a finished event
 * is never mailed unless someone chooses to. The email links back to the event
 * with the shopper's tickets pre-filled (the checkout reads `resume_items`),
 * optionally carrying a promo code. A send stamps `recovery_sent_at` so the
 * button greys out and you can see who has already had it.
 */
final class Recovery {

    /** The event page with the cart (and optional code) pre-filled for one-click resume. */
    public static function resume_link(object $draft, string $promo = ''): string {
        $permalink = get_permalink((int) $draft->event_id);
        if (! $permalink) {
            return home_url('/');
        }
        $items = [];
        foreach ((array) ($draft->items ?? []) as $li) {
            $key = (string) ($li['type_key'] ?? '');
            $qty = (int) ($li['qty'] ?? 0);
            // The checkout parses resume_items as key:qty pairs split on , and :,
            // so skip any key carrying those (ticket keys are slugs, but be safe).
            if ($key !== '' && $qty > 0 && strpbrk($key, ':,') === false) {
                $items[] = $key . ':' . $qty;
            }
        }
        $args = [];
        if ($items) {
            $args['resume_items'] = implode(',', $items);
        }
        $code = $promo !== '' ? $promo : (string) ($draft->promo_code ?? '');
        if ($code !== '') {
            $args['code'] = $code;
        }
        return $args ? add_query_arg($args, $permalink) : $permalink;
    }

    /**
     * Send the recovery email for a draft and stamp it sent. Returns false when
     * there's no valid email (nothing is stamped in that case).
     */
    public static function send(object $draft, string $promo = ''): bool {
        $email = (string) ($draft->email ?? '');
        if (! is_email($email)) {
            return false;
        }
        $brand   = (string) Settings::get('brand_name', 'October Events');
        $event   = get_the_title((int) $draft->event_id) ?: $brand;
        $name    = (string) ($draft->name ?? '');
        $link    = self::resume_link($draft, $promo);
        $code    = $promo !== '' ? $promo : (string) ($draft->promo_code ?? '');
        $subject = strtr(self::copy('recovery_subject'), ['{event}' => $event, '{code}' => $code]);
        $html    = self::body($draft, $event, $name, $link, $code);
        $ok = Transactional::send('cart_recovery', ['email' => $email, 'name' => $name], [], $subject, $html, [], true);
        if ($ok) {
            Abandonment::mark_recovery_sent((int) $draft->id);
        }
        return $ok;
    }

    /**
     * Render the recovery email exactly as it would send, with sample data, for
     * an admin preview. $with_code shows the promo line; without it the code
     * line is omitted (so you can see both versions).
     */
    public static function preview(bool $with_code): string {
        $draft = (object) [
            'id'         => 0,
            'event_id'   => 0, // sample → resume link falls back to the site home
            'email'      => 'sample@example.com',
            'name'       => __('Alex', 'october-events'),
            'promo_code' => '',
            'items'      => [
                ['type_key' => 'general', 'qty' => 2, 'label' => __('General admission', 'october-events')],
                ['type_key' => 'vip', 'qty' => 1, 'label' => __('VIP', 'october-events')],
            ],
        ];
        $event = __('Opening Night', 'october-events');
        $code  = $with_code ? 'WELCOME10' : '';
        $link  = self::resume_link($draft, $code);
        $doc   = Transactional::wrap_body(self::body($draft, $event, (string) $draft->name, $link, $code));
        // Show the (editable) subject above the email, like the ticket preview.
        $subject = strtr(self::copy('recovery_subject'), ['{event}' => $event, '{code}' => $code]);
        $bar = '<div style="max-width:600px;margin:0 auto 12px;padding-top:8px;font:600 13px Arial,Helvetica,sans-serif;color:#555">'
            . esc_html__('Subject', 'october-events') . ': ' . esc_html($subject) . '</div>';
        return str_replace('<body style="margin:0;background:#eceae6">', '<body style="margin:0;background:#eceae6">' . $bar, $doc);
    }

    /** Editable copy for a key, falling back to the built-in default when blank. */
    private static function copy(string $key): string {
        $defaults = [
            'recovery_subject'   => __('You left tickets for {event}', 'october-events'),
            'recovery_intro'     => __('You started booking for {event} but didn’t finish. Your tickets are still waiting — pick up where you left off:', 'october-events'),
            'recovery_button'    => __('Complete your booking', 'october-events'),
            'recovery_code_line' => __('Use code {code} at checkout.', 'october-events'),
        ];
        $v = trim((string) Settings::get($key, ''));
        return $v !== '' ? $v : ($defaults[$key] ?? '');
    }

    /** Inner HTML for the branded shell (wrap=true adds the header/footer). */
    private static function body(object $draft, string $event, string $name, string $link, string $code): string {
        $rows = '';
        foreach ((array) ($draft->items ?? []) as $li) {
            $qty = (int) ($li['qty'] ?? 0);
            if ($qty < 1) {
                continue;
            }
            $label = (string) ($li['label'] ?? ($li['type_key'] ?? ''));
            $rows .= '<tr><td style="padding:4px 0;color:#333">' . esc_html($qty . ' × ' . $label) . '</td></tr>';
        }
        $greeting = $name !== ''
            ? sprintf(__('Hi %s,', 'october-events'), esc_html($name))
            : esc_html__('Hi,', 'october-events');
        // Escape the editable copy (the intro is a textarea, so keep line breaks
        // like the volunteer intro does), then swap the {event}/{code} tokens for
        // their (already-escaped) values — braces survive esc_html, so this is safe.
        $intro    = strtr(nl2br(esc_html(self::copy('recovery_intro'))), [
            '{event}' => '<strong>' . esc_html($event) . '</strong>',
            '{code}'  => esc_html($code),
        ]);
        $btn  = '<a href="' . esc_url($link) . '" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">' . esc_html(self::copy('recovery_button')) . '</a>';
        $cart = $rows !== '' ? '<table style="margin:10px 0 16px;border-collapse:collapse">' . $rows . '</table>' : '';

        if ($code !== '') {
            // Give the promo code the same prominence as the volunteer thank-you
            // code: a dashed, monospace chip inside a bordered, tinted panel, with
            // the CTA button below it. {code} in the editable line becomes the
            // chip; if the admin removed the token, the chip is shown on its own.
            $chip     = '<span style="display:inline-block;border:2px dashed #111;padding:6px 14px;margin:2px 0;font-family:\'Courier New\',Courier,monospace;font-size:18px;font-weight:800;letter-spacing:.08em;color:#111">' . esc_html($code) . '</span>';
            $line_tpl = self::copy('recovery_code_line');
            $caption  = strtr(nl2br(esc_html($line_tpl)), ['{code}' => $chip, '{event}' => esc_html($event)]);
            if (strpos($line_tpl, '{code}') === false) {
                $caption .= '<br>' . $chip;
            }
            $cta = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:2px solid #111;background:#faf7f0;margin:18px 0 0"><tr><td style="padding:16px 18px">'
                . '<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#222">' . $caption . '</p>'
                . '<p style="margin:0">' . $btn . '</p>'
                . '</td></tr></table>';
        } else {
            $cta = '<p style="margin:18px 0">' . $btn . '</p>';
        }

        return '<p>' . $greeting . '</p>'
            . '<p>' . $intro . '</p>'
            . $cart
            . $cta;
    }
}
