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
</div>
