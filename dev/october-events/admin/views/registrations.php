<?php
/**
 * Tickets screen (UI-SPEC §3) — one page, one table, three lenses:
 * Attendees / Orders / Check-in log, switched by a segmented toggle. Secondary
 * modules (guided tours, waitlist, promos) are accordions linking to their
 * screens. Add order and the manual-issue form live in a right slide-in.
 *
 * Every lens is click-to-open: an attendee or check-in row opens the attendee
 * slide-in (detail, check-in history, transfer / resend / check-in), an order
 * row opens the order control-center slide-in (summary, payment, tickets,
 * history, and the resend / invoice / refund / cancel / delete actions). The
 * panels load over AJAX (no page load) and reuse the existing money handlers.
 *
 * @var object[]   $attendees      one row per active admission (order fields inline)
 * @var array      $attendee_stats {tickets:int, checked_in:int}
 * @var array<string,array<int,object>> $txn_tickets active tickets keyed by payment id (refund panel)
 * @var \WP_Post[] $events         published events
 * @var array      $event_types    [event_id => [['key','label'], …]]
 * @var object[]   $orders         Orders::transactions() rows (Orders lens)
 * @var object[]   $checkins       CheckIn::log_grouped() rows (Check-in lens)
 * @var array<int,string> $event_titles  event_id => title
 * @var string     $currency
 * @var int        $event_filter
 */
defined('ABSPATH') || exit;
use OE\Ticketing\Orders;
use OE\Admin\SlideIn;

$ev_arg          = $event_filter ? ('&event=' . (int) $event_filter) : '';
$export_orders   = wp_nonce_url(admin_url('admin.php?page=oe-tickets&oe_export=orders' . $ev_arg), 'oe_export');
$export_attendee = wp_nonce_url(admin_url('admin.php?page=oe-tickets&oe_export=attendees' . $ev_arg), 'oe_export');
$export_att_pdf  = wp_nonce_url(admin_url('admin.php?page=oe-tickets&oe_export=attendees_pdf' . $ev_arg), 'oe_export');

$cur_sym = ['USD' => '$', 'GBP' => '£', 'EUR' => '€', 'CAD' => '$', 'AUD' => '$'][$currency] ?? ($currency . ' ');
$att_total = (int) ($attendee_stats['tickets'] ?? count($attendees));
$att_in    = (int) ($attendee_stats['checked_in'] ?? 0);
$att_out   = max(0, $att_total - $att_in);
$att_pct   = $att_total ? round($att_in / $att_total * 100) : 0;
$att_capped = count($attendees) < $att_total;

$counts_map = ['0' => ['t' => $att_total, 'i' => $att_in]];
$pills = [];
foreach (($counts_by_event ?? []) as $eid => $c) {
    $counts_map[(string) $eid] = ['t' => (int) $c['tickets'], 'i' => (int) $c['checked_in']];
    $pills[$eid] = get_the_title((int) $eid) ?: ('#' . (int) $eid);
}
asort($pills, SORT_NATURAL | SORT_FLAG_CASE);

