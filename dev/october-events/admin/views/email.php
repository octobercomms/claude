<?php
defined('ABSPATH') || exit;
$digest_url = wp_nonce_url(admin_url('admin-post.php?action=oe_send_digest'), 'oe_send_digest');
$contact_counts = \OE\Mail\Contacts::counts();
$audiences = \OE\Mail\Campaigns::audiences();
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Email', 'october-events'); ?></h1>
    <?php \OE\Admin\Admin::bento('email'); ?>

    <h2><?php esc_html_e('Contacts & audiences', 'october-events'); ?></h2>
    <p class="description"><?php esc_html_e('Contacts are built automatically from accounts, ticket buyers, volunteers and submitters — no manual import. Campaign audiences are derived from them.', 'october-events'); ?></p>
    <p>
        <strong style="font-size:20px"><?php echo esc_html(number_format_i18n($contact_counts['total'])); ?></strong>
        <?php esc_html_e('contacts', 'october-events'); ?>
        (<?php echo esc_html(number_format_i18n($contact_counts['subscribed'])); ?> <?php esc_html_e('subscribed', 'october-events'); ?>)
        · <a href="<?php echo esc_url(admin_url('admin.php?page=oe-contacts')); ?>"><?php esc_html_e('Manage contacts', 'october-events'); ?></a>
    </p>
    <ul style="list-style:disc;margin-left:20px">
        <?php foreach ($audiences as $a) : ?>
            <li><strong><?php echo esc_html($a['label']); ?></strong> — <?php echo esc_html(number_format_i18n($a['count'])); ?></li>
        <?php endforeach; ?>
    </ul>
    <p class="description"><?php esc_html_e('Build and send campaigns from the planning platform (Email) — they send through the transport below with open/click tracking and one-click unsubscribe.', 'october-events'); ?></p>

    <h2><?php esc_html_e('Monthly digest', 'october-events'); ?></h2>
    <p><?php esc_html_e('Runs automatically on the first Monday of each month. You can also trigger it manually:', 'october-events'); ?></p>
    <p><a class="button button-primary" href="<?php echo esc_url($digest_url); ?>"><?php esc_html_e('Send digest now', 'october-events'); ?></a></p>

    <hr>
    <h2><?php esc_html_e('Outgoing mail (Amazon SES)', 'october-events'); ?></h2>
    <?php $ses_active = \OE\Mail\Mailer::ses_active(); $mc = \OE\Mail\EmailLog::counts(); ?>
    <p>
        <?php esc_html_e('Transport:', 'october-events'); ?>
        <strong style="color:<?php echo $ses_active ? '#1a7f37' : '#8a6d3b'; ?>">
            <?php echo $ses_active
                ? esc_html(sprintf(__('Amazon SES (%s)', 'october-events'), \OE\Mail\Mailer::smtp_host()))
                : esc_html__('Site default (SES not enabled/configured — configure it in Settings → Email)', 'october-events'); ?>
        </strong>
        &nbsp;·&nbsp;
        <?php echo esc_html(sprintf(__('%1$d sent / %2$d failed / %3$d suppressed', 'october-events'), $mc['sent'], $mc['failed'], $mc['suppressed'])); ?>
    </p>

    <?php $test = get_transient('oe_mail_test'); if (is_array($test)) { delete_transient('oe_mail_test'); ?>
        <div class="notice <?php echo $test['ok'] ? 'notice-success' : 'notice-error'; ?>" style="margin:8px 0;padding:10px 12px">
            <?php echo $test['ok']
                ? esc_html(sprintf(__('Test email sent to %s.', 'october-events'), $test['to']))
                : esc_html(sprintf(__('Could not send the test email to %s — check the log below and your SES config.', 'october-events'), $test['to'])); ?>
        </div>
    <?php } ?>

    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="margin-bottom:16px">
        <input type="hidden" name="action" value="oe_send_test_email">
        <?php wp_nonce_field('oe_send_test_email'); ?>
        <input type="email" name="oe_test_to" class="regular-text" placeholder="<?php echo esc_attr((string) get_option('admin_email')); ?>">
        <?php submit_button(__('Send test email', 'october-events'), 'secondary', 'submit', false); ?>
    </form>

    <h3><?php esc_html_e('Recent email log', 'october-events'); ?></h3>
    <?php $log = \OE\Mail\EmailLog::recent(25); if (! $log) : ?>
        <p class="description"><?php esc_html_e('No email logged yet.', 'october-events'); ?></p>
    <?php else : ?>
        <table class="widefat striped">
            <thead><tr>
                <th><?php esc_html_e('When', 'october-events'); ?></th>
                <th><?php esc_html_e('To', 'october-events'); ?></th>
                <th><?php esc_html_e('Subject', 'october-events'); ?></th>
                <th><?php esc_html_e('Status', 'october-events'); ?></th>
                <th><?php esc_html_e('Via', 'october-events'); ?></th>
            </tr></thead>
            <tbody>
            <?php foreach ($log as $row) : ?>
                <tr>
                    <td><?php echo esc_html(get_date_from_gmt((string) $row->created_at, 'M j, H:i')); ?></td>
                    <td><?php echo esc_html((string) $row->recipients); ?></td>
                    <td><?php echo esc_html((string) $row->subject); ?></td>
                    <td><strong style="color:<?php echo $row->status === 'sent' ? '#1a7f37' : ($row->status === 'failed' ? '#b32d2e' : '#8a6d3b'); ?>"><?php echo esc_html((string) $row->status); ?></strong>
                        <?php if ($row->error) : ?><br><span class="description"><?php echo esc_html(mb_substr((string) $row->error, 0, 120)); ?></span><?php endif; ?></td>
                    <td><?php echo esc_html((string) $row->driver); ?></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    <?php endif; ?>
</div>
