<?php
/**
 * Ticket sales dashboard — KPIs, a 30-day tickets-sold bar chart, and per-event
 * sales. Mirrors the old Event Tickets "Ticket Sales Dashboard".
 *
 * @var array  $stats    Orders::stats()
 * @var array  $daily    Orders::daily_sales(30)  [{date,tickets,revenue}]
 * @var array  $events   Orders::event_summary()  [{event_id,tickets,revenue}]
 * @var string $currency
 */
defined('ABSPATH') || exit;
$money = static fn($n) => esc_html($currency . ' ' . number_format((float) $n, 2));
$max   = 1;
$tot30 = 0;
foreach ($daily as $d) { $max = max($max, (int) $d['tickets']); $tot30 += (int) $d['tickets']; }
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Tickets', 'october-events'); ?></h1>
    <?php \OE\Admin\Admin::bento('tickets'); ?>
    <?php \OE\Admin\Admin::tickets_tabs('sales'); ?>

    <div class="oe-salekpis" style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:16px 0">
        <div class="oe-skpi" style="background:#1a1a1a;color:#fff;border-radius:12px;padding:16px"><div style="font-size:28px;font-weight:800"><?php echo (int) $stats['tickets']; ?></div><div style="opacity:.7;font-size:12px;text-transform:uppercase;letter-spacing:.06em"><?php esc_html_e('Tickets sold (all time)', 'october-events'); ?></div></div>
        <div class="oe-skpi" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px"><div style="font-size:28px;font-weight:800"><?php echo $money($stats['revenue']); ?></div><div style="color:#777;font-size:12px;text-transform:uppercase;letter-spacing:.06em"><?php esc_html_e('Revenue (all time)', 'october-events'); ?></div></div>
        <div class="oe-skpi" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px"><div style="font-size:28px;font-weight:800"><?php echo (int) $stats['today_tickets']; ?></div><div style="color:#777;font-size:12px;text-transform:uppercase;letter-spacing:.06em"><?php esc_html_e('Tickets today', 'october-events'); ?></div></div>
        <div class="oe-skpi" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px"><div style="font-size:28px;font-weight:800"><?php echo $money($stats['today_revenue']); ?></div><div style="color:#777;font-size:12px;text-transform:uppercase;letter-spacing:.06em"><?php esc_html_e('Revenue today', 'october-events'); ?></div></div>
    </div>

    <div class="oe-panel-label"><?php esc_html_e('Tickets sold — last 30 days', 'october-events'); ?></div>
    <div style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:18px 18px 10px">
        <div style="display:flex;align-items:flex-end;gap:3px;height:180px">
            <?php foreach ($daily as $d) :
                $h = (int) round(((int) $d['tickets'] / $max) * 100);
                $label = date_i18n('M j', strtotime((string) $d['date'])) . ' · ' . (int) $d['tickets'] . ' tickets · ' . $currency . ' ' . number_format((float) $d['revenue'], 2); ?>
                <div title="<?php echo esc_attr($label); ?>" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%">
                    <div style="height:<?php echo max(2, $h); ?>%;background:<?php echo (int) $d['tickets'] ? '#E7CD41' : '#eee'; ?>;border-radius:3px 3px 0 0;min-height:2px"></div>
                </div>
            <?php endforeach; ?>
        </div>
        <p class="description" style="margin:10px 0 0"><?php echo esc_html(sprintf(__('%d tickets sold in the last 30 days. Hover a bar for the day.', 'october-events'), $tot30)); ?></p>
    </div>

    <div class="oe-panel-label"><?php esc_html_e('Sales by event', 'october-events'); ?></div>
    <table class="widefat striped">
        <thead><tr>
            <th><?php esc_html_e('Event', 'october-events'); ?></th>
            <th><?php esc_html_e('Tickets', 'october-events'); ?></th>
            <th><?php esc_html_e('Revenue', 'october-events'); ?></th>
            <th></th>
        </tr></thead>
        <tbody>
        <?php if (! $events) : ?>
            <tr><td colspan="4"><em><?php esc_html_e('No sales yet.', 'october-events'); ?></em></td></tr>
        <?php else : foreach ($events as $e) : ?>
            <tr>
                <td><strong><?php echo esc_html(get_the_title((int) $e->event_id) ?: ('#' . (int) $e->event_id)); ?></strong></td>
                <td><?php echo (int) $e->tickets; ?></td>
                <td><?php echo $money($e->revenue); ?></td>
                <td><a class="button button-small" href="<?php echo esc_url(admin_url('admin.php?page=oe-tickets&event=' . (int) $e->event_id)); ?>"><?php esc_html_e('Registrations', 'october-events'); ?></a></td>
            </tr>
        <?php endforeach; endif; ?>
        </tbody>
    </table>
</div>
