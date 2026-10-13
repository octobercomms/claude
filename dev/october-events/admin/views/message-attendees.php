<?php
/**
 * "Message attendees" screen: send an email to everyone registered for one
 * event — a change of venue, an added tour location, any announcement.
 *
 * @var array $events  [['id'=>int,'title'=>string,'count'=>int], …] ticketed events + counts
 * @var array|false $result  Flash result from a send/test.
 */

defined('ABSPATH') || exit;

$selected = isset($_GET['event']) ? absint($_GET['event']) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Message attendees', 'october-events'); ?></h1>
    <p style="margin:6px 0 14px"><a class="button" href="<?php echo esc_url(admin_url('admin.php?page=oe-tickets')); ?>">&larr; <?php esc_html_e('Back to Tickets', 'october-events'); ?></a></p>
    <div class="oe-ad-card" style="max-width:720px">
        <?php require OE_DIR . 'admin/views/_message-compose.php'; ?>
    </div>
</div>
