<?php
defined('ABSPATH') || exit;
use OE\Connectors\BrevoConnector;
use OE\Settings as Config;
$ready = BrevoConnector::is_ready();
$digest_url = wp_nonce_url(admin_url('admin-post.php?action=oe_send_digest'), 'oe_send_digest');
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Email', 'october-events'); ?></h1>

    <p>
        <?php esc_html_e('Brevo connection:', 'october-events'); ?>
        <strong style="color:<?php echo $ready ? '#1a7f37' : '#b32d2e'; ?>">
            <?php echo $ready ? esc_html__('Configured', 'october-events') : esc_html__('Missing API key (set OE_BREVO_API_KEY)', 'october-events'); ?>
        </strong>
    </p>

    <h2><?php esc_html_e('Contact lists', 'october-events'); ?></h2>
    <p class="description"><?php esc_html_e('Map these to the list IDs created in Brevo (edit in Settings):', 'october-events'); ?></p>
    <ul style="list-style:disc;margin-left:20px">
        <?php foreach (['oe_all_subscribers', 'oe_directory_listed', 'oe_event_attendees', 'oe_volunteers', 'oe_partners', 'oe_monthly_digest'] as $list) :
            $id = (int) (Config::get('brevo_lists', [])[$list] ?? 0); ?>
            <li><code><?php echo esc_html($list); ?></code> → <?php echo $id ? esc_html((string) $id) : '<em>' . esc_html__('not set', 'october-events') . '</em>'; ?></li>
        <?php endforeach; ?>
    </ul>

    <h2><?php esc_html_e('Monthly digest', 'october-events'); ?></h2>
    <p><?php esc_html_e('Runs automatically on the first Monday of each month. You can also trigger it manually:', 'october-events'); ?></p>
    <p><a class="button button-primary" href="<?php echo esc_url($digest_url); ?>"><?php esc_html_e('Send digest now', 'october-events'); ?></a></p>
</div>