$oe_sym = ['usd' => '$', 'gbp' => '£', 'eur' => '€'][strtolower((string) ($currency ?? 'usd'))] ?? '';
$oe_rev = isset($revenue) ? (float) $revenue : 0.0;
$oe_rev_display = $oe_sym !== '' ? $oe_sym . number_format($oe_rev) : number_format($oe_rev) . ' ' . (string) ($currency ?? '');
?>
<div class="wrap oe-admin oe-tickets">
    <h1 style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <span><?php esc_html_e('Tickets', 'october-events'); ?></span>
        <span style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <?php echo SlideIn::trigger('oe-add-order', __('+ Add order', 'october-events'), 'button button-primary'); ?>
            <?php echo SlideIn::trigger('oe-message-attendees', __('Message attendees', 'october-events')); ?>
            <a class="button" href="<?php echo esc_url($export_attendee); ?>" id="oe-export-att"><?php esc_html_e('Export CSV', 'october-events'); ?></a>
            <a class="button" href="<?php echo esc_url($export_att_pdf); ?>" id="oe-export-att-pdf" target="_blank" rel="noopener"><?php esc_html_e('Attendee list (PDF)', 'october-events'); ?></a>
            <a class="button" href="<?php echo esc_url($export_orders); ?>" id="oe-export-ord"><?php esc_html_e('Export orders', 'october-events'); ?></a>
        </span>
    </h1>
    <p class="description" id="oe-export-note" style="margin:4px 0 0<?php echo $event_filter ? '' : ';display:none'; ?>">
        <?php echo esc_html(sprintf(__('Exports are filtered to: %s', 'october-events'), $event_filter ? (get_the_title($event_filter) ?: ('#' . $event_filter)) : '')); ?>
    </p>
    <?php \OE\Admin\Admin::bento('tickets'); ?>

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
            'undone'        => ['success', __('Check-in reversed.', 'october-events')],
        ];
        $note = $messages[$m] ?? ['error', __('Could not create that order — check the event has a ticket type.', 'october-events')]; ?>
        <div class="notice notice-<?php echo esc_attr($note[0]); ?> is-dismissible"><p><?php echo esc_html($note[1]); ?></p></div>
    <?php endif; ?>

    <div class="oe-ad-strip">
        <div class="oe-ad-stat oe-ad-stat--feature"><div class="l"><?php esc_html_e('Tickets', 'october-events'); ?></div><div class="v" id="oe-chip-total"><?php echo esc_html(number_format_i18n($att_total)); ?></div><div class="s"><?php esc_html_e('across events', 'october-events'); ?></div></div>
        <div class="oe-ad-stat"><div class="l"><?php esc_html_e('Checked in', 'october-events'); ?></div><div class="v" id="oe-chip-in"><?php echo esc_html(number_format_i18n($att_in) . ' · ' . $att_pct . '%'); ?></div><div class="s"><?php esc_html_e('at the door', 'october-events'); ?></div></div>
        <div class="oe-ad-stat"><div class="l"><?php esc_html_e('Not in', 'october-events'); ?></div><div class="v" id="oe-chip-out"><?php echo esc_html(number_format_i18n($att_out)); ?></div><div class="s"><?php esc_html_e('yet to arrive', 'october-events'); ?></div></div>
        <div class="oe-ad-stat"><div class="l"><?php esc_html_e('Revenue', 'october-events'); ?></div><div class="v"><?php echo esc_html($oe_rev_display); ?></div><div class="s"><?php esc_html_e('paid orders', 'october-events'); ?></div></div>
    </div>

    <?php if ($pills) : ?>
    <div class="oe-section-label"><?php esc_html_e('Filter by event', 'october-events'); ?></div>
    <div class="oe-att-events" style="display:flex;gap:6px;flex-wrap:wrap;margin:0 0 12px">
        <button type="button" class="button oe-att-ev-btn<?php echo $event_filter ? '' : ' button-primary'; ?>" data-ev="0"><?php echo esc_html(sprintf(__('All events (%s)', 'october-events'), number_format_i18n($att_total))); ?></button>
        <?php foreach ($pills as $eid => $etitle) : ?>
            <button type="button" class="button oe-att-ev-btn<?php echo $event_filter === (int) $eid ? ' button-primary' : ''; ?>" data-ev="<?php echo (int) $eid; ?>"><?php echo esc_html($etitle . ' (' . number_format_i18n($counts_map[(string) $eid]['t']) . ')'); ?></button>
        <?php endforeach; ?>
    </div>
    <?php endif; ?>

    <details class="oe-ad-card oe-tix-mainacc" open>
        <summary class="oe-tix-mainsum"><strong><?php esc_html_e('Registrations', 'october-events'); ?></strong> <span class="description"><?php echo esc_html(sprintf(__('%1$s attendees · %2$s orders · %3$s check-ins', 'october-events'), number_format_i18n($att_total), number_format_i18n(count($orders)), number_format_i18n($att_in))); ?></span></summary>
        <div class="oe-tix-toolbar">
            <div class="oe-tix-seg" id="oe-tix-seg">
                <button type="button" class="is-on" data-lens="attendees"><?php esc_html_e('Attendees', 'october-events'); ?> <b><?php echo esc_html(number_format_i18n($att_total)); ?></b></button>
                <button type="button" data-lens="orders"><?php esc_html_e('Orders', 'october-events'); ?> <b><?php echo esc_html(number_format_i18n(count($orders))); ?></b></button>
                <button type="button" data-lens="checkins"><?php esc_html_e('Check-in log', 'october-events'); ?> <b><?php echo esc_html(number_format_i18n($att_in)); ?></b></button>
            </div>
        </div>

        <!-- ===== Lens: Attendees (existing operational hub, kept verbatim) ===== -->
        <div class="oe-tix-lens" data-lens="attendees">
        <?php if (! $attendees) : ?>
            <div class="notice notice-info inline" style="margin:0"><p><?php esc_html_e('No tickets issued yet for this filter.', 'october-events'); ?></p></div>
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
                <span class="description"><?php echo esc_html(sprintf(__('Showing %1$s of %2$s tickets (not-checked-in first). Filter by event or export for the full list.', 'october-events'), number_format_i18n(count($attendees)), number_format_i18n($att_total))); ?></span>
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
                $view_url  = Orders::ticket_url((string) $a->token);
            ?>
                <tr class="oe-tix-click <?php echo $a->checked_in ? 'oe-att-in' : 'oe-att-out'; ?>"
                    data-oe-detail="attendee" data-id="<?php echo (int) $a->id; ?>"
                    data-status="<?php echo $a->checked_in ? 'in' : 'out'; ?>"
                    data-event="<?php echo (int) $a->event_id; ?>"
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
            var counts   = <?php echo wp_json_encode($counts_map); ?>;
            var evTitles = <?php echo wp_json_encode($pills); ?>;
            var curEvent = <?php echo (int) $event_filter; ?>;
            var exportNote = <?php echo wp_json_encode(__('Exports are filtered to: %s', 'october-events')); ?>;
            function pairs(){
                var out = [], rows = tbody.children, cur = null;
                for (var i = 0; i < rows.length; i++) {
                    if (rows[i].classList.contains('oe-att-skip')) { if (cur) { cur[1].push(rows[i]); } continue; }
                    cur = [rows[i], []]; out.push(cur);
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
                sortDir = (sortKey === key) ? -sortDir : 1; sortKey = key;
                var ps = pairs();
                ps.sort(function(a, b){ var x = val(a[0], key), y = val(b[0], key); if (x < y) { return -1 * sortDir; } if (x > y) { return 1 * sortDir; } return 0; });
                ps.forEach(function(p){ tbody.appendChild(p[0]); p[1].forEach(function(s){ tbody.appendChild(s); }); });
                table.querySelectorAll('.oe-att-arrow').forEach(function(s){ s.textContent = ''; });
                var th = table.querySelector('th[data-key="' + key + '"] .oe-att-arrow');
                if (th) { th.textContent = sortDir > 0 ? '▲' : '▼'; }
            }
            table.querySelectorAll('th.oe-att-sortable').forEach(function(th){ th.addEventListener('click', function(){ sortBy(th.getAttribute('data-key')); }); });
            var filter = document.getElementById('oe-att-filter'), search = document.getElementById('oe-att-search'), shown = document.getElementById('oe-att-shown');
            function apply(){
                var f = filter ? filter.value : 'all', q = (search ? search.value : '').trim().toLowerCase(), n = 0;
                pairs().forEach(function(p){
                    var row = p[0];
                    var okF = (f === 'all') || row.getAttribute('data-status') === f;
                    var okQ = !q || (row.getAttribute('data-search') || '').indexOf(q) !== -1;
                    var okE = (curEvent === 0) || parseInt(row.getAttribute('data-event'), 10) === curEvent;
                    var show = okF && okQ && okE;
                    row.style.display = show ? '' : 'none';
                    if (!show) { p[1].forEach(function(s){ s.style.display = 'none'; }); }
                    if (show) { n++; }
                });
                if (shown) { shown.textContent = n + ' <?php echo esc_js(__('shown', 'october-events')); ?>'; }
            }
            if (filter) { filter.addEventListener('change', apply); }
            if (search) { search.addEventListener('input', apply); }
            function fmt(n){ try { return (n | 0).toLocaleString(); } catch (e) { return '' + (n | 0); } }
            function updateChips(){
                var c = counts[String(curEvent)] || counts['0'] || { t: 0, i: 0 };
                var t = c.t | 0, inn = c.i | 0, out = Math.max(0, t - inn), pct = t ? Math.round(inn / t * 100) : 0;
                var et = document.getElementById('oe-chip-total'), ei = document.getElementById('oe-chip-in'), eo = document.getElementById('oe-chip-out');
                if (et) { et.textContent = fmt(t); } if (ei) { ei.textContent = fmt(inn) + ' · ' + pct + '%'; } if (eo) { eo.textContent = fmt(out); }
            }
            function setExportEvent(id){
                ['oe-export-att', 'oe-export-att-pdf', 'oe-export-ord'].forEach(function(eid){
                    var a = document.getElementById(eid); if (!a) { return; }
                    try { var u = new URL(a.getAttribute('href'), window.location.origin); if (id) { u.searchParams.set('event', id); } else { u.searchParams.delete('event'); } a.setAttribute('href', u.toString()); } catch (e) {}
                });
                var note = document.getElementById('oe-export-note');
                if (note) { if (id && evTitles[String(id)]) { note.textContent = exportNote.replace('%s', evTitles[String(id)]); note.style.display = ''; } else { note.style.display = 'none'; } }
            }
            // Event pills drive the attendees lens AND the other lenses (shared).
            window.oeTixEvent = curEvent;
            var evBtns = document.querySelectorAll('.oe-att-ev-btn');
            evBtns.forEach(function(b){
                b.addEventListener('click', function(){
                    curEvent = parseInt(b.getAttribute('data-ev'), 10) || 0; window.oeTixEvent = curEvent;
                    evBtns.forEach(function(x){ x.classList.remove('button-primary'); }); b.classList.add('button-primary');
                    updateChips(); setExportEvent(curEvent);
                    try { var url = new URL(window.location.href); if (curEvent) { url.searchParams.set('event', curEvent); } else { url.searchParams.delete('event'); } window.history.replaceState({}, '', url.toString()); } catch (e) {}
                    apply();
                    if (window.oeTixLensApply) { window.oeTixLensApply(); }
                });
            });
            updateChips(); apply();
        })();
        </script>
        <?php endif; ?>
        </div><!-- /attendees lens -->

        <!-- ===== Lens: Orders ===== -->
        <div class="oe-tix-lens" data-lens="orders" hidden>
            <div style="margin:0 0 10px"><input type="search" class="oe-tix-lsearch" data-lens="orders" placeholder="<?php esc_attr_e('Search buyer, email or event…', 'october-events'); ?>" style="min-width:240px"></div>
            <?php if (! $orders) : ?>
                <div class="notice notice-info inline" style="margin:0"><p><?php esc_html_e('No orders yet.', 'october-events'); ?></p></div>
            <?php else : ?>
            <table class="oe-ad-table">
                <thead><tr>
                    <th><?php esc_html_e('Buyer', 'october-events'); ?></th>
                    <th><?php esc_html_e('Event', 'october-events'); ?></th>
                    <th class="oe-ad-num"><?php esc_html_e('Tickets', 'october-events'); ?></th>
                    <th class="oe-ad-num"><?php esc_html_e('Total', 'october-events'); ?></th>
                    <th><?php esc_html_e('Placed', 'october-events'); ?></th>
                </tr></thead>
                <tbody>
                <?php foreach ($orders as $o) :
                    $ev_t = $event_titles[(int) $o->event_id] ?? ('#' . (int) $o->event_id);
                    $when = $o->created_at ? (strtotime((string) $o->created_at . ' UTC') ?: 0) : 0;
                    $srch = strtolower(trim((string) $o->name . ' ' . (string) $o->email . ' ' . $ev_t));
                ?>
                    <tr class="oe-tix-click" data-oe-detail="order" data-id="<?php echo (int) $o->order_id; ?>" data-event="<?php echo (int) $o->event_id; ?>" data-search="<?php echo esc_attr($srch); ?>">
                        <td><strong><?php echo esc_html((string) $o->name ?: '—'); ?></strong>
                            <?php if ((string) $o->email !== '') : ?><br><span class="description"><?php echo esc_html((string) $o->email); ?></span><?php endif; ?>
                        </td>
                        <td><?php echo esc_html($ev_t); ?></td>
                        <td class="oe-ad-num"><?php echo (int) $o->active; ?><?php if ((int) $o->tickets !== (int) $o->active) : ?> <span class="description">/ <?php echo (int) $o->tickets; ?></span><?php endif; ?></td>
                        <td class="oe-ad-num"><?php echo esc_html($cur_sym . number_format_i18n((float) $o->total, 2)); ?></td>
                        <td><?php echo $when ? esc_html(wp_date('M j, Y g:i A', $when)) : '<span class="description">—</span>'; ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
            <p class="oe-ad-note"><?php esc_html_e('One row per order. Click to open the control center — payment, tickets and the resend / invoice / refund / cancel / delete actions.', 'october-events'); ?></p>
            <?php endif; ?>
        </div><!-- /orders lens -->

        <!-- ===== Lens: Check-in log ===== -->
        <div class="oe-tix-lens" data-lens="checkins" hidden>
            <div style="margin:0 0 10px"><input type="search" class="oe-tix-lsearch" data-lens="checkins" placeholder="<?php esc_attr_e('Search attendee, event or door…', 'october-events'); ?>" style="min-width:240px"></div>
            <?php if (! $checkins) : ?>
                <div class="notice notice-info inline" style="margin:0"><p><?php esc_html_e('No check-ins recorded yet.', 'october-events'); ?></p></div>
            <?php else : ?>
            <table class="oe-ad-table">
                <thead><tr>
                    <th><?php esc_html_e('Attendee', 'october-events'); ?></th>
                    <th><?php esc_html_e('Event', 'october-events'); ?></th>
                    <th><?php esc_html_e('Door', 'october-events'); ?></th>
                    <th class="oe-ad-num"><?php esc_html_e('Scans', 'october-events'); ?></th>
                    <th><?php esc_html_e('Last scan', 'october-events'); ?></th>
                    <th class="oe-ad-num"></th>
                </tr></thead>
                <tbody>
                <?php foreach ($checkins as $c) :
                    $ev_t = $event_titles[(int) $c->event_id] ?? ('#' . (int) $c->event_id);
                    $when = $c->last_at ? (strtotime((string) $c->last_at . ' UTC') ?: 0) : 0;
                    $venue = (string) ($c->venue_name ?? '');
                    $srch = strtolower(trim((string) $c->attendee_name . ' ' . $ev_t . ' ' . $venue));
                    $undo = wp_nonce_url(admin_url('admin-post.php?action=oe_checkin_undo&ticket_id=' . (int) $c->ticket_id . '&event_id=' . (int) $c->event_id . '&venue=' . rawurlencode($venue)), 'oe_checkin_undo');
                ?>
                    <tr class="oe-tix-click" data-oe-detail="attendee" data-id="<?php echo (int) $c->ticket_id; ?>" data-event="<?php echo (int) $c->event_id; ?>" data-search="<?php echo esc_attr($srch); ?>">
                        <td><strong><?php echo esc_html((string) $c->attendee_name ?: '—'); ?></strong>
                            <?php if ((string) $c->ticket_type_label !== '') : ?><br><span class="description"><?php echo esc_html((string) $c->ticket_type_label); ?></span><?php endif; ?>
                        </td>
                        <td><?php echo esc_html($ev_t); ?></td>
                        <td><?php echo $venue !== '' ? esc_html($venue) : '<span class="description">—</span>'; ?></td>
                        <td class="oe-ad-num"><?php echo (int) $c->scans; ?><?php if ((int) $c->rescans > 0) : ?> <span class="description">(+<?php echo (int) $c->rescans; ?>)</span><?php endif; ?></td>
                        <td><?php echo $when ? esc_html(wp_date('M j, g:i A', $when)) : '<span class="description">—</span>'; ?></td>
                        <td class="oe-ad-num"><a class="button button-small" href="<?php echo esc_url($undo); ?>" onclick="return confirm('<?php echo esc_js(__('Reverse this check-in?', 'october-events')); ?>');"><?php esc_html_e('Undo', 'october-events'); ?></a></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
            <p class="oe-ad-note"><?php esc_html_e('One row per ticket × door, most recent first. A repeat scan at the same door bumps the count rather than adding a row.', 'october-events'); ?></p>
            <?php endif; ?>
        </div><!-- /checkins lens -->
    </details><!-- /card -->

    <div class="oe-section-label"><?php esc_html_e('More', 'october-events'); ?></div>
    <?php
    $oe_cur     = strtoupper((string) \OE\Settings::get('currency', 'usd'));
    $oe_cur_sym = ['USD' => '$', 'GBP' => '£', 'EUR' => '€', 'CAD' => '$', 'AUD' => '$'][$oe_cur] ?? ($oe_cur . ' ');
    $oe_promos   = \OE\Ticketing\Promo::all();
    $oe_waitlist = \OE\Ticketing\Waitlist::all(0);
    $guided_url  = admin_url('admin.php?page=oe-tickets&tab=guided');
    $waitlist_url = admin_url('admin.php?page=oe-tickets&tab=waitlist');
    $promos_url  = admin_url('admin.php?page=oe-tickets&tab=promos');
    $oe_timed_locs = class_exists('\\OE\\GuidedTours\\Slots') ? \OE\GuidedTours\Slots::locations_with_slots() : [];
    ?>

    <?php // ---- Timed tickets: per-location timed slots (e.g. tours, talks, demos) ---- ?>
    <details class="oe-acc oe-tix-moreacc"<?php echo $oe_timed_locs ? ' open' : ''; ?>>
        <summary>
            <span class="oe-tix-moresum"><strong><?php esc_html_e('Timed tickets', 'october-events'); ?></strong>
                <span class="description"><?php echo esc_html(sprintf(_n('%s location with timed slots', '%s locations with timed slots', count($oe_timed_locs), 'october-events'), number_format_i18n(count($oe_timed_locs)))); ?></span></span>
        </summary>
        <div class="oe-acc-body">
            <p style="margin:0 0 12px"><?php esc_html_e('Timed slots give a location its own bookable times with limited capacity, for anything that runs on a schedule: tours, talks, demos or tastings.', 'october-events'); ?></p>
            <?php if (! $oe_timed_locs) : ?>
                <p class="description" style="margin:0 0 12px"><?php esc_html_e('No timed slots yet. Open a location and add slots to let people book a specific time.', 'october-events'); ?></p>
            <?php else : ?>
            <table class="oe-ad-table">
                <thead><tr>
                    <th><?php esc_html_e('Location', 'october-events'); ?></th>
                    <th class="oe-ad-num"><?php esc_html_e('Slots', 'october-events'); ?></th>
                    <th><?php esc_html_e('Next slot', 'october-events'); ?></th>
                    <th class="oe-ad-num"></th>
                </tr></thead>
                <tbody>
                <?php foreach ($oe_timed_locs as $loc_id) :
                    $slots = \OE\GuidedTours\Slots::all((int) $loc_id);
                    $active = array_values(array_filter($slots, static fn($s) => ! empty($s['active'])));
                    $next_label = '—';
                    foreach ($active as $s) {
                        if ($s['date'] === '') { continue; }
                        $ts = (int) (strtotime($s['date'] . ' ' . ($s['start'] ?: '12:00')) ?: 0);
                        if ($ts >= (time() - DAY_IN_SECONDS)) {
                            $next_label = wp_date('D M j', $ts) . ($s['start'] !== '' ? ' · ' . gmdate('g:i A', (int) strtotime('2000-01-01 ' . $s['start'])) : '');
                            break;
                        }
                    }
                    $edit = admin_url('admin.php?page=oe-tickets&tab=guided&building=' . (int) $loc_id);
                ?>
                    <tr>
                        <td><strong><?php echo esc_html(get_the_title((int) $loc_id) ?: ('#' . (int) $loc_id)); ?></strong></td>
                        <td class="oe-ad-num"><?php echo esc_html(number_format_i18n(count($slots))); ?></td>
                        <td><?php echo esc_html($next_label); ?></td>
                        <td class="oe-ad-num"><a class="button button-small" href="<?php echo esc_url($edit); ?>"><?php esc_html_e('Edit slots', 'october-events'); ?></a></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
            <?php endif; ?>
            <p style="margin:12px 0 0"><a class="button button-primary" href="<?php echo esc_url($guided_url); ?>"><?php esc_html_e('Manage timed tickets', 'october-events'); ?></a></p>
        </div>
    </details>

    <?php // ---- Waitlist (inline) ---- ?>
    <details class="oe-acc oe-tix-moreacc"<?php echo $oe_waitlist ? ' open' : ''; ?>>
        <summary>
            <span class="oe-tix-moresum"><strong><?php esc_html_e('Waitlist', 'october-events'); ?></strong>
                <span class="description"><?php echo esc_html(sprintf(_n('%s person waiting', '%s people waiting', count($oe_waitlist), 'october-events'), number_format_i18n(count($oe_waitlist)))); ?></span></span>
        </summary>
        <div class="oe-acc-body">
            <?php if (! $oe_waitlist) : ?>
                <p class="description" style="margin:0"><?php esc_html_e('No one on the waitlist. People join from checkout when a ticket type is sold out.', 'october-events'); ?></p>
            <?php else : ?>
            <table class="oe-ad-table">
                <thead><tr>
                    <th><?php esc_html_e('Name', 'october-events'); ?></th>
                    <th><?php esc_html_e('Event', 'october-events'); ?></th>
                    <th><?php esc_html_e('Ticket type', 'october-events'); ?></th>
                    <th><?php esc_html_e('Status', 'october-events'); ?></th>
                    <th class="oe-ad-num"></th>
                </tr></thead>
                <tbody>
                <?php foreach (array_slice($oe_waitlist, 0, 30) as $w) :
                    $offer    = wp_nonce_url(admin_url('admin-post.php?action=oe_waitlist_promote&id=' . (int) $w->id), 'oe_waitlist_promote');
                    $notified = (string) ($w->status ?? '') === 'notified';
                ?>
                    <tr>
                        <td><strong><?php echo esc_html((string) ($w->name ?? '') ?: '—'); ?></strong><br><span class="description"><?php echo esc_html((string) $w->email); ?></span></td>
                        <td><?php echo esc_html(get_the_title((int) $w->event_id) ?: ('#' . (int) $w->event_id)); ?></td>
                        <td><?php echo esc_html((string) ($w->ticket_type_label ?? '') ?: '—'); ?></td>
                        <td><span class="oe-ad-pill oe-ad-pill--<?php echo $notified ? 'pos' : 'neu'; ?>"><?php echo $notified ? esc_html__('Notified', 'october-events') : esc_html__('Waiting', 'october-events'); ?></span></td>
                        <td class="oe-ad-num"><a class="button button-small" href="<?php echo esc_url($offer); ?>"><?php echo $notified ? esc_html__('Offer again', 'october-events') : esc_html__('Offer spot', 'october-events'); ?></a></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
            <p style="margin:10px 0 0"><a class="button" href="<?php echo esc_url($waitlist_url); ?>"><?php esc_html_e('Manage waitlist', 'october-events'); ?></a></p>
            <?php endif; ?>
        </div>
    </details>

    <?php // ---- Promo codes (inline) ---- ?>
    <details class="oe-acc oe-tix-moreacc"<?php echo $oe_promos ? ' open' : ''; ?>>
        <summary>
            <span class="oe-tix-moresum"><strong><?php esc_html_e('Promo codes', 'october-events'); ?></strong>
                <span class="description"><?php echo esc_html(sprintf(_n('%s code', '%s codes', count($oe_promos), 'october-events'), number_format_i18n(count($oe_promos)))); ?></span></span>
        </summary>
        <div class="oe-acc-body">
            <?php if (! $oe_promos) : ?>
                <p class="description" style="margin:0 0 12px"><?php esc_html_e('No promo codes yet. Create percentage or fixed discounts for checkout.', 'october-events'); ?></p>
            <?php else : ?>
            <table class="oe-ad-table">
                <thead><tr>
                    <th><?php esc_html_e('Code', 'october-events'); ?></th>
                    <th><?php esc_html_e('Event', 'october-events'); ?></th>
                    <th><?php esc_html_e('Discount', 'october-events'); ?></th>
                    <th class="oe-ad-num"><?php esc_html_e('Used', 'october-events'); ?></th>
                    <th><?php esc_html_e('Status', 'october-events'); ?></th>
                </tr></thead>
                <tbody>
                <?php foreach ($oe_promos as $p) :
                    $disc = (string) $p->discount_type === 'percent'
                        ? sprintf(__('%s%% off', 'october-events'), rtrim(rtrim(number_format((float) $p->discount_value, 2), '0'), '.'))
                        : sprintf(__('%s off', 'october-events'), $oe_cur_sym . number_format((float) $p->discount_value, 2));
                    $used = (int) $p->used_count . ($p->max_uses !== null ? ' / ' . (int) $p->max_uses : '');
                    $active = ! empty($p->active);
                ?>
                    <tr>
                        <td><code><?php echo esc_html((string) $p->code); ?></code></td>
                        <td><span class="description"><?php echo $p->event_id ? esc_html(get_the_title((int) $p->event_id) ?: ('#' . (int) $p->event_id)) : esc_html__('All events', 'october-events'); ?></span></td>
                        <td><?php echo esc_html($disc); ?></td>
                        <td class="oe-ad-num"><?php echo esc_html($used); ?></td>
                        <td><span class="oe-ad-pill oe-ad-pill--<?php echo $active ? 'pos' : 'neu'; ?>"><?php echo $active ? esc_html__('Active', 'october-events') : esc_html__('Off', 'october-events'); ?></span></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
            <?php endif; ?>
            <p style="margin:10px 0 0"><a class="button button-primary" href="<?php echo esc_url($promos_url); ?>"><?php esc_html_e('+ New code', 'october-events'); ?></a> <a class="button" href="<?php echo esc_url($promos_url); ?>"><?php esc_html_e('Manage codes', 'october-events'); ?></a></p>
        </div>
    </details>
    <?php // phpcs:ignore -- end More ?>

    <?php // ===== Add-order slide-in (the manual issue form) ===== ?>
    <?php SlideIn::open('oe-add-order', __('Add an order', 'october-events')); ?>
        <?php if (! $events) : ?>
            <p class="description"><?php printf(
                /* translators: %s: link to create an event */
                esc_html__('You don’t have any published events yet. %s, add a ticket type to it, then you can issue tickets here.', 'october-events'),
                '<a href="' . esc_url(admin_url('post-new.php?post_type=' . \OE\PostTypes::slug('event'))) . '">' . esc_html__('Create an event', 'october-events') . '</a>'
            ); ?></p>
        <?php elseif (! $event_types) : ?>
            <p class="description"><?php esc_html_e('None of your events have ticket types yet. Open an event and add at least one ticket type (in its “Tickets” box) — only then can tickets be issued.', 'october-events'); ?></p>
        <?php endif; ?>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="oe-manual-order" style="display:grid;gap:12px;">
            <input type="hidden" name="action" value="oe_create_order">
            <?php wp_nonce_field('oe_create_order'); ?>
            <label><?php esc_html_e('Event', 'october-events'); ?>
                <select name="event_id" id="oe-mo-event" required style="width:100%">
                    <option value=""><?php esc_html_e('Choose…', 'october-events'); ?></option>
                    <?php foreach ($events as $ev) : $has = ! empty($event_types[$ev->ID]); ?>
                        <option value="<?php echo (int) $ev->ID; ?>" data-edit="<?php echo esc_url((string) get_edit_post_link($ev->ID, '')); ?>">
                            <?php echo esc_html(get_the_title($ev) ?: ('#' . (int) $ev->ID)); ?><?php echo $has ? '' : ' — ' . esc_html__('no ticket types', 'october-events'); ?>
                        </option>
                    <?php endforeach; ?>
                </select></label>
            <label><?php esc_html_e('Ticket type', 'october-events'); ?>
                <select name="type_key" id="oe-mo-type" required style="width:100%"></select></label>
            <div style="display:flex;gap:12px;flex-wrap:wrap;">
                <label style="flex:0 0 80px"><?php esc_html_e('Qty', 'october-events'); ?>
                    <input type="number" name="qty" value="1" min="1" style="width:100%"></label>
                <label style="flex:1;min-width:140px"><?php esc_html_e('Mode', 'october-events'); ?>
                    <select name="mode" style="width:100%"><option value="comp"><?php esc_html_e('Comp (free)', 'october-events'); ?></option><option value="paid"><?php esc_html_e('Mark paid', 'october-events'); ?></option></select></label>
            </div>
            <label><?php esc_html_e('Name', 'october-events'); ?><input type="text" name="name" style="width:100%"></label>
            <label><?php esc_html_e('Email', 'october-events'); ?><input type="email" name="email" required style="width:100%"></label>
            <p id="oe-mo-hint" class="description" style="margin:0;color:#b32d2e;display:none"></p>
            <div><button class="button button-primary" id="oe-mo-submit"><?php esc_html_e('Issue tickets', 'october-events'); ?></button></div>
        </form>
    <?php SlideIn::close(); ?>

    <?php // ===== Message-attendees slide-in (compose; sends only on click) ===== ?>
    <?php SlideIn::open('oe-message-attendees', __('Message attendees', 'october-events'), is_array($msg_result)); ?>
        <?php
        $events   = $msg_events;   // for the shared compose partial
        $result   = $msg_result;
        $selected = $event_filter;
        require OE_DIR . 'admin/views/_message-compose.php';
        ?>
    <?php SlideIn::close(); ?>

    <script>
    (function(){
        // Manual-order dependent dropdown (ticket types per event).
        var map = <?php echo wp_json_encode($event_types); ?>;
        var noTypes = <?php echo wp_json_encode(__('This event has no ticket types yet — open it and add one before issuing.', 'october-events')); ?>;
        var openLbl = <?php echo wp_json_encode(__('Open the event', 'october-events')); ?>;
        var ev = document.getElementById('oe-mo-event'), ty = document.getElementById('oe-mo-type'), btn = document.getElementById('oe-mo-submit'), hint = document.getElementById('oe-mo-hint');
        function fill(){
            if (!ev || !ty) { return; }
            ty.innerHTML=''; var types = map[ev.value] || [];
            types.forEach(function(t){ var o=document.createElement('option'); o.value=t.key; o.textContent=t.label; ty.appendChild(o); });
            var blocked = !!ev.value && !types.length; ty.disabled = !types.length; if (btn) { btn.disabled = blocked; }
            if (hint) {
                if (blocked) { var opt = ev.options[ev.selectedIndex], edit = opt && opt.getAttribute('data-edit'); hint.innerHTML = noTypes + (edit ? ' <a href="' + edit + '">' + openLbl + ' ↗</a>' : ''); hint.style.display = 'block'; }
                else { hint.style.display = 'none'; }
            }
        }
        if (ev) { ev.addEventListener('change', fill); fill(); }

        // Lens segmented toggle + per-lens search + shared event filter.
        var seg = document.getElementById('oe-tix-seg');
        var lenses = document.querySelectorAll('.oe-tix-lens');
        function lensApply(){
            var ev = window.oeTixEvent || 0;
            document.querySelectorAll('.oe-tix-lens[data-lens="orders"] tbody tr, .oe-tix-lens[data-lens="checkins"] tbody tr').forEach(function(tr){
                var box = tr.closest('.oe-tix-lens');
                var inp = box ? box.querySelector('.oe-tix-lsearch') : null;
                var q = inp ? inp.value.trim().toLowerCase() : '';
                var okE = (ev === 0) || parseInt(tr.getAttribute('data-event'), 10) === ev;
                var okQ = !q || (tr.getAttribute('data-search') || '').indexOf(q) !== -1;
                tr.style.display = (okE && okQ) ? '' : 'none';
            });
        }
        window.oeTixLensApply = lensApply;
        if (seg) {
            seg.querySelectorAll('button').forEach(function(b){
                b.addEventListener('click', function(){
                    var lens = b.getAttribute('data-lens');
                    seg.querySelectorAll('button').forEach(function(x){ x.classList.toggle('is-on', x === b); });
                    lenses.forEach(function(l){ l.hidden = l.getAttribute('data-lens') !== lens; });
                    lensApply();
                });
            });
        }
        document.querySelectorAll('.oe-tix-lsearch').forEach(function(inp){ inp.addEventListener('input', lensApply); });
        lensApply();
    })();
    </script>

    <?php // ===== Shared record slide-in (attendee / order), loaded over AJAX ===== ?>
    <aside class="oe-slide oe-slide-wide" id="oe-tix-detail" role="dialog" aria-label="<?php esc_attr_e('Record detail', 'october-events'); ?>">
        <div id="oe-tix-detail-body"><div class="oe-tixp-loading description" style="padding:28px 24px"><?php esc_html_e('Loading…', 'october-events'); ?></div></div>
    </aside>
    <script>
    (function(){
        var nonce = <?php echo wp_json_encode(wp_create_nonce('oe_tix_detail')); ?>;
        var ajax  = (typeof ajaxurl !== 'undefined') ? ajaxurl : <?php echo wp_json_encode(admin_url('admin-ajax.php')); ?>;
        var panel = document.getElementById('oe-tix-detail');
        var body  = document.getElementById('oe-tix-detail-body');
        if (!panel || !body) { return; }
        function openDetail(type, id){
            body.innerHTML = <?php echo wp_json_encode('<div class="oe-tixp-loading description" style="padding:28px 24px">' . esc_html__('Loading…', 'october-events') . '</div>'); ?>;
            if (window.oeSlide) { window.oeSlide.open(panel); }
            var url = ajax + '?action=oe_tix_detail&nonce=' + encodeURIComponent(nonce) + '&type=' + encodeURIComponent(type) + '&id=' + encodeURIComponent(id);
            fetch(url, { credentials: 'same-origin' })
                .then(function(r){ return r.json(); })
                .then(function(res){ body.innerHTML = (res && res.success && res.data && res.data.html) ? res.data.html : '<div style="padding:24px"><p>' + ((res && res.data && res.data.message) ? res.data.message : 'Could not load.') + '</p></div>'; })
                .catch(function(){ body.innerHTML = '<div style="padding:24px"><p>Could not load.</p></div>'; });
        }
        // One delegate covers all three lenses and the cross-links inside panels.
        document.addEventListener('click', function(e){
            var row = e.target.closest ? e.target.closest('[data-oe-detail]') : null;
            if (!row) { return; }
            // Let real controls inside a row (check-in, view, forms) work normally.
            if (e.target.closest('form, button, input, select, label') || (e.target.closest('a') && !e.target.closest('[data-oe-detail]'))) { return; }
            e.preventDefault();
            openDetail(row.getAttribute('data-oe-detail'), row.getAttribute('data-id'));
        });
    })();
    </script>
</div>
