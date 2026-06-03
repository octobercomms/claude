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
use ADF\Ticketing\Orders;
$export = wp_nonce_url(admin_url('admin.php?page=adf-tickets&adf_export=orders'), 'adf_export');
?>
<div class="wrap adf-admin">
    <h1><?php esc_html_e('Registrations', 'adf-festival'); ?>
        <a href="<?php echo esc_url($export); ?>" class="page-title-action"><?php esc_html_e('Export CSV', 'adf-festival'); ?></a>
    </h1>

    <?php if (! empty($_GET['adf_msg'])) :
        $m = sanitize_key((string) $_GET['adf_msg']); ?>
        <div class="notice notice-<?php echo $m === 'created' ? 'success' : 'error'; ?> is-dismissible"><p>
            <?php echo $m === 'created' ? esc_html__('Order created and tickets issued.', 'adf-festival') : esc_html__('Could not create that order — check the event has a ticket type.', 'adf-festival'); ?>
        </p></div>
    <?php endif; ?>

    <h2><?php esc_html_e('Add a registration manually', 'adf-festival'); ?></h2>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" class="adf-manual-order" style="background:#fff;border:1px solid #e3ded3;border-radius:12px;padding:16px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
        <input type="hidden" name="action" value="adf_create_order">
        <?php wp_nonce_field('adf_create_order'); ?>
        <label><?php esc_html_e('Event', 'adf-festival'); ?><br>
            <select name="event_id" id="adf-mo-event" required>
                <option value=""><?php esc_html_e('Choose…', 'adf-festival'); ?></option>
                <?php foreach ($events as $ev) : if (empty($event_types[$ev->ID])) { continue; } ?>
                    <option value="<?php echo (int) $ev->ID; ?>"><?php echo esc_html(get_the_title($ev)); ?></option>
                <?php endforeach; ?>
            </select></label>
        <label><?php esc_html_e('Ticket type', 'adf-festival'); ?><br>
            <select name="type_key" id="adf-mo-type" required></select></label>
        <label><?php esc_html_e('Qty', 'adf-festival'); ?><br><input type="number" name="qty" value="1" min="1" style="width:60px"></label>
        <label><?php esc_html_e('Name', 'adf-festival'); ?><br><input type="text" name="name"></label>
        <label><?php esc_html_e('Email', 'adf-festival'); ?><br><input type="email" name="email" required></label>
        <label><?php esc_html_e('Mode', 'adf-festival'); ?><br>
            <select name="mode"><option value="comp"><?php esc_html_e('Comp (free)', 'adf-festival'); ?></option><option value="paid"><?php esc_html_e('Mark paid', 'adf-festival'); ?></option></select></label>
        <button class="button button-primary"><?php esc_html_e('Issue tickets', 'adf-festival'); ?></button>
    </form>
    <script>
    (function(){
        var map = <?php echo wp_json_encode($event_types); ?>;
        var ev = document.getElementById('adf-mo-event'), ty = document.getElementById('adf-mo-type');
        function fill(){ ty.innerHTML=''; (map[ev.value]||[]).forEach(function(t){ var o=document.createElement('option'); o.value=t.key; o.textContent=t.label; ty.appendChild(o); }); }
        ev.addEventListener('change', fill); fill();
    })();
    </script>

    <h2 style="margin-top:24px"><?php esc_html_e('Orders', 'adf-festival'); ?></h2>
    <table class="widefat striped">
        <thead><tr>
            <th>#</th><th><?php esc_html_e('Event', 'adf-festival'); ?></th><th><?php esc_html_e('Purchaser', 'adf-festival'); ?></th>
            <th><?php esc_html_e('Type', 'adf-festival'); ?></th><th><?php esc_html_e('Qty', 'adf-festival'); ?></th>
            <th><?php esc_html_e('Total', 'adf-festival'); ?></th><th><?php esc_html_e('Status', 'adf-festival'); ?></th>
            <th><?php esc_html_e('Source', 'adf-festival'); ?></th><th><?php esc_html_e('Actions', 'adf-festival'); ?></th>
        </tr></thead>
        <tbody>
        <?php if (! $orders) : ?><tr><td colspan="9"><?php esc_html_e('No registrations yet.', 'adf-festival'); ?></td></tr><?php endif; ?>
        <?php foreach (($orders ?: []) as $o) :
            $cancel = wp_nonce_url(admin_url('admin-post.php?action=adf_cancel_order&id=' . $o->id), 'adf_cancel_order');
            $refund = wp_nonce_url(admin_url('admin-post.php?action=adf_cancel_order&refund=1&id=' . $o->id), 'adf_cancel_order'); ?>
            <tr>
                <td><?php echo (int) $o->id; ?></td>
                <td><?php echo esc_html(get_the_title((int) $o->event_id)); ?></td>
                <td><?php echo esc_html($o->name); ?><br><span class="description"><?php echo esc_html($o->email); ?></span></td>
                <td><?php echo esc_html($o->ticket_type_label); ?></td>
                <td><?php echo (int) $o->qty; ?></td>
                <td><?php echo esc_html($o->total . ' ' . $o->currency); ?></td>
                <td><span class="adf-status adf-status-<?php echo esc_attr($o->status); ?>"><?php echo esc_html($o->status); ?></span></td>
                <td><?php echo esc_html($o->source); ?></td>
                <td>
                    <?php if (in_array($o->status, ['paid', 'pending'], true)) : ?>
                        <a class="button button-small" href="<?php echo esc_url($cancel); ?>" onclick="return confirm('<?php echo esc_js(__('Cancel this order?', 'adf-festival')); ?>')"><?php esc_html_e('Cancel', 'adf-festival'); ?></a>
                        <?php if ($o->payment_id) : ?>
                            <a class="button button-small" href="<?php echo esc_url($refund); ?>" onclick="return confirm('<?php echo esc_js(__('Cancel AND refund via Stripe?', 'adf-festival')); ?>')"><?php esc_html_e('Refund', 'adf-festival'); ?></a>
                        <?php endif; ?>
                    <?php else : ?>—<?php endif; ?>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
