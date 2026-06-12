<?php
/** @var \WP_Post[] $items @var string $filter */
defined('ABSPATH') || exit;
use OE\PostTypes;
use OE\Fields;
use OE\Account;
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Approval Queue', 'october-events'); ?></h1>

    <ul class="subsubsub">
        <li><a href="<?php echo esc_url(admin_url('admin.php?page=oe-queue')); ?>" class="<?php echo $filter === '' ? 'current' : ''; ?>"><?php esc_html_e('All', 'october-events'); ?></a></li>
        <?php foreach (PostTypes::listing_types() as $type) : ?>
            | <li><a href="<?php echo esc_url(admin_url('admin.php?page=oe-queue&type=' . $type)); ?>" class="<?php echo $filter === $type ? 'current' : ''; ?>"><?php echo esc_html(PostTypes::TYPES[$type]['label']); ?></a></li>
        <?php endforeach; ?>
    </ul>

    <table class="widefat striped">
        <thead>
            <tr>
                <th><?php esc_html_e('Listing', 'october-events'); ?></th>
                <th><?php esc_html_e('Type', 'october-events'); ?></th>
                <th><?php esc_html_e('Account', 'october-events'); ?></th>
                <th><?php esc_html_e('Tier', 'october-events'); ?></th>
                <th><?php esc_html_e('Submitted', 'october-events'); ?></th>
                <th><?php esc_html_e('Actions', 'october-events'); ?></th>
            </tr>
        </thead>
        <tbody>
        <?php if (! $items) : ?>
            <tr><td colspan="6"><?php esc_html_e('Nothing awaiting review. 🎉', 'october-events'); ?></td></tr>
        <?php endif; ?>
        <?php foreach ($items as $post) :
            $type = (string) Fields::get($post->ID, 'listing_type');
            $account_id = (int) Fields::get($post->ID, 'submitter_account_id');
        ?>
            <tr>
                <td><strong><a href="<?php echo esc_url(get_edit_post_link($post->ID)); ?>"><?php echo esc_html(get_the_title($post)); ?></a></strong></td>
                <td><?php echo esc_html(PostTypes::TYPES[$type]['label'] ?? $type); ?></td>
                <td><?php echo esc_html($account_id ? Account::name($account_id) : '—'); ?></td>
                <td><span class="oe-tier oe-tier-<?php echo esc_attr(Fields::tier($post->ID)); ?>"><?php echo esc_html(ucfirst(Fields::tier($post->ID))); ?></span></td>
                <td><?php echo esc_html((string) Fields::get($post->ID, 'submission_date')); ?></td>
                <td>
                    <a class="button button-primary" href="<?php echo esc_url(wp_nonce_url(admin_url('admin-post.php?action=oe_approve&id=' . $post->ID), 'oe_approve_' . $post->ID)); ?>"><?php esc_html_e('Approve', 'october-events'); ?></a>
                    <a class="button" href="<?php echo esc_url(wp_nonce_url(admin_url('admin-post.php?action=oe_reject&id=' . $post->ID), 'oe_reject_' . $post->ID)); ?>" onclick="return confirm('<?php echo esc_js(__('Reject and refund (if paid)?', 'october-events')); ?>');"><?php esc_html_e('Reject', 'october-events'); ?></a>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
