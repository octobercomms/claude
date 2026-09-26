<?php
/**
 * Registrations (orders) screen + manual order/comp creation.
 *
 * @var array      $orders       order rows
 * @var \WP_Post[] $events       published events
 * @var array      $event_types  [event_id => [['key','label'], …]]
 * @var int        $event_filter
 */
defined('ABSPATH') || exit;
use OE\Ticketing\Orders;
$ev_arg          = $event_filter ? ('&event=' . (int) $event_filter) : '';
$export_orders   = wp_nonce_url(admin_url('admin.php?page=oe-tickets&oe_export=orders' . $ev_arg), 'oe_export');
$export_attendee = wp_nonce_url(admin_url('admin.php?page=oe-tickets&oe_export=attendees' . $ev_arg), 'oe_export');
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Tickets', 'october-events'); ?>
        <a href="<?php echo esc_url($export_attendee); ?>" class="page-title-action"><?php esc_html_e('Export attendees', 'october-events'); ?></a>
        <a href="<?php echo esc_url($export_orders); ?>" class="page-title-action"><?php esc_html_e('Export orders', 'october-events'); ?></a>
    </h1>
    <?php if ($event_filter) : ?>
        <p class="description" style="margin:4px 0 0"><?php echo esc_html(sprintf(__('Exports are filtered to: %s', 'october-events'), get_the_title($event_filter) ?: ('#' . $event_filter))); ?></p>
    <?php endif; ?>
    <?php \OE\Admin\Admin::bento('tickets'); ?>
    <?php \OE\Admin\Admin::tickets_tabs('orders'); ?>

    <?php if (! empty($_GET['oe_msg'])) :
        $m = sanitize_key((string) $_GET['oe_msg']);
        $messages = [
            'created'       => ['success', __('Order created and tickets issued.', 'october-events')],
            'resent'        => ['success', __('Confirmation email re-sent to the buyer.', 'october-events')],
            'resend_failed' => ['error', __('Could not re-send — that order has no email address.', 'october-events')],
            'deleted'       => ['success', __('Order deleted, along with its tickets and any check-in scans.', 'october-events')],
            'refunded'      => ['success', __('Refund issued and the selected tickets voided.', 'october-events')],
            'refund_failed' => ['error', __('Refund failed — nothing was charged back. Check the order is a paid card order with tickets still active.', 'october-events')],
            'transferred'   => ['success', __('Ticket transferred — the new attendee has been emailed their ticket.', 'october-events')],
            'transfer_failed' => ['error', __('Could not transfer that ticket — check the name and a valid email, and that the ticket is still active.', 'october-events')],
            'checked_in'    => ['success', __('Checked in.', 'october-events')],
            'checkin_failed' => ['error', __('Could not check that ticket in. If it’s a door-restricted ticket already scanned elsewhere, use the door scanner instead.', 'october-events')],
        ];
        $note = $messages[$m] ?? ['error', __('Could not create that order — check the event has a ticket type.', 'october-events')]; ?>
        <div class="notice notice-<?php echo esc_attr($note[0]); ?> is-dismissible"><p><?php echo esc_html($note[1]); ?></p></div>
    <?php endif; ?>

    <h2><?php esc_html_e('Add a registration manually', 'october-events'); ?></h2>
    <?php if (! $events) : ?>
        <div class="notice notice-warning inline" style="margin:0 0 12px"><p>
            <?php printf(
                /* translators: %s: link to create an event */
                esc_html__('You don’t have any published events yet. %s, add a ticket type to it, then you can issue tickets here.', 'october-events'),
                '<a href="' . esc_url(admin_url('post-new.php?post_type=' . \OE\PostTypes::slug('event'))) . '">' . esc_html__('Create an event', 'october-events') . '</a>'
            ); ?>
        </p></div>
    <?php elseif (! $event_types) : ?>
        <div class="notice notice-warning inline" style="margin:0 0 12px"><p>
            <?php esc_html_e('None of your events have ticket types yet. Open an event and add at least one ticket type (in its “Tickets” box) — only then can tickets be issued for it.', 'october-events'); ?>
        </p></div>
    <?php endif; ?>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="oe-manual-order" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
        <input type="hidden" name="action" value="oe_create_order">
        <?php wp_nonce_field('oe_create_order'); ?>
        <label><?php esc_html_e('Event', 'october-events'); ?><br>
            <select name="event_id" id="oe-mo-event" required>
                <option value=""><?php esc_html_e('Choose…', 'october-events'); ?></option>
                <?php foreach ($events as $ev) : $has = ! empty($event_types[$ev->ID]); ?>
                    <option value="<?php echo (int) $ev->ID; ?>" data-edit="<?php echo esc_url((string) get_edit_post_link($ev->ID, '')); ?>">
                        <?php echo esc_html(get_the_title($ev) ?: ('#' . (int) $ev->ID)); ?><?php echo $has ? '' : ' — ' . esc_html__('no ticket types', 'october-events'); ?>
                    </option>
                <?php endforeach; ?>
            </select></label>
        <label><?php esc_html_e('Ticket type', 'october-events'); ?><br>
            <select name="type_key" id="oe-mo-type" required></select></label>
        <label><?php esc_html_e('Qty', 'october-events'); ?><br><input type="number" name="qty" value="1" min="1" style="width:60px"></label>
        <label><?php esc_html_e('Name', 'october-events'); ?><br><input type="text" name="name"></label>
        <label><?php esc_html_e('Email', 'october-events'); ?><br><input type="email" name="email" required></label>
        <label><?php esc_html_e('Mode', 'october-events'); ?><br>
            <select name="mode"><option value="comp"><?php esc_html_e('Comp (free)', 'october-events'); ?></option><option value="paid"><?php esc_html_e('Mark paid', 'october-events'); ?></option></select></label>
        <button class="button button-primary" id="oe-mo-submit"><?php esc_html_e('Issue tickets', 'october-events'); ?></button>
        <p id="oe-mo-hint" class="description" style="flex-basis:100%;margin:4px 0 0;color:#b32d2e;display:none"></p>
    </form>
    <script>
    (function(){
        var map = <?php echo wp_json_encode($event_types); ?>;
        var noTypes = <?php echo wp_json_encode(__('This event has no ticket types yet — open it and add one in its “Tickets” box before issuing.', 'october-events')); ?>;
        var openLbl = <?php echo wp_json_encode(__('Open the event', 'october-events')); ?>;
        var ev = document.getElementById('oe-mo-event'),
            ty = document.getElementById('oe-mo-type'),
            btn = document.getElementById('oe-mo-submit'),
            hint = document.getElementById('oe-mo-hint');
        function fill(){
            ty.innerHTML='';
            var types = map[ev.value] || [];
            types.forEach(function(t){ var o=document.createElement('option'); o.value=t.key; o.textContent=t.label; ty.appendChild(o); });
            var blocked = !!ev.value && !types.length;
            ty.disabled = !types.length;
            btn.disabled = blocked;
            if (blocked) {
                var opt = ev.options[ev.selectedIndex], edit = opt && opt.getAttribute('data-edit');
                hint.innerHTML = noTypes + (edit ? ' <a href="' + edit + '">' + openLbl + ' ↗</a>' : '');
                hint.style.display = 'block';
            } else {
                hint.style.display = 'none';
            }
        }
        ev.addEventListener('change', fill); fill();
    })();
    </script>

    <?php
    $money = static function ($amount) use ($currency): string {
        return number_format((float) $amount, 2) . ' ' . $currency;
    };
    $cur_sym = ['USD' => '$', 'GBP' => '£', 'EUR' => '€', 'CAD' => '$', 'AUD' => '$'][$currency] ?? ($currency . ' ');
    // Uncapped totals (attendees_for_list is capped for very large events).
    $att_total = (int) ($attendee_stats['tickets'] ?? count($attendees));
    $att_in    = (int) ($attendee_stats['checked_in'] ?? 0);
    $att_out   = max(0, $att_total - $att_in);
    $att_pct   = $att_total ? round($att_in / $att_total * 100) : 0;
    $att_capped = count($attendees) < $att_total;
    ?>

    <h2 style="margin-top:22px"><?php esc_html_e('Attendees', 'october-events'); ?></h2>
    <p class="description" style="margin:0 0 10px"><?php esc_html_e('One row per ticket. Green = checked in, red = not yet. Sort or filter to see who hasn’t arrived, and check someone in with one click if they slipped past the door.', 'october-events'); ?></p>

    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin:10px 0 12px">
        <div style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:10px 16px">
            <div class="description" style="text-transform:uppercase;letter-spacing:.05em;font-size:11px"><?php esc_html_e('Tickets', 'october-events'); ?></div>
            <div style="font-size:20px;font-weight:800"><?php echo esc_html(number_format_i18n($att_total)); ?></div>
        </div>
        <div style="background:#eaf7ec;border:1px solid #cde9d2;border-radius:12px;padding:10px 16px">
            <div class="description" style="text-transform:uppercase;letter-spacing:.05em;font-size:11px"><?php esc_html_e('Checked in', 'october-events'); ?></div>
            <div style="font-size:20px;font-weight:800"><?php echo esc_html(number_format_i18n($att_in) . ' · ' . $att_pct . '%'); ?></div>
        </div>
        <div style="background:#fdeceb;border:1px solid #f4c7c3;border-radius:12px;padding:10px 16px">
            <div class="description" style="text-transform:uppercase;letter-spacing:.05em;font-size:11px"><?php esc_html_e('Not checked in', 'october-events'); ?></div>
            <div style="font-size:20px;font-weight:800"><?php echo esc_html(number_format_i18n($att_out)); ?></div>
        </div>
        <form method="get" style="margin-left:auto;display:flex;gap:8px;align-items:center">
            <input type="hidden" name="page" value="oe-tickets">
            <label for="oe-att-ev" class="description"><?php esc_html_e('Event', 'october-events'); ?></label>
            <select id="oe-att-ev" name="event" onchange="this.form.submit()">
                <option value="0"><?php esc_html_e('All events', 'october-events'); ?></option>
                <?php foreach (($events ?: []) as $ev) : ?>
                    <option value="<?php echo (int) $ev->ID; ?>" <?php selected($event_filter, (int) $ev->ID); ?>><?php echo esc_html(get_the_title($ev) ?: ('#' . (int) $ev->ID)); ?></option>
                <?php endforeach; ?>
            </select>
        </form>
    </div>

    <?php if (! $attendees) : ?>
        <div class="notice notice-info inline" style="margin:0 0 18px"><p><?php esc_html_e('No tickets issued yet for this filter.', 'october-events'); ?></p></div>
    <?php else : ?>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:0 0 10px">
        <label class="description"><?php esc_html_e('Show', 'october-events'); ?>
            <select id="oe-att-filter">
                <option value="all"><?php esc_html_e('All', 'october-events'); ?></option>
                <option value="out"><?php esc_html_e('Not checked in', 'october-events'); ?></option>
                <option value="in"><?php esc_html_e('Checked in', 'october-events'); ?></option>
            </select>
        </label>
        <input type="search" id="oe-att-search" placeholder="<?php esc_attr_e('Search name, email or type…', 'october-events'); ?>" style="min-width:220px">
        <span class="description" id="oe-att-shown"></span>
        <?php if ($att_capped) : ?>
            <span class="description"><?php echo esc_html(sprintf(
                /* translators: 1: rows shown, 2: total */
                __('Showing the first %1$s of %2$s — filter by event to see the rest.', 'october-events'),
                number_format_i18n(count($attendees)), number_format_i18n($att_total)
            )); ?></span>
        <?php endif; ?>
    </div>

    <table class="widefat striped oe-att-table" id="oe-att-table">
        <thead><tr>
            <th class="oe-att-sortable" data-key="name"><?php esc_html_e('Attendee', 'october-events'); ?> <span class="oe-att-arrow"></span></th>
            <th class="oe-att-sortable" data-key="type"><?php esc_html_e('Ticket type', 'october-events'); ?> <span class="oe-att-arrow"></span></th>
            <th class="oe-att-sortable" data-key="price" style="text-align:right"><?php esc_html_e('Price', 'october-events'); ?> <span class="oe-att-arrow"></span></th>
            <th class="oe-att-sortable" data-key="status"><?php esc_html_e('Checked in', 'october-events'); ?> <span class="oe-att-arrow"></span></th>
            <th><?php esc_html_e('Actions', 'october-events'); ?></th>
        </tr></thead>
        <tbody>
        <?php foreach ($attendees as $a) :
            $when = $a->checked_in && $a->first_scan ? get_date_from_gmt((string) $a->first_scan, 'g:i a') : '';
            $search = strtolower(trim($a->attendee . ' ' . $a->email . ' ' . $a->type . ' ' . $a->buyer));
            $view_url = \OE\Ticketing\Orders::ticket_url((string) $a->token);
        ?>
            <tr class="<?php echo $a->checked_in ? 'oe-att-in' : 'oe-att-out'; ?>"
                data-status="<?php echo $a->checked_in ? 'in' : 'out'; ?>"
                data-name="<?php echo esc_attr(strtolower($a->attendee)); ?>"
                data-type="<?php echo esc_attr(strtolower($a->type)); ?>"
                data-price="<?php echo esc_attr((string) $a->price); ?>"
                data-search="<?php echo esc_attr($search); ?>">
                <td><strong><?php echo esc_html($a->attendee ?: '—'); ?></strong>
                    <?php if ($a->email !== '') : ?><br><span class="description" style="font-size:12px"><?php echo esc_html($a->email); ?></span><?php endif; ?>
                    <?php if ($a->buyer !== '' && $a->buyer !== $a->attendee) : ?><br><span class="description" style="font-size:11px"><?php echo esc_html(sprintf(__('bought by %s', 'october-events'), $a->buyer)); ?></span><?php endif; ?></td>
                <td><?php echo esc_html($a->type ?: '—'); ?></td>
                <td style="text-align:right"><?php echo $a->price > 0 ? esc_html($cur_sym . number_format_i18n($a->price, 2)) : '<span class="description">' . esc_html__('Free', 'october-events') . '</span>'; ?></td>
                <td>
                    <?php if ($a->checked_in) : ?>
                        <span style="color:#1e7a33;font-weight:700">✓ <?php esc_html_e('In', 'october-events'); ?></span>
                        <span class="description" style="font-size:11px"><?php echo esc_html(trim(($a->venue !== '' ? $a->venue : '') . ($when ? ' · ' . $when : ''))); ?></span>
                    <?php else : ?>
                        <span style="color:#b32d2e;font-weight:700">✗ <?php esc_html_e('Not in', 'october-events'); ?></span>
                    <?php endif; ?>
                </td>
                <td style="white-space:nowrap">
                    <?php if (! $a->checked_in) : ?>
                        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:inline">
                            <input type="hidden" name="action" value="oe_ticket_checkin">
                            <input type="hidden" name="ticket_id" value="<?php echo (int) $a->id; ?>">
                            <?php wp_nonce_field('oe_ticket_checkin'); ?>
                            <button type="submit" class="button button-small button-primary"><?php esc_html_e('Check in', 'october-events'); ?></button>
                        </form>
                    <?php endif; ?>
                    <a class="button button-small" href="<?php echo esc_url($view_url); ?>" target="_blank" rel="noopener"><?php esc_html_e('View', 'october-events'); ?></a>
                    <a href="#" class="button button-small oe-xfer-toggle" data-target="oe-attx-<?php echo (int) $a->id; ?>"><?php esc_html_e('Transfer', 'october-events'); ?></a>
                </td>
            </tr>
            <tr id="oe-attx-<?php echo (int) $a->id; ?>" class="oe-att-skip" style="display:none">
                <td colspan="5" style="background:#faf9f5">
                    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;padding:8px 4px">
                        <input type="hidden" name="action" value="oe_transfer_ticket">
                        <input type="hidden" name="ticket_id" value="<?php echo (int) $a->id; ?>">
                        <?php wp_nonce_field('oe_transfer_ticket'); ?>
                        <label style="font-size:12px"><?php esc_html_e('New attendee name', 'october-events'); ?><br>
                            <input type="text" name="attendee_name" value="<?php echo esc_attr($a->attendee); ?>" required style="min-width:180px"></label>
                        <label style="font-size:12px"><?php esc_html_e('New email', 'october-events'); ?><br>
                            <input type="email" name="attendee_email" placeholder="<?php echo esc_attr($a->email); ?>" required style="min-width:200px"></label>
                        <button type="submit" class="button button-primary" onclick="return confirm('<?php echo esc_js(__('Transfer this ticket and email the new attendee their ticket? The QR code stays the same, so any earlier copy now belongs to the new person.', 'october-events')); ?>');"><?php esc_html_e('Transfer & email ticket', 'october-events'); ?></button>
                    </form>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
    <style>
        .oe-att-table tr.oe-att-in > td { background:#eaf7ec !important; }
        .oe-att-table tr.oe-att-out > td { background:#fdeceb !important; }
        .oe-att-table th.oe-att-sortable { cursor:pointer; user-select:none; }
        .oe-att-table th.oe-att-sortable:hover { color:#000; }
    </style>
    <script>
    (function(){
        var table = document.getElementById('oe-att-table');
        if (!table) { return; }
        var tbody = table.querySelector('tbody');
        // A ticket = its main row plus its (hidden) transfer row. Keep them paired.
        function pairs(){
            var out = [], rows = tbody.children;
            for (var i = 0; i < rows.length; i++) {
                if (rows[i].classList.contains('oe-att-skip')) { continue; }
                out.push([rows[i], rows[i + 1] && rows[i + 1].classList.contains('oe-att-skip') ? rows[i + 1] : null]);
            }
            return out;
        }
        var sortKey = '', sortDir = 1;
        function val(row, key){
            if (key === 'price') { return parseFloat(row.getAttribute('data-price')) || 0; }
            if (key === 'status') { return row.getAttribute('data-status') === 'in' ? 1 : 0; }
            return row.getAttribute('data-' + key) || '';
        }
        function sortBy(key){
            sortDir = (sortKey === key) ? -sortDir : 1;
            sortKey = key;
            var ps = pairs();
            ps.sort(function(a, b){
                var x = val(a[0], key), y = val(b[0], key);
                if (x < y) { return -1 * sortDir; }
                if (x > y) { return 1 * sortDir; }
                return 0;
            });
            ps.forEach(function(p){ tbody.appendChild(p[0]); if (p[1]) { tbody.appendChild(p[1]); } });
            table.querySelectorAll('.oe-att-arrow').forEach(function(s){ s.textContent = ''; });
            var th = table.querySelector('th[data-key="' + key + '"] .oe-att-arrow');
            if (th) { th.textContent = sortDir > 0 ? '▲' : '▼'; }
        }
        table.querySelectorAll('th.oe-att-sortable').forEach(function(th){
            th.addEventListener('click', function(){ sortBy(th.getAttribute('data-key')); });
        });
        var filter = document.getElementById('oe-att-filter'),
            search = document.getElementById('oe-att-search'),
            shown  = document.getElementById('oe-att-shown');
        function apply(){
            var f = filter ? filter.value : 'all', q = (search ? search.value : '').trim().toLowerCase(), n = 0;
            pairs().forEach(function(p){
                var row = p[0];
                var okF = (f === 'all') || row.getAttribute('data-status') === f;
                var okQ = !q || (row.getAttribute('data-search') || '').indexOf(q) !== -1;
                var show = okF && okQ;
                row.style.display = show ? '' : 'none';
                if (p[1] && !show) { p[1].style.display = 'none'; }
                if (show) { n++; }
            });
            if (shown) { shown.textContent = n + ' <?php echo esc_js(__('shown', 'october-events')); ?>'; }
        }
        if (filter) { filter.addEventListener('change', apply); }
        if (search) { search.addEventListener('input', apply); }
        apply();
    })();
    </script>
    <?php endif; ?>

    <details class="oe-acc" style="margin-top:22px">
        <summary style="cursor:pointer;font-size:1.25em;font-weight:600;margin:10px 0"><?php esc_html_e('Orders & payment detail', 'october-events'); ?></summary>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin:14px 0 10px">
        <div style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:12px 18px">
            <div class="description" style="text-transform:uppercase;letter-spacing:.05em;font-size:11px"><?php esc_html_e('Revenue (paid)', 'october-events'); ?></div>
            <div style="font-size:22px;font-weight:700"><?php echo esc_html($money($rev_total)); ?></div>
        </div>
        <div style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:12px 18px">
            <div class="description" style="text-transform:uppercase;letter-spacing:.05em;font-size:11px"><?php esc_html_e('Tickets sold', 'october-events'); ?></div>
            <div style="font-size:22px;font-weight:700"><?php echo esc_html(number_format_i18n($tix_total)); ?></div>
        </div>
        <form method="get" style="margin-left:auto;display:flex;gap:8px;align-items:center">
            <input type="hidden" name="page" value="oe-tickets">
            <label for="oe-ev-filter" class="description"><?php esc_html_e('Event', 'october-events'); ?></label>
            <select id="oe-ev-filter" name="event" onchange="this.form.submit()">
                <option value="0"><?php esc_html_e('All events', 'october-events'); ?></option>
                <?php foreach (($events ?: []) as $ev) : ?>
                    <option value="<?php echo (int) $ev->ID; ?>" <?php selected($event_filter, (int) $ev->ID); ?>><?php echo esc_html(get_the_title($ev) ?: ('#' . (int) $ev->ID)); ?></option>
                <?php endforeach; ?>
            </select>
        </form>
    </div>

    <?php if ($rev_rows && ! $event_filter) : ?>
        <table class="widefat striped" style="margin-bottom:18px;max-width:640px">
            <thead><tr>
                <th><?php esc_html_e('Event', 'october-events'); ?></th>
                <th style="text-align:right"><?php esc_html_e('Paid orders', 'october-events'); ?></th>
                <th style="text-align:right"><?php esc_html_e('Tickets', 'october-events'); ?></th>
                <th style="text-align:right"><?php esc_html_e('Revenue', 'october-events'); ?></th>
            </tr></thead>
            <tbody>
                <?php foreach ($rev_rows as $r) : ?>
                    <tr>
                        <td><a href="<?php echo esc_url(admin_url('admin.php?page=oe-tickets&event=' . (int) $r->event_id)); ?>"><?php echo esc_html(get_the_title((int) $r->event_id) ?: ('#' . (int) $r->event_id)); ?></a></td>
                        <td style="text-align:right"><?php echo (int) $r->orders; ?></td>
                        <td style="text-align:right"><?php echo esc_html(number_format_i18n((int) $r->tickets)); ?></td>
                        <td style="text-align:right"><?php echo esc_html($money($r->revenue)); ?></td>
                    </tr>
                <?php endforeach; ?>
            </tbody>
            <tfoot><tr>
                <th><?php esc_html_e('Total', 'october-events'); ?></th>
                <th></th>
                <th style="text-align:right"><?php echo esc_html(number_format_i18n($tix_total)); ?></th>
                <th style="text-align:right"><?php echo esc_html($money($rev_total)); ?></th>
            </tr></tfoot>
        </table>
    <?php endif; ?>

    <table class="widefat striped">
        <thead><tr>
            <th>#</th><th><?php esc_html_e('Event', 'october-events'); ?></th><th><?php esc_html_e('Event date', 'october-events'); ?></th><th><?php esc_html_e('Purchaser', 'october-events'); ?></th>
            <th><?php esc_html_e('Type', 'october-events'); ?></th><th><?php esc_html_e('Qty', 'october-events'); ?></th>
            <th><?php esc_html_e('Total', 'october-events'); ?></th><th><?php esc_html_e('Status', 'october-events'); ?></th>
            <th><?php esc_html_e('Source', 'october-events'); ?></th><th><?php esc_html_e('Actions', 'october-events'); ?></th>
        </tr></thead>
        <tbody>
        <?php if (! $orders) : ?><tr><td colspan="10"><?php esc_html_e('No registrations yet.', 'october-events'); ?></td></tr><?php endif; ?>
        <?php foreach (($orders ?: []) as $o) :
            $cancel = wp_nonce_url(admin_url('admin-post.php?action=oe_cancel_order&id=' . $o->id), 'oe_cancel_order');
            $refund = wp_nonce_url(admin_url('admin-post.php?action=oe_cancel_order&refund=1&id=' . $o->id), 'oe_cancel_order');
            $resend = wp_nonce_url(admin_url('admin-post.php?action=oe_resend_confirmation&id=' . $o->id), 'oe_resend_confirmation');
            $delete = wp_nonce_url(admin_url('admin-post.php?action=oe_delete_order&id=' . $o->id), 'oe_delete_order'); ?>
            <?php
            $ev_date = \OE\Ticketing\Ics::date_label((int) $o->event_id);
            $ev_when = \OE\Ticketing\Ics::when_label((int) $o->event_id);
            $o_tickets = $order_tickets[(int) $o->id] ?? [];
            ?>
            <tr>
                <td><?php echo (int) $o->id; ?></td>
                <td><?php echo esc_html(get_the_title((int) $o->event_id)); ?></td>
                <td><?php echo $ev_date ? esc_html($ev_date) : '<span class="description">—</span>'; ?></td>
                <td><?php echo esc_html($o->name); ?><br><span class="description"><?php echo esc_html($o->email); ?></span></td>
                <td><?php echo esc_html($o->ticket_type_label); ?></td>
                <td><?php echo (int) $o->qty; ?></td>
                <td><?php echo esc_html($o->total . ' ' . $o->currency); ?></td>
                <td><span class="oe-status oe-status-<?php echo esc_attr($o->status); ?>"><?php echo esc_html($o->status); ?></span></td>
                <td><?php echo esc_html($o->source); ?></td>
                <td>
                    <button type="button" class="button button-small oe-od-toggle" aria-expanded="false" data-target="oe-od-<?php echo (int) $o->id; ?>"><?php esc_html_e('Details', 'october-events'); ?></button>
                    <?php if ($o->status === 'paid' && $o->email) : ?>
                        <a class="button button-small" href="<?php echo esc_url($resend); ?>" title="<?php esc_attr_e('Email the buyer their tickets again', 'october-events'); ?>"><?php esc_html_e('Resend', 'october-events'); ?></a>
                    <?php endif; ?>
                    <?php if (in_array($o->status, ['paid', 'pending'], true)) : ?>
                        <a class="button button-small" href="<?php echo esc_url($cancel); ?>" onclick="return confirm('<?php echo esc_js(__('Cancel this order and void its tickets? The customer will be emailed.', 'october-events')); ?>')"><?php esc_html_e('Cancel', 'october-events'); ?></a>
                        <?php
                        $is_stripe = in_array((string) $o->payment_method, ['stripe', 'public'], true);
                        $tk = $txn_tickets[(string) $o->payment_id] ?? [];
                        if ($o->payment_id && $is_stripe && $tk) :
                            $panel_order_id = (int) $o->id;
                            $panel_tickets  = $tk;
                            $panel_label    = __('Refund…', 'october-events');
                            include OE_DIR . 'admin/views/_refund-panel.php';
                        elseif ($o->payment_id) : ?>
                            <a class="button button-small" href="<?php echo esc_url($refund); ?>" onclick="return confirm('<?php echo esc_js(__('Refund this order in full and void its tickets? The customer will be emailed their refund.', 'october-events')); ?>')"><?php esc_html_e('Refund', 'october-events'); ?></a>
                        <?php endif; ?>
                    <?php endif; ?>
                    <a class="button button-small button-link-delete" href="<?php echo esc_url($delete); ?>" title="<?php esc_attr_e('Permanently delete (for test data)', 'october-events'); ?>" onclick="return confirm('<?php echo esc_js(__('Permanently delete this order, its tickets and any check-in scans? This cannot be undone, and no refund is issued.', 'october-events')); ?>')"><?php esc_html_e('Delete', 'october-events'); ?></a>
                </td>
            </tr>
            <tr class="oe-od-row" id="oe-od-<?php echo (int) $o->id; ?>" style="display:none">
                <td colspan="10" style="background:#faf9f5">
                    <div style="display:flex;flex-wrap:wrap;gap:24px;padding:6px 4px 10px">
                        <div style="min-width:220px">
                            <div class="description" style="text-transform:uppercase;letter-spacing:.05em;font-size:11px"><?php esc_html_e('Order', 'october-events'); ?></div>
                            <div><strong><?php echo esc_html(get_the_title((int) $o->event_id) ?: ('#' . (int) $o->event_id)); ?></strong></div>
                            <?php if ($ev_when) : ?><div><?php echo esc_html($ev_when); ?></div><?php endif; ?>
                            <div><?php echo esc_html($o->name); ?> &lt;<?php echo esc_html($o->email); ?>&gt;</div>
                            <?php
                            $placed = $o->created_at ? (strtotime((string) $o->created_at . ' UTC') ?: 0) : 0;
                            if ($placed) : ?>
                                <div class="description"><?php echo esc_html(sprintf(__('Placed %s', 'october-events'), wp_date('M j, Y g:i A', $placed))); ?></div>
                            <?php endif; ?>
                        </div>
                        <div style="min-width:200px">
                            <div class="description" style="text-transform:uppercase;letter-spacing:.05em;font-size:11px"><?php esc_html_e('Payment', 'october-events'); ?></div>
                            <div><?php echo esc_html(ucfirst((string) $o->payment_method) . ' · ' . $o->total . ' ' . $o->currency); ?></div>
                            <?php if ((float) $o->discount_amount > 0) : ?>
                                <div class="description"><?php echo esc_html(sprintf(__('%1$s %2$s off (%3$s)', 'october-events'), $o->currency, number_format((float) $o->discount_amount, 2), $o->promo_code ?: __('discount', 'october-events'))); ?></div>
                            <?php endif; ?>
                            <?php if ($o->payment_id) : ?><div class="description" style="word-break:break-all"><?php echo esc_html((string) $o->payment_id); ?></div><?php endif; ?>
                        </div>
                        <div style="flex:1;min-width:260px">
                            <div class="description" style="text-transform:uppercase;letter-spacing:.05em;font-size:11px"><?php echo esc_html(sprintf(__('Tickets (%d)', 'october-events'), count($o_tickets))); ?></div>
                            <?php if ($o_tickets) : ?>
                                <table style="width:100%;border-collapse:collapse;margin-top:4px">
                                    <?php foreach ($o_tickets as $tk) :
                                        $tk_email = (string) ($tk->attendee_email ?? '') !== '' ? (string) $tk->attendee_email : (string) $o->email;
                                        $can_transfer = ((string) $tk->status === 'active');
                                    ?>
                                        <tr style="border-bottom:1px solid #eee">
                                            <td style="padding:3px 8px 3px 0;white-space:nowrap;vertical-align:top"><code>#<?php echo esc_html((string) $tk->ticket_number); ?></code></td>
                                            <td style="padding:3px 8px">
                                                <?php echo esc_html($tk->attendee_name ?: '—'); ?>
                                                <?php if ($tk_email !== '') : ?><br><span class="description" style="font-size:11px"><?php echo esc_html($tk_email); ?></span><?php endif; ?>
                                            </td>
                                            <td style="padding:3px 0;vertical-align:top"><span class="oe-status oe-status-<?php echo esc_attr($tk->status); ?>"><?php echo esc_html($tk->status); ?></span></td>
                                            <td style="padding:3px 0 3px 8px;white-space:nowrap;vertical-align:top">
                                                <?php if (! empty($tk->token)) : ?>
                                                    <a href="<?php echo esc_url(\OE\Ticketing\Orders::ticket_url((string) $tk->token)); ?>" target="_blank" rel="noopener"><?php esc_html_e('View', 'october-events'); ?></a>
                                                <?php endif; ?>
                                                <?php if ($can_transfer) : ?>
                                                    &middot; <a href="#" class="oe-xfer-toggle" data-target="oe-xfer-<?php echo (int) $tk->id; ?>"><?php esc_html_e('Transfer', 'october-events'); ?></a>
                                                <?php endif; ?>
                                            </td>
                                        </tr>
                                        <?php if ($can_transfer) : ?>
                                        <tr id="oe-xfer-<?php echo (int) $tk->id; ?>" style="display:none">
                                            <td colspan="4" style="padding:6px 0 10px">
                                                <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;background:#fff;border:1px solid #e3ded3;border-radius:8px;padding:10px">
                                                    <input type="hidden" name="action" value="oe_transfer_ticket">
                                                    <input type="hidden" name="ticket_id" value="<?php echo (int) $tk->id; ?>">
                                                    <?php wp_nonce_field('oe_transfer_ticket'); ?>
                                                    <label style="font-size:12px"><?php esc_html_e('New attendee name', 'october-events'); ?><br>
                                                        <input type="text" name="attendee_name" value="<?php echo esc_attr((string) $tk->attendee_name); ?>" required style="min-width:180px"></label>
                                                    <label style="font-size:12px"><?php esc_html_e('New email', 'october-events'); ?><br>
                                                        <input type="email" name="attendee_email" value="<?php echo esc_attr((string) ($tk->attendee_email ?? '')); ?>" placeholder="<?php echo esc_attr($tk_email); ?>" required style="min-width:200px"></label>
                                                    <button type="submit" class="button button-primary" onclick="return confirm('<?php echo esc_js(__('Transfer this ticket and email the new attendee their ticket? The QR code stays the same, so any earlier copy now belongs to the new person.', 'october-events')); ?>');"><?php esc_html_e('Transfer & email ticket', 'october-events'); ?></button>
                                                </form>
                                            </td>
                                        </tr>
                                        <?php endif; ?>
                                    <?php endforeach; ?>
                                </table>
                            <?php else : ?>
                                <div class="description"><?php esc_html_e('No ticket rows.', 'october-events'); ?></div>
                            <?php endif; ?>
                        </div>
                    </div>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
    <script>
    (function(){
        document.querySelectorAll('.oe-od-toggle').forEach(function(btn){
            btn.addEventListener('click', function(){
                var row = document.getElementById(btn.getAttribute('data-target'));
                if (!row) { return; }
                var open = row.style.display !== 'none';
                row.style.display = open ? 'none' : 'table-row';
                btn.setAttribute('aria-expanded', open ? 'false' : 'true');
            });
        });
        // Reveal a ticket's transfer form inline.
        document.querySelectorAll('.oe-xfer-toggle').forEach(function(link){
            link.addEventListener('click', function(e){
                e.preventDefault();
                var row = document.getElementById(link.getAttribute('data-target'));
                if (!row) { return; }
                row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
                var input = row.querySelector('input[name="attendee_name"]');
                if (input && row.style.display !== 'none') { input.focus(); input.select(); }
            });
        });
    })();
    </script>
    </details>
</div>
