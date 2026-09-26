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
        $subject = sprintf(__('You left tickets for %s', 'october-events'), $event);
        $html    = self::body($draft, $event, $name, $link, $code);
        $ok = Transactional::send('cart_recovery', ['email' => $email, 'name' => $name], [], $subject, $html, [], true);
        if ($ok) {
            Abandonment::mark_recovery_sent((int) $draft->id);
        }
        return $ok;
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
        /* translators: %s: event name (bold) */
        $intro    = sprintf(__('You started booking for %s but didn’t finish. Your tickets are still waiting — pick up where you left off:', 'october-events'), '<strong>' . esc_html($event) . '</strong>');
        $btn      = '<a href="' . esc_url($link) . '" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700">' . esc_html__('Complete your booking', 'october-events') . '</a>';
        $codeline = $code !== ''
            ? '<p style="margin:14px 0 0;color:#1e7a33"><strong>' . esc_html(sprintf(__('Use code %s at checkout.', 'october-events'), $code)) . '</strong></p>'
            : '';
        $cart     = $rows !== '' ? '<table style="margin:10px 0 16px;border-collapse:collapse">' . $rows . '</table>' : '';
        return '<p>' . $greeting . '</p>'
            . '<p>' . $intro . '</p>'
            . $cart
            . '<p style="margin:18px 0">' . $btn . '</p>'
            . $codeline;
    }
}
