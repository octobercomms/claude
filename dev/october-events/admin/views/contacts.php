<?php
defined('ABSPATH') || exit;
/** @var array $counts @var array $contacts */
$rebuild_url = wp_nonce_url(admin_url('admin-post.php?action=oe_rebuild_contacts'), 'oe_rebuild_contacts');
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Contacts', 'october-events'); ?></h1>
    <?php \OE\Admin\Admin::bento('contacts'); ?>

    <?php if (! empty($_GET['rebuilt'])) : ?>
        <div class="notice notice-success is-dismissible"><p><?php esc_html_e('Contacts rebuilt from accounts, ticket buyers and volunteers.', 'october-events'); ?></p></div>
    <?php endif; ?>

    <p class="description">
        <?php esc_html_e('The unified, de-duplicated contact list — built automatically from accounts, ticket buyers, volunteers and listing submitters. This replaces manual Brevo imports; new signups are added going forward.', 'october-events'); ?>
    </p>

    <p style="display:flex;gap:24px;margin:18px 0">
        <span><strong style="font-size:24px"><?php echo esc_html(number_format_i18n($counts['total'])); ?></strong><br><?php esc_html_e('total', 'october-events'); ?></span>
        <span><strong style="font-size:24px;color:#1a7f37"><?php echo esc_html(number_format_i18n($counts['subscribed'])); ?></strong><br><?php esc_html_e('subscribed', 'october-events'); ?></span>
        <span><strong style="font-size:24px"><?php echo esc_html(number_format_i18n($counts['unsubscribed'])); ?></strong><br><?php esc_html_e('unsubscribed', 'october-events'); ?></span>
        <span><strong style="font-size:24px"><?php echo esc_html(number_format_i18n($counts['sms'])); ?></strong><br><?php esc_html_e('SMS opt-in', 'october-events'); ?></span>
    </p>

    <p><a class="button button-primary" href="<?php echo esc_url($rebuild_url); ?>"><?php esc_html_e('Rebuild from existing data', 'october-events'); ?></a></p>

    <h2><?php esc_html_e('Recent contacts', 'october-events'); ?></h2>
    <table class="widefat striped">
        <thead><tr>
            <th><?php esc_html_e('Email', 'october-events'); ?></th>
            <th><?php esc_html_e('Name', 'october-events'); ?></th>
            <th><?php esc_html_e('Phone', 'october-events'); ?></th>
            <th><?php esc_html_e('Source', 'october-events'); ?></th>
            <th><?php esc_html_e('Status', 'october-events'); ?></th>
        </tr></thead>
        <tbody>
        <?php if (! $contacts) : ?>
            <tr><td colspan="5"><em><?php esc_html_e('No contacts yet — click "Rebuild from existing data".', 'october-events'); ?></em></td></tr>
        <?php else : foreach ($contacts as $c) : ?>
            <tr>
                <td><?php echo esc_html($c->email); ?></td>
                <td><?php echo esc_html($c->name); ?></td>
                <td><?php echo esc_html($c->phone); ?></td>
                <td><?php echo esc_html($c->source); ?></td>
                <td><?php echo esc_html($c->status); ?></td>
            </tr>
        <?php endforeach; endif; ?>
        </tbody>
    </table>
</div>
