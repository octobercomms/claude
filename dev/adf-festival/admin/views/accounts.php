<?php
/** @var \WP_Post[] $accounts */
defined('ABSPATH') || exit;
?>
<div class="wrap adf-admin">
    <h1><?php esc_html_e('Accounts', 'adf-festival'); ?></h1>
    <table class="widefat striped">
        <thead>
            <tr>
                <th><?php esc_html_e('Name', 'adf-festival'); ?></th>
                <th><?php esc_html_e('Email', 'adf-festival'); ?></th>
                <th><?php esc_html_e('Status', 'adf-festival'); ?></th>
                <th><?php esc_html_e('Auto-approve', 'adf-festival'); ?></th>
                <th></th>
            </tr>
        </thead>
        <tbody>
        <?php foreach ($accounts as $acc) :
            $auto  = get_post_meta($acc->ID, '_adf_auto_approve', true) ? __('On', 'adf-festival') : __('Off', 'adf-festival');
            $types = (array) get_post_meta($acc->ID, '_adf_auto_approve_types', true);
        ?>
            <tr>
                <td><strong><?php echo esc_html(get_the_title($acc)); ?></strong></td>
                <td><?php echo esc_html((string) get_post_meta($acc->ID, '_adf_email', true)); ?></td>
                <td><?php echo esc_html((string) get_post_meta($acc->ID, '_adf_account_status', true) ?: 'active'); ?></td>
                <td><?php echo esc_html($auto); ?><?php echo $types ? ' (' . esc_html(implode(', ', $types)) . ')' : ''; ?></td>
                <td><a href="<?php echo esc_url(get_edit_post_link($acc->ID)); ?>"><?php esc_html_e('Edit', 'adf-festival'); ?></a></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
    <p class="description"><?php esc_html_e('Auto-approve flags are set on the account record. An empty type list means auto-approve applies to every listing type.', 'adf-festival'); ?></p>
</div>
