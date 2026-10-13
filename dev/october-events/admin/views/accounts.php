<?php
/** @var \WP_Post[] $accounts @var int $with_orders @var int $organizers */
defined('ABSPATH') || exit;
use OE\PostTypes;
?>
<div class="wrap oe-admin">
    <h1 style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <span><?php esc_html_e('Accounts', 'october-events'); ?></span>
        <a class="button button-primary" href="<?php echo esc_url(admin_url('post-new.php?post_type=' . PostTypes::slug('account'))); ?>"><?php esc_html_e('+ Add account', 'october-events'); ?></a>
    </h1>
    <?php \OE\Admin\Admin::bento('accounts'); ?>

    <div class="oe-ad-strip">
        <div class="oe-ad-stat oe-ad-stat--feature"><div class="l"><?php esc_html_e('Accounts', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n(count($accounts))); ?></div><div class="s"><?php esc_html_e('total', 'october-events'); ?></div></div>
        <div class="oe-ad-stat"><div class="l"><?php esc_html_e('With orders', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n((int) ($with_orders ?? 0))); ?></div><div class="s"><?php esc_html_e('paying customers', 'october-events'); ?></div></div>
        <div class="oe-ad-stat"><div class="l"><?php esc_html_e('Organizers', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n((int) ($organizers ?? 0))); ?></div><div class="s"><?php esc_html_e('submit events', 'october-events'); ?></div></div>
    </div>

    <?php if (! $accounts) : ?>
        <div class="oe-ad-card"><strong><?php esc_html_e('No accounts yet.', 'october-events'); ?></strong><br>
            <span class="description"><?php esc_html_e('Accounts are created when someone submits a listing, or add one by hand with “+ Add account”.', 'october-events'); ?></span>
        </div>
    <?php else : ?>
    <div class="oe-ad-card" style="padding:0;">
        <table class="oe-ad-table">
            <thead>
                <tr>
                    <th><?php esc_html_e('Name', 'october-events'); ?></th>
                    <th><?php esc_html_e('Email', 'october-events'); ?></th>
                    <th><?php esc_html_e('Status', 'october-events'); ?></th>
                    <th><?php esc_html_e('Auto-approve', 'october-events'); ?></th>
                    <th class="oe-ad-num"></th>
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
                    <td class="oe-ad-num"><a class="button button-small" href="<?php echo esc_url(get_edit_post_link($acc->ID)); ?>"><?php esc_html_e('Edit', 'october-events'); ?></a></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    </div>
    <p class="oe-ad-note"><?php esc_html_e('Auto-approve flags are set on the account record. An empty type list means auto-approve applies to every listing type.', 'october-events'); ?></p>
    <?php endif; ?>
</div>
