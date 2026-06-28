<?php
/**
 * Registrations (orders) screen + manual order/comp creation.
 *
 * @var array      $orders       order rows
 * @var \WP_Post[] $events       published events
 * @var array      $event_types  [event_id => [['key','label'], …]]
 * @var int        $event_filter
 */
defined('ABSPATH') || exit;
use OE\Ticketing\Orders;
$ev_arg          = $event_filter ? ('&event=' . (int) $event_filter) : '';
$export_orders   = wp_nonce_url(admin_url('admin.php?page=oe-tickets&oe_export=orders' . $ev_arg), 'oe_export');
$export_attendee = wp_nonce_url(admin_url('admin.php?page=oe-tickets&oe_export=attendees' . $ev_arg), 'oe_export');
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Tickets', 'october-events'); ?>
        <a href="<?php echo esc_url($export_attendee); ?>" class="page-title-action"><?php esc_html_e('Export attendees', 'october-events'); ?></a>
        <a href="<?php echo esc_url($export_orders); ?>" class="page-title-action"><?php esc_html_e('Export orders', 'october-events'); ?></a>
    </h1>
    <?php if ($event_filter) : ?>
        <p class="description" style="margin:4px 0 0"><?php echo esc_html(sprintf(__('Exports are filtered to: %s', 'october-events'), get_the_title($event_filter) ?: ('#' . $event_filter))); ?></p>
    <?php endif; ?>
    <?php \OE\Admin\Admin::bento('tickets'); ?>
    <?php \OE\Admin\Admin::tickets_tabs('orders'); ?>

    <?php if (! empty($_GET['oe_msg'])) :
        $m = sanitize_key((string) $_GET['oe_msg']);
        $messages = [
            'created'       => ['success', __('Order created and tickets issued.', 'october-events')],
            'resent'        => ['success', __('Confirmation email re-sent to the buyer.', 'october-events')],
            'resend_failed' => ['error', __('Could not re-send — that order has no email address.', 'october-events')],
            'deleted'       => ['success', __('Order deleted, along with its tickets and any check-in scans.', 'october-events')],
            'refunded'      => ['success', __('Refund issued and the selected tickets voided.', 'october-events')],
            'refund_failed' => ['error', __('Refund failed — nothing was charged back. Check the order is a paid card order with tickets still active.', 'october-events')],
        ];
        $note = $messages[$m] ?? ['error', __('Could not create that order — check the event has a ticket type.', 'october-events')]; ?>
        <div class="notice notice-<?php echo esc_attr($note[0]); ?> is-dismissible"><p><?php echo esc_html($note[1]); ?></p></div>
    <?php endif; ?>

    <h2><?php esc_html_e('Add a registration manually', 'october-events'); ?></h2>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="oe-manual-order" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
        <input type="hidden" name="action" value="oe_create_order">
        <?php wp_nonce_field('oe_create_order'); ?>
        <label><?php esc_html_e('Event', 'october-events'); ?><br>
            <select name="event_id" id="oe-mo-event" required>
                <option value=""><?php esc_html_e('Choose…', 'october-events'); ?></option>
                <?php foreach ($events as $ev) : if (empty($event_types[$ev->ID])) { continue; } ?>
                    <option value="<?php echo (int) $ev->ID; ?>"><?php echo esc_html(get_the_title($ev)); ?></option>
                <?php endforeach; ?>
            </select></label>
        <label><?php esc_html_e('Ticket type', 'october-events'); ?><br>
            <select name="type_key" id="oe-mo-type" required></select></label>
        <label><?php esc_html_e('Qty', 'october-events'); ?><br><input type="number" name="qty" value="1" min="1" style="width:60px"></label>
        <label><?php esc_html_e('Name', 'october-events'); ?><br><input type="text" name="name"></label>
        <label><?php esc_html_e('Email', 'october-events'); ?><br><input type="email" name="email" required></label>
        <label><?php esc_html_e('Mode', 'october-events'); ?><br>
            <select name="mode"><option value="comp"><?php esc_html_e('Comp (free)', 'october-events'); ?></option><option value="paid"><?php esc_html_e('Mark paid', 'october-events'); ?></option></select></label>
        <button class="button button-primary"><?php esc_html_e('Issue tickets', 'october-events'); ?></button>
    </form>
    <script>
    (function(){
        var map = <?php echo wp_json_encode($event_types); ?>;
        var ev = document.getElementById('oe-mo-event'), ty = document.getElementById('oe-mo-type');
        function fill(){ ty.innerHTML=''; (map[ev.value]||[]).forEach(function(t){ var o=document.createElement('option'); o.value=t.key; o.textContent=t.label; ty.appendChild(o); }); }
        ev.addEventListener('change', fill); fill();
    })();
    </script>

    <h2 style="margin-top:24px"><?php esc_html_e('Orders', 'october-events'); ?></h2>
    <table class="widefat striped">
        <thead><tr>
            <th>#</th><th><?php esc_html_e('Event', 'october-events'); ?></th><th><?php esc_html_e('Purchaser', 'october-events'); ?></th>
            <th><?php esc_html_e('Type', 'october-events'); ?></th><th><?php esc_html_e('Qty', 'october-events'); ?></th>
            <th><?php esc_html_e('Total', 'october-events'); ?></th><th><?php esc_html_e('Status', 'october-events'); ?></th>
            <th><?php esc_html_e('Source', 'october-events'); ?></th><th><?php esc_html_e('Actions', 'october-events'); ?></th>
        </tr></thead>
        <tbody>
        <?php if (! $orders) : ?><tr><td colspan="9"><?php esc_html_e('No registrations yet.', 'october-events'); ?></td></tr><?php endif; ?>
        <?php foreach (($orders ?: []) as $o) :
            $cancel = wp_nonce_url(admin_url('admin-post.php?action=oe_cancel_order&id=' . $o->id), 'oe_cancel_order');
            $refund = wp_nonce_url(admin_url('admin-post.php?action=oe_cancel_order&refund=1&id=' . $o->id), 'oe_cancel_order');
            $resend = wp_nonce_url(admin_url('admin-post.php?action=oe_resend_confirmation&id=' . $o->id), 'oe_resend_confirmation');
            $delete = wp_nonce_url(admin_url('admin-post.php?action=oe_delete_order&id=' . $o->id), 'oe_delete_order'); ?>
            <tr>
                <td><?php echo (int) $o->id; ?></td>
                <td><?php echo esc_html(get_the_title((int) $o->event_id)); ?></td>
                <td><?php echo esc_html($o->name); ?><br><span class="description"><?php echo esc_html($o->email); ?></span></td>
                <td><?php echo esc_html($o->ticket_type_label); ?></td>
                <td><?php echo (int) $o->qty; ?></td>
                <td><?php echo esc_html($o->total . ' ' . $o->currency); ?></td>
                <td><span class="oe-status oe-status-<?php echo esc_attr($o->status); ?>"><?php echo esc_html($o->status); ?></span></td>
                <td><?php echo esc_html($o->source); ?></td>
                <td>
                    <?php if ($o->status === 'paid' && $o->email) : ?>
                        <a class="button button-small" href="<?php echo esc_url($resend); ?>" title="<?php esc_attr_e('Email the buyer their tickets again', 'october-events'); ?>"><?php esc_html_e('Resend', 'october-events'); ?></a>
                    <?php endif; ?>
                    <?php if (in_array($o->status, ['paid', 'pending'], true)) : ?>
                        <a class="button button-small" href="<?php echo esc_url($cancel); ?>" onclick="return confirm('<?php echo esc_js(__('Cancel this order and void its tickets? The customer will be emailed.', 'october-events')); ?>')"><?php esc_html_e('Cancel', 'october-events'); ?></a>
                        <?php
                        $is_stripe = in_array((string) $o->payment_method, ['stripe', 'public'], true);
                        $tk = $txn_tickets[(string) $o->payment_id] ?? [];
                        if ($o->payment_id && $is_stripe && $tk) :
                            $panel_order_id = (int) $o->id;
                            $panel_tickets  = $tk;
                            $panel_label    = __('Refund…', 'october-events');
                            include OE_DIR . 'admin/views/_refund-panel.php';
                        elseif ($o->payment_id) : ?>
                            <a class="button button-small" href="<?php echo esc_url($refund); ?>" onclick="return confirm('<?php echo esc_js(__('Refund this order in full and void its tickets? The customer will be emailed their refund.', 'october-events')); ?>')"><?php esc_html_e('Refund', 'october-events'); ?></a>
                        <?php endif; ?>
                    <?php endif; ?>
                    <a class="button button-small button-link-delete" href="<?php echo esc_url($delete); ?>" title="<?php esc_attr_e('Permanently delete (for test data)', 'october-events'); ?>" onclick="return confirm('<?php echo esc_js(__('Permanently delete this order, its tickets and any check-in scans? This cannot be undone, and no refund is issued.', 'october-events')); ?>')"><?php esc_html_e('Delete', 'october-events'); ?></a>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
