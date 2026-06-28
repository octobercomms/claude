<?php
/**
 * Check-in log — every recorded door scan, filterable by event, with per-venue
 * stats for the selected event. Mirrors the old Event Tickets "Check-in Log".
 *
 * @var array      $rows         check-in rows, collapsed to one per ticket × door
 * @var int        $total        total scans (for the current filter)
 * @var int        $groups       collapsed row count (for pagination)
 * @var array      $by_venue     [{event_id,venue,scans}] scans per event + door
 * @var array      $by_hour      [0..23 => count] scans by hour of the local day
 * @var array|null $stats        ['unique'=>int,'venues'=>[['venue','count'],…]] when an event is selected
 * @var int        $pages        total pages
 * @var int        $paged        current page
 * @var int        $per_page
 * @var \WP_Post[] $events       published events
 * @var int        $event_filter
 */
defined('ABSPATH') || exit;
$base = admin_url('admin.php?page=oe-tickets&tab=checkin');

// ---- Chart prep -----------------------------------------------------------
// Group door scans by event; rows arrive most-scanned door first per event.
$ev_doors = [];
foreach ($by_venue as $r) { $ev_doors[(int) $r->event_id][] = $r; }
$venue_max = 0;
foreach ($by_venue as $r) { $venue_max = max($venue_max, (int) $r->scans); }
$hour_max  = $by_hour ? max($by_hour) : 0;
$accent    = (string) \OE\Settings::get('theme_accent', '') ?: '#C8A96E';
$venue_lbl = static fn(string $v): string => $v !== '' ? $v : __('(no door)', 'october-events');
$hr_label  = static function (int $h): string {
    $ampm = $h < 12 ? 'a' : 'p'; $h12 = $h % 12; if ($h12 === 0) { $h12 = 12; }
    return $h12 . $ampm;
};
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Tickets', 'october-events'); ?></h1>
    <?php \OE\Admin\Admin::bento('tickets'); ?>
    <?php \OE\Admin\Admin::tickets_tabs('checkin'); ?>

    <?php $test_url = home_url('/checkin'); ?>
    <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px 18px;margin:16px 0;display:flex;gap:20px;align-items:center;flex-wrap:wrap">
        <div id="oe-test-qr" style="width:150px;height:150px;flex:none"></div>
        <div style="flex:1;min-width:260px">
            <strong>🧪 <?php esc_html_e('Test the scanner', 'october-events'); ?></strong>
            <p class="description" style="margin:6px 0"><?php esc_html_e('A safe, always-available demo — great for showing the team. Nothing is recorded.', 'october-events'); ?></p>
            <ol style="margin:0 0 0 18px;font-size:13px;line-height:1.6">
                <li><?php printf(esc_html__('On a phone, open %s', 'october-events'), '<a href="' . esc_url($test_url) . '" target="_blank" rel="noopener">' . esc_html($test_url) . '</a>'); ?></li>
                <li><?php printf(esc_html__('Choose %1$s, enter PIN %2$s, pick %3$s.', 'october-events'), '“🧪 Test (scanner check)”', '<code>' . esc_html(\OE\Ticketing\CheckIn::TEST_PIN) . '</code>', '“Test door”'); ?></li>
                <li><?php esc_html_e('Scan this QR — you should see a green “✓ Welcome, Test Attendee”.', 'october-events'); ?></li>
            </ol>
            <p style="margin:8px 0 0"><a class="button button-small" href="<?php echo esc_url(home_url('/?oe_ticket=' . \OE\Ticketing\CheckIn::TEST_TOKEN)); ?>" target="_blank" rel="noopener"><?php esc_html_e('Open the test ticket ↗', 'october-events'); ?></a>
                <span class="description"><?php esc_html_e('A real ticket page you can open on another phone and scan.', 'october-events'); ?></span></p>
        </div>
    </div>
    <script src="<?php echo esc_url(OE_URL . 'assets/js/qrcode.min.js'); ?>"></script>
    <script>(function(){ var el=document.getElementById('oe-test-qr'); if(el&&window.QRCode){ new QRCode(el,{ text: <?php echo wp_json_encode(\OE\Ticketing\CheckIn::TEST_TOKEN); ?>, width:150, height:150 }); } else if(el){ el.textContent=<?php echo wp_json_encode(\OE\Ticketing\CheckIn::TEST_TOKEN); ?>; } })();</script>

    <form method="get" style="margin:16px 0">
        <input type="hidden" name="page" value="oe-tickets">
        <input type="hidden" name="tab" value="checkin">
        <label><?php esc_html_e('Event', 'october-events'); ?>
            <select name="event" onchange="this.form.submit()">
                <option value="0"><?php esc_html_e('All events', 'october-events'); ?></option>
                <?php foreach ($events as $ev) : ?>
                    <option value="<?php echo (int) $ev->ID; ?>" <?php selected($event_filter, $ev->ID); ?>><?php echo esc_html(get_the_title($ev)); ?></option>
                <?php endforeach; ?>
            </select>
        </label>
        <span class="description" style="margin-left:8px"><?php echo esc_html(sprintf(_n('%s scan recorded', '%s scans recorded', $total, 'october-events'), number_format_i18n($total))); ?></span>
    </form>

    <?php if ($stats !== null) : ?>
        <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:14px 16px;margin-bottom:16px;max-width:680px">
            <strong><?php echo esc_html(sprintf(__('%s unique attendees checked in', 'october-events'), number_format_i18n((int) $stats['unique']))); ?></strong>
            <?php if (! empty($stats['venues'])) : ?>
                <table class="widefat striped" style="margin-top:10px">
                    <thead><tr><th><?php esc_html_e('Door / venue', 'october-events'); ?></th><th><?php esc_html_e('Scans', 'october-events'); ?></th></tr></thead>
                    <tbody>
                    <?php foreach ($stats['venues'] as $v) : ?>
                        <tr><td><?php echo esc_html($v['venue'] !== '' ? $v['venue'] : __('(no venue)', 'october-events')); ?></td><td><?php echo (int) $v['count']; ?></td></tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endif; ?>
        </div>
    <?php endif; ?>

    <?php if ($by_venue) : ?>
    <div class="oe-ci-charts" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;margin-bottom:18px">

        <?php /* 1. Scans by event + door (single door → just the event name). */ ?>
        <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:14px 16px">
            <strong><?php esc_html_e('Scans by door', 'october-events'); ?></strong>
            <p class="description" style="margin:4px 0 12px"><?php esc_html_e('Each event split out by door.', 'october-events'); ?></p>
            <?php foreach ($ev_doors as $eid => $doors) : $single = count($doors) === 1; ?>
                <?php if (! $event_filter) : ?>
                    <div style="font-weight:600;font-size:13px;margin:10px 0 6px"><?php echo esc_html(get_the_title((int) $eid) ?: ('#' . (int) $eid)); ?></div>
                <?php endif; ?>
                <?php foreach ($doors as $d) : $w = $venue_max ? round((int) $d->scans / $venue_max * 100) : 0; ?>
                    <div style="display:flex;align-items:center;gap:10px;margin:5px 0">
                        <div style="width:130px;font-size:12px;color:#444;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><?php echo esc_html($single && ! $event_filter ? '↳ ' . $venue_lbl((string) $d->venue) : $venue_lbl((string) $d->venue)); ?></div>
                        <div style="flex:1;background:#f0ede6;border-radius:4px;height:16px"><div style="width:<?php echo (int) max(2, $w); ?>%;background:<?php echo esc_attr($accent); ?>;height:16px;border-radius:4px"></div></div>
                        <div style="width:34px;text-align:right;font-size:12px;font-weight:600"><?php echo (int) $d->scans; ?></div>
                    </div>
                <?php endforeach; ?>
            <?php endforeach; ?>
        </div>

        <?php /* 2. Time of day tickets were scanned. */ ?>
        <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:14px 16px">
            <strong><?php esc_html_e('Time of day', 'october-events'); ?></strong>
            <p class="description" style="margin:4px 0 12px"><?php esc_html_e('When scans happened, by hour.', 'october-events'); ?></p>
            <div style="display:flex;align-items:flex-end;gap:2px;height:140px">
                <?php for ($h = 0; $h < 24; $h++) : $n = (int) ($by_hour[$h] ?? 0); $bh = $hour_max ? round($n / $hour_max * 100) : 0; ?>
                    <div title="<?php echo esc_attr(sprintf(_n('%1$s scan at %2$s', '%1$s scans at %2$s', $n, 'october-events'), number_format_i18n($n), $hr_label($h))); ?>" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%">
                        <div style="height:<?php echo (int) max(2, $bh); ?>%;background:<?php echo $n ? esc_attr($accent) : '#eee'; ?>;border-radius:2px 2px 0 0;min-height:2px"></div>
                    </div>
                <?php endfor; ?>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:10px;color:#999;margin-top:4px">
                <span><?php echo esc_html($hr_label(0)); ?></span><span><?php echo esc_html($hr_label(6)); ?></span><span><?php echo esc_html($hr_label(12)); ?></span><span><?php echo esc_html($hr_label(18)); ?></span><span><?php echo esc_html($hr_label(23)); ?></span>
            </div>
        </div>

        <?php /* 3. Most popular door per event (the busiest home on the tour). */ ?>
        <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:14px 16px">
            <strong><?php esc_html_e('Most popular door', 'october-events'); ?></strong>
            <p class="description" style="margin:4px 0 12px"><?php esc_html_e('The busiest stop on each tour, by total scans.', 'october-events'); ?></p>
            <?php foreach ($ev_doors as $eid => $doors) : $top = $doors[0]; ?>
                <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid #f0ede6">
                    <div style="font-size:20px">🏆</div>
                    <div style="flex:1;min-width:0">
                        <?php if (! $event_filter) : ?><div style="font-size:11px;color:#999;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><?php echo esc_html(get_the_title((int) $eid) ?: ('#' . (int) $eid)); ?></div><?php endif; ?>
                        <div style="font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><?php echo esc_html($venue_lbl((string) $top->venue)); ?></div>
                    </div>
                    <div style="text-align:right"><div style="font-weight:800;font-size:16px;color:<?php echo esc_attr($accent); ?>"><?php echo (int) $top->scans; ?></div><div style="font-size:10px;color:#999"><?php esc_html_e('scans', 'october-events'); ?></div></div>
                </div>
            <?php endforeach; ?>
        </div>

    </div>
    <?php endif; ?>

    <table class="widefat striped">
        <thead><tr>
            <?php if (! $event_filter) : ?><th><?php esc_html_e('Event', 'october-events'); ?></th><?php endif; ?>
            <th><?php esc_html_e('Attendee', 'october-events'); ?></th>
            <th><?php esc_html_e('Ticket type', 'october-events'); ?></th>
            <th><?php esc_html_e('Ticket #', 'october-events'); ?></th>
            <th><?php esc_html_e('Door / venue', 'october-events'); ?></th>
            <th><?php esc_html_e('Rescans', 'october-events'); ?></th>
            <th><?php esc_html_e('Scanned at', 'october-events'); ?></th>
        </tr></thead>
        <tbody>
        <?php if (! $rows) : ?>
            <tr><td colspan="<?php echo $event_filter ? 6 : 7; ?>"><em><?php esc_html_e('No check-ins recorded yet.', 'october-events'); ?></em></td></tr>
        <?php else : foreach ($rows as $r) :
            $rescans = (int) ($r->rescans ?? 0);
            $first = get_date_from_gmt((string) $r->first_at, 'M j, Y g:i a');
            $last  = get_date_from_gmt((string) $r->last_at, 'M j, Y g:i a'); ?>
            <tr>
                <?php if (! $event_filter) : ?><td><?php echo esc_html(get_the_title((int) $r->event_id) ?: ('#' . (int) $r->event_id)); ?></td><?php endif; ?>
                <td><?php echo esc_html((string) ($r->attendee_name ?? '') ?: '—'); ?></td>
                <td><?php echo esc_html((string) ($r->ticket_type_label ?? '') ?: '—'); ?></td>
                <td><?php echo esc_html(((int) ($r->ticket_number ?? 1)) . ' / ' . ((int) ($r->total_in_order ?? 1))); ?></td>
                <td><?php echo esc_html((string) ($r->venue_name ?? '') ?: __('(no venue)', 'october-events')); ?></td>
                <td><?php if ($rescans > 0) : ?><span title="<?php echo esc_attr(sprintf(__('Scanned %d times at this door', 'october-events'), (int) $r->scans)); ?>" style="display:inline-block;background:#f3d9a6;color:#7a5a12;font-weight:700;font-size:12px;padding:1px 8px;border-radius:999px"><?php echo esc_html('×' . $rescans); ?></span><?php else : ?><span style="color:#bbb">—</span><?php endif; ?></td>
                <td><?php echo esc_html($first); ?><?php if ($rescans > 0 && $last !== $first) : ?><br><span style="font-size:11px;color:#888"><?php echo esc_html(sprintf(__('last %s', 'october-events'), $last)); ?></span><?php endif; ?></td>
            </tr>
        <?php endforeach; endif; ?>
        </tbody>
    </table>

    <?php if ($pages > 1) : ?>
        <div class="tablenav"><div class="tablenav-pages" style="margin:12px 0">
            <?php
            $args = ['page' => 'oe-tickets', 'tab' => 'checkin'];
            if ($event_filter) { $args['event'] = $event_filter; }
            echo paginate_links([
                'base'      => add_query_arg('paged', '%#%', admin_url('admin.php?' . http_build_query($args))),
                'format'    => '',
                'current'   => $paged,
                'total'     => $pages,
                'prev_text' => '‹',
                'next_text' => '›',
            ]);
            ?>
        </div></div>
    <?php endif; ?>
</div>
