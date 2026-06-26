<?php
/**
 * Waitlist screen — people waiting on sold-out ticket types, in queue order.
 * "Notify" emails them a checkout link (marks them notified); "Remove" drops them.
 *
 * @var array      $entries      waitlist rows (oldest first)
 * @var \WP_Post[] $events       published events
 * @var int        $event_filter
 */
defined('ABSPATH') || exit;
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Tickets', 'october-events'); ?></h1>
    <?php \OE\Admin\Admin::bento('tickets'); ?>
    <?php \OE\Admin\Admin::tickets_tabs('waitlist'); ?>

    <form method="get" style="margin:16px 0">
        <input type="hidden" name="page" value="oe-tickets">
        <input type="hidden" name="tab" value="waitlist">
        <label><?php esc_html_e('Event', 'october-events'); ?>
            <select name="event" onchange="this.form.submit()">
                <option value="0"><?php esc_html_e('All events', 'october-events'); ?></option>
                <?php foreach ($events as $ev) : ?>
                    <option value="<?php echo (int) $ev->ID; ?>" <?php selected($event_filter, $ev->ID); ?>><?php echo esc_html(get_the_title($ev)); ?></option>
                <?php endforeach; ?>
            </select>
        </label>
        <span class="description" style="margin-left:8px"><?php echo esc_html(sprintf(_n('%s person waiting', '%s people waiting', count($entries), 'october-events'), number_format_i18n(count($entries)))); ?></span>
    </form>

    <table class="widefat striped">
        <thead><tr>
            <?php if (! $event_filter) : ?><th><?php esc_html_e('Event', 'october-events'); ?></th><?php endif; ?>
            <th><?php esc_html_e('Name', 'october-events'); ?></th>
            <th><?php esc_html_e('Email', 'october-events'); ?></th>
            <th><?php esc_html_e('Ticket type', 'october-events'); ?></th>
            <th><?php esc_html_e('Status', 'october-events'); ?></th>
            <th><?php esc_html_e('Joined', 'october-events'); ?></th>
            <th></th>
        </tr></thead>
        <tbody>
        <?php if (! $entries) : ?>
            <tr><td colspan="<?php echo $event_filter ? 6 : 7; ?>"><em><?php esc_html_e('No one on the waitlist.', 'october-events'); ?></em></td></tr>
        <?php else : foreach ($entries as $w) :
            $promote = wp_nonce_url(admin_url('admin-post.php?action=oe_waitlist_promote&id=' . (int) $w->id), 'oe_waitlist_promote');
            $remove  = wp_nonce_url(admin_url('admin-post.php?action=oe_waitlist_remove&id=' . (int) $w->id), 'oe_waitlist_remove');
            $notified = $w->status === 'notified'; ?>
            <tr>
                <?php if (! $event_filter) : ?><td><?php echo esc_html(get_the_title((int) $w->event_id) ?: ('#' . (int) $w->event_id)); ?></td><?php endif; ?>
                <td><?php echo esc_html((string) ($w->name ?? '') ?: '—'); ?></td>
                <td><?php echo esc_html((string) $w->email); ?></td>
                <td><?php echo esc_html((string) ($w->ticket_type_label ?? '') ?: '—'); ?></td>
                <td><span class="oe-status oe-status-<?php echo $notified ? 'approved' : 'pending'; ?>"><?php echo $notified ? esc_html__('Notified', 'october-events') : esc_html__('Waiting', 'october-events'); ?></span></td>
                <td><?php echo esc_html(get_date_from_gmt((string) $w->created_at, 'M j, Y')); ?></td>
                <td>
                    <a class="button button-small button-primary" href="<?php echo esc_url($promote); ?>"><?php echo $notified ? esc_html__('Notify again', 'october-events') : esc_html__('Notify', 'october-events'); ?></a>
                    <a class="button button-small" href="<?php echo esc_url($remove); ?>" onclick="return confirm('<?php echo esc_js(__('Remove from the waitlist?', 'october-events')); ?>')"><?php esc_html_e('Remove', 'october-events'); ?></a>
                </td>
            </tr>
        <?php endforeach; endif; ?>
        </tbody>
    </table>
    <p class="description" style="margin-top:10px"><?php esc_html_e('“Notify” emails the person a link to come and buy, and marks them notified. People join from the checkout when a ticket type is sold out.', 'october-events'); ?></p>
</div>
