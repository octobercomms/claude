<?php
/** @var \WP_Post[] $accounts */
defined('ABSPATH') || exit;
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Accounts', 'october-events'); ?></h1>
    <?php \OE\Admin\Admin::bento('accounts'); ?>
    <table class="widefat striped">
        <thead>
            <tr>
                <th><?php esc_html_e('Name', 'october-events'); ?></th>
                <th><?php esc_html_e('Email', 'october-events'); ?></th>
                <th><?php esc_html_e('Status', 'october-events'); ?></th>
                <th><?php esc_html_e('Auto-approve', 'october-events'); ?></th>
                <th></th>
            </tr>
        </thead>
        <tbody>
        <?php foreach ($accounts as $acc) :
            $auto  = get_post_meta($acc->ID, '_oe_auto_approve', true) ? __('On', 'october-events') : __('Off', 'october-events');
            $types = (array) get_post_meta($acc->ID, '_oe_auto_approve_types', true);
        ?>
            <tr>
                <td><strong><?php echo esc_html(get_the_title($acc)); ?></strong></td>
                <td><?php echo esc_html((string) get_post_meta($acc->ID, '_oe_email', true)); ?></td>
                <td><?php echo esc_html((string) get_post_meta($acc->ID, '_oe_account_status', true) ?: 'active'); ?></td>
                <td><?php echo esc_html($auto); ?><?php echo $types ? ' (' . esc_html(implode(', ', $types)) . ')' : ''; ?></td>
                <td><a href="<?php echo esc_url(get_edit_post_link($acc->ID)); ?>"><?php esc_html_e('Edit', 'october-events'); ?></a></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
    <p class="description"><?php esc_html_e('Auto-approve flags are set on the account record. An empty type list means auto-approve applies to every listing type.', 'october-events'); ?></p>
</div>
