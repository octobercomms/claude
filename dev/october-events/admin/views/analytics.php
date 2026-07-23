<?php
/**
 * Sales analytics — weekly ticket sales leading up to an event's date. Set the
 * event date and the page counts sales week-by-week (and cumulatively) as the
 * event approaches: week 0 is the event week, week −1 the week before, etc.
 *
 * @var \WP_Post[] $events    published/draft events for the picker
 * @var int        $event_id  selected event
 * @var int        $event_ts  UTC timestamp of the event start (0 if none set)
 * @var array      $series    Orders::event_weekly_sales() — oldest→event, cumulative
 * @var string     $currency
 */
defined('ABSPATH') || exit;

$money  = static fn($n) => esc_html($currency . ' ' . number_format((float) $n, 2));
$title  = $event_id ? (get_the_title($event_id) ?: ('#' . $event_id)) : '';
$dinput = $event_ts ? wp_date('Y-m-d', $event_ts) : '';
$week   = 7 * DAY_IN_SECONDS;

$total_tickets = $series ? (int) end($series)['cum_tickets'] : 0;
$total_revenue = $series ? (float) end($series)['cum_revenue'] : 0.0;
$weeks_tracked = count($series);
$peak = ['tickets' => 0, 'week_before' => 0];
foreach ($series as $s) { if ($s['tickets'] > $peak['tickets']) { $peak = $s; } }
$days_to = $event_ts ? (int) ceil(($event_ts - time()) / DAY_IN_SECONDS) : 0;

