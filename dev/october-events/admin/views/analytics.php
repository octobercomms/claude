<?php
/**
 * Sales analytics — weekly ticket sales leading up to an event's date, with an
 * optional year-over-year overlay from imported prior-year weekly history.
 *
 * Week 0 is the event week; −1 the week before, etc. The cumulative chart plots
 * the live current-year curve plus a line per imported prior year, all aligned by
 * "weeks before the event" so you can see whether this year is pacing ahead.
 *
 * @var \WP_Post[] $events
 * @var int        $event_id
 * @var int        $event_ts     UTC timestamp of the event start (0 if none set)
 * @var int        $event_year   calendar year of the event (0 if no date)
 * @var array      $series       Orders::event_weekly_sales() — oldest→event, cumulative
 * @var array      $history      [year => [weeks_before => ['q'=>int,'r'=>float]]]
 * @var string     $currency
 */
defined('ABSPATH') || exit;

$money  = static fn($n) => esc_html($currency . ' ' . number_format((float) $n, 2));
$cur_sym = ['USD' => '$', 'GBP' => '£', 'EUR' => '€', 'CAD' => '$', 'AUD' => '$'][$currency] ?? ($currency . ' ');
$title  = $event_id ? (get_the_title($event_id) ?: ('#' . $event_id)) : '';
$dinput = $event_ts ? wp_date('Y-m-d', $event_ts) : '';
$week   = 7 * DAY_IN_SECONDS;
$wlabel = static fn(int $w): string => $w === 0 ? __('Event wk', 'october-events') : '−' . $w;

// Live-year KPIs.
$total_tickets = $series ? (int) end($series)['cum_tickets'] : 0;
$total_revenue = $series ? (float) end($series)['cum_revenue'] : 0.0;
$peak = ['tickets' => 0, 'week_before' => 0];
foreach ($series as $s) { if ($s['tickets'] > $peak['tickets']) { $peak = $s; } }
$days_to = $event_ts ? (int) ceil(($event_ts - time()) / DAY_IN_SECONDS) : 0;

// Existing history, as CSV, to prefill the import box (so it round-trips).
$hist_csv = '';
foreach ($history as $yr => $weeks) {
    ksort($weeks, SORT_NUMERIC);
    foreach ($weeks as $wb => $v) { $hist_csv .= $yr . ',' . $wb . ',' . (int) $v['q'] . ',' . (float) $v['r'] . "\n"; }
}

