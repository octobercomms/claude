<?php
/**
 * Shared transaction-wide refund panel. Lists every active ticket in the whole
 * transaction (all orders that share the Stripe payment), so a mixed cart can be
 * refunded in one go — all ticked = full, untick for partial.
 *
 * Expects:
 * @var int                $panel_order_id  an order id in the transaction (the handler derives the payment)
 * @var array<int,object>  $panel_tickets   active tickets across the transaction
 * @var string             $panel_label     optional summary label (default "Refund…")
 */
defined('ABSPATH') || exit;
$panel_label = $panel_label ?? __('Refund…', 'october-events');
?>
<details class="oe-refund" style="display:inline-block;vertical-align:top">
    <summary class="button button-small" style="cursor:pointer;list-style:none"><?php echo esc_html($panel_label); ?></summary>
    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="position:absolute;z-index:10;margin-top:6px;background:#fff;border:1px solid #c3c4c7;border-radius:8px;padding:12px;box-shadow:0 6px 18px rgba(0,0,0,.12);min-width:280px;text-align:left" onsubmit="return confirm('<?php echo esc_js(__('Refund the ticked tickets to the customer’s card? They’ll be emailed.', 'october-events')); ?>')">
        <?php wp_nonce_field('oe_refund_tickets'); ?>
        <input type="hidden" name="action" value="oe_refund_tickets">
        <input type="hidden" name="id" value="<?php echo (int) $panel_order_id; ?>">
        <p style="margin:0 0 8px;font-weight:600"><?php esc_html_e('Tickets to refund', 'october-events'); ?></p>
        <?php foreach ($panel_tickets as $t) : ?>
            <label style="display:block;margin:3px 0;font-size:13px">
                <input type="checkbox" name="ticket_ids[]" value="<?php echo (int) $t->id; ?>" checked>
                <?php echo esc_html('#' . (int) $t->ticket_number . '/' . (int) $t->total_in_order . ' · ' . ((string) $t->ticket_type_label ?: '—') . ((string) $t->attendee_name !== '' ? ' · ' . (string) $t->attendee_name : '')); ?>
            </label>
        <?php endforeach; ?>
        <p style="margin:10px 0 4px"><label><?php esc_html_e('Reason', 'october-events'); ?>
            <select name="reason" style="margin-left:6px">
                <option value="requested_by_customer"><?php esc_html_e('Requested by customer', 'october-events'); ?></option>
                <option value="duplicate"><?php esc_html_e('Duplicate', 'october-events'); ?></option>
                <option value="fraudulent"><?php esc_html_e('Fraudulent', 'october-events'); ?></option>
            </select></label></p>
        <p style="margin:10px 0 0"><button type="submit" class="button button-primary button-small"><?php esc_html_e('Refund selected', 'october-events'); ?></button>
            <span class="description" style="display:block;margin-top:4px"><?php esc_html_e('All ticked = full refund. Untick to refund only some.', 'october-events'); ?></span></p>
    </form>
</details>
