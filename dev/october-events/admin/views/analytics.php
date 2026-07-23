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

// ---- Build overlay series (cumulative by weeks-before) for a given metric ----
$palette = ['#7c3aed', '#2563eb', '#059669', '#d97706', '#dc2626', '#0891b2', '#be185d', '#4d7c0f', '#9333ea', '#0d9488'];
// $metric = 'tickets' | 'revenue'. Returns [series[], maxWeek, maxY].
$build_overlay = static function (string $metric) use ($series, $history, $event_year, $palette): array {
    $live_key = $metric === 'revenue' ? 'cum_revenue' : 'cum_tickets';
    $hist_key = $metric === 'revenue' ? 'r' : 'q';
    $cs = []; $gmw = 0; $gmy = 0.0;
    if ($series) {
        $pts = [];
        foreach ($series as $s) { $pts[(int) $s['week_before']] = (float) $s[$live_key]; $gmw = max($gmw, (int) $s['week_before']); $gmy = max($gmy, (float) $s[$live_key]); }
        $cs[] = ['label' => ($event_year ?: __('This year', 'october-events')) . ' · ' . __('live', 'october-events'), 'color' => '#d14900', 'points' => $pts, 'w' => 3.2, 'live' => true];
    }
    $ci = 0;
    foreach ($history as $yr => $weeks) {
        $maxw = 0; foreach ($weeks as $wb => $v) { $maxw = max($maxw, (int) $wb); }
        $cum = 0.0; $pts = [];
        for ($w = $maxw; $w >= 0; $w--) { $cum += (float) ($weeks[(string) $w][$hist_key] ?? 0); $pts[$w] = $cum; }
        $gmw = max($gmw, $maxw); $gmy = max($gmy, $cum);
        $cs[] = ['label' => (string) $yr, 'color' => $palette[$ci++ % count($palette)], 'points' => $pts, 'w' => 1.8, 'live' => false];
    }
    return [$cs, $gmw, $gmy];
};
[$overlay_t, $gmw_t, $gmy_t] = $build_overlay('tickets');
[$overlay_r, $gmw_r, $gmy_r] = $build_overlay('revenue');
$has_charts = ! empty($overlay_t); // live sales OR imported history

// Compact axis-number formatter (e.g. 50900 → "50.9k").
$axis_num = static function (float $v): string {
    if ($v >= 1000) { return rtrim(rtrim(number_format($v / 1000, 1), '0'), '.') . 'k'; }
    return (string) (int) round($v);
};

