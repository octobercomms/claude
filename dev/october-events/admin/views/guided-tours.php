<?php
/**
 * Guided-tour signups admin screen: list per building/slot, add or remove people
 * by hand, and export the whole list.
 *
 * @var int[]        $buildings     Location post IDs that have slots.
 * @var array        $reservations  Rows for the current filter (all statuses).
 * @var int          $location      Building filter (0 = all).
 * @var array|false  $notice        Flash notice from an add/remove.
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
    <h1><?php esc_html_e('Guided Tours', 'october-events'); ?></h1>
    <p class="description" style="max-width:820px"><?php esc_html_e('Everyone booked onto a guided-tour slot. Add or remove people by hand, and download the list for each building or all at once.', 'october-events'); ?></p>

    <?php if (is_array($notice)) : ?>
        <div class="notice notice-<?php echo isset($notice['error']) ? 'error' : 'success'; ?> is-dismissible"><p><?php echo esc_html($notice['error'] ?? $notice['ok'] ?? ''); ?></p></div>
    <?php endif; ?>

    <?php if (! $buildings) : ?>
        <div class="notice notice-info inline"><p><?php esc_html_e('No guided-tour slots yet. Add slots on a building under “Guided tour slots”, then bookings appear here.', 'october-events'); ?></p></div>
    <?php else : ?>

        <form method="get" style="margin:14px 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <input type="hidden" name="page" value="oe-guided-tours">
            <label><?php esc_html_e('Building', 'october-events'); ?>
                <select name="building" onchange="this.form.submit()">
                    <option value="0"><?php esc_html_e('All buildings', 'october-events'); ?></option>
                    <?php foreach ($buildings as $bid) : ?>
                        <option value="<?php echo (int) $bid; ?>" <?php selected($location, (int) $bid); ?>><?php echo esc_html($title_of((int) $bid)); ?></option>
                    <?php endforeach; ?>
                </select>
            </label>
            <a class="button" href="<?php echo esc_url(wp_nonce_url(admin_url('admin.php?page=oe-guided-tours&oe_export=guided'), 'oe_export')); ?>"><?php esc_html_e('Download all (CSV)', 'october-events'); ?></a>
        </form>

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
                    if ($rr->status === Reservations::STATUS_WAITLIST) { $wait++; } else { $held++; }
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
                            <tr>
                                <td><?php echo esc_html($r->name ?: '—'); ?></td>
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
