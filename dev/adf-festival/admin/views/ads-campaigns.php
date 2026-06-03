<?php
/** @var array $campaigns */
defined('ABSPATH') || exit;
use ADF\Ads\Campaigns;
use ADF\Ads\Formats;
?>
<div class="wrap adf-admin">
    <h1><?php esc_html_e('Ad Campaigns', 'adf-festival'); ?>
        <a href="<?php echo esc_url(admin_url('admin.php?page=adf-ads&action=new')); ?>" class="page-title-action"><?php esc_html_e('Add Campaign', 'adf-festival'); ?></a>
    </h1>
    <table class="widefat striped">
        <thead><tr>
            <th><?php esc_html_e('Name', 'adf-festival'); ?></th><th><?php esc_html_e('Client', 'adf-festival'); ?></th>
            <th><?php esc_html_e('Status', 'adf-festival'); ?></th><th><?php esc_html_e('Formats', 'adf-festival'); ?></th>
            <th><?php esc_html_e('Impr.', 'adf-festival'); ?></th><th><?php esc_html_e('Clicks', 'adf-festival'); ?></th>
            <th><?php esc_html_e('CTR', 'adf-festival'); ?></th><th><?php esc_html_e('Actions', 'adf-festival'); ?></th>
        </tr></thead>
        <tbody>
        <?php if (! $campaigns) : ?><tr><td colspan="8"><?php esc_html_e('No campaigns yet.', 'adf-festival'); ?></td></tr><?php endif; ?>
        <?php foreach ($campaigns as $c) :
            $s = Campaigns::stats((int) $c->id);
            $formats = array_map(static fn($cr) => $cr->format, Campaigns::creatives((int) $c->id));
            $toggle = wp_nonce_url(admin_url('admin-post.php?action=adf_toggle_campaign&id=' . $c->id), 'adf_toggle_campaign');
            $del    = wp_nonce_url(admin_url('admin-post.php?action=adf_delete_campaign&id=' . $c->id), 'adf_delete_campaign'); ?>
            <tr>
                <td><strong><a href="<?php echo esc_url(admin_url('admin.php?page=adf-ads&action=edit&id=' . $c->id)); ?>"><?php echo esc_html($c->name); ?></a></strong></td>
                <td><?php echo esc_html($c->client_name); ?></td>
                <td><span class="adf-status adf-status-<?php echo $c->status === 'active' ? 'approved' : 'pending'; ?>"><?php echo esc_html($c->status); ?></span></td>
                <td><?php echo esc_html(implode(', ', $formats) ?: '—'); ?></td>
                <td><?php echo (int) $s['impressions']; ?><?php echo $c->restrict_impressions ? ' / ' . (int) $c->max_impressions : ''; ?></td>
                <td><?php echo (int) $s['clicks']; ?><?php echo $c->restrict_clicks ? ' / ' . (int) $c->max_clicks : ''; ?></td>
                <td><?php echo esc_html($s['ctr']); ?>%</td>
                <td>
                    <a class="button button-small" href="<?php echo esc_url(admin_url('admin.php?page=adf-ads&action=edit&id=' . $c->id)); ?>"><?php esc_html_e('Edit', 'adf-festival'); ?></a>
                    <a class="button button-small" href="<?php echo esc_url($toggle); ?>"><?php echo $c->status === 'active' ? esc_html__('Disable', 'adf-festival') : esc_html__('Enable', 'adf-festival'); ?></a>
                    <a class="button button-small" href="<?php echo esc_url($del); ?>" onclick="return confirm('<?php echo esc_js(__('Delete campaign?', 'adf-festival')); ?>')"><?php esc_html_e('Delete', 'adf-festival'); ?></a>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
    <h2 style="margin-top:24px"><?php esc_html_e('Place an ad slot', 'adf-festival'); ?></h2>
    <p class="description"><?php esc_html_e('Drop a shortcode where you want an ad to appear:', 'adf-festival'); ?></p>
    <p><?php foreach (Formats::keys() as $f) : ?><code>[adf_ad format="<?php echo esc_attr($f); ?>"]</code> &nbsp; <?php endforeach; ?></p>
    <p class="description"><?php esc_html_e('Self-serve booking form:', 'adf-festival'); ?> <code>[adf_ad_book]</code></p>
</div>
