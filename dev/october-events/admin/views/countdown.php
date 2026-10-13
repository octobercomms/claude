<?php
/**
 * Countdown image generator — standalone page. The tool itself lives in the
 * shared _countdown-tool.php partial, which the Events slide-in also uses.
 */
defined('ABSPATH') || exit;
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Countdown image', 'october-events'); ?></h1>
    <?php \OE\Admin\Admin::bento('countdown'); ?>
    <?php require __DIR__ . '/_countdown-tool.php'; ?>
</div>
