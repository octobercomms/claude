<?php
/**
 * Check-in log — every recorded door scan, filterable by event, with per-venue
 * stats for the selected event. Mirrors the old Event Tickets "Check-in Log".
 *
 * @var array      $rows         check-in rows (joined with ticket)
 * @var int        $total        total scans (for the current filter)
 * @var array|null $stats        ['unique'=>int,'venues'=>[['venue','count'],…]] when an event is selected
 * @var int        $pages        total pages
 * @var int        $paged        current page
 * @var int        $per_page
 * @var \WP_Post[] $events       published events
 * @var int        $event_filter
 */
defined('ABSPATH') || exit;
$base = admin_url('admin.php?page=oe-tickets&tab=checkin');
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

    <table class="widefat striped">
        <thead><tr>
            <?php if (! $event_filter) : ?><th><?php esc_html_e('Event', 'october-events'); ?></th><?php endif; ?>
            <th><?php esc_html_e('Attendee', 'october-events'); ?></th>
            <th><?php esc_html_e('Ticket type', 'october-events'); ?></th>
            <th><?php esc_html_e('Ticket #', 'october-events'); ?></th>
            <th><?php esc_html_e('Door / venue', 'october-events'); ?></th>
            <th><?php esc_html_e('Scanned at', 'october-events'); ?></th>
        </tr></thead>
        <tbody>
        <?php if (! $rows) : ?>
            <tr><td colspan="<?php echo $event_filter ? 5 : 6; ?>"><em><?php esc_html_e('No check-ins recorded yet.', 'october-events'); ?></em></td></tr>
        <?php else : foreach ($rows as $r) : ?>
            <tr>
                <?php if (! $event_filter) : ?><td><?php echo esc_html(get_the_title((int) $r->event_id) ?: ('#' . (int) $r->event_id)); ?></td><?php endif; ?>
                <td><?php echo esc_html((string) ($r->attendee_name ?? '') ?: '—'); ?></td>
                <td><?php echo esc_html((string) ($r->ticket_type_label ?? '') ?: '—'); ?></td>
                <td><?php echo esc_html(((int) ($r->ticket_number ?? 1)) . ' / ' . ((int) ($r->total_in_order ?? 1))); ?></td>
                <td><?php echo esc_html((string) ($r->venue_name ?? '') ?: __('(no venue)', 'october-events')); ?></td>
                <td><?php echo esc_html(get_date_from_gmt((string) $r->scanned_at, 'M j, Y g:i a')); ?></td>
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
