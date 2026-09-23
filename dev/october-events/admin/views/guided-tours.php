<?php
/**
 * Guided-tour signups admin screen: list per building/slot, add or remove people
 * by hand, and export the whole list.
 *
 * @var int[]        $buildings     Location post IDs that have slots.
 * @var array        $reservations  Rows for the current filter (all statuses).
 * @var int          $location      Building filter (0 = all).
 * @var array|false  $notice        Flash notice from an add/remove.
 * @var array        $releases      Tour release schedule rows (tour_key => row).
 */

defined('ABSPATH') || exit;

use OE\GuidedTours\Slots;
use OE\GuidedTours\Reservations;

$title_of = static fn(int $id): string => get_the_title($id) ?: ('#' . $id);

/** Human label for a slot: "Sat Oct 3 · 12:00 PM". */
$slot_label = static function (int $loc, string $uid): string {
    foreach (Slots::all($loc) as $s) {
        if ($s['uid'] === $uid) {
            $day = $s['date'] !== '' ? wp_date('D M j', (int) (strtotime($s['date'] . ' 12:00') ?: time())) : '';
            $tm  = $s['start'] !== '' ? gmdate('g:i A', (int) strtotime('2000-01-01 ' . $s['start'])) : '';
            return trim($day . ($tm !== '' ? ' · ' . $tm : ''));
        }
    }
    return $uid;
};

$active = [Reservations::STATUS_RESERVED, Reservations::STATUS_CONFIRMED, Reservations::STATUS_WAITLIST];

