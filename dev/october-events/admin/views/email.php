<?php
/**
 * Email overview screen (ADMIN-BUILD AD9).
 *
 * @var array $contacts  Contacts::counts()  [total, subscribed, unsubscribed, sms]
 * @var array $log       EmailLog::counts()  [sent, failed, suppressed]
 * @var array $campaigns array of Campaigns::dto()
 * @var string $driver   'ses' | 'brevo' | 'default'
 */
defined('ABSPATH') || exit;

$driver_label = [
    'ses'     => __('Amazon SES', 'october-events'),
    'brevo'   => __('Brevo', 'october-events'),
    'default' => __('Site default (wp_mail)', 'october-events'),
][$driver] ?? $driver;
$driver_ok = $driver !== 'default';

$status_pill = static function (string $s): array {
    switch ($s) {
        case 'sent':      return ['pos', __('Sent', 'october-events')];
        case 'sending':   return ['warn', __('Sending', 'october-events')];
        case 'scheduled': return ['info', __('Scheduled', 'october-events')];
        case 'draft':     return ['neu', __('Draft', 'october-events')];
        default:          return ['neu', ucwords($s)];
    }
};

$total_sent = 0;
foreach ($campaigns as $c) { $total_sent += (int) ($c['stats']['sent'] ?? 0); }
?>
<div class="wrap oe-admin oe-email">
    <h1><?php esc_html_e('Email', 'october-events'); ?></h1>
    <?php \OE\Admin\Admin::bento('email'); ?>

    <div class="oe-ad-strip">
        <div class="oe-ad-stat oe-ad-stat--feature">
            <div class="l"><?php esc_html_e('Subscribers', 'october-events'); ?></div>
            <div class="v"><?php echo esc_html(number_format_i18n((int) ($contacts['subscribed'] ?? 0))); ?></div>
            <div class="s"><?php echo esc_html(sprintf(__('of %s contacts', 'october-events'), number_format_i18n((int) ($contacts['total'] ?? 0)))); ?></div>
        </div>
        <div class="oe-ad-stat">
            <div class="l"><?php esc_html_e('Delivered', 'october-events'); ?></div>
            <div class="v"><?php echo esc_html(number_format_i18n((int) ($log['sent'] ?? 0))); ?></div>
            <div class="s"><?php esc_html_e('all-time, logged', 'october-events'); ?></div>
        </div>
        <div class="oe-ad-stat">
            <div class="l"><?php esc_html_e('Failed', 'october-events'); ?></div>
            <div class="v"><?php echo esc_html(number_format_i18n((int) ($log['failed'] ?? 0))); ?></div>
            <div class="s"><?php echo esc_html(sprintf(__('%s suppressed', 'october-events'), number_format_i18n((int) ($log['suppressed'] ?? 0)))); ?></div>
        </div>
        <div class="oe-ad-stat">
            <div class="l"><?php esc_html_e('Campaigns', 'october-events'); ?></div>
            <div class="v"><?php echo esc_html(number_format_i18n(count($campaigns))); ?></div>
            <div class="s"><?php echo esc_html(sprintf(__('%s emails sent', 'october-events'), number_format_i18n($total_sent))); ?></div>
        </div>
    </div>

    <div class="oe-ad-card oe-email-health">
        <div class="oe-email-health-row">
            <span class="oe-ad-pill oe-ad-pill--<?php echo $driver_ok ? 'pos' : 'warn'; ?>"><?php echo $driver_ok ? esc_html__('Connected', 'october-events') : esc_html__('Default transport', 'october-events'); ?></span>
            <strong><?php echo esc_html($driver_label); ?></strong>
            <span class="description"><?php echo $driver_ok
                ? esc_html__('Transactional and campaign email is routed through your sending provider.', 'october-events')
                : esc_html__('No dedicated provider connected — email uses the site default, which can hurt deliverability at volume.', 'october-events'); ?></span>
            <a class="button button-small" href="<?php echo esc_url(admin_url('admin.php?page=oe-settings#email')); ?>"><?php esc_html_e('Email settings', 'october-events'); ?></a>
        </div>
    </div>

    <h2 class="oe-email-h"><?php esc_html_e('Campaigns', 'october-events'); ?></h2>
    <?php if (! $campaigns) : ?>
        <div class="oe-ad-card">
            <strong><?php esc_html_e('No campaigns yet.', 'october-events'); ?></strong><br>
            <span class="description"><?php esc_html_e('Campaigns are composed in the planning platform using the same contacts and audiences shown here. Sent campaigns and their open/click stats appear on this screen.', 'october-events'); ?></span>
        </div>
    <?php else : ?>
        <div class="oe-email-campaigns">
        <?php foreach ($campaigns as $c) :
            [$pill, $plabel] = $status_pill((string) $c['status']);
            $st   = (array) $c['stats'];
            $sent = (int) ($st['sent'] ?? 0);
            $open = (int) ($st['opened'] ?? 0);
            $clk  = (int) ($st['clicked'] ?? 0);
            $openr = $sent > 0 ? round($open / $sent * 100) : 0;
            $clickr = $sent > 0 ? round($clk / $sent * 100) : 0;
            $when = $c['sent_at'] ?: ($c['scheduled_at'] ?: '');
        ?>
            <details class="oe-ad-card oe-email-camp">
                <summary>
                    <span class="oe-email-camp-name"><strong><?php echo esc_html((string) ($c['name'] ?: $c['subject'] ?: __('(untitled)', 'october-events'))); ?></strong>
                        <span class="description"><?php echo esc_html((string) $c['subject']); ?></span>
                    </span>
                    <span class="oe-email-camp-meta">
                        <span class="oe-ad-pill oe-ad-pill--<?php echo esc_attr($pill); ?>"><?php echo esc_html($plabel); ?></span>
                        <span class="oe-email-camp-sent"><?php echo esc_html(number_format_i18n($sent)); ?> <?php esc_html_e('sent', 'october-events'); ?></span>
                    </span>
                </summary>
                <div class="oe-email-camp-body">
                    <div class="oe-email-metrics">
                        <div class="m"><div class="l"><?php esc_html_e('Audience', 'october-events'); ?></div><div class="v"><?php echo esc_html((string) ($c['audience'] ?: '—')); ?></div></div>
                        <div class="m"><div class="l"><?php esc_html_e('Recipients', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n((int) ($st['total'] ?? 0))); ?></div></div>
                        <div class="m"><div class="l"><?php esc_html_e('Opened', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n($open)); ?> <span class="pc"><?php echo (int) $openr; ?>%</span></div></div>
                        <div class="m"><div class="l"><?php esc_html_e('Clicked', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n($clk)); ?> <span class="pc"><?php echo (int) $clickr; ?>%</span></div></div>
                        <div class="m"><div class="l"><?php esc_html_e('Failed', 'october-events'); ?></div><div class="v"><?php echo esc_html(number_format_i18n((int) ($st['failed'] ?? 0))); ?></div></div>
                        <div class="m"><div class="l"><?php esc_html_e('When', 'october-events'); ?></div><div class="v"><?php echo esc_html($when ? date_i18n(get_option('date_format'), strtotime((string) $when)) : '—'); ?></div></div>
                    </div>
                </div>
            </details>
        <?php endforeach; ?>
        </div>
    <?php endif; ?>

    <p class="oe-ad-note"><?php esc_html_e('Campaigns are built in the planning platform; this screen is the at-a-glance read of sending health and campaign performance. Transactional email (tickets, confirmations, volunteer and team messages) sends automatically and is counted under Delivered.', 'october-events'); ?></p>
</div>