/** Label for a "weeks before" bucket. */
$wlabel = static function (int $w): string {
    return $w === 0 ? __('Event wk', 'october-events') : '−' . $w;
};
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Tickets', 'october-events'); ?></h1>
    <?php \OE\Admin\Admin::bento('tickets'); ?>
    <?php \OE\Admin\Admin::tickets_tabs('analytics'); ?>

    <p class="description" style="margin:10px 0 14px;max-width:760px">
        <?php esc_html_e('Track ticket sales week by week as an event approaches. Pick an event and set its date — sales are then counted backwards from that date, so you can see how each week and the running total build toward the event.', 'october-events'); ?>
    </p>

    <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;margin-bottom:18px">
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

    <?php if (! $event_id) : ?>
        <div class="notice notice-warning inline"><p><?php esc_html_e('No events found. Create an event with ticket types first.', 'october-events'); ?></p></div>
    <?php elseif (! $event_ts) : ?>
        <div class="notice notice-warning inline"><p><?php echo esc_html(sprintf(__('“%s” has no date set. Add the event date above to see week-by-week sales leading up to it.', 'october-events'), $title)); ?></p></div>
    <?php elseif (! $series) : ?>
        <div class="notice notice-info inline"><p><?php echo esc_html(sprintf(__('No paid ticket sales yet for “%s” (event date %s).', 'october-events'), $title, wp_date('F j, Y', $event_ts))); ?></p></div>
    <?php else : ?>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin:6px 0 18px">
            <div class="oe-skpi" style="background:#1a1a1a;color:#fff;border-radius:12px;padding:16px"><div style="font-size:28px;font-weight:800"><?php echo (int) $total_tickets; ?></div><div style="opacity:.7;font-size:12px;text-transform:uppercase;letter-spacing:.06em"><?php esc_html_e('Tickets sold', 'october-events'); ?></div></div>
            <div class="oe-skpi" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px"><div style="font-size:28px;font-weight:800"><?php echo $money($total_revenue); ?></div><div style="color:#777;font-size:12px;text-transform:uppercase;letter-spacing:.06em"><?php esc_html_e('Revenue', 'october-events'); ?></div></div>
            <div class="oe-skpi" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px"><div style="font-size:28px;font-weight:800"><?php echo (int) $peak['tickets']; ?></div><div style="color:#777;font-size:12px;text-transform:uppercase;letter-spacing:.06em"><?php echo esc_html(sprintf(__('Best week (%s)', 'october-events'), $wlabel((int) $peak['week_before']))); ?></div></div>
            <div class="oe-skpi" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px"><div style="font-size:28px;font-weight:800"><?php echo $days_to >= 0 ? (int) $days_to : esc_html__('—', 'october-events'); ?></div><div style="color:#777;font-size:12px;text-transform:uppercase;letter-spacing:.06em"><?php echo $days_to >= 0 ? esc_html__('Days to event', 'october-events') : esc_html__('Event has passed', 'october-events'); ?></div></div>
        </div>

        <?php
        // ---- Cumulative curve (inline SVG) ----------------------------------
        $n     = count($series);
        $W = 1000; $H = 300; $padL = 44; $padR = 12; $padT = 12; $padB = 30;
        $plotW = $W - $padL - $padR;
        $plotH = $H - $padT - $padB;
        $maxY  = max(1, $total_tickets);
        $x = static fn($i) => $padL + ($n <= 1 ? $plotW / 2 : ($i / ($n - 1)) * $plotW);
        $y = static fn($v) => $padT + $plotH - ($v / $maxY) * $plotH;
        $line = [];
        foreach ($series as $i => $s) { $line[] = round($x($i), 1) . ',' . round($y($s['cum_tickets']), 1); }
        $area = round($x(0), 1) . ',' . round($padT + $plotH, 1) . ' ' . implode(' ', $line) . ' ' . round($x($n - 1), 1) . ',' . round($padT + $plotH, 1);
        // X label stride so we show ~12 labels max.
        $stride = max(1, (int) ceil($n / 12));
        ?>
        <div class="oe-panel-label"><?php esc_html_e('Cumulative tickets sold — approaching the event', 'october-events'); ?></div>
        <div style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:14px">
            <svg viewBox="0 0 <?php echo $W; ?> <?php echo $H; ?>" width="100%" style="display:block;max-height:320px" preserveAspectRatio="xMidYMid meet" role="img" aria-label="<?php esc_attr_e('Cumulative tickets sold by week before the event', 'october-events'); ?>">
                <?php for ($g = 0; $g <= 4; $g++) : $gv = $maxY * $g / 4; $gy = $y($gv); ?>
                    <line x1="<?php echo $padL; ?>" y1="<?php echo round($gy, 1); ?>" x2="<?php echo $W - $padR; ?>" y2="<?php echo round($gy, 1); ?>" stroke="#eee" stroke-width="1"/>
                    <text x="<?php echo $padL - 6; ?>" y="<?php echo round($gy + 3, 1); ?>" text-anchor="end" font-size="11" fill="#999"><?php echo (int) round($gv); ?></text>
                <?php endfor; ?>
                <polygon points="<?php echo esc_attr($area); ?>" fill="#E7CD41" fill-opacity="0.18"/>
                <polyline points="<?php echo esc_attr(implode(' ', $line)); ?>" fill="none" stroke="#d14900" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
                <?php foreach ($series as $i => $s) : if ($i % $stride !== 0 && $i !== $n - 1) { continue; }
                    $anchor = $i === 0 ? 'start' : ($i === $n - 1 ? 'end' : 'middle'); ?>
                    <circle cx="<?php echo round($x($i), 1); ?>" cy="<?php echo round($y($s['cum_tickets']), 1); ?>" r="2.5" fill="#d14900"/>
                    <text x="<?php echo round($x($i), 1); ?>" y="<?php echo $H - 10; ?>" text-anchor="<?php echo $anchor; ?>" font-size="11" fill="#777"><?php echo esc_html($wlabel((int) $s['week_before'])); ?></text>
                <?php endforeach; ?>
            </svg>
        </div>

        <?php
        // ---- Per-week bars ---------------------------------------------------
        $maxWk = 1; foreach ($series as $s) { $maxWk = max($maxWk, (int) $s['tickets']); }
        ?>
        <div class="oe-panel-label"><?php esc_html_e('Tickets sold each week', 'october-events'); ?></div>
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

        <div class="oe-panel-label"><?php esc_html_e('Weekly breakdown', 'october-events'); ?></div>
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
            <?php foreach ($series as $s) :
                $w = (int) $s['week_before'];
                $wk_start = $event_ts - $w * $week; // start of that week window
            ?>
                <tr>
                    <td><strong><?php echo esc_html($wlabel($w)); ?></strong></td>
                    <td><?php echo esc_html(wp_date('M j, Y', $wk_start)); ?></td>
                    <td><?php echo (int) $s['tickets']; ?></td>
                    <td><?php echo $money($s['revenue']); ?></td>
                    <td><?php echo (int) $s['cum_tickets']; ?></td>
                    <td><?php echo $money($s['cum_revenue']); ?></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>

    <?php endif; ?>
</div>
