<?php
/**
 * Transactions — one searchable, sortable list of every payment: paid orders,
 * partial/full refunds, failed Stripe charges and abandoned carts. The
 * failed-reason chart and abandoned-cart summary sit on top; a Status column
 * (and filter chips) lets you isolate one kind, and search finds a person by
 * name or email across all of them.
 *
 * @var object[]              $rows          normalised payment rows (newest first)
 * @var array<string,int>     $reasons       failed reason label => count (most common first)
 * @var int                   $failed_count  total failed charges in the window
 * @var array<string,mixed>   $abandon_stats Abandonment::stats()
 * @var bool                  $ready         Stripe connected
 * @var int                   $days          failed look-back window
 * @var string                $refresh       nonce URL to bust the failed-charge cache
 * @var array<string,array<int,object>> $txn_tickets active tickets keyed by payment id
 * @var \WP_Post[]            $events        published events (filter)
 * @var int                   $event_filter
 * @var string                $currency
 */
defined('ABSPATH') || exit;

$sym   = $currency === 'GBP' ? '£' : ($currency === 'EUR' ? '€' : '$');
$money = static fn(float $n, string $cur): string => number_format($n, 2) . ' ' . $cur;

// Status presentation: label, text colour, chip background, row background, sort rank, filter group.
$meta = [
    'paid'          => [__('Paid', 'october-events'),        '#1e7a33', '#eaf7ec', 0, 'paid'],
    'part_refunded' => [__('Part refunded', 'october-events'), '#8a5a00', '#fdf3e3', 1, 'paid'],
    'refunded'      => [__('Refunded', 'october-events'),     '#b23c17', '#fdeceb', 2, 'refunded'],
    'failed'        => [__('Failed', 'october-events'),       '#b23c17', '#fbeee9', 3, 'failed'],
    'in_progress'   => [__('In progress', 'october-events'),  '#1565c0', '#e9f1fb', 4, 'abandoned'],
    'abandoned'     => [__('Abandoned', 'october-events'),    '#6a6a6a', '#f3f2ee', 5, 'abandoned'],
];

// Export abandoned drafts (contact + cart) as CSV, filtered to the event.
$export_abandoned = wp_nonce_url(
    admin_url('admin.php?page=oe-tickets&tab=payments&oe_export=abandoned' . ($event_filter ? '&event=' . $event_filter : '')),
    'oe_export'
);

// Failed-reason pie (conic-gradient) + legend.
$total_reasons = array_sum($reasons);
$palette = ['#C8A96E', '#1a1a1a', '#e53935', '#2e7d32', '#1565c0', '#f9a825', '#6a1b9a', '#00838f', '#ef6c00', '#5d4037', '#789262', '#9e9e9e'];
$stops = [];
$legend = [];
$acc = 0;
$i = 0;
foreach ($reasons as $label => $n) {
    $color = $palette[$i % count($palette)];
    $start = $total_reasons ? $acc / $total_reasons * 360 : 0;
    $acc  += $n;
    $end   = $total_reasons ? $acc / $total_reasons * 360 : 0;
    $stops[]  = $color . ' ' . round($start, 2) . 'deg ' . round($end, 2) . 'deg';
    $legend[] = ['label' => (string) $label, 'n' => (int) $n, 'color' => $color, 'pct' => $total_reasons ? round($n / $total_reasons * 100) : 0];
    $i++;
}
$gradient = $stops ? 'conic-gradient(' . implode(',', $stops) . ')' : '#eee';

$ab_seen  = (int) $abandon_stats['abandoned'] + (int) $abandon_stats['recovered'];
$ab_recov = $ab_seen > 0 ? round($abandon_stats['recovered'] / $ab_seen * 100) : 0;
?>
<?php if (empty($oe_embed)) : ?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Tickets', 'october-events'); ?></h1>
    <?php \OE\Admin\Admin::bento('tickets'); ?>
    <?php \OE\Admin\Admin::tickets_tabs('payments'); ?>