// Draw one cumulative overlay chart (SVG + legend) for a metric.
$draw_overlay = static function (array $cs, int $gmw, float $gmy, string $metric) use ($wlabel, $axis_num, $cur_sym): void {
    $W = 1000; $H = 320; $padL = 52; $padR = 12; $padT = 12; $padB = 30;
    $plotW = $W - $padL - $padR; $plotH = $H - $padT - $padB;
    $gmw = max(1, $gmw); $gmy = max(1.0, $gmy);
    $X = static fn($wb) => $padL + (($gmw - $wb) / $gmw) * $plotW;
    $Y = static fn($v) => $padT + $plotH - ($v / $gmy) * $plotH;
    $stride = max(1, (int) ceil($gmw / 12));
    ?>
    <svg viewBox="0 0 <?php echo $W; ?> <?php echo $H; ?>" width="100%" style="display:block;max-height:340px" preserveAspectRatio="xMidYMid meet" role="img">
        <?php for ($g = 0; $g <= 4; $g++) : $gv = $gmy * $g / 4; $gy = $Y($gv); ?>
            <line x1="<?php echo $padL; ?>" y1="<?php echo round($gy, 1); ?>" x2="<?php echo $W - $padR; ?>" y2="<?php echo round($gy, 1); ?>" stroke="#eee" stroke-width="1"/>
            <text x="<?php echo $padL - 6; ?>" y="<?php echo round($gy + 3, 1); ?>" text-anchor="end" font-size="11" fill="#999"><?php echo esc_html($metric === 'revenue' ? ($cur_sym . $axis_num($gv)) : $axis_num($gv)); ?></text>
        <?php endfor; ?>
        <?php for ($wb = $gmw; $wb >= 0; $wb -= $stride) : $anchor = $wb === $gmw ? 'start' : ($wb === 0 ? 'end' : 'middle'); ?>
            <text x="<?php echo round($X($wb), 1); ?>" y="<?php echo $H - 10; ?>" text-anchor="<?php echo $anchor; ?>" font-size="11" fill="#777"><?php echo esc_html($wlabel((int) $wb)); ?></text>
        <?php endfor; ?>
        <?php foreach ($cs as $one) :
            $wbs = array_keys($one['points']); rsort($wbs, SORT_NUMERIC);
            $pline = [];
            foreach ($wbs as $wb) { $pline[] = round($X($wb), 1) . ',' . round($Y($one['points'][$wb]), 1); }
            if ($one['live']) : ?>
                <polygon points="<?php echo round($X($gmw), 1) . ',' . round($padT + $plotH, 1) . ' ' . esc_attr(implode(' ', $pline)) . ' ' . round($X(0), 1) . ',' . round($padT + $plotH, 1); ?>" fill="#E7CD41" fill-opacity="0.14"/>
            <?php endif; ?>
            <polyline points="<?php echo esc_attr(implode(' ', $pline)); ?>" fill="none" stroke="<?php echo esc_attr($one['color']); ?>" stroke-width="<?php echo (float) $one['w']; ?>" stroke-linejoin="round" stroke-linecap="round"<?php echo $one['live'] ? '' : ' opacity="0.85"'; ?>/>
        <?php endforeach; ?>
    </svg>
    <div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:10px">
        <?php foreach ($cs as $one) : ?>
            <span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#444">
                <span style="width:14px;height:3px;border-radius:2px;background:<?php echo esc_attr($one['color']); ?>;display:inline-block"></span>
                <?php echo esc_html($one['label']); ?>
            </span>
        <?php endforeach; ?>
    </div>
    <?php
};
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
            <div class="oe-skpi" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px"><div style="font-size:28px;font-weight:800"><?php echo (int) $peak['tickets']; ?></div><div style="color:#777;font-size:12px;text-transform:uppercase;letter-spacing:.06em"><?php echo esc_html(sprintf(__('Best week (%s)', 'october-events'), $wlabel((int) $peak['week_before']))); ?></div></div>
            <div class="oe-skpi" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px"><div style="font-size:28px;font-weight:800"><?php echo $days_to >= 0 ? (int) $days_to : esc_html__('—', 'october-events'); ?></div><div style="color:#777;font-size:12px;text-transform:uppercase;letter-spacing:.06em"><?php echo $days_to >= 0 ? esc_html__('Days to event', 'october-events') : esc_html__('Event has passed', 'october-events'); ?></div></div>
        </div>
        <?php endif; ?>

        <div class="oe-panel-label" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <span><?php echo count($overlay_t) > 1 ? esc_html__('Cumulative sales — year over year', 'october-events') : esc_html__('Cumulative sales — approaching the event', 'october-events'); ?></span>
            <span class="oe-metric-toggle" role="tablist" style="font-weight:400">
                <button type="button" class="button button-small oe-metric-btn is-active" data-metric="tickets" aria-pressed="true"><?php esc_html_e('Tickets', 'october-events'); ?></button>
                <button type="button" class="button button-small oe-metric-btn" data-metric="revenue" aria-pressed="false"><?php esc_html_e('Revenue', 'october-events'); ?></button>
            </span>
        </div>
        <div style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:14px">
            <div class="oe-metric-panel" data-metric="tickets"><?php $draw_overlay($overlay_t, $gmw_t, $gmy_t, 'tickets'); ?></div>
            <div class="oe-metric-panel" data-metric="revenue" style="display:none"><?php $draw_overlay($overlay_r, $gmw_r, $gmy_r, 'revenue'); ?></div>
        </div>
        <style>
            .oe-metric-toggle { display:inline-flex; gap:0 }
            .oe-metric-toggle .oe-metric-btn { border-radius:0 }
            .oe-metric-toggle .oe-metric-btn:first-child { border-radius:4px 0 0 4px }
            .oe-metric-toggle .oe-metric-btn:last-child { border-radius:0 4px 4px 0; margin-left:-1px }
            .oe-metric-toggle .oe-metric-btn.is-active { background:#1a1a1a; color:#fff; border-color:#1a1a1a; z-index:1 }
        </style>
        <script>
        (function(){
            var btns = document.querySelectorAll('.oe-metric-btn');
            var panels = document.querySelectorAll('.oe-metric-panel');
            btns.forEach(function(b){
                b.addEventListener('click', function(){
                    var m = b.getAttribute('data-metric');
                    btns.forEach(function(x){ var on = x === b; x.classList.toggle('is-active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
                    panels.forEach(function(p){ p.style.display = p.getAttribute('data-metric') === m ? '' : 'none'; });
                });
            });
        })();
        </script>

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
