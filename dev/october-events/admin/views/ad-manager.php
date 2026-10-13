<?php
/**
 * Ad manager overview (ADMIN-BUILD AD10).
 *
 * October-styled read of the folded-in ads module: a stat strip and a
 * campaigns table. Full editing stays in the module's own screens
 * (page=ocad-add-campaign / ocad-report).
 *
 * @var bool  $available  whether the ads module (OCAD_Campaign) is loaded
 * @var array $campaigns  OCAD_Campaign::get_all() rows
 * @var array $stats      OCAD_Campaign::get_stats_for_all() keyed by campaign id
 */
defined('ABSPATH') || exit;

$total_imp = 0;
$total_clk = 0;
$active = 0;
foreach ($campaigns as $c) {
    $s = $stats[$c->id] ?? ['impressions' => 0, 'clicks' => 0];
    $total_imp += (int) ($s['impressions'] ?? 0);
    $total_clk += (int) ($s['clicks'] ?? 0);
    if ((string) $c->status === 'active') { $active++; }
}
$ctr = $total_imp > 0 ? round($total_clk / $total_imp * 100, 2) : 0;

$status_pill = static function (string $s): array {
    switch ($s) {
        case 'active':   return ['pos', __('Active', 'october-events')];
        case 'paused':   return ['warn', __('Paused', 'october-events')];
        case 'ended':    return ['neu', __('Ended', 'october-events')];
        default:         return ['neu', ucwords($s)];
    }
};
?>
<div class="wrap oe-admin oe-ads">
    <h1 style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <span><?php esc_html_e('Ad manager', 'october-events'); ?></span>
        <?php if ($available) : ?>
            <span style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <a class="button" href="<?php echo esc_url(admin_url('admin.php?page=ocad-bookings')); ?>"><?php esc_html_e('Bookings', 'october-events'); ?></a>
                <a class="button" href="<?php echo esc_url(admin_url('admin.php?page=ocad-report')); ?>"><?php esc_html_e('Reports', 'october-events'); ?></a>
                <a class="button button-primary" href="<?php echo esc_url(admin_url('admin.php?page=ocad-add-campaign')); ?>"><?php esc_html_e('+ New campaign', 'october-events'); ?></a>
            </span>
        <?php endif; ?>
    </h1>

    <?php if (! $available) : ?>
        <div class="oe-ad-card">
            <strong><?php esc_html_e('The ad manager is not active.', 'october-events'); ?></strong><br>
            <span class="description"><?php esc_html_e('Turn on the Ad manager feature in Settings → Features (and make sure the standalone oc-ad-manager plugin is not also active). Once on, your campaigns, impressions and clicks appear here.', 'october-events'); ?></span>
            <p style="margin-top:12px"><a class="button" href="<?php echo esc_url(admin_url('admin.php?page=oe-settings')); ?>"><?php esc_html_e('Open settings', 'october-events'); ?></a></p>
        </div>
    <?php else : ?>

    <div class="oe-ad-strip">
        <div class="oe-ad-stat oe-ad-stat--feature">
            <div class="l"><?php esc_html_e('Active campaigns', 'october-events'); ?></div>
            <div class="v"><?php echo esc_html(number_format_i18n($active)); ?></div>
            <div class="s"><?php echo esc_html(sprintf(__('of %s total', 'october-events'), number_format_i18n(count($campaigns)))); ?></div>
        </div>
        <div class="oe-ad-stat">
            <div class="l"><?php esc_html_e('Impressions', 'october-events'); ?></div>
            <div class="v"><?php echo esc_html(number_format_i18n($total_imp)); ?></div>
            <div class="s"><?php esc_html_e('all campaigns', 'october-events'); ?></div>
        </div>
        <div class="oe-ad-stat">
            <div class="l"><?php esc_html_e('Clicks', 'october-events'); ?></div>
            <div class="v"><?php echo esc_html(number_format_i18n($total_clk)); ?></div>
            <div class="s"><?php esc_html_e('all campaigns', 'october-events'); ?></div>
        </div>
        <div class="oe-ad-stat">
            <div class="l"><?php esc_html_e('CTR', 'october-events'); ?></div>
            <div class="v"><?php echo esc_html($ctr); ?>%</div>
            <div class="s"><?php esc_html_e('clicks ÷ impressions', 'october-events'); ?></div>
        </div>
    </div>

    <?php if (! $campaigns) : ?>
        <div class="oe-ad-card"><strong><?php esc_html_e('No campaigns yet.', 'october-events'); ?></strong><br>
            <span class="description"><?php esc_html_e('Create your first campaign to start serving ad units and tracking impressions and clicks.', 'october-events'); ?></span>
        </div>
    <?php else : ?>
    <div class="oe-ad-card" style="padding:0;">
        <table class="oe-ad-table">
            <thead><tr>
                <th><?php esc_html_e('Campaign', 'october-events'); ?></th>
                <th><?php esc_html_e('Client', 'october-events'); ?></th>
                <th><?php esc_html_e('Status', 'october-events'); ?></th>
                <th><?php esc_html_e('Runs', 'october-events'); ?></th>
                <th class="oe-ad-num"><?php esc_html_e('Impressions', 'october-events'); ?></th>
                <th class="oe-ad-num"><?php esc_html_e('Clicks', 'october-events'); ?></th>
                <th class="oe-ad-num"><?php esc_html_e('CTR', 'october-events'); ?></th>
                <th class="oe-ad-num"></th>
            </tr></thead>
            <tbody>
            <?php foreach ($campaigns as $c) :
                $s   = $stats[$c->id] ?? ['impressions' => 0, 'clicks' => 0];
                $imp = (int) ($s['impressions'] ?? 0);
                $clk = (int) ($s['clicks'] ?? 0);
                $cctr = $imp > 0 ? round($clk / $imp * 100, 2) : 0;
                [$pill, $plabel] = $status_pill((string) $c->status);
                $edit = admin_url('admin.php?page=ocad-add-campaign&campaign_id=' . (int) $c->id);
                $runs = '';
                if ($c->start_date || $c->end_date) {
                    $fmt = get_option('date_format');
                    $runs = ($c->start_date ? date_i18n($fmt, strtotime((string) $c->start_date)) : '…')
                          . ' – ' . ($c->end_date ? date_i18n($fmt, strtotime((string) $c->end_date)) : '…');
                }
            ?>
                <tr>
                    <td><strong><?php echo esc_html((string) $c->name); ?></strong>
                        <?php if (! empty($c->url)) : ?><br><span class="description"><?php echo esc_html((string) $c->url); ?></span><?php endif; ?>
                    </td>
                    <td><?php echo esc_html((string) ($c->client_name ?: '—')); ?></td>
                    <td><span class="oe-ad-pill oe-ad-pill--<?php echo esc_attr($pill); ?>"><?php echo esc_html($plabel); ?></span></td>
                    <td><?php echo $runs !== '' ? esc_html($runs) : '<span class="description">—</span>'; ?></td>
                    <td class="oe-ad-num"><?php echo esc_html(number_format_i18n($imp)); ?></td>
                    <td class="oe-ad-num"><?php echo esc_html(number_format_i18n($clk)); ?></td>
                    <td class="oe-ad-num"><?php echo esc_html($cctr); ?>%</td>
                    <td class="oe-ad-num"><a class="button button-small" href="<?php echo esc_url($edit); ?>"><?php esc_html_e('Edit', 'october-events'); ?></a></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>
    <p class="oe-ad-note"><?php esc_html_e('Impression and click caps, ad-unit images per format, the booking form and the partner feed are managed in the campaign editor.', 'october-events'); ?></p>
    <?php endif; ?>
    <?php endif; ?>
</div>
