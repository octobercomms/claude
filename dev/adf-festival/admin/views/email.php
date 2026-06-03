<?php
defined('ABSPATH') || exit;
use ADF\Connectors\BrevoConnector;
use ADF\Settings as Config;
$ready = BrevoConnector::is_ready();
$digest_url = wp_nonce_url(admin_url('admin-post.php?action=adf_send_digest'), 'adf_send_digest');
?>
<div class="wrap adf-admin">
    <h1><?php esc_html_e('Email', 'adf-festival'); ?></h1>

    <p>
        <?php esc_html_e('Brevo connection:', 'adf-festival'); ?>
        <strong style="color:<?php echo $ready ? '#1a7f37' : '#b32d2e'; ?>">
            <?php echo $ready ? esc_html__('Configured', 'adf-festival') : esc_html__('Missing API key (set ADF_BREVO_API_KEY)', 'adf-festival'); ?>
        </strong>
    </p>

    <h2><?php esc_html_e('Contact lists', 'adf-festival'); ?></h2>
    <p class="description"><?php esc_html_e('Map these to the list IDs created in Brevo (edit in Settings):', 'adf-festival'); ?></p>
    <ul style="list-style:disc;margin-left:20px">
        <?php foreach (['adf_all_subscribers', 'adf_directory_listed', 'adf_event_attendees', 'adf_volunteers', 'adf_partners', 'adf_monthly_digest'] as $list) :
            $id = (int) (Config::get('brevo_lists', [])[$list] ?? 0); ?>
            <li><code><?php echo esc_html($list); ?></code> → <?php echo $id ? esc_html((string) $id) : '<em>' . esc_html__('not set', 'adf-festival') . '</em>'; ?></li>
        <?php endforeach; ?>
    </ul>

    <h2><?php esc_html_e('Monthly digest', 'adf-festival'); ?></h2>
    <p><?php esc_html_e('Runs automatically on the first Monday of each month. You can also trigger it manually:', 'adf-festival'); ?></p>
    <p><a class="button button-primary" href="<?php echo esc_url($digest_url); ?>"><?php esc_html_e('Send digest now', 'adf-festival'); ?></a></p>
</div>
