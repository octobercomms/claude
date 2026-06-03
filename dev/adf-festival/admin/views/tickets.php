<?php
/** @var \WP_Post[] $items */
defined('ABSPATH') || exit;
$export = wp_nonce_url(admin_url('admin.php?page=adf-tickets&adf_export=tickets'), 'adf_export');
?>
<div class="wrap adf-admin">
    <h1><?php esc_html_e('Tickets', 'adf-festival'); ?>
        <a href="<?php echo esc_url($export); ?>" class="page-title-action"><?php esc_html_e('Export CSV', 'adf-festival'); ?></a>
    </h1>
    <table class="widefat striped">
        <thead>
            <tr>
                <th><?php esc_html_e('Number', 'adf-festival'); ?></th>
                <th><?php esc_html_e('Event', 'adf-festival'); ?></th>
                <th><?php esc_html_e('Purchaser', 'adf-festival'); ?></th>
                <th><?php esc_html_e('Checked in', 'adf-festival'); ?></th>
            </tr>
        </thead>
        <tbody>
        <?php foreach ($items as $post) : ?>
            <tr>
                <td><code><?php echo esc_html((string) get_post_meta($post->ID, '_adf_ticket_number', true)); ?></code></td>
                <td><?php echo esc_html(get_the_title((int) get_post_meta($post->ID, '_adf_event_id', true))); ?></td>
                <td><?php echo esc_html((string) get_post_meta($post->ID, '_adf_purchaser_name', true)); ?><br><span class="description"><?php echo esc_html((string) get_post_meta($post->ID, '_adf_purchaser_email', true)); ?></span></td>
                <td><?php echo get_post_meta($post->ID, '_adf_checked_in', true) ? '✓ ' . esc_html((string) get_post_meta($post->ID, '_adf_check_in_time', true)) : '—'; ?></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