// Group active reservations: [location_id][slot_uid] => rows[].
$grouped = [];
foreach ($reservations as $r) {
    if (! in_array($r->status, $active, true)) {
        continue;
    }
    $grouped[(int) $r->location_id][(string) $r->slot_uid][] = $r;
}
?>
<div class="wrap">
    <h1><?php esc_html_e('Tickets', 'october-events'); ?></h1>
    <?php \OE\Admin\Admin::tickets_tabs('guided'); ?>
    <h2 style="margin-top:18px"><?php esc_html_e('Guided tour registrations', 'october-events'); ?></h2>
    <p class="description" style="max-width:820px"><?php esc_html_e('Everyone booked onto a guided-tour slot. Add or remove people by hand, and download the list for each building or all at once.', 'october-events'); ?></p>

    <?php if (is_array($notice)) : ?>
        <div class="notice notice-<?php echo isset($notice['error']) ? 'error' : 'success'; ?> is-dismissible"><p><?php echo esc_html($notice['error'] ?? $notice['ok'] ?? ''); ?></p></div>
    <?php endif; ?>

    <?php
    // ---- Tour release schedule -------------------------------------------
    // A tour (city + year) can open for booking on a set date. Before it, the
    // booking page shows a countdown and bookings are refused; when the date
    // passes, an hourly job opens it and emails everyone holding that tour's
    // ticket, once.
    $rel_events = array_values(array_filter(
        \OE\Ticketing\CheckIn::events(),
        static fn($e) => (int) $e['id'] !== \OE\Ticketing\CheckIn::TEST_EVENT_ID
    ));
    ?>
    <div class="oe-gt-releases" style="max-width:960px;margin:16px 0 26px;padding:16px 18px;border:1px solid #dcdcde;border-radius:8px;background:#fff">
        <h3 style="margin:0 0 4px"><?php esc_html_e('Tour release schedule', 'october-events'); ?></h3>
        <p class="description" style="margin:0 0 12px"><?php esc_html_e('Set when a tour opens for booking. Before the date, its booking page shows a countdown and no one can reserve. When the date passes, booking opens and everyone holding that tour’s ticket is emailed once. Leave a tour off this list to keep it open all the time.', 'october-events'); ?></p>

        <?php if ($releases) : ?>
            <table class="widefat striped" style="margin-bottom:14px">
                <thead><tr>
                    <th><?php esc_html_e('Tour', 'october-events'); ?></th>
                    <th><?php esc_html_e('Ticket event', 'october-events'); ?></th>
                    <th><?php esc_html_e('Opens', 'october-events'); ?></th>
                    <th><?php esc_html_e('Status', 'october-events'); ?></th>
                    <th></th>
                </tr></thead>
                <tbody>
                <?php foreach ($releases as $tk => $r) :
                    $ev_id   = (int) ($r['event_id'] ?? 0);
                    $rel_ts  = (int) ($r['release_at'] ?? 0);
                    $opens   = $rel_ts > 0 ? wp_date('D M j, Y · g:i A', $rel_ts) : esc_html__('— no date —', 'october-events');
                    if ($ev_id <= 0) {
                        $status = '<span style="color:#b32d2e">' . esc_html__('No ticket event set — no email will send', 'october-events') . '</span>';
                    } elseif ($rel_ts <= 0) {
                        $status = esc_html__('Open (no date)', 'october-events');
                    } elseif (time() < $rel_ts) {
                        // Only the still-scheduled row needs the audience count.
                        $count  = \OE\GuidedTours\Releases::audience_count($ev_id);
                        $status = '<span style="color:#8a6d3b">' . sprintf(esc_html__('Scheduled · %d ticket-holders to email', 'october-events'), $count) . '</span>';
                    } elseif ((int) ($r['notified_at'] ?? 0) > 0) {
                        $status = '<span style="color:#1a7f37">' . esc_html__('Open · announcement sent', 'october-events') . '</span>';
                    } else {
                        $status = '<span style="color:#1a7f37">' . esc_html__('Open · emailing holders…', 'october-events') . '</span>';
                    }
                    $del = wp_nonce_url(admin_url('admin-post.php?action=oe_gt_release_delete&tour=' . rawurlencode((string) $tk)), 'oe_gt_release_delete_' . $tk);
                    ?>
                    <tr>
                        <td><strong><?php echo esc_html(trim(($r['city'] ?? '') . ' ' . ($r['year'] ?? '')) ?: (string) $tk); ?></strong><br><code style="font-size:11px"><?php echo esc_html((string) $tk); ?></code></td>
                        <td><?php echo $ev_id > 0 ? esc_html(get_the_title($ev_id) ?: ('#' . $ev_id)) : '—'; ?></td>
                        <td><?php echo esc_html($opens); ?></td>
                        <td><?php echo $status; // phpcs: built from esc_html above ?></td>
                        <td style="text-align:right"><a href="<?php echo esc_url($del); ?>" class="button-link" style="color:#b32d2e" onclick="return confirm('<?php echo esc_js(__('Remove this tour’s release schedule? Booking reverts to always-open.', 'october-events')); ?>')"><?php esc_html_e('Remove', 'october-events'); ?></a></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        <?php endif; ?>

        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;align-items:end;max-width:720px">
            <input type="hidden" name="action" value="oe_gt_release_save">
            <?php wp_nonce_field('oe_gt_release_save'); ?>
            <label style="display:block"><strong><?php esc_html_e('City', 'october-events'); ?></strong><br>
                <input type="text" name="city" class="regular-text" placeholder="atlanta-ga" style="width:100%"></label>
            <label style="display:block"><strong><?php esc_html_e('Year', 'october-events'); ?></strong><br>
                <input type="number" name="year" min="2024" max="2100" placeholder="<?php echo esc_attr((string) ((int) wp_date('Y'))); ?>" style="width:100%"></label>
            <label style="display:block"><strong><?php esc_html_e('Ticket event', 'october-events'); ?></strong><br>
                <select name="event_id" style="width:100%">
                    <option value="0"><?php esc_html_e('— none (no email will send) —', 'october-events'); ?></option>
                    <?php foreach ($rel_events as $e) : ?>
                        <option value="<?php echo (int) $e['id']; ?>"><?php echo esc_html($e['title']); ?></option>
                    <?php endforeach; ?>
                </select></label>
            <label style="display:block"><strong><?php esc_html_e('Opens (your timezone)', 'october-events'); ?></strong><br>
                <input type="datetime-local" name="release_at" style="width:100%"></label>
            <label style="display:block;grid-column:1 / -1"><strong><?php esc_html_e('Booking page URL (for the email button)', 'october-events'); ?></strong><br>
                <input type="url" name="booking_url" class="regular-text" placeholder="https://architecturetours.us/book/" style="width:100%"></label>
            <p style="grid-column:1 / -1;margin:4px 0 0">
                <button type="submit" class="button button-primary"><?php esc_html_e('Save release schedule', 'october-events'); ?></button>
                <span class="description" style="margin-left:8px"><?php esc_html_e('Re-entering the same city + year updates that tour. City + year must match the [guided_gate] shortcode on the booking page.', 'october-events'); ?></span>
            </p>
        </form>
    </div>

    <?php if (! $buildings) : ?>
        <div class="notice notice-info inline"><p><?php esc_html_e('No guided-tour slots yet. Add slots on a building under “Guided tour slots”, then bookings appear here.', 'october-events'); ?></p></div>
    <?php else : ?>

        <form method="get" style="margin:14px 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <input type="hidden" name="page" value="oe-tickets">
            <input type="hidden" name="tab" value="guided">
            <label><?php esc_html_e('Building', 'october-events'); ?>
                <select name="building" onchange="this.form.submit()">
                    <option value="0"><?php esc_html_e('All buildings', 'october-events'); ?></option>
                    <?php foreach ($buildings as $bid) : ?>
                        <option value="<?php echo (int) $bid; ?>" <?php selected($location, (int) $bid); ?>><?php echo esc_html($title_of((int) $bid)); ?></option>
                    <?php endforeach; ?>
                </select>
            </label>
            <a class="button" href="<?php echo esc_url(wp_nonce_url(admin_url('admin.php?page=oe-tickets&tab=guided&oe_export=guided'), 'oe_export')); ?>"><?php esc_html_e('Download all (CSV)', 'october-events'); ?></a>
        </form>

        <?php
        $previews = [
            'reserved'  => __('Booking confirmation', 'october-events'),
            'waitlist'  => __('Waitlist notice', 'october-events'),
            'promoted'  => __('Waitlist promotion', 'october-events'),
            'reconfirm' => __('48-hour reconfirm', 'october-events'),
        ];
        ?>
        <p style="margin:14px 0 20px;color:#444">
            <strong><?php esc_html_e('Preview emails:', 'october-events'); ?></strong>
            <?php $sep = ''; foreach ($previews as $type => $label) :
                $url = wp_nonce_url(admin_url('admin-post.php?action=oe_preview_guided_email&type=' . $type), 'oe_preview_guided_email');
                echo $sep; $sep = ' &nbsp;·&nbsp; '; ?>
                <a href="<?php echo esc_url($url); ?>" target="_blank" rel="noopener"><?php echo esc_html($label); ?></a>
            <?php endforeach; ?>
            <span class="description" style="display:block;margin-top:4px"><?php esc_html_e('Opens in a new tab with sample details, showing exactly what recipients get.', 'october-events'); ?></span>
        </p>

        <h2 style="margin-top:22px"><?php esc_html_e('Add someone', 'october-events'); ?></h2>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;background:#fff;border:1px solid #dcdcde;border-radius:8px;padding:14px 16px;max-width:960px">
            <?php wp_nonce_field('oe_gt_reservation_add'); ?>
            <input type="hidden" name="action" value="oe_gt_reservation_add">
            <label style="display:flex;flex-direction:column;font-weight:600;gap:4px"><?php esc_html_e('Building', 'october-events'); ?>
                <select name="building" id="oe-gt-add-building" required style="min-width:220px">
                    <option value=""><?php esc_html_e('Choose…', 'october-events'); ?></option>
                    <?php foreach ($buildings as $bid) : ?>
                        <option value="<?php echo (int) $bid; ?>"><?php echo esc_html($title_of((int) $bid)); ?></option>
                    <?php endforeach; ?>
                </select>
            </label>
            <label style="display:flex;flex-direction:column;font-weight:600;gap:4px"><?php esc_html_e('Time', 'october-events'); ?>
                <select name="slot" id="oe-gt-add-slot" required style="min-width:200px"><option value=""><?php esc_html_e('Choose a building first', 'october-events'); ?></option></select>
            </label>
            <label style="display:flex;flex-direction:column;font-weight:600;gap:4px"><?php esc_html_e('Name', 'october-events'); ?>
                <input type="text" name="name" style="min-width:160px"></label>
            <label style="display:flex;flex-direction:column;font-weight:600;gap:4px"><?php esc_html_e('Email', 'october-events'); ?>
                <input type="email" name="email" required style="min-width:220px"></label>
            <label style="display:flex;flex-direction:column;font-weight:600;gap:4px"><?php esc_html_e('Seats', 'october-events'); ?>
                <input type="number" name="party" value="1" min="1" max="50" style="width:80px"></label>
            <button class="button button-primary"><?php esc_html_e('Add person', 'october-events'); ?></button>
        </form>
        <p class="description" style="max-width:960px"><?php esc_html_e('They get the same confirmation email (building details and a release link). If the slot is full they join the waitlist.', 'october-events'); ?></p>

        <script>
        (function () {
            var slots = <?php
                $map = [];
                foreach ($buildings as $bid) {
                    $opts = [];
                    foreach (Slots::all((int) $bid) as $s) {
                        if (! $s['active']) {
                            continue;
                        }
                        $opts[] = ['uid' => $s['uid'], 'label' => $slot_label((int) $bid, (string) $s['uid'])];
                    }
                    $map[(int) $bid] = $opts;
                }
                echo wp_json_encode($map);
            ?>;
            var b = document.getElementById('oe-gt-add-building'),
                sl = document.getElementById('oe-gt-add-slot');
            if (b && sl) {
                b.addEventListener('change', function () {
                    var list = slots[b.value] || [];
                    sl.innerHTML = '';
                    if (!list.length) { sl.innerHTML = '<option value="">' + '<?php echo esc_js(__('No active times', 'october-events')); ?>' + '</option>'; return; }
                    list.forEach(function (o) {
                        var op = document.createElement('option');
                        op.value = o.uid; op.textContent = o.label;
                        sl.appendChild(op);
                    });
                });
            }
        })();
        </script>

        <?php
        $shown = 0;
        foreach ($grouped as $bid => $by_slot) : ?>
            <h2 style="margin-top:28px;border-top:2px solid #111;padding-top:14px"><?php echo esc_html($title_of((int) $bid)); ?></h2>
            <?php
            // Iterate this building's slots in chronological order; skip empty ones.
            foreach (Slots::all((int) $bid) as $s) :
                $uid = (string) $s['uid'];
                if (empty($by_slot[$uid])) {
                    continue;
                }
                $rows = $by_slot[$uid];
                $held = 0; $wait = 0;
                foreach ($rows as $rr) {
                    $seats = max(1, (int) ($rr->party_size ?? 1));
                    if ($rr->status === Reservations::STATUS_WAITLIST) { $wait += $seats; } else { $held += $seats; }
                }
                ?>
                <h3 style="margin:16px 0 6px"><?php echo esc_html($slot_label((int) $bid, $uid)); ?>
                    <span style="font-weight:400;color:#666">— <?php echo esc_html($held . ($s['capacity'] ? ' / ' . (int) $s['capacity'] : '') . ' booked'); ?><?php echo $wait ? esc_html(' · ' . $wait . ' waiting') : ''; ?></span></h3>
                <table class="widefat striped" style="max-width:960px">
                    <thead><tr>
                        <th><?php esc_html_e('Name', 'october-events'); ?></th>
                        <th><?php esc_html_e('Email', 'october-events'); ?></th>
                        <th style="width:120px"><?php esc_html_e('Status', 'october-events'); ?></th>
                        <th style="width:90px"></th>
                    </tr></thead>
                    <tbody>
                        <?php foreach ($rows as $r) : $shown++;
                            $remove = wp_nonce_url(admin_url('admin-post.php?action=oe_gt_reservation_remove&id=' . (int) $r->id), 'oe_gt_reservation_remove_' . (int) $r->id); ?>
                            <?php $seats = max(1, (int) ($r->party_size ?? 1)); ?>
                            <tr>
                                <td><?php echo esc_html($r->name ?: '—'); ?><?php if ($seats > 1) : ?> <span style="color:#666;font-size:12px">· <?php echo esc_html(sprintf(_n('%d seat', '%d seats', $seats, 'october-events'), $seats)); ?></span><?php endif; ?></td>
                                <td><?php echo esc_html($r->email); ?></td>
                                <td><?php echo esc_html(ucfirst((string) $r->status)); ?></td>
                                <td style="text-align:right"><a href="<?php echo esc_url($remove); ?>" class="button-link" style="color:#b32d2e" onclick="return confirm('<?php echo esc_js(__('Remove this person from the slot?', 'october-events')); ?>')"><?php esc_html_e('Remove', 'october-events'); ?></a></td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            <?php endforeach; ?>
        <?php endforeach; ?>

        <?php if ($shown === 0) : ?>
            <p style="margin-top:20px;color:#666"><?php esc_html_e('No bookings yet.', 'october-events'); ?></p>
        <?php endif; ?>

    <?php endif; ?>
</div>