<?php endif; ?>

    <?php if (! empty($_GET['oe_msg'])) :
        $m = sanitize_key((string) $_GET['oe_msg']);
        $map = [
            'refunded'      => ['success', __('Refund issued and the selected tickets voided.', 'october-events')],
            'refund_failed' => ['error', __('Refund failed — nothing was charged back. Check it’s a paid card transaction with tickets still active.', 'october-events')],
        ];
        if (isset($map[$m])) : ?>
            <div class="notice notice-<?php echo esc_attr($map[$m][0]); ?> is-dismissible"><p><?php echo esc_html($map[$m][1]); ?></p></div>
        <?php endif; ?>
    <?php endif; ?>

    <p class="description" style="margin:14px 0 10px;max-width:820px"><?php esc_html_e('Every payment in one place — paid orders, refunds, failed cards and abandoned carts. Search a name or email, sort any column, or use the status chips to focus. Contact details on failed and abandoned rows are for your analysis only; drafts auto-delete after 90 days.', 'october-events'); ?></p>

    <?php /* One event filter for the whole page (failed charges have no event link, so they always show). */ ?>
    <form method="get" style="margin:0 0 12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <input type="hidden" name="page" value="oe-tickets"><input type="hidden" name="tab" value="payments">
        <label style="font-weight:600"><?php esc_html_e('Event', 'october-events'); ?>
            <select name="event" onchange="this.form.submit()" style="min-width:220px">
                <option value="0"><?php esc_html_e('All events', 'october-events'); ?></option>
                <?php foreach ($events as $ev) : ?>
                    <option value="<?php echo (int) $ev->ID; ?>" <?php selected($event_filter, (int) $ev->ID); ?>><?php echo esc_html(get_the_title($ev) ?: ('#' . (int) $ev->ID)); ?></option>
                <?php endforeach; ?>
            </select>
        </label>
        <span class="description"><?php esc_html_e('Failed cards have no event, so they always show.', 'october-events'); ?></span>
    </form>

    <?php /* Top summary: failed-reason pie + abandoned-cart tiles. */ ?>
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:stretch;margin-bottom:18px">
        <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:18px;display:flex;gap:20px;align-items:center;flex:1;min-width:340px">
            <?php if (! $ready) : ?>
                <div>
                    <div class="oe-panel-label" style="margin-bottom:6px"><?php esc_html_e('Failed payments', 'october-events'); ?></div>
                    <p class="description" style="margin:0"><?php printf(
                        esc_html__('Connect Stripe under %s to see failed charges and why they failed.', 'october-events'),
                        '<a href="' . esc_url(admin_url('admin.php?page=oe-settings#api-keys')) . '">' . esc_html__('Settings → API keys', 'october-events') . '</a>'
                    ); ?></p>
                </div>
            <?php elseif (! $failed_count) : ?>
                <div>
                    <div class="oe-panel-label" style="margin-bottom:6px"><?php esc_html_e('Failed payments', 'october-events'); ?></div>
                    <strong>✓ <?php echo esc_html(sprintf(__('None in the last %d days.', 'october-events'), (int) $days)); ?></strong>
                    <a class="button button-small" href="<?php echo esc_url($refresh); ?>" style="margin-left:8px"><?php esc_html_e('Refresh', 'october-events'); ?></a>
                </div>
            <?php else : ?>
                <div style="width:150px;height:150px;border-radius:50%;flex:none;background:<?php echo esc_attr($gradient); ?>"></div>
                <div style="flex:1;min-width:0">
                    <div class="oe-panel-label" style="margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:8px">
                        <span><?php echo esc_html(sprintf(__('Why %1$d payments failed (%2$d days)', 'october-events'), (int) $failed_count, (int) $days)); ?></span>
                        <a class="button button-small" href="<?php echo esc_url($refresh); ?>"><?php esc_html_e('Refresh', 'october-events'); ?></a>
                    </div>
                    <?php foreach ($legend as $rowl) : ?>
                        <div style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:13px">
                            <span style="width:12px;height:12px;border-radius:3px;flex:none;background:<?php echo esc_attr($rowl['color']); ?>"></span>
                            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><?php echo esc_html($rowl['label']); ?></span>
                            <strong><?php echo (int) $rowl['n']; ?></strong>
                            <span style="color:#999;width:42px;text-align:right"><?php echo (int) $rowl['pct']; ?>%</span>
                        </div>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </div>

        <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:18px;flex:1;min-width:300px">
            <div class="oe-panel-label" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:8px">
                <span><?php esc_html_e('Abandoned carts', 'october-events'); ?></span>
                <a class="button button-small" href="<?php echo esc_url($export_abandoned); ?>"><?php esc_html_e('Export CSV', 'october-events'); ?></a>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px">
                <div><div style="font-size:24px;font-weight:800"><?php echo (int) $abandon_stats['abandoned']; ?></div><div class="description" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em"><?php esc_html_e('Abandoned', 'october-events'); ?></div></div>
                <div><div style="font-size:24px;font-weight:800"><?php echo esc_html($sym . number_format((float) $abandon_stats['lost_value'], 2)); ?></div><div class="description" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em"><?php esc_html_e('Not converted', 'october-events'); ?></div></div>
                <div><div style="font-size:24px;font-weight:800"><?php echo (int) $abandon_stats['recovered']; ?></div><div class="description" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em"><?php esc_html_e('Later bought', 'october-events'); ?></div></div>
                <div><div style="font-size:24px;font-weight:800"><?php echo (int) $ab_recov; ?>%</div><div class="description" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em"><?php esc_html_e('Recovery rate', 'october-events'); ?></div></div>
                <div><div style="font-size:24px;font-weight:800"><?php echo (int) $abandon_stats['open']; ?></div><div class="description" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em"><?php esc_html_e('In progress', 'october-events'); ?></div></div>
            </div>
        </div>
    </div>

    <?php /* Status filter chips + search. */ ?>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:0 0 10px">
        <div class="oe-txfilter" style="display:flex;gap:6px;flex-wrap:wrap">
            <?php
            $chips = [
                'all'       => __('All', 'october-events'),
                'paid'      => __('Paid', 'october-events'),
                'refunded'  => __('Refunded', 'october-events'),
                'failed'    => __('Failed', 'october-events'),
                'abandoned' => __('Abandoned', 'october-events'),
            ];
            foreach ($chips as $key => $label) :
                printf('<button type="button" class="button oe-txfilter-btn%s" data-grp="%s">%s</button>', $key === 'all' ? ' button-primary' : '', esc_attr($key), esc_html($label));
            endforeach; ?>
        </div>
        <input type="search" id="oe-tx-search" placeholder="<?php esc_attr_e('Search name or email…', 'october-events'); ?>" style="min-width:240px">
        <span class="description" id="oe-tx-shown"></span>
    </div>

    <?php if (! $rows) : ?>
        <div class="oe-panel" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:18px"><strong><?php esc_html_e('No payments yet.', 'october-events'); ?></strong></div>
    <?php else : ?>
    <table class="widefat striped oe-tx-table" id="oe-tx-table">
        <thead><tr>
            <th class="oe-tx-sortable" data-key="status"><?php esc_html_e('Status', 'october-events'); ?> <span class="oe-tx-arrow"></span></th>
            <th class="oe-tx-sortable" data-key="name"><?php esc_html_e('Who', 'october-events'); ?> <span class="oe-tx-arrow"></span></th>
            <th><?php esc_html_e('Event', 'october-events'); ?></th>
            <th class="oe-tx-sortable" data-key="amount" style="text-align:right"><?php esc_html_e('Amount', 'october-events'); ?> <span class="oe-tx-arrow"></span></th>
            <th class="oe-tx-sortable" data-key="ts"><?php esc_html_e('When', 'october-events'); ?> <span class="oe-tx-arrow"></span></th>
            <th><?php esc_html_e('Details', 'october-events'); ?></th>
            <th><?php esc_html_e('Actions', 'october-events'); ?></th>
        </tr></thead>
        <tbody>
        <?php foreach ($rows as $r) :
            $m = $meta[$r->kind] ?? [$r->kind, '#333', '#f3f2ee', 9, 'other'];
            [$slabel, $sfg, $sbg, $srank, $sgroup] = $m;
            $search = strtolower(trim($r->name . ' ' . $r->email . ' ' . $r->detail));
            $when   = $r->ts ? wp_date('M j, Y g:i a', $r->ts) : '—';
            $tk     = $r->payment_id !== '' ? ($txn_tickets[(string) $r->payment_id] ?? []) : [];
        ?>
            <tr class="oe-tx-row" data-grp="<?php echo esc_attr($sgroup); ?>" data-rank="<?php echo (int) $srank; ?>"
                data-ts="<?php echo (int) $r->ts; ?>" data-amount="<?php echo esc_attr((string) $r->amount); ?>"
                data-name="<?php echo esc_attr(strtolower($r->name !== '' ? $r->name : $r->email)); ?>"
                data-search="<?php echo esc_attr($search); ?>" style="--sbg:<?php echo esc_attr($sbg); ?>">
                <td><span style="display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:700;color:<?php echo esc_attr($sfg); ?>;background:<?php echo esc_attr($sbg); ?>"><?php echo esc_html($slabel); ?></span></td>
                <td>
                    <?php if ($r->name !== '') : ?><strong><?php echo esc_html($r->name); ?></strong><br><?php endif; ?>
                    <?php if ($r->email !== '') : ?><a href="<?php echo esc_url('mailto:' . $r->email); ?>" class="description" style="font-size:12px"><?php echo esc_html($r->email); ?></a><?php else : ?><span class="description">—</span><?php endif; ?>
                </td>
                <td><?php echo $r->event_id ? esc_html(get_the_title((int) $r->event_id) ?: ('#' . (int) $r->event_id)) : '<span class="description">—</span>'; ?></td>
                <td style="text-align:right;white-space:nowrap"><?php echo $r->amount > 0 ? esc_html($money((float) $r->amount, (string) $r->currency)) : '<span class="description">—</span>'; ?></td>
                <td style="white-space:nowrap"><?php echo esc_html($when); ?></td>
                <td><?php echo esc_html($r->detail); ?></td>
                <td>
                    <?php if (($r->kind === 'paid' || $r->kind === 'part_refunded') && $r->active > 0 && $tk) :
                        $panel_order_id = (int) $r->order_id;
                        $panel_tickets  = $tk;
                        $panel_label    = __('Refund…', 'october-events');
                        include OE_DIR . 'admin/views/_refund-panel.php';
                    else : ?><span class="description">—</span><?php endif; ?>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
    <style>
        .oe-tx-table tr.oe-tx-row > td { background:var(--sbg) !important; }
        .oe-tx-table th.oe-tx-sortable { cursor:pointer; user-select:none; }
        .oe-tx-table th.oe-tx-sortable:hover { color:#000; }
    </style>
    <script>
    (function(){
        var table = document.getElementById('oe-tx-table');
        if (!table) { return; }
        var tbody = table.querySelector('tbody');
        var grp = 'all', q = '';
        var sortKey = 'ts', sortDir = -1; // newest first by default
        function val(row, key){
            if (key === 'ts')     { return parseInt(row.getAttribute('data-ts'), 10) || 0; }
            if (key === 'amount') { return parseFloat(row.getAttribute('data-amount')) || 0; }
            if (key === 'status') { return parseInt(row.getAttribute('data-rank'), 10) || 0; }
            return row.getAttribute('data-' + key) || '';
        }
        function resort(){
            var rows = Array.prototype.slice.call(tbody.querySelectorAll('.oe-tx-row'));
            rows.sort(function(a, b){
                var x = val(a, sortKey), y = val(b, sortKey);
                if (x < y) { return -1 * sortDir; }
                if (x > y) { return 1 * sortDir; }
                return 0;
            });
            rows.forEach(function(r){ tbody.appendChild(r); });
            table.querySelectorAll('.oe-tx-arrow').forEach(function(s){ s.textContent = ''; });
            var th = table.querySelector('th[data-key="' + sortKey + '"] .oe-tx-arrow');
            if (th) { th.textContent = sortDir > 0 ? '▲' : '▼'; }
        }
        var shown = document.getElementById('oe-tx-shown');
        function apply(){
            var n = 0;
            tbody.querySelectorAll('.oe-tx-row').forEach(function(row){
                var okG = (grp === 'all') || row.getAttribute('data-grp') === grp;
                var okQ = !q || (row.getAttribute('data-search') || '').indexOf(q) !== -1;
                var show = okG && okQ;
                row.style.display = show ? '' : 'none';
                if (show) { n++; }
            });
            if (shown) { shown.textContent = n + ' <?php echo esc_js(__('shown', 'october-events')); ?>'; }
        }
        table.querySelectorAll('th.oe-tx-sortable').forEach(function(th){
            th.addEventListener('click', function(){
                var k = th.getAttribute('data-key');
                sortDir = (sortKey === k) ? -sortDir : (k === 'ts' ? -1 : 1);
                sortKey = k;
                resort();
            });
        });
        var btns = table.ownerDocument.querySelectorAll('.oe-txfilter-btn');
        btns.forEach(function(b){
            b.addEventListener('click', function(){
                grp = b.getAttribute('data-grp');
                btns.forEach(function(x){ x.classList.remove('button-primary'); });
                b.classList.add('button-primary');
                apply();
            });
        });
        var search = document.getElementById('oe-tx-search');
        if (search) { search.addEventListener('input', function(){ q = search.value.trim().toLowerCase(); apply(); }); }
        resort();
        apply();
    })();
    </script>
    <?php endif; ?>
<?php if (empty($oe_embed)) : ?>
</div>
<?php endif; ?>
