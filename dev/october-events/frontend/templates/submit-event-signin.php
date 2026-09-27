<?php
/**
 * Guest view of [oe_submit_event] — prompt to sign in before submitting.
 * Public organiser signup is a later slice; for now submitting requires a login.
 */
defined('ABSPATH') || exit;
$login = wp_login_url(add_query_arg([], (string) ($_SERVER['REQUEST_URI'] ?? home_url('/'))));
?>
<div class="oe-submit oe-submit--signin">
    <h2 class="oe-submit-title"><?php esc_html_e('List your event', 'october-events'); ?></h2>
    <p><?php esc_html_e('Please sign in to submit an event. New events are reviewed before they go live.', 'october-events'); ?></p>
    <p class="oe-submit-actions">
        <a class="oe-submit-btn" href="<?php echo esc_url($login); ?>"><?php esc_html_e('Sign in to submit', 'october-events'); ?></a>
    </p>
</div>
