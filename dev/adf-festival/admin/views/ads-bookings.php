<?php
/** @var array $bookings */
defined('ABSPATH') || exit;
?>
<div class="wrap adf-admin">
    <h1><?php esc_html_e('Ad Bookings', 'adf-festival'); ?></h1>
    <p class="description"><?php esc_html_e('Paid bookings await review. Activating one creates the live campaign and emails the advertiser.', 'adf-festival'); ?></p>
    <table class="widefat striped">
        <thead><tr>
            <th><?php esc_html_e('Date', 'adf-festival'); ?></th><th><?php esc_html_e('Advertiser', 'adf-festival'); ?></th>
            <th><?php esc_html_e('Campaign / package', 'adf-festival'); ?></th><th><?php esc_html_e('Amount', 'adf-festival'); ?></th>
            <th><?php esc_html_e('Status', 'adf-festival'); ?></th><th><?php esc_html_e('Actions', 'adf-festival'); ?></th>
        </tr></thead>
        <tbody>
        <?php if (! $bookings) : ?><tr><td colspan="6"><?php esc_html_e('No bookings yet.', 'adf-festival'); ?></td></tr><?php endif; ?>
        <?php foreach ($bookings as $b) :
            $activate = wp_nonce_url(admin_url('admin-post.php?action=adf_activate_booking&id=' . $b->id), 'adf_activate_booking');
            $decline  = wp_nonce_url(admin_url('admin-post.php?action=adf_decline_booking&id=' . $b->id), 'adf_decline_booking');
            $badge = ['pending_payment' => 'pending', 'paid' => 'pending_review', 'active' => 'approved', 'declined' => 'rejected'][$b->status] ?? 'pending'; ?>
            <tr>
                <td><?php echo esc_html(mysql2date('Y-m-d', $b->created_at)); ?></td>
                <td><?php echo esc_html($b->company ?: $b->email); ?><br><span class="description"><?php echo esc_html($b->email); ?></span></td>
                <td><?php echo esc_html($b->campaign_name); ?><br><span class="description"><?php echo esc_html($b->package_name); ?><?php echo $b->promo_code ? ' · ' . esc_html($b->promo_code) . ' −' . (int) $b->discount_pct . '%' : ''; ?></span></td>
                <td><?php echo esc_html(number_format($b->amount_cents / 100, 2)); ?></td>
                <td><span class="adf-status adf-status-<?php echo esc_attr($badge); ?>"><?php echo esc_html(str_replace('_', ' ', $b->status)); ?></span></td>
                <td>
                    <?php if ($b->status === 'paid') : ?>
                        <a class="button button-small button-primary" href="<?php echo esc_url($activate); ?>"><?php esc_html_e('Activate', 'adf-festival'); ?></a>
                        <a class="button button-small" href="<?php echo esc_url($decline); ?>"><?php esc_html_e('Decline', 'adf-festival'); ?></a>
                    <?php elseif ($b->status === 'active' && $b->campaign_id) : ?>
                        <a class="button button-small" href="<?php echo esc_url(admin_url('admin.php?page=adf-ads&action=edit&id=' . $b->campaign_id)); ?>"><?php esc_html_e('Campaign', 'adf-festival'); ?></a>
                    <?php else : ?>—<?php endif; ?>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
