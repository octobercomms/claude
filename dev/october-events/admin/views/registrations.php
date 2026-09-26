<?php
/**
 * Attendees screen — one row per active ticket, with each attendee's order &
 * payment detail inline (expand "Order") — plus manual order/comp creation.
 *
 * @var object[]   $attendees      one row per active admission (order fields inline)
 * @var array      $attendee_stats {tickets:int, checked_in:int}
 * @var array<string,array<int,object>> $txn_tickets active tickets keyed by payment id (refund panel)
 * @var \WP_Post[] $events         published events
 * @var array      $event_types    [event_id => [['key','label'], …]]
 * @var string     $currency
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
            // Order-level actions (an attendee's ticket belongs to one order).
            $oid       = (int) $a->order_id;
            $resend    = wp_nonce_url(admin_url('admin-post.php?action=oe_resend_confirmation&id=' . $oid), 'oe_resend_confirmation');
            $cancel    = wp_nonce_url(admin_url('admin-post.php?action=oe_cancel_order&id=' . $oid), 'oe_cancel_order');
            $refund    = wp_nonce_url(admin_url('admin-post.php?action=oe_cancel_order&refund=1&id=' . $oid), 'oe_cancel_order');
            $delete    = wp_nonce_url(admin_url('admin-post.php?action=oe_delete_order&id=' . $oid), 'oe_delete_order');
            $is_stripe = in_array((string) $a->payment_method, ['stripe', 'public'], true);
            $ord_tk    = $txn_tickets[(string) $a->payment_id] ?? [];
            $placed    = $a->created_at ? (strtotime((string) $a->created_at . ' UTC') ?: 0) : 0;
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
                    <a href="#" class="button button-small oe-att-toggle" data-target="oe-attx-<?php echo (int) $a->id; ?>"><?php esc_html_e('Transfer', 'october-events'); ?></a>
                    <a href="#" class="button button-small oe-att-toggle" data-target="oe-attord-<?php echo (int) $a->id; ?>"><?php esc_html_e('Order ▾', 'october-events'); ?></a>
                </td>
            </tr>
            <tr id="oe-attord-<?php echo (int) $a->id; ?>" class="oe-att-skip" style="display:none">
                <td colspan="5" style="background:#faf9f5">
                    <div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start;padding:8px 4px 10px">
                        <div style="min-width:220px">
                            <div class="description" style="text-transform:uppercase;letter-spacing:.05em;font-size:11px"><?php esc_html_e('Order', 'october-events'); ?></div>
                            <div><strong>#<?php echo (int) $a->order_id; ?></strong> · <?php echo esc_html($a->buyer ?: '—'); ?></div>
                            <?php if ($a->buyer_email !== '') : ?><div class="description"><?php echo esc_html($a->buyer_email); ?></div><?php endif; ?>
                            <?php if ($placed) : ?><div class="description"><?php echo esc_html(sprintf(__('Placed %s', 'october-events'), wp_date('M j, Y g:i A', $placed))); ?></div><?php endif; ?>
                            <div class="description"><?php echo esc_html(sprintf(__('Source: %s', 'october-events'), $a->source ?: '—')); ?></div>
                        </div>
                        <div style="min-width:200px">
                            <div class="description" style="text-transform:uppercase;letter-spacing:.05em;font-size:11px"><?php esc_html_e('Payment', 'october-events'); ?></div>
                            <div><?php echo esc_html(ucfirst((string) $a->payment_method ?: '—') . ' · ' . number_format((float) $a->order_total, 2) . ' ' . $a->currency); ?></div>
                            <div><span class="oe-status oe-status-<?php echo esc_attr($a->order_status); ?>"><?php echo esc_html($a->order_status); ?></span></div>
                            <?php if ($a->payment_id !== '') : ?><div class="description" style="word-break:break-all"><?php echo esc_html((string) $a->payment_id); ?></div><?php endif; ?>
                        </div>
                        <div style="flex:1;min-width:220px">
                            <div class="description" style="text-transform:uppercase;letter-spacing:.05em;font-size:11px;margin-bottom:6px"><?php esc_html_e('Order actions', 'october-events'); ?></div>
                            <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:flex-start">
                                <?php if ($a->buyer_email !== '') : ?>
                                    <a class="button button-small" href="<?php echo esc_url($resend); ?>" title="<?php esc_attr_e('Email the buyer their tickets again', 'october-events'); ?>"><?php esc_html_e('Resend', 'october-events'); ?></a>
                                <?php endif; ?>
                                <a class="button button-small" href="<?php echo esc_url($cancel); ?>" onclick="return confirm('<?php echo esc_js(__('Cancel this order and void its tickets? The customer will be emailed.', 'october-events')); ?>')"><?php esc_html_e('Cancel order', 'october-events'); ?></a>
                                <?php if ($a->payment_id !== '' && $is_stripe && $ord_tk) :
                                    $panel_order_id = (int) $a->order_id;
                                    $panel_tickets  = $ord_tk;
                                    $panel_label    = __('Refund…', 'october-events');
                                    include OE_DIR . 'admin/views/_refund-panel.php';
                                elseif ($a->payment_id !== '') : ?>
                                    <a class="button button-small" href="<?php echo esc_url($refund); ?>" onclick="return confirm('<?php echo esc_js(__('Refund this order in full and void its tickets? The customer will be emailed their refund.', 'october-events')); ?>')"><?php esc_html_e('Refund', 'october-events'); ?></a>
                                <?php endif; ?>
                                <a class="button button-small button-link-delete" href="<?php echo esc_url($delete); ?>" title="<?php esc_attr_e('Permanently delete (for test data)', 'october-events'); ?>" onclick="return confirm('<?php echo esc_js(__('Permanently delete this order, its tickets and any check-in scans? This cannot be undone, and no refund is issued.', 'october-events')); ?>')"><?php esc_html_e('Delete', 'october-events'); ?></a>
                            </div>
                        </div>
                    </div>
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
        // A ticket = its main row plus its (hidden) detail rows (order + transfer).
        // Keep each group together when sorting/filtering.
        function pairs(){
            var out = [], rows = tbody.children, cur = null;
            for (var i = 0; i < rows.length; i++) {
                if (rows[i].classList.contains('oe-att-skip')) {
                    if (cur) { cur[1].push(rows[i]); }
                    continue;
                }
                cur = [rows[i], []];
                out.push(cur);
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
            ps.forEach(function(p){ tbody.appendChild(p[0]); p[1].forEach(function(s){ tbody.appendChild(s); }); });
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
                if (!show) { p[1].forEach(function(s){ s.style.display = 'none'; }); }
                if (show) { n++; }
            });
            if (shown) { shown.textContent = n + ' <?php echo esc_js(__('shown', 'october-events')); ?>'; }
        }
        if (filter) { filter.addEventListener('change', apply); }
        if (search) { search.addEventListener('input', apply); }
        apply();
        // Reveal a ticket's inline order-detail or transfer row.
        table.querySelectorAll('.oe-att-toggle').forEach(function(link){
            link.addEventListener('click', function(e){
                e.preventDefault();
                var target = document.getElementById(link.getAttribute('data-target'));
                if (!target) { return; }
                var open = target.style.display !== 'none';
                target.style.display = open ? 'none' : 'table-row';
                if (!open) {
                    var input = target.querySelector('input[name="attendee_name"]');
                    if (input) { input.focus(); input.select(); }
                }
            });
        });
    })();
    </script>
    <?php endif; ?>
</div>
