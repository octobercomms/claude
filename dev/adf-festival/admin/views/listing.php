<?php
/** @var \WP_Post[] $items @var string $type @var string $label */
defined('ABSPATH') || exit;
use ADF\Fields;
$is_destination = ($type === 'destination');
?>
<div class="wrap adf-admin">
    <h1><?php echo esc_html($label); ?></h1>
    <table class="widefat striped">
        <thead>
            <tr>
                <th><?php esc_html_e('Title', 'adf-festival'); ?></th>
                <th><?php esc_html_e('Status', 'adf-festival'); ?></th>
                <th><?php esc_html_e('Tier', 'adf-festival'); ?></th>
                <?php if ($is_destination) : ?><th><?php esc_html_e('Map visible', 'adf-festival'); ?></th><?php endif; ?>
                <th></th>
            </tr>
        </thead>
        <tbody>
        <?php if (! $items) : ?>
            <tr><td colspan="5"><?php esc_html_e('No records yet.', 'adf-festival'); ?></td></tr>
        <?php endif; ?>
        <?php foreach ($items as $post) : ?>
            <tr>
                <td><strong><a href="<?php echo esc_url(get_edit_post_link($post->ID)); ?>"><?php echo esc_html(get_the_title($post)); ?></a></strong></td>
                <td><span class="adf-status adf-status-<?php echo esc_attr(Fields::status($post->ID)); ?>"><?php echo esc_html(ucwords(str_replace('_', ' ', Fields::status($post->ID)))); ?></span></td>
                <td><?php echo esc_html(ucfirst(Fields::tier($post->ID))); ?></td>
                <?php if ($is_destination) : ?>
                    <td><?php echo get_post_meta($post->ID, '_adf_map_visible', true) ? '✓' : '—'; ?></td>
                <?php endif; ?>
                <td><a href="<?php echo esc_url(get_edit_post_link($post->ID)); ?>"><?php esc_html_e('Edit', 'adf-festival'); ?></a></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
