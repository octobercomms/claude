<?php
/** @var array $events  list of Events::summary() */
defined('ABSPATH') || exit;
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Events', 'october-events'); ?>
        <a href="<?php echo esc_url(admin_url('post-new.php?post_type=' . \OE\Planning\Events::slug())); ?>" class="page-title-action"><?php esc_html_e('Add new', 'october-events'); ?></a>
    </h1>
    <?php \OE\Admin\Admin::bento('planning'); ?>
    <p class="description"><?php esc_html_e('Every event and its readiness. An event goes green once it has the essentials: title, dates & times, price and location. Green = published live.', 'october-events'); ?></p>

    <?php if (isset($_GET['seeded'])) : ?>
        <div class="notice notice-success is-dismissible"><p><?php echo esc_html(sprintf(__('Seeded planning data into %d event(s) from your mapped fields.', 'october-events'), (int) $_GET['seeded'])); ?></p></div>
    <?php endif; ?>
    <?php if (\OE\Planning\Events::field_map()) : ?>
        <p><a class="button" href="<?php echo esc_url(wp_nonce_url(admin_url('admin-post.php?action=oe_seed_planning'), 'oe_seed_planning')); ?>"><?php esc_html_e('Seed planning from existing fields', 'october-events'); ?></a>
        <span class="description"><?php esc_html_e('Copies your mapped event fields into the planner (won\'t overwrite anything already entered).', 'october-events'); ?></span></p>
    <?php endif; ?>

    <table class="widefat striped">
        <thead><tr>
            <th><?php esc_html_e('Event', 'october-events'); ?></th>
            <th><?php esc_html_e('Ready', 'october-events'); ?></th>
            <th><?php esc_html_e('Status', 'october-events'); ?></th>
            <th><?php esc_html_e('Still needs', 'october-events'); ?></th>
            <th><?php esc_html_e('Live', 'october-events'); ?></th>
            <th><?php esc_html_e('Check-in PIN', 'october-events'); ?></th>
            <th></th>
        </tr></thead>
        <tbody>
        <?php if (! $events) : ?>
            <tr><td colspan="7"><?php esc_html_e('No events yet.', 'october-events'); ?></td></tr>
        <?php endif; ?>
        <?php foreach ($events as $e) : ?>
            <tr>
                <td><strong><a href="<?php echo esc_url($e['edit_url']); ?>"><?php echo esc_html($e['title'] ?: __('(untitled)', 'october-events')); ?></a></strong></td>
                <td style="width:160px">
                    <div style="background:#eee;border-radius:999px;height:8px;overflow:hidden">
                        <div style="height:8px;width:<?php echo (int) $e['percent']; ?>%;background:<?php echo $e['percent'] >= 100 ? '#1a7f37' : '#d8531f'; ?>"></div>
                    </div>
                    <span class="description"><?php echo (int) $e['percent']; ?>%</span>
                </td>
                <td><span class="oe-status oe-status-<?php echo esc_attr($e['status']); ?>"><?php echo esc_html(ucwords(str_replace('_', ' ', $e['status']))); ?></span></td>
                <td><?php echo $e['missing'] ? esc_html(implode(', ', $e['missing'])) : '—'; ?></td>
                <td><?php echo $e['live'] ? '✓' : '—'; ?></td>
                <?php $pin = \OE\Ticketing\TicketTypes::pin((int) $e['id']); ?>
                <td><?php echo $pin !== '' ? '<code>' . esc_html($pin) . '</code>' : '<span class="description">—</span>'; ?></td>
                <td><a class="button button-small" href="<?php echo esc_url($e['edit_url']); ?>"><?php esc_html_e('Open', 'october-events'); ?></a></td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