// Gross profit after card fees, for the live year (fee inputs from the controller).
$fees        = $total_revenue * ($fee_pct / 100) + $paid_txns * $fee_fixed;
$gross_profit = max(0, $total_revenue - $fees);
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Tickets', 'october-events'); ?></h1>
    <?php \OE\Admin\Admin::bento('tickets'); ?>
    <?php \OE\Admin\Admin::tickets_tabs('analytics'); ?>

    <p class="description" style="margin:10px 0 14px;max-width:820px">
        <?php esc_html_e('Track ticket sales week by week as an event approaches — pick an event, set its date, and sales are counted backwards from that date (week 0 = event week). Import prior years to overlay a year-over-year comparison and see whether this year is pacing ahead.', 'october-events'); ?>
    </p>

    <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;margin-bottom:14px">
        <form method="get" action="<?php echo esc_url(admin_url('admin.php')); ?>">
            <input type="hidden" name="page" value="oe-tickets">
            <input type="hidden" name="tab" value="analytics">
            <label style="font-weight:600"><?php esc_html_e('Event', 'october-events'); ?><br>
                <select name="event" onchange="this.form.submit()" style="min-width:260px">
                    <?php foreach ($events as $ev) :
                        $ets = \OE\Ticketing\Ics::start_ts((int) $ev->ID);
                        $lbl = (get_the_title($ev) ?: ('#' . (int) $ev->ID)) . ($ets ? ' — ' . wp_date('M j, Y', $ets) : '');
                    ?>
                        <option value="<?php echo (int) $ev->ID; ?>" <?php selected($event_id, (int) $ev->ID); ?>><?php echo esc_html($lbl); ?></option>
                    <?php endforeach; ?>
                </select>
            </label>
        </form>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:flex;gap:8px;align-items:flex-end">
            <input type="hidden" name="action" value="oe_set_event_date">
            <input type="hidden" name="event_id" value="<?php echo (int) $event_id; ?>">
            <?php wp_nonce_field('oe_set_event_date'); ?>
            <label style="font-weight:600"><?php esc_html_e('Event date', 'october-events'); ?><br>
                <input type="date" name="event_date" value="<?php echo esc_attr($dinput); ?>">
            </label>
            <button class="button"><?php esc_html_e('Save date', 'october-events'); ?></button>
        </form>
        <a class="button" href="<?php echo esc_url(admin_url('admin.php?page=oe-tickets&event=' . (int) $event_id)); ?>" style="margin-bottom:1px"><?php esc_html_e('View registrations', 'october-events'); ?></a>
    </div>

    <?php if ($event_id) : ?>
    <details class="oe-hist-import" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:6px 16px;margin-bottom:18px"<?php echo $history ? '' : ''; ?>>
        <summary style="cursor:pointer;font-weight:600;padding:8px 0">
            <?php esc_html_e('Prior-year data (year-over-year overlay)', 'october-events'); ?>
            <?php if ($history) : ?><span class="description">— <?php echo esc_html(sprintf(_n('%d year imported', '%d years imported', count($history), 'october-events'), count($history))); ?></span><?php endif; ?>
        </summary>
        <div style="padding:6px 0 14px">
            <p class="description" style="max-width:820px">
                <?php esc_html_e('Paste one row per week per year — CSV columns: year, weeks_before, quantity, revenue (a header row is fine). weeks_before is 0 for the event week, 1 for the week before, etc. Re-importing replaces the stored history; an empty box clears it.', 'october-events'); ?>
            </p>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <input type="hidden" name="action" value="oe_import_history">
                <input type="hidden" name="event_id" value="<?php echo (int) $event_id; ?>">
                <?php wp_nonce_field('oe_import_history'); ?>
                <textarea name="history_csv" rows="8" class="large-text code" placeholder="year,weeks_before,quantity,revenue&#10;2025,0,121,3156&#10;2025,1,69,2220"><?php echo esc_textarea($hist_csv); ?></textarea>
                <p><button class="button button-primary"><?php esc_html_e('Import / update history', 'october-events'); ?></button></p>
            </form>
        </div>
    </details>
    <?php endif; ?>

    <?php if (! $event_id) : ?>
        <div class="notice notice-warning inline"><p><?php esc_html_e('No events found. Create an event with ticket types first.', 'october-events'); ?></p></div>
    <?php elseif (! $has_charts) : ?>
        <div class="notice notice-info inline"><p>
            <?php if (! $event_ts) : ?>
                <?php echo esc_html(sprintf(__('“%s” has no date set. Add the event date above (and/or import prior years) to see the charts.', 'october-events'), $title)); ?>
            <?php else : ?>
                <?php echo esc_html(sprintf(__('No paid sales yet for “%s”, and no prior-year data imported. Sales will appear here as they come in.', 'october-events'), $title)); ?>
            <?php endif; ?>
        </p></div>
    <?php else : ?>

        <?php if ($series) : ?>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin:6px 0 18px">
            <div class="oe-skpi" style="background:#1a1a1a;color:#fff;border-radius:12px;padding:16px"><div style="font-size:28px;font-weight:800"><?php echo (int) $total_tickets; ?></div><div style="opacity:.7;font-size:12px;text-transform:uppercase;letter-spacing:.06em"><?php esc_html_e('Tickets sold', 'october-events'); ?></div></div>
            <div class="oe-skpi" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px"><div style="font-size:28px;font-weight:800"><?php echo $money($total_revenue); ?></div><div style="color:#777;font-size:12px;text-transform:uppercase;letter-spacing:.06em"><?php esc_html_e('Revenue', 'october-events'); ?></div></div>
            <div class="oe-skpi" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px" title="<?php echo esc_attr(sprintf(__('Revenue minus card fees (%1$s%% + %2$s per transaction, %3$d transactions). Set the fee under Settings → Checkout.', 'october-events'), rtrim(rtrim(number_format($fee_pct, 2), '0'), '.'), $currency . ' ' . number_format($fee_fixed, 2), (int) $paid_txns)); ?>"><div style="font-size:28px;font-weight:800"><?php echo $money($gross_profit); ?></div><div style="color:#777;font-size:12px;text-transform:uppercase;letter-spacing:.06em"><?php esc_html_e('Gross profit (after fees)', 'october-events'); ?></div></div>
            <div class="oe-skpi" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px"><div style="font-size:28px;font-weight:800"><?php echo (int) $peak['tickets']; ?></div><div style="color:#777;font-size:12px;text-transform:uppercase;letter-spacing:.06em"><?php echo esc_html(sprintf(__('Best week (%s)', 'october-events'), $wlabel((int) $peak['week_before']))); ?></div></div>
            <div class="oe-skpi" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px"><div style="font-size:28px;font-weight:800"><?php echo $days_to >= 0 ? (int) $days_to : esc_html__('—', 'october-events'); ?></div><div style="color:#777;font-size:12px;text-transform:uppercase;letter-spacing:.06em"><?php echo $days_to >= 0 ? esc_html__('Days to event', 'october-events') : esc_html__('Event has passed', 'october-events'); ?></div></div>
        </div>
        <?php endif; ?>

        <div class="oe-panel-label" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <span><?php echo $history ? esc_html__('Cumulative sales — year over year', 'october-events') : esc_html__('Cumulative sales — approaching the event', 'october-events'); ?></span>
            <span class="oe-metric-toggle" role="tablist" style="font-weight:400">
                <button type="button" class="button button-small oe-metric-btn is-active" data-metric="tickets" aria-pressed="true"><?php esc_html_e('Tickets', 'october-events'); ?></button>
                <button type="button" class="button button-small oe-metric-btn" data-metric="revenue" aria-pressed="false"><?php esc_html_e('Revenue', 'october-events'); ?></button>
            </span>
        </div>
        <div style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:14px">
            <div id="oe-yoy-chart" style="position:relative;min-height:200px"></div>
            <div id="oe-yoy-tip" class="oe-yoy-tip"></div>
            <div id="oe-yoy-legend" class="oe-yoy-legend"></div>
            <p class="description" style="margin:8px 0 0"><?php esc_html_e('Click a year to show/hide it (the scale adjusts to the visible lines). Hover a line for its year and value.', 'october-events'); ?></p>
        </div>
        <style>
            .oe-metric-toggle { display:inline-flex; gap:0 }
            .oe-metric-toggle .oe-metric-btn { border-radius:0 }
            .oe-metric-toggle .oe-metric-btn:first-child { border-radius:4px 0 0 4px }
            .oe-metric-toggle .oe-metric-btn:last-child { border-radius:0 4px 4px 0; margin-left:-1px }
            .oe-metric-toggle .oe-metric-btn.is-active { background:#1a1a1a; color:#fff; border-color:#1a1a1a; z-index:1 }
            .oe-yoy-legend { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px }
            .oe-yoy-leg { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#333; background:#fff; border:1px solid #e0dbcf; border-radius:20px; padding:3px 10px; cursor:pointer }
            .oe-yoy-leg .sw { width:14px; height:3px; border-radius:2px; display:inline-block }
            .oe-yoy-leg.is-off { opacity:.4; text-decoration:line-through }
            .oe-yoy-tip { position:fixed; z-index:100000; display:none; pointer-events:none; background:#1a1a1a; color:#fff; font-size:12px; line-height:1.35; padding:6px 9px; border-radius:6px; box-shadow:0 4px 14px rgba(0,0,0,.18); white-space:nowrap }
            #oe-yoy-chart { position:relative }
        </style>

        <?php if ($series) : ?>
        <?php $maxWk = 1; foreach ($series as $s) { $maxWk = max($maxWk, (int) $s['tickets']); } ?>
        <div class="oe-panel-label"><?php esc_html_e('Tickets sold each week (this year)', 'october-events'); ?></div>
        <div style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:18px 18px 10px">
            <div style="display:flex;align-items:flex-end;gap:4px;height:170px">
                <?php foreach ($series as $s) :
                    $h = (int) round(((int) $s['tickets'] / $maxWk) * 100);
                    $lab = sprintf(__('%1$s · %2$d tickets · %3$s', 'october-events'), $wlabel((int) $s['week_before']), (int) $s['tickets'], $currency . ' ' . number_format((float) $s['revenue'], 2)); ?>
                    <div title="<?php echo esc_attr($lab); ?>" style="flex:1;min-width:6px;display:flex;flex-direction:column;justify-content:flex-end;height:100%">
                        <div style="height:<?php echo max(2, $h); ?>%;background:<?php echo (int) $s['tickets'] ? '#1a1a1a' : '#eee'; ?>;border-radius:3px 3px 0 0;min-height:2px"></div>
                    </div>
                <?php endforeach; ?>
            </div>
            <p class="description" style="margin:10px 0 0"><?php esc_html_e('Each bar is one week before the event (right-most = event week). Hover for detail.', 'october-events'); ?></p>
        </div>

        <div class="oe-panel-label"><?php esc_html_e('Weekly breakdown (this year)', 'october-events'); ?></div>
        <table class="widefat striped">
            <thead><tr>
                <th><?php esc_html_e('Week', 'october-events'); ?></th>
                <th><?php esc_html_e('Week starting', 'october-events'); ?></th>
                <th><?php esc_html_e('Tickets', 'october-events'); ?></th>
                <th><?php esc_html_e('Revenue', 'october-events'); ?></th>
                <th><?php esc_html_e('Cumulative tickets', 'october-events'); ?></th>
                <th><?php esc_html_e('Cumulative revenue', 'october-events'); ?></th>
            </tr></thead>
            <tbody>
            <?php foreach ($series as $s) : $w = (int) $s['week_before']; ?>
                <tr>
                    <td><strong><?php echo esc_html($wlabel($w)); ?></strong></td>
                    <td><?php echo esc_html(wp_date('M j, Y', $event_ts - $w * $week)); ?></td>
                    <td><?php echo (int) $s['tickets']; ?></td>
                    <td><?php echo $money($s['revenue']); ?></td>
                    <td><?php echo (int) $s['cum_tickets']; ?></td>
                    <td><?php echo $money($s['cum_revenue']); ?></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
        <?php endif; ?>

    <?php endif; ?>
</div>
