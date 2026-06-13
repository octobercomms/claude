<?php
defined('ABSPATH') || exit;
use OE\Admin\Admin;

$digest_url  = wp_nonce_url(admin_url('admin-post.php?action=oe_send_digest'), 'oe_send_digest');
$rebuild_url = wp_nonce_url(admin_url('admin-post.php?action=oe_rebuild_contacts'), 'oe_rebuild_contacts');
$counts      = \OE\Mail\Contacts::counts();
$audiences   = \OE\Mail\Campaigns::audiences();
$platform    = Admin::platform_url();
$ses_active  = \OE\Mail\Mailer::ses_active();
$mc          = \OE\Mail\EmailLog::counts();
$recent      = \OE\Mail\Contacts::search('', 12, 0);
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Email', 'october-events'); ?></h1>
    <?php Admin::bento('email'); ?>

    <!-- Build & send: campaigns are designed in the platform -->
    <div class="oe-callout">
        <h3><?php esc_html_e('Design &amp; send campaigns in the platform', 'october-events'); ?></h3>
        <p><?php esc_html_e('Campaigns are built in the planning platform — the drag-and-drop / block editor with the AI co-pilot. They send through the transport below, with open &amp; click tracking and one-click unsubscribe.', 'october-events'); ?></p>
        <div class="oe-actionbar">
            <?php if ($platform !== '') : ?>
                <a class="button button-primary" href="<?php echo esc_url($platform); ?>" target="_blank" rel="noopener"><?php esc_html_e('Open the email builder in the platform ↗', 'october-events'); ?></a>
            <?php else : ?>
                <a class="button button-primary" href="<?php echo esc_url(admin_url('admin.php?page=oe-settings#platform')); ?>"><?php esc_html_e('Set your Platform URL →', 'october-events'); ?></a>
                <span class="description"><?php esc_html_e('Add it in Settings to link straight to the builder.', 'october-events'); ?></span>
            <?php endif; ?>
        </div>
    </div>

    <!-- Outgoing mail (SES) -->
    <div class="oe-panel-label"><?php esc_html_e('Outgoing mail (Amazon SES)', 'october-events'); ?></div>
    <p>
        <?php esc_html_e('Transport:', 'october-events'); ?>
        <strong style="color:<?php echo $ses_active ? '#1a7f37' : '#8a6d3b'; ?>">
            <?php echo $ses_active
                ? esc_html(sprintf(__('Amazon SES (%s)', 'october-events'), \OE\Mail\Mailer::smtp_host()))
                : esc_html__('Site default — configure SES in Settings → Email', 'october-events'); ?>
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

    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="margin-bottom:8px">
        <input type="hidden" name="action" value="oe_send_test_email">
        <?php wp_nonce_field('oe_send_test_email'); ?>
        <input type="email" name="oe_test_to" class="regular-text" placeholder="<?php echo esc_attr((string) get_option('admin_email')); ?>">
        <?php submit_button(__('Send test email', 'october-events'), 'secondary', 'submit', false); ?>
    </form>

    <h3><?php esc_html_e('Recent email log', 'october-events'); ?></h3>
    <?php $log = \OE\Mail\EmailLog::recent(15); if (! $log) : ?>
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

    <!-- Audiences -->
    <div class="oe-panel-label"><?php esc_html_e('Audiences', 'october-events'); ?></div>
    <p class="description"><?php esc_html_e('Derived automatically from your contacts — pick one as a campaign’s audience in the builder.', 'october-events'); ?></p>
    <table class="widefat striped" style="max-width:560px"><tbody>
        <?php foreach ($audiences as $a) : ?>
            <tr><td><strong><?php echo esc_html($a['label']); ?></strong></td><td style="text-align:right"><?php echo esc_html(number_format_i18n($a['count'])); ?></td></tr>
        <?php endforeach; ?>
    </tbody></table>

    <!-- Monthly digest -->
    <div class="oe-panel-label"><?php esc_html_e('Monthly digest', 'october-events'); ?></div>
    <p><?php esc_html_e('Runs automatically on the first Monday of each month. You can also send it now:', 'october-events'); ?></p>
    <p><a class="button" href="<?php echo esc_url($digest_url); ?>"><?php esc_html_e('Send digest now', 'october-events'); ?></a></p>

    <!-- Contacts (managed here, at the bottom) -->
    <div class="oe-panel-label"><?php esc_html_e('Contacts', 'october-events'); ?></div>
    <p class="description"><?php esc_html_e('Built automatically from accounts, ticket buyers, volunteers, submitters and WordPress users — no manual import.', 'october-events'); ?></p>
    <div class="oe-kpis">
        <div class="oe-kpi dark"><div class="k"><?php esc_html_e('Total', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n($counts['total'])); ?></div><div class="s"><?php esc_html_e('contacts', 'october-events'); ?></div></div>
        <div class="oe-kpi"><div class="k"><?php esc_html_e('Subscribed', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n($counts['subscribed'])); ?></div><div class="s"><i class="dot green"></i><?php esc_html_e('can receive email', 'october-events'); ?></div></div>
        <div class="oe-kpi"><div class="k"><?php esc_html_e('Unsubscribed', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n($counts['unsubscribed'])); ?></div><div class="s"><?php esc_html_e('opted out', 'october-events'); ?></div></div>
        <div class="oe-kpi"><div class="k"><?php esc_html_e('SMS opt-in', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n($counts['sms'])); ?></div><div class="s"><?php esc_html_e('phone consented', 'october-events'); ?></div></div>
    </div>
    <div class="oe-actionbar">
        <a class="button button-primary" href="<?php echo esc_url($rebuild_url); ?>"><?php esc_html_e('Rebuild from all data (incl. users)', 'october-events'); ?></a>
        <a class="button" href="<?php echo esc_url(admin_url('admin.php?page=oe-contacts')); ?>"><?php esc_html_e('Manage contacts →', 'october-events'); ?></a>
    </div>
    <?php if ($recent) : ?>
        <table class="widefat striped">
            <thead><tr>
                <th><?php esc_html_e('Email', 'october-events'); ?></th>
                <th><?php esc_html_e('Name', 'october-events'); ?></th>
                <th><?php esc_html_e('Source', 'october-events'); ?></th>
                <th><?php esc_html_e('Status', 'october-events'); ?></th>
            </tr></thead>
            <tbody>
            <?php foreach ($recent as $c) : ?>
                <tr>
                    <td><?php echo esc_html((string) $c->email); ?></td>
                    <td><?php echo esc_html((string) $c->name); ?></td>
                    <td><span class="oe-status"><?php echo esc_html((string) ($c->source ?: '—')); ?></span></td>
                    <td><span class="oe-status oe-status-<?php echo $c->status === 'subscribed' ? 'approved' : 'rejected'; ?>"><?php echo esc_html((string) $c->status); ?></span></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
    <?php endif; ?>
</div>
