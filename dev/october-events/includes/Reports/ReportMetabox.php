<?php
declare(strict_types=1);

namespace OE\Reports;

use OE\PostTypes;
use OE\Settings;

defined('ABSPATH') || exit;

/**
 * End-of-event report metabox (BUILD-PLAN M7). A read-only summary on the event
 * edit screen: tickets, comp, revenue, check-in rate, promo and waitlist /
 * cart conversion. Pure read of EventReport; no actions, no writes.
 */
final class ReportMetabox {

    public static function init(): void {
        add_action('add_meta_boxes', [self::class, 'add']);
    }

    public static function add(): void {
        $pt = PostTypes::slug('event');
        if ($pt === '' || ! post_type_exists($pt)) {
            return;
        }
        add_meta_box('oe-event-report', __('Event report', 'october-events'), [self::class, 'render'], $pt, 'side', 'low');
    }

    public static function render(\WP_Post $post): void {
        $r   = EventReport::for_event((int) $post->ID);
        $sym = ($cur = strtoupper((string) Settings::get('currency', 'usd'))) === 'GBP' ? '£' : ($cur === 'EUR' ? '€' : '$');
        $money = static fn(float $v): string => $sym . number_format($v, 2);

        echo '<div class="oe-report" style="font-size:13px">';
        self::row(__('Tickets', 'october-events'), (string) $r['tickets'] . ' (' . $r['paid_tickets'] . ' ' . esc_html__('paid', 'october-events') . ', ' . $r['comp'] . ' ' . esc_html__('comp', 'october-events') . ')');
        self::row(__('Revenue', 'october-events'), $money((float) $r['revenue']));
        if ((float) $r['discount'] > 0) {
            self::row(__('Discounts', 'october-events'), '−' . $money((float) $r['discount']));
        }
        self::row(__('Checked in', 'october-events'), $r['checked_in'] . ' / ' . $r['issued'] . ' (' . $r['checkin_rate'] . '%)');
        if (! empty($r['waitlist']['total'])) {
            self::row(__('Waitlist', 'october-events'), $r['waitlist']['total'] . ' · ' . $r['waitlist']['notified'] . ' ' . esc_html__('offered', 'october-events') . ' · ' . $r['waitlist']['converted'] . ' ' . esc_html__('converted', 'october-events'));
        }
        if (! empty($r['carts']['started'])) {
            self::row(__('Cart conversion', 'october-events'), $r['carts']['recovered'] . ' / ' . $r['carts']['started'] . ' (' . $r['carts']['conversion'] . '%)');
        }
        if (! empty($r['survey']['total'])) {
            $s = $r['survey'];
            $val = $s['complete'] . ' ' . esc_html__('completed', 'october-events');
            if ($s['partial'] > 0) {
                $val .= ' · ' . $s['partial'] . ' ' . esc_html__('started', 'october-events');
            }
            if ($s['response_rate'] > 0) {
                $val .= ' (' . $s['response_rate'] . '%)';
            }
            self::row(__('Survey', 'october-events'), $val);
        }
        if (! empty($r['promos'])) {
            echo '<p style="margin:10px 0 2px;font-weight:600">' . esc_html__('Promo codes', 'october-events') . '</p>';
            foreach ($r['promos'] as $p) {
                self::row(esc_html($p['code']), $p['orders'] . ' ' . esc_html__('orders', 'october-events') . ' · −' . $money((float) $p['discount']));
            }
        }
        echo '<p class="description" style="margin-top:10px">' . esc_html__('Live figures from this event’s orders, tickets and check-ins.', 'october-events') . '</p>';
        echo '</div>';
    }

    private static function row(string $label, string $value): void {
        printf(
            '<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px solid #eee"><span>%s</span><strong>%s</strong></div>',
            esc_html($label),
            // $value may contain already-escaped markup (promo code is escaped above).
            wp_kses_post($value)
        );
    }
}
