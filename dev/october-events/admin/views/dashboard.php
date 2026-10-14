<?php
/** @var array $counts  type => [status => count] @var \WP_Post[] $pending */
defined('ABSPATH') || exit;
use OE\PostTypes;
use OE\Admin\Admin;
use OE\Fields;
use OE\Account;

// Custom scanner page if set, else the clean built-in /checkin route.
$checkin   = (string) \OE\Settings::get('checkin_page_url', '');
if ($checkin === '') { $checkin = home_url('/checkin'); }
$event_new = admin_url('post-new.php?post_type=' . PostTypes::slug('event'));
?>
<?php
// AD1 — sales analytics (real data from the ticketing tables). Fetched up
// front so the consolidated stat bentos can render at the top.
$oe_series  = \OE\Reports\DashboardStats::chart_series();
$oe_byEvent = \OE\Reports\DashboardStats::sales_by_event();
$oe_price   = \OE\Reports\DashboardStats::price();
$oe_sales   = \OE\Ticketing\Orders::stats();
$oe_cur     = strtoupper((string) \OE\Settings::get('currency', 'usd'));
$oe_sym     = ['USD' => '$', 'GBP' => '£', 'EUR' => '€'][$oe_cur] ?? ($oe_cur . ' ');
// Ticket-economics stats, minus the ones already in the headline row
// (Tickets, Revenue) so nothing is shown twice.
$oe_econ = array_values(array_filter((array) ($oe_price['summary'] ?? []), static function ($s) {
    $label = strtolower((string) ($s[0] ?? ''));
    return $label !== 'tickets' && $label !== 'revenue';
}));
?>
<div class="wrap oe-admin">
    <h1 class="oe-dash-h1">
        <span><?php esc_html_e('Dashboard', 'october-events'); ?></span>
        <span class="oe-dash-actions">
            <a class="button button-primary" href="<?php echo esc_url($event_new); ?>"><?php esc_html_e('+ New event', 'october-events'); ?></a>
            <a class="button" href="<?php echo esc_url(admin_url('admin.php?page=oe-tickets')); ?>"><?php esc_html_e('Tickets', 'october-events'); ?></a>
            <a class="button" href="<?php echo esc_url(admin_url('admin.php?page=oe-contacts')); ?>"><?php esc_html_e('Contacts', 'october-events'); ?></a>
            <?php if ($checkin !== '') : ?>
                <a class="button" href="<?php echo esc_url($checkin); ?>" target="_blank" rel="noopener"><?php esc_html_e('Scan tickets ↗', 'october-events'); ?></a>
            <?php endif; ?>
        </span>
    </h1>
    <?php Admin::bento('dashboard'); ?>

    <?php // Row 1 — headline numbers. ?>
    <?php Admin::kpis(); ?>

    <?php // Row 2 — ticket economics (deduped) + today, as large bentos. ?>
    <div class="oe-kpis">
        <?php foreach ($oe_econ as $s) : ?>
            <div class="oe-kpi"><div class="k"><?php echo esc_html((string) $s[0]); ?></div><div class="v"><?php echo esc_html((string) $s[1]); ?></div><div class="s"><?php echo esc_html((string) ($s[2] ?? '')); ?></div></div>
        <?php endforeach; ?>
        <div class="oe-kpi"><div class="k"><?php esc_html_e('Tickets today', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n((int) $oe_sales['today_tickets'])); ?></div><div class="s"><?php esc_html_e('sold today', 'october-events'); ?></div></div>
        <div class="oe-kpi"><div class="k"><?php esc_html_e('Revenue today', 'october-events'); ?></div><div class="v"><?php echo esc_html($oe_sym . number_format((float) $oe_sales['today_revenue'], 0)); ?></div><div class="s"><?php esc_html_e('collected today', 'october-events'); ?></div></div>
    </div>

    <?php \OE\Admin\FirstRun::render(); ?>

    <div class="oe-ad-card">
        <div class="oe-ad-card-title"><span><?php esc_html_e('Sales over time', 'october-events'); ?></span>
            <span class="oe-ad-rangebar" id="oe-ad-range">
                <button class="oe-ad-rchip" data-r="7"><?php esc_html_e('7 days', 'october-events'); ?></button>
                <button class="oe-ad-rchip is-active" data-r="30"><?php esc_html_e('30 days', 'october-events'); ?></button>
                <button class="oe-ad-rchip" data-r="90"><?php esc_html_e('90 days', 'october-events'); ?></button>
                <button class="oe-ad-rchip" data-r="ytd"><?php esc_html_e('Year to date', 'october-events'); ?></button>
                <button class="oe-ad-rchip" data-r="all"><?php esc_html_e('All time', 'october-events'); ?></button>
            </span>
        </div>
        <div class="oe-ad-chart" id="oe-ad-chart"></div>
        <div class="oe-ad-chartbase"></div>
        <p class="oe-ad-note" id="oe-ad-chartnote"></p>
    </div>

    <div class="oe-ad-grid2">
        <div class="oe-ad-card">
            <div class="oe-ad-card-title"><?php esc_html_e('Sales by event', 'october-events'); ?></div>
            <?php if ($oe_byEvent) : ?>
            <table class="oe-ad-table">
                <thead><tr><th><?php esc_html_e('Event', 'october-events'); ?></th><th class="oe-ad-num"><?php esc_html_e('Tickets', 'october-events'); ?></th><th class="oe-ad-num"><?php esc_html_e('Revenue', 'october-events'); ?></th></tr></thead>
                <tbody>
                <?php foreach ($oe_byEvent as $row) : ?>
                    <tr><td><strong><?php echo esc_html($row['name']); ?></strong></td><td class="oe-ad-num"><?php echo esc_html(number_format_i18n($row['tickets'])); ?></td><td class="oe-ad-num">$<?php echo esc_html(number_format($row['revenue'])); ?></td></tr>
                <?php endforeach; ?>
                </tbody>
            </table>
            <?php else : ?>
                <p class="oe-ad-note"><?php esc_html_e('No sales yet.', 'october-events'); ?></p>
            <?php endif; ?>
        </div>
        <div class="oe-ad-card">
            <div class="oe-ad-card-title"><?php esc_html_e('Price paid per ticket', 'october-events'); ?></div>
            <div class="oe-ad-donutwrap">
                <div class="oe-ad-donut" style="background:<?php echo esc_attr($oe_price['donut']); ?>"></div>
                <div class="oe-ad-legend">
                    <?php foreach ($oe_price['buckets'] as $b) : ?>
                        <div class="oe-ad-lrow"><span class="oe-ad-sw" style="background:<?php echo esc_attr($b['color']); ?>"></span><span><?php echo esc_html($b['label']); ?></span><span class="oe-ad-num" style="font-weight:700"><?php echo esc_html(number_format_i18n($b['count'])); ?></span><span class="oe-ad-num subtle"><?php echo (int) $b['pct']; ?>%</span></div>
                    <?php endforeach; ?>
                    <?php if (empty($oe_price['buckets'])) : ?><p class="oe-ad-note"><?php esc_html_e('No tickets yet.', 'october-events'); ?></p><?php endif; ?>
                </div>
            </div>
        </div>
    </div>

    <?php if ($oe_price['free_pct'] >= 60) : ?>
        <div class="oe-ad-heads"><strong><?php esc_html_e('Heads up:', 'october-events'); ?></strong>
            <?php echo esc_html(sprintf(__('%d%% of tickets are free. If that is higher than intended, tighten which ticket types are comped or add a paid tier.', 'october-events'), (int) $oe_price['free_pct'])); ?>
        </div>
    <?php endif; ?>

    <script>
    (function(){
        var S = <?php echo wp_json_encode($oe_series['series']); ?>;
        var L = <?php echo wp_json_encode($oe_series['labels']); ?>;
        var chart = document.getElementById('oe-ad-chart');
        var note  = document.getElementById('oe-ad-chartnote');
        var bar   = document.getElementById('oe-ad-range');
        if (!chart || !bar) { return; }
        function render(r){
            var a = S[r] || [];
            var max = 1; for (var i=0;i<a.length;i++){ if (a[i]>max) max=a[i]; }
            chart.innerHTML = a.map(function(v,i){
                return '<span class="oe-ad-col'+(i===a.length-1?' last':'')+'" style="height:'+Math.round(v/max*100)+'%" title="'+v+'"></span>';
            }).join('');
            var total = a.reduce(function(x,y){return x+y;},0);
            note.textContent = total + ' ' + <?php echo wp_json_encode(__('tickets in', 'october-events')); ?> + ' ' + (L[r]||'') + '. ' + <?php echo wp_json_encode(__('Hover a bar.', 'october-events')); ?>;
        }
        bar.addEventListener('click', function(e){
            var b = e.target.closest('.oe-ad-rchip'); if (!b) return;
            bar.querySelectorAll('.oe-ad-rchip').forEach(function(c){ c.classList.toggle('is-active', c===b); });
            render(b.getAttribute('data-r'));
        });
        render('30');
    })();
    </script>

    <div class="oe-panel-label"><?php echo esc_html(sprintf(__('Approval queue (%d)', 'october-events'), number_format_i18n(count($pending)))); ?></div>
    <?php if (empty($pending)) : ?>
        <table class="widefat"><tbody><tr><td style="padding:24px 16px"><strong><?php esc_html_e('Nothing awaiting review.', 'october-events'); ?> 🎉</strong> <span class="description"><?php esc_html_e('New submissions will appear here to approve or reject.', 'october-events'); ?></span></td></tr></tbody></table>
    <?php else : ?>
        <table class="widefat striped">
            <thead><tr>
                <th><?php esc_html_e('Listing', 'october-events'); ?></th>
                <th><?php esc_html_e('Type', 'october-events'); ?></th>
                <th><?php esc_html_e('Account', 'october-events'); ?></th>
                <th><?php esc_html_e('Submitted', 'october-events'); ?></th>
                <th></th>
            </tr></thead>
            <tbody>
            <?php foreach ($pending as $p) :
                $ptype = (string) Fields::get($p->ID, 'listing_type');
                $acct  = (int) Fields::get($p->ID, 'submitter_account_id'); ?>
                <tr>
                    <td><strong><a href="<?php echo esc_url((string) get_edit_post_link($p->ID)); ?>"><?php echo esc_html(get_the_title($p)); ?></a></strong></td>
                    <td><?php echo esc_html(PostTypes::TYPES[$ptype]['label'] ?? $ptype); ?></td>
                    <td><?php echo esc_html($acct ? Account::name($acct) : '—'); ?></td>
                    <td><?php echo esc_html((string) Fields::get($p->ID, 'submission_date')); ?></td>
                    <td>
                        <a class="button button-primary" href="<?php echo esc_url(wp_nonce_url(admin_url('admin-post.php?action=oe_approve&id=' . $p->ID), 'oe_approve_' . $p->ID)); ?>"><?php esc_html_e('Approve', 'october-events'); ?></a>
                        <a class="button" href="<?php echo esc_url(wp_nonce_url(admin_url('admin-post.php?action=oe_reject&id=' . $p->ID), 'oe_reject_' . $p->ID)); ?>" onclick="return confirm('<?php echo esc_js(__('Reject and refund (if paid)?', 'october-events')); ?>');"><?php esc_html_e('Reject', 'october-events'); ?></a>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    <?php endif; ?>

    <div class="oe-panel-label"><?php esc_html_e('By listing type', 'october-events'); ?></div>
    <table class="widefat striped">
        <thead>
            <tr>
                <th><?php esc_html_e('Listing type', 'october-events'); ?></th>
                <th><?php esc_html_e('Pending review', 'october-events'); ?></th>
                <th><?php esc_html_e('Approved', 'october-events'); ?></th>
                <th><?php esc_html_e('Rejected', 'october-events'); ?></th>
                <th></th>
            </tr>
        </thead>
        <tbody>
        <?php
        $type_pages = ['directory' => 'oe-directory', 'destination' => 'oe-destinations', 'story' => 'oe-stories'];
        foreach ($counts as $type => $by_status) :
            $type_pending = (int) ($by_status['pending_review'] ?? 0);
            $manage = $type === 'event'
                ? admin_url('edit.php?post_type=' . PostTypes::slug('event'))
                : admin_url('admin.php?page=' . ($type_pages[$type] ?? 'october-events')); ?>
            <tr>
                <td><strong><?php echo esc_html(PostTypes::TYPES[$type]['label'] ?? $type); ?></strong></td>
                <td><?php echo $type_pending ? '<span class="oe-status oe-status-pending_review">' . (int) $type_pending . '</span>' : '0'; ?></td>
                <td><?php echo (int) ($by_status['approved'] ?? 0); ?></td>
                <td><?php echo (int) ($by_status['rejected'] ?? 0); ?></td>
                <td><a class="oe-rowlink" href="<?php echo esc_url($manage); ?>"><?php esc_html_e('Manage →', 'october-events'); ?></a></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>

</div>
