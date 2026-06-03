<?php
/** @var \WP_Post[] $items @var string $filter */
defined('ABSPATH') || exit;
use ADF\PostTypes;
use ADF\Fields;
use ADF\Account;
?>
<div class="wrap adf-admin">
    <h1><?php esc_html_e('Approval Queue', 'adf-festival'); ?></h1>

    <ul class="subsubsub">
        <li><a href="<?php echo esc_url(admin_url('admin.php?page=adf-queue')); ?>" class="<?php echo $filter === '' ? 'current' : ''; ?>"><?php esc_html_e('All', 'adf-festival'); ?></a></li>
        <?php foreach (PostTypes::listing_types() as $type) : ?>
            | <li><a href="<?php echo esc_url(admin_url('admin.php?page=adf-queue&type=' . $type)); ?>" class="<?php echo $filter === $type ? 'current' : ''; ?>"><?php echo esc_html(PostTypes::TYPES[$type]['label']); ?></a></li>
        <?php endforeach; ?>
    </ul>

    <table class="widefat striped">
        <thead>
            <tr>
                <th><?php esc_html_e('Listing', 'adf-festival'); ?></th>
                <th><?php esc_html_e('Type', 'adf-festival'); ?></th>
                <th><?php esc_html_e('Account', 'adf-festival'); ?></th>
                <th><?php esc_html_e('Tier', 'adf-festival'); ?></th>
                <th><?php esc_html_e('Submitted', 'adf-festival'); ?></th>
                <th><?php esc_html_e('Actions', 'adf-festival'); ?></th>
            </tr>
        </thead>
        <tbody>
        <?php if (! $items) : ?>
            <tr><td colspan="6"><?php esc_html_e('Nothing awaiting review. 🎉', 'adf-festival'); ?></td></tr>
        <?php endif; ?>
        <?php foreach ($items as $post) :
            $type = (string) Fields::get($post->ID, 'listing_type');
            $account_id = (int) Fields::get($post->ID, 'submitter_account_id');
        ?>
            <tr>
                <td><strong><a href="<?php echo esc_url(get_edit_post_link($post->ID)); ?>"><?php echo esc_html(get_the_title($post)); ?></a></strong></td>
                <td><?php echo esc_html(PostTypes::TYPES[$type]['label'] ?? $type); ?></td>
                <td><?php echo esc_html($account_id ? Account::name($account_id) : '—'); ?></td>
                <td><span class="adf-tier adf-tier-<?php echo esc_attr(Fields::tier($post->ID)); ?>"><?php echo esc_html(ucfirst(Fields::tier($post->ID))); ?></span></td>
                <td><?php echo esc_html((string) Fields::get($post->ID, 'submission_date')); ?></td>
                <td>
                    <a class="button button-primary" href="<?php echo esc_url(wp_nonce_url(admin_url('admin-post.php?action=adf_approve&id=' . $post->ID), 'adf_approve_' . $post->ID)); ?>"><?php esc_html_e('Approve', 'adf-festival'); ?></a>
                    <a class="button" href="<?php echo esc_url(wp_nonce_url(admin_url('admin-post.php?action=adf_reject&id=' . $post->ID), 'adf_reject_' . $post->ID)); ?>" onclick="return confirm('<?php echo esc_js(__('Reject and refund (if paid)?', 'adf-festival')); ?>');"><?php esc_html_e('Reject', 'adf-festival'); ?></a>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
