<?php
/** @var \WP_Post[] $items @var string $type @var string $label */
defined('ABSPATH') || exit;
use OE\Fields;
use OE\PostTypes;
$is_destination = ($type === 'destination');
?>
<div class="wrap oe-admin">
    <h1><?php echo esc_html($label); ?></h1>
    <?php \OE\Admin\Admin::bento('listing'); ?>

    <div class="oe-actionbar">
        <a class="button button-primary" href="<?php echo esc_url(admin_url('post-new.php?post_type=' . PostTypes::slug($type))); ?>"><?php /* translators: %s: listing type, e.g. Event */ echo esc_html(sprintf(__('+ New %s', 'october-events'), rtrim($label, 's'))); ?></a>
        <span class="description"><?php echo esc_html(sprintf(_n('%s record', '%s records', count($items), 'october-events'), number_format_i18n(count($items)))); ?></span>
    </div>

    <table class="widefat striped">
        <thead>
            <tr>
                <th><?php esc_html_e('Title', 'october-events'); ?></th>
                <th><?php esc_html_e('Status', 'october-events'); ?></th>
                <th><?php esc_html_e('Tier', 'october-events'); ?></th>
                <?php if ($is_destination) : ?><th><?php esc_html_e('Map visible', 'october-events'); ?></th><?php endif; ?>
                <th></th>
            </tr>
        </thead>
        <tbody>
        <?php if (! $items) : ?>
            <tr><td colspan="5"><?php esc_html_e('No records yet.', 'october-events'); ?></td></tr>
        <?php endif; ?>
        <?php foreach ($items as $post) : ?>
            <tr>
                <td><strong><a href="<?php echo esc_url(get_edit_post_link($post->ID)); ?>"><?php echo esc_html(get_the_title($post)); ?></a></strong></td>
                <td><span class="oe-status oe-status-<?php echo esc_attr(Fields::status($post->ID)); ?>"><?php echo esc_html(ucwords(str_replace('_', ' ', Fields::status($post->ID)))); ?></span></td>
                <td><?php echo esc_html(ucfirst(Fields::tier($post->ID))); ?></td>
                <?php if ($is_destination) : ?>
                    <td><?php echo get_post_meta($post->ID, '_oe_map_visible', true) ? '✓' : '—'; ?></td>
                <?php endif; ?>
                <td><a href="<?php echo esc_url(get_edit_post_link($post->ID)); ?>"><?php esc_html_e('Edit', 'october-events'); ?></a></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
