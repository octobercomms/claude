<?php
/**
 * Failed payments — recent declined/failed Stripe charges and why, so the most
 * common failure reasons are visible at a glance (a pie chart + a table). Helps
 * spot patterns that turn buyers away (e.g. lots of "do not honor" bank blocks).
 *
 * @var bool                 $ready    whether Stripe is connected
 * @var int                  $days     look-back window
 * @var array<int,array>     $charges  failed charges (newest first)
 * @var array<string,int>    $reasons  reason label => count (most common first)
 */
defined('ABSPATH') || exit;

$total    = array_sum($reasons);
$count    = count($charges);
$refresh  = wp_nonce_url(admin_url('admin.php?page=oe-tickets&tab=failed&refresh=1'), 'oe_failed_refresh');
$currency = strtoupper((string) \OE\Settings::get('currency', 'usd'));
$sym      = $currency === 'GBP' ? '£' : ($currency === 'EUR' ? '€' : '$');

// Build the pie (conic-gradient) + legend.
$palette  = ['#C8A96E', '#1a1a1a', '#e53935', '#2e7d32', '#1565c0', '#f9a825', '#6a1b9a', '#00838f', '#ef6c00', '#5d4037', '#789262', '#9e9e9e'];
$stops    = [];
$legend   = [];
$acc      = 0;
$i        = 0;
foreach ($reasons as $label => $n) {
    $color = $palette[$i % count($palette)];
    $start = $total ? $acc / $total * 360 : 0;
    $acc  += $n;
    $end   = $total ? $acc / $total * 360 : 0;
    $stops[]  = $color . ' ' . round($start, 2) . 'deg ' . round($end, 2) . 'deg';
    $legend[] = ['label' => $label, 'n' => $n, 'color' => $color, 'pct' => $total ? round($n / $total * 100) : 0];
    $i++;
}
$gradient = $stops ? 'conic-gradient(' . implode(',', $stops) . ')' : '#eee';
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Tickets', 'october-events'); ?></h1>
    <?php \OE\Admin\Admin::bento('tickets'); ?>
    <?php \OE\Admin\Admin::tickets_tabs('failed'); ?>

    <?php if (! $ready) : ?>
        <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px 18px;margin-top:16px">
            <strong><?php esc_html_e('Connect Stripe to see failed payments.', 'october-events'); ?></strong>
            <p class="description" style="margin:6px 0 0"><?php printf(
                /* translators: %s: link to settings */
                esc_html__('Add your Stripe secret key under %s, then failed charges and their reasons will appear here.', 'october-events'),
                '<a href="' . esc_url(admin_url('admin.php?page=oe-settings#api-keys')) . '">' . esc_html__('Settings → API keys', 'october-events') . '</a>'
            ); ?></p>
        </div>
    <?php else : ?>

        <p style="margin:16px 0 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <span class="description"><?php echo esc_html(sprintf(
                /* translators: 1: count, 2: days */
                _n('%1$s failed payment in the last %2$d days.', '%1$s failed payments in the last %2$d days.', $count, 'october-events'),
                number_format_i18n($count), (int) $days
            )); ?></span>
            <a class="button button-small" href="<?php echo esc_url($refresh); ?>"><?php esc_html_e('Refresh', 'october-events'); ?></a>
        </p>

        <?php if (! $count) : ?>
            <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px 18px">
                <strong>✓ <?php esc_html_e('No failed payments in this window.', 'october-events'); ?></strong>
                <p class="description" style="margin:6px 0 0"><?php esc_html_e('Nice — nothing to act on right now.', 'october-events'); ?></p>
            </div>
        <?php else : ?>

            <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start;margin-bottom:18px">
                <?php /* Pie chart of reasons */ ?>
                <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:18px;display:flex;gap:20px;align-items:center;flex:1;min-width:340px">
                    <div style="width:170px;height:170px;border-radius:50%;flex:none;background:<?php echo esc_attr($gradient); ?>"></div>
                    <div style="flex:1;min-width:0">
                        <div class="oe-panel-label" style="margin-bottom:8px"><?php esc_html_e('Why payments failed', 'october-events'); ?></div>
                        <?php foreach ($legend as $row) : ?>
                            <div style="display:flex;align-items:center;gap:8px;margin:4px 0;font-size:13px">
                                <span style="width:12px;height:12px;border-radius:3px;flex:none;background:<?php echo esc_attr($row['color']); ?>"></span>
                                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><?php echo esc_html($row['label']); ?></span>
                                <strong><?php echo (int) $row['n']; ?></strong>
                                <span style="color:#999;width:42px;text-align:right"><?php echo (int) $row['pct']; ?>%</span>
                            </div>
                        <?php endforeach; ?>
                    </div>
                </div>
            </div>

            <?php /* Detail table */ ?>
            <table class="widefat striped">
                <thead><tr>
                    <th><?php esc_html_e('When', 'october-events'); ?></th>
                    <th><?php esc_html_e('Email', 'october-events'); ?></th>
                    <th><?php esc_html_e('Card', 'october-events'); ?></th>
                    <th><?php esc_html_e('Amount', 'october-events'); ?></th>
                    <th><?php esc_html_e('Reason', 'october-events'); ?></th>
                </tr></thead>
                <tbody>
                <?php foreach ($charges as $c) :
                    $brand = (string) ($c['brand'] ?? '');
                    $last4 = (string) ($c['last4'] ?? '');
                    $card  = trim(($brand !== '' ? ucfirst($brand) : '') . ($last4 !== '' ? ' ····' . $last4 : '')); ?>
                    <tr>
                        <td><?php echo esc_html((int) ($c['created'] ?? 0) ? wp_date('M j, Y g:i a', (int) $c['created']) : '—'); ?></td>
                        <td><?php echo esc_html((string) ($c['email'] ?? '') ?: '—'); ?></td>
                        <td><?php echo esc_html($card ?: '—'); ?></td>
                        <td><?php echo esc_html($sym . number_format((float) ($c['amount'] ?? 0), 2)); ?></td>
                        <td>
                            <?php echo esc_html(\OE\Admin\TicketsAdmin::failure_label((string) ($c['code'] ?? ''))); ?>
                            <?php if (! empty($c['message'])) : ?><br><span class="description" style="font-size:12px"><?php echo esc_html((string) $c['message']); ?></span><?php endif; ?>
                        </td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
            <p class="description" style="margin-top:10px"><?php esc_html_e('Pulled live from Stripe (most recent failed charges in the window). Most declines are the customer’s bank, not your checkout — the buyer now sees plain-English guidance to call their bank or try another card.', 'october-events'); ?></p>

        <?php endif; ?>
    <?php endif; ?>
</div>
