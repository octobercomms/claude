<?php
/** @var array $counts  type => [status => count] */
defined('ABSPATH') || exit;
use OE\PostTypes;
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('October Events', 'october-events'); ?></h1>
    <?php \OE\Admin\Admin::bento('dashboard'); ?>
    <p class="description"><?php esc_html_e('Operations overview across all listing types.', 'october-events'); ?></p>

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
        <?php foreach ($counts as $type => $by_status) : ?>
            <tr>
                <td><strong><?php echo esc_html(PostTypes::TYPES[$type]['label'] ?? $type); ?></strong></td>
                <td><?php echo (int) ($by_status['pending_review'] ?? 0); ?></td>
                <td><?php echo (int) ($by_status['approved'] ?? 0); ?></td>
                <td><?php echo (int) ($by_status['rejected'] ?? 0); ?></td>
                <td><a href="<?php echo esc_url(admin_url('admin.php?page=oe-queue&type=' . $type)); ?>"><?php esc_html_e('Review', 'october-events'); ?></a></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>

    <?php $sales = \OE\Ticketing\Orders::stats(); $cur = strtoupper((string) \OE\Settings::get('currency', 'usd')); ?>
    <h2 style="margin-top:28px"><?php esc_html_e('Ticket sales', 'october-events'); ?></h2>
    <table class="widefat striped" style="max-width:560px">
        <tbody>
            <tr><td><?php esc_html_e('Tickets sold (all time)', 'october-events'); ?></td><td><strong><?php echo (int) $sales['tickets']; ?></strong></td></tr>
            <tr><td><?php esc_html_e('Revenue (all time)', 'october-events'); ?></td><td><strong><?php echo esc_html($cur . ' ' . number_format($sales['revenue'], 2)); ?></strong></td></tr>
            <tr><td><?php esc_html_e('Tickets today', 'october-events'); ?></td><td><?php echo (int) $sales['today_tickets']; ?></td></tr>
            <tr><td><?php esc_html_e('Revenue today', 'october-events'); ?></td><td><?php echo esc_html($cur . ' ' . number_format($sales['today_revenue'], 2)); ?></td></tr>
        </tbody>
    </table>
</div>
