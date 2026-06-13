<?php
/** @var array $counts  type => [status => count] @var \WP_Post[] $pending */
defined('ABSPATH') || exit;
use OE\PostTypes;
use OE\Admin\Admin;
use OE\Fields;
use OE\Account;

$platform  = Admin::platform_url();
$checkin   = (string) \OE\Settings::get('checkin_page_url', '');
$event_new = admin_url('post-new.php?post_type=' . PostTypes::slug('event'));
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Dashboard', 'october-events'); ?></h1>
    <?php Admin::bento('dashboard'); ?>

    <?php Admin::kpis(); ?>

    <div class="oe-actionbar">
        <a class="button button-primary" href="<?php echo esc_url($event_new); ?>"><?php esc_html_e('+ New event', 'october-events'); ?></a>
        <a class="button" href="<?php echo esc_url(admin_url('admin.php?page=oe-queue')); ?>"><?php esc_html_e('Review submissions', 'october-events'); ?></a>
        <a class="button" href="<?php echo esc_url(admin_url('admin.php?page=oe-contacts')); ?>"><?php esc_html_e('Contacts', 'october-events'); ?></a>
        <?php if ($checkin !== '') : ?>
            <a class="button" href="<?php echo esc_url($checkin); ?>" target="_blank" rel="noopener"><?php esc_html_e('Scan tickets ↗', 'october-events'); ?></a>
        <?php endif; ?>
        <?php if ($platform !== '') : ?>
            <a class="button" href="<?php echo esc_url($platform); ?>" target="_blank" rel="noopener"><?php esc_html_e('Open the platform ↗', 'october-events'); ?></a>
        <?php endif; ?>
    </div>

    <?php if (! empty($pending)) : ?>
        <div class="oe-panel-label"><?php echo esc_html(sprintf(_n('Needs your approval (%d)', 'Needs your approval (%d)', count($pending), 'october-events'), number_format_i18n(count($pending)))); ?></div>
        <table class="widefat striped">
            <thead><tr>
                <th><?php esc_html_e('Listing', 'october-events'); ?></th>
                <th><?php esc_html_e('Type', 'october-events'); ?></th>
                <th><?php esc_html_e('Account', 'october-events'); ?></th>
                <th><?php esc_html_e('Submitted', 'october-events'); ?></th>
                <th></th>
            </tr></thead>
            <tbody>
            <?php foreach ($pending as $p) :
                $ptype = (string) Fields::get($p->ID, 'listing_type');
                $acct  = (int) Fields::get($p->ID, 'submitter_account_id'); ?>
                <tr>
                    <td><strong><a href="<?php echo esc_url((string) get_edit_post_link($p->ID)); ?>"><?php echo esc_html(get_the_title($p)); ?></a></strong></td>
                    <td><?php echo esc_html(PostTypes::TYPES[$ptype]['label'] ?? $ptype); ?></td>
                    <td><?php echo esc_html($acct ? Account::name($acct) : '—'); ?></td>
                    <td><?php echo esc_html((string) Fields::get($p->ID, 'submission_date')); ?></td>
                    <td>
                        <a class="button button-primary" href="<?php echo esc_url(wp_nonce_url(admin_url('admin-post.php?action=oe_approve&id=' . $p->ID), 'oe_approve_' . $p->ID)); ?>"><?php esc_html_e('Approve', 'october-events'); ?></a>
                        <a class="button" href="<?php echo esc_url(wp_nonce_url(admin_url('admin-post.php?action=oe_reject&id=' . $p->ID), 'oe_reject_' . $p->ID)); ?>" onclick="return confirm('<?php echo esc_js(__('Reject and refund (if paid)?', 'october-events')); ?>');"><?php esc_html_e('Reject', 'october-events'); ?></a>
                    </td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
        <p class="description"><a href="<?php echo esc_url(admin_url('admin.php?page=oe-queue')); ?>"><?php esc_html_e('Open the full approval queue →', 'october-events'); ?></a></p>
    <?php endif; ?>

    <div class="oe-panel-label"><?php esc_html_e('By listing type', 'october-events'); ?></div>
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
        <?php foreach ($counts as $type => $by_status) :
            $pending = (int) ($by_status['pending_review'] ?? 0); ?>
            <tr>
                <td><strong><?php echo esc_html(PostTypes::TYPES[$type]['label'] ?? $type); ?></strong></td>
                <td><?php echo $pending ? '<span class="oe-status oe-status-pending_review">' . (int) $pending . '</span>' : '0'; ?></td>
                <td><?php echo (int) ($by_status['approved'] ?? 0); ?></td>
                <td><?php echo (int) ($by_status['rejected'] ?? 0); ?></td>
                <td><a class="oe-rowlink" href="<?php echo esc_url(admin_url('admin.php?page=oe-queue&type=' . $type)); ?>"><?php esc_html_e('Review →', 'october-events'); ?></a></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>

    <?php $sales = \OE\Ticketing\Orders::stats(); $cur = strtoupper((string) \OE\Settings::get('currency', 'usd')); ?>
    <div class="oe-panel-label"><?php esc_html_e('Today', 'october-events'); ?></div>
    <table class="widefat striped" style="max-width:560px">
        <tbody>
            <tr><td><?php esc_html_e('Tickets sold today', 'october-events'); ?></td><td><strong><?php echo (int) $sales['today_tickets']; ?></strong></td></tr>
            <tr><td><?php esc_html_e('Revenue today', 'october-events'); ?></td><td><strong><?php echo esc_html($cur . ' ' . number_format($sales['today_revenue'], 2)); ?></strong></td></tr>
        </tbody>
    </table>
</div>
