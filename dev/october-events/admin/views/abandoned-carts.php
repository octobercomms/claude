<?php
/**
 * Abandoned carts — in-progress checkouts that never completed, with whatever the
 * buyer entered (tickets, name, email, attendee names, running total), so you can
 * see where and how often people drop off before paying. First-party conversion
 * analytics only — this data is NOT used for marketing, and drafts auto-purge
 * after 90 days. No card details are ever captured (Stripe handles those).
 *
 * @var int              $event  event filter (0 = all)
 * @var array<string,mixed> $stats  headline counts (open/abandoned/recovered/value)
 * @var array<int,object> $rows   recent drafts, each with ->state and ->items
 */
defined('ABSPATH') || exit;

$currency = strtoupper((string) \OE\Settings::get('currency', 'usd'));
$sym      = $currency === 'GBP' ? '£' : ($currency === 'EUR' ? '€' : '$');
$money    = static function ($n) use ($sym) { return $sym . number_format((float) $n, 2); };

$total_seen = (int) $stats['abandoned'] + (int) $stats['recovered'];
$recovery_rate = $total_seen > 0 ? round($stats['recovered'] / $total_seen * 100) : 0;

$state_badge = static function (string $state): array {
    switch ($state) {
        case 'recovered':   return [__('Recovered', 'october-events'), '#2e7d32', '#eaf5ec'];
        case 'in_progress': return [__('In progress', 'october-events'), '#1565c0', '#e9f1fb'];
        default:            return [__('Abandoned', 'october-events'), '#b23c17', '#fbeee9'];
    }
};

