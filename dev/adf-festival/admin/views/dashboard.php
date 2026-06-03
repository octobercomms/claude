<?php
/** @var array $counts  type => [status => count] */
defined('ABSPATH') || exit;
use ADF\PostTypes;
?>
<div class="wrap adf-admin">
    <h1><?php esc_html_e('ADF Festival', 'adf-festival'); ?></h1>
    <p class="description"><?php esc_html_e('Operations overview across all listing types.', 'adf-festival'); ?></p>

    <table class="widefat striped">
        <thead>
            <tr>
                <th><?php esc_html_e('Listing type', 'adf-festival'); ?></th>
                <th><?php esc_html_e('Pending review', 'adf-festival'); ?></th>
                <th><?php esc_html_e('Approved', 'adf-festival'); ?></th>
                <th><?php esc_html_e('Rejected', 'adf-festival'); ?></th>
                <th></th>
            </tr>
        </thead>
        <tbody>
        <?php foreach ($counts as $type => $by_status) : ?>
            <tr>
                <td><strong><?php echo esc_html(PostTypes::TYPES[$type]['label'] ?? $type); ?></strong></td>
                <td><?php echo (int) ($by_status['pending_review'] ?? 0); ?></td>
                <td><?php echo (int) ($by_status['approved'] ?? 0); ?></td>
                <td><?php echo (int) ($by_status['rejected'] ?? 0); ?></td>
                <td><a href="<?php echo esc_url(admin_url('admin.php?page=adf-queue&type=' . $type)); ?>"><?php esc_html_e('Review', 'adf-festival'); ?></a></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>

    <?php $sales = \ADF\Ticketing\Orders::stats(); $cur = strtoupper((string) \ADF\Settings::get('currency', 'usd')); ?>
    <h2 style="margin-top:28px"><?php esc_html_e('Ticket sales', 'adf-festival'); ?></h2>
    <table class="widefat striped" style="max-width:560px">
        <tbody>
            <tr><td><?php esc_html_e('Tickets sold (all time)', 'adf-festival'); ?></td><td><strong><?php echo (int) $sales['tickets']; ?></strong></td></tr>
            <tr><td><?php esc_html_e('Revenue (all time)', 'adf-festival'); ?></td><td><strong><?php echo esc_html($cur . ' ' . number_format($sales['revenue'], 2)); ?></strong></td></tr>
            <tr><td><?php esc_html_e('Tickets today', 'adf-festival'); ?></td><td><?php echo (int) $sales['today_tickets']; ?></td></tr>
            <tr><td><?php esc_html_e('Revenue today', 'adf-festival'); ?></td><td><?php echo esc_html($cur . ' ' . number_format($sales['today_revenue'], 2)); ?></td></tr>
        </tbody>
    </table>
</div>
