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
$export = wp_nonce_url(admin_url('admin.php?page=oe-tickets&oe_export=orders'), 'oe_export');
?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Tickets', 'october-events'); ?>
        <a href="<?php echo esc_url($export); ?>" class="page-title-action"><?php esc_html_e('Export CSV', 'october-events'); ?></a>
    </h1>
    <?php \OE\Admin\Admin::bento('tickets'); ?>
    <?php \OE\Admin\Admin::tickets_tabs('orders'); ?>

    <?php if (! empty($_GET['oe_msg'])) :
        $m = sanitize_key((string) $_GET['oe_msg']); ?>
        <div class="notice notice-<?php echo $m === 'created' ? 'success' : 'error'; ?> is-dismissible"><p>
            <?php echo $m === 'created' ? esc_html__('Order created and tickets issued.', 'october-events') : esc_html__('Could not create that order — check the event has a ticket type.', 'october-events'); ?>
        </p></div>
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
            $refund = wp_nonce_url(admin_url('admin-post.php?action=oe_cancel_order&refund=1&id=' . $o->id), 'oe_cancel_order'); ?>
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
                    <?php if (in_array($o->status, ['paid', 'pending'], true)) : ?>
                        <a class="button button-small" href="<?php echo esc_url($cancel); ?>" onclick="return confirm('<?php echo esc_js(__('Cancel this order?', 'october-events')); ?>')"><?php esc_html_e('Cancel', 'october-events'); ?></a>
                        <?php if ($o->payment_id) : ?>
                            <a class="button button-small" href="<?php echo esc_url($refund); ?>" onclick="return confirm('<?php echo esc_js(__('Cancel AND refund via Stripe?', 'october-events')); ?>')"><?php esc_html_e('Refund', 'october-events'); ?></a>
                        <?php endif; ?>
                    <?php else : ?>—<?php endif; ?>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