$export_url = wp_nonce_url(
    admin_url('admin.php?page=oe-tickets&tab=abandoned&oe_export=abandoned' . ($event ? '&event=' . $event : '')),
    'oe_export'
);
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Tickets', 'october-events'); ?></h1>
    <?php \OE\Admin\Admin::bento('tickets'); ?>
    <?php \OE\Admin\Admin::tickets_tabs('abandoned'); ?>

    <p class="description" style="margin:14px 0 4px;max-width:760px">
        <?php esc_html_e('Checkouts that were started but not paid for. Use this to spot conversion problems — e.g. people reaching the pay step but not finishing, or the same tickets abandoned again and again. Contact details shown here are for your analysis only; they are not marketed to, and drafts are automatically deleted after 90 days.', 'october-events'); ?>
    </p>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin:14px 0 18px">
        <div class="oe-skpi" style="background:#1a1a1a;color:#fff;border-radius:12px;padding:16px">
            <div style="font-size:28px;font-weight:800"><?php echo (int) $stats['abandoned']; ?></div>
            <div style="opacity:.7;font-size:12px;text-transform:uppercase;letter-spacing:.06em"><?php esc_html_e('Abandoned', 'october-events'); ?></div>
        </div>
        <div class="oe-skpi" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px" title="<?php esc_attr_e('Estimated ticket value of abandoned carts (at the prices they had selected).', 'october-events'); ?>">
            <div style="font-size:28px;font-weight:800"><?php echo esc_html($money($stats['lost_value'])); ?></div>
            <div style="color:#777;font-size:12px;text-transform:uppercase;letter-spacing:.06em"><?php esc_html_e('Value not converted', 'october-events'); ?></div>
        </div>
        <div class="oe-skpi" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px">
            <div style="font-size:28px;font-weight:800"><?php echo (int) $stats['recovered']; ?></div>
            <div style="color:#777;font-size:12px;text-transform:uppercase;letter-spacing:.06em"><?php esc_html_e('Later purchased', 'october-events'); ?></div>
        </div>
        <div class="oe-skpi" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px" title="<?php esc_attr_e('Share of drop-offs where the same email later completed a purchase.', 'october-events'); ?>">
            <div style="font-size:28px;font-weight:800"><?php echo (int) $recovery_rate; ?>%</div>
            <div style="color:#777;font-size:12px;text-transform:uppercase;letter-spacing:.06em"><?php esc_html_e('Recovery rate', 'october-events'); ?></div>
        </div>
        <div class="oe-skpi" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px">
            <div style="font-size:28px;font-weight:800"><?php echo (int) $stats['open']; ?></div>
            <div style="color:#777;font-size:12px;text-transform:uppercase;letter-spacing:.06em"><?php esc_html_e('In progress now', 'october-events'); ?></div>
        </div>
    </div>

    <p style="margin:0 0 12px">
        <a class="button button-small" href="<?php echo esc_url($export_url); ?>"><?php esc_html_e('Export CSV', 'october-events'); ?></a>
    </p>

    <?php if (! $rows) : ?>
        <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:18px">
            <strong><?php esc_html_e('No abandoned carts yet.', 'october-events'); ?></strong>
            <p class="description" style="margin:6px 0 0"><?php esc_html_e('As soon as a shopper enters an email or picks a ticket without completing checkout, their draft will appear here.', 'october-events'); ?></p>
        </div>
    <?php else : ?>
        <table class="widefat striped" style="background:#fff">
            <thead>
                <tr>
                    <th><?php esc_html_e('State', 'october-events'); ?></th>
                    <th><?php esc_html_e('Contact', 'october-events'); ?></th>
                    <th><?php esc_html_e('Event', 'october-events'); ?></th>
                    <th><?php esc_html_e('Tickets', 'october-events'); ?></th>
                    <th style="text-align:right"><?php esc_html_e('Total', 'october-events'); ?></th>
                    <th><?php esc_html_e('Got as far as', 'october-events'); ?></th>
                    <th><?php esc_html_e('Last activity', 'october-events'); ?></th>
                </tr>
            </thead>
            <tbody>
            <?php
            $step_label = [
                'cart'    => __('Choosing tickets', 'october-events'),
                'details' => __('Entered details', 'october-events'),
                'payment' => __('Reached payment', 'october-events'),
                'exit'    => __('Left the page', 'october-events'),
            ];
            foreach ($rows as $r) :
                [$blabel, $bfg, $bbg] = $state_badge((string) $r->state);
            ?>
                <tr>
                    <td><span style="display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:700;color:<?php echo esc_attr($bfg); ?>;background:<?php echo esc_attr($bbg); ?>"><?php echo esc_html($blabel); ?></span></td>
                    <td>
                        <?php if ($r->email !== '') : ?>
                            <a href="<?php echo esc_url('mailto:' . $r->email); ?>"><?php echo esc_html($r->email); ?></a>
                        <?php else : ?>
                            <span class="description"><?php esc_html_e('(no email yet)', 'october-events'); ?></span>
                        <?php endif; ?>
                        <?php if ($r->name !== '') : ?><br><span class="description"><?php echo esc_html($r->name); ?></span><?php endif; ?>
                        <?php if (! empty($r->attendees)) : ?>
                            <br><span class="description" style="font-size:11px"><?php echo esc_html(sprintf(__('Attendees: %s', 'october-events'), implode(', ', array_map('strval', (array) $r->attendees)))); ?></span>
                        <?php endif; ?>
                    </td>
                    <td><?php echo esc_html(get_the_title((int) $r->event_id) ?: ('#' . (int) $r->event_id)); ?></td>
                    <td>
                        <?php if (! empty($r->items)) : ?>
                            <?php foreach ((array) $r->items as $li) : ?>
                                <div style="font-size:13px"><?php echo esc_html(((int) ($li['qty'] ?? 0)) . '× ' . (string) ($li['label'] ?? ($li['type_key'] ?? '?'))); ?></div>
                            <?php endforeach; ?>
                        <?php else : ?>
                            <span class="description"><?php esc_html_e('—', 'october-events'); ?></span>
                        <?php endif; ?>
                        <?php if (! empty($r->promo_code)) : ?>
                            <div class="description" style="font-size:11px"><?php echo esc_html(sprintf(__('Promo: %s', 'october-events'), (string) $r->promo_code)); ?></div>
                        <?php endif; ?>
                    </td>
                    <td style="text-align:right;white-space:nowrap"><?php echo esc_html($money($r->total)); ?></td>
                    <td><?php echo esc_html($step_label[(string) $r->furthest_step] ?? (string) $r->furthest_step); ?></td>
                    <td style="white-space:nowrap"><?php echo esc_html(mysql2date(get_option('date_format') . ' ' . get_option('time_format'), (string) $r->updated_at)); ?></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
        <p class="description" style="margin-top:10px"><?php esc_html_e('Showing the most recent 300 drafts. “In progress” means the checkout is still recent (may still convert); “abandoned” means it went quiet.', 'october-events'); ?></p>
    <?php endif; ?>
</div>
