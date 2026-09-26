<?php
/**
 * Check-in log — every recorded door scan, filterable by event, with per-venue
 * stats for the selected event. Mirrors the old Event Tickets "Check-in Log".
 *
 * @var array      $rows         check-in rows, collapsed to one per ticket × door
 * @var int        $total        total scans (for the current filter)
 * @var int        $groups       collapsed row count (for pagination)
 * @var array      $by_venue     [{event_id,venue,scans}] scans per event + door
 * @var array      $slots        ['slots'=>[['label','day','count'],…],'step'=>int,'multi_day'=>bool] check-in timeline, trimmed to the real window
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
$slot_rows = is_array($slots['slots'] ?? null) ? $slots['slots'] : [];
$slot_step = (int) ($slots['step'] ?? 15);
$slot_multi = ! empty($slots['multi_day']);
$slot_max  = 0;
foreach ($slot_rows as $s) { $slot_max = max($slot_max, (int) $s['count']); }
$accent    = (string) \OE\Settings::get('theme_accent', '') ?: '#C8A96E';
$venue_lbl = static fn(string $v): string => $v !== '' ? $v : __('(no door)', 'october-events');
$export_url = wp_nonce_url(admin_url('admin.php?page=oe-tickets&oe_export=checkins' . ($event_filter ? '&event=' . (int) $event_filter : '')), 'oe_export');
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
        <?php if ($total) : ?>
            <a class="button" style="margin-left:8px" href="<?php echo esc_url($export_url); ?>"><?php esc_html_e('Export log (CSV)', 'october-events'); ?></a>
        <?php endif; ?>
    </form>

    <?php if ($stats !== null) :
        $issued   = (int) ($stats['issued'] ?? 0);
        $attended = (int) ($stats['attended'] ?? 0);
        $no_show  = (int) ($stats['no_show'] ?? 0);
        $att_pct  = $issued ? (int) round($attended / $issued * 100) : 0;
        // Don't let rounding claim 100% attendance while no-shows remain (or 0%
        // while someone attended); keep the two shares summing to 100.
        if ($att_pct >= 100 && $attended < $issued) { $att_pct = 99; }
        if ($att_pct <= 0   && $attended > 0)       { $att_pct = 1;  }
        $ns_pct   = $issued ? 100 - $att_pct : 0;
        // Attendance pie (conic-gradient): attended (accent) vs no-show (grey).
        // Keep the degree an integer: a float concatenated into CSS renders with
        // the LC_NUMERIC decimal separator on PHP 7.4 (a supported version), so a
        // comma locale would emit "129,6deg" and break the gradient. Sub-degree
        // precision is invisible anyway.
        $att_deg  = $issued ? (int) round($attended / $issued * 360) : 0;
        $att_grad = $issued
            ? 'conic-gradient(' . $accent . ' 0deg ' . $att_deg . 'deg, #e3ded3 ' . $att_deg . 'deg 360deg)'
            : '#eee';
        ?>
        <?php if ($issued) : ?>
        <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:18px;margin-bottom:16px;max-width:680px;display:flex;gap:20px;align-items:center;flex-wrap:wrap">
            <div style="width:150px;height:150px;border-radius:50%;flex:none;background:<?php echo esc_attr($att_grad); ?>"></div>
            <div style="flex:1;min-width:220px">
                <div style="font-weight:700;margin-bottom:8px"><?php esc_html_e('Attendance', 'october-events'); ?></div>
                <div style="display:flex;align-items:center;gap:8px;margin:5px 0;font-size:14px">
                    <span style="width:12px;height:12px;border-radius:3px;flex:none;background:<?php echo esc_attr($accent); ?>"></span>
                    <span style="flex:1"><?php esc_html_e('Attended', 'october-events'); ?></span>
                    <strong><?php echo esc_html(number_format_i18n($attended)); ?></strong>
                    <span class="description" style="width:44px;text-align:right"><?php echo (int) $att_pct; ?>%</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;margin:5px 0;font-size:14px">
                    <span style="width:12px;height:12px;border-radius:3px;flex:none;background:#e3ded3"></span>
                    <span style="flex:1"><?php esc_html_e('No-show', 'october-events'); ?></span>
                    <strong><?php echo esc_html(number_format_i18n($no_show)); ?></strong>
                    <span class="description" style="width:44px;text-align:right"><?php echo (int) $ns_pct; ?>%</span>
                </div>
                <p class="description" style="margin:8px 0 0"><?php echo esc_html(sprintf(
                    /* translators: 1: attended, 2: issued tickets */
                    __('%1$s of %2$s valid tickets were scanned in.', 'october-events'),
                    number_format_i18n($attended), number_format_i18n($issued)
                )); ?></p>
            </div>
        </div>
        <?php endif; ?>
        <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:14px 16px;margin-bottom:16px;max-width:680px">
            <strong><?php echo esc_html(sprintf(__('%s unique attendees checked in', 'october-events'), number_format_i18n($attended))); ?></strong>
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

        <?php /* 2. When people checked in — trimmed to the real window, in short segments. */ ?>
        <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:14px 16px">
            <strong><?php esc_html_e('Check-in times', 'october-events'); ?></strong>
            <p class="description" style="margin:4px 0 12px"><?php echo esc_html(sprintf(
                /* translators: %d: minutes per bar */
                __('When scans happened, in %d-minute segments across the actual check-in window.', 'october-events'),
                $slot_step
            )); ?></p>
            <?php if (! $slot_rows) : ?>
                <p class="description"><?php esc_html_e('No scans yet.', 'october-events'); ?></p>
            <?php else : $n_slots = count($slot_rows); ?>
                <div style="display:flex;align-items:flex-end;gap:<?php echo $n_slots > 40 ? '1' : '2'; ?>px;height:140px">
                    <?php foreach ($slot_rows as $s) : $n = (int) $s['count']; $bh = $slot_max ? round($n / $slot_max * 100) : 0; ?>
                        <div title="<?php echo esc_attr(sprintf(_n('%1$s scan · %2$s', '%1$s scans · %2$s', $n, 'october-events'), number_format_i18n($n), ($slot_multi ? $s['day'] . ' ' : '') . $s['label'])); ?>" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%">
                            <div style="height:<?php echo (int) max(2, $bh); ?>%;background:<?php echo $n ? esc_attr($accent) : '#eee'; ?>;border-radius:2px 2px 0 0;min-height:2px"></div>
                        </div>
                    <?php endforeach; ?>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:10px;color:#999;margin-top:4px">
                    <?php
                    $first = $slot_rows[0];
                    $mid   = $slot_rows[(int) floor($n_slots / 2)];
                    $last  = $slot_rows[$n_slots - 1];
                    $tick  = static fn(array $s): string => ($slot_multi ? $s['day'] . ' ' : '') . $s['label'];
                    ?>
                    <span><?php echo esc_html($tick($first)); ?></span>
                    <?php if ($n_slots > 2) : ?><span><?php echo esc_html($tick($mid)); ?></span><?php endif; ?>
                    <span><?php echo esc_html($tick($last)); ?></span>
                </div>
            <?php endif; ?>
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
