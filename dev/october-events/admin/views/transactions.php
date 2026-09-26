<?php
/**
 * Transactions — paid orders grouped by Stripe payment, so a mixed cart (one
 * order per ticket type) shows as a single purchase you can refund in one go.
 *
 * @var array<int,object>             $txns         transaction summaries (newest first)
 * @var array<string,array<int,object>> $txn_tickets active tickets keyed by payment id
 * @var \WP_Post[]                    $events       published events (filter)
 * @var int                           $event_filter
 */
defined('ABSPATH') || exit;
?>
<?php if (empty($oe_embed)) : ?>
<div class="wrap oe-admin">
    <h1><?php esc_html_e('Tickets', 'october-events'); ?></h1>
    <?php \OE\Admin\Admin::bento('tickets'); ?>
    <?php \OE\Admin\Admin::tickets_tabs('transactions'); ?>
<?php else : ?>
    <h2 style="margin:6px 0 4px"><?php esc_html_e('Payments', 'october-events'); ?></h2>
<?php endif; ?>

    <?php if (! empty($_GET['oe_msg'])) :
        $m = sanitize_key((string) $_GET['oe_msg']);
        $map = [
            'refunded'      => ['success', __('Refund issued and the selected tickets voided.', 'october-events')],
            'refund_failed' => ['error', __('Refund failed — nothing was charged back. Check it’s a paid card transaction with tickets still active.', 'october-events')],
        ];
        if (isset($map[$m])) : ?>
            <div class="notice notice-<?php echo esc_attr($map[$m][0]); ?> is-dismissible"><p><?php echo esc_html($map[$m][1]); ?></p></div>
        <?php endif; ?>
    <?php endif; ?>

    <p class="description" style="margin:14px 0"><?php esc_html_e('Each row is one payment. A cart with several ticket types is a single transaction here — refunding it covers every ticket bought together.', 'october-events'); ?></p>

    <?php if (empty($oe_embed)) : // the Payments page provides one event filter for all sections ?>
    <form method="get" style="margin:0 0 14px">
        <input type="hidden" name="page" value="oe-tickets">
        <input type="hidden" name="tab" value="transactions">
        <label><?php esc_html_e('Event', 'october-events'); ?>
            <select name="event" onchange="this.form.submit()">
                <option value="0"><?php esc_html_e('All events', 'october-events'); ?></option>
                <?php foreach ($events as $ev) : ?>
                    <option value="<?php echo (int) $ev->ID; ?>" <?php selected($event_filter, $ev->ID); ?>><?php echo esc_html(get_the_title($ev)); ?></option>
                <?php endforeach; ?>
            </select>
        </label>
    </form>
    <?php endif; ?>

    <table class="widefat striped">
        <thead><tr>
            <th><?php esc_html_e('Payment', 'october-events'); ?></th>
            <th><?php esc_html_e('Purchaser', 'october-events'); ?></th>
            <th><?php esc_html_e('Event', 'october-events'); ?></th>
            <th><?php esc_html_e('Tickets', 'october-events'); ?></th>
            <th><?php esc_html_e('Total', 'october-events'); ?></th>
            <th><?php esc_html_e('Status', 'october-events'); ?></th>
            <th><?php esc_html_e('Actions', 'october-events'); ?></th>
        </tr></thead>
        <tbody>
        <?php if (! $txns) : ?>
            <tr><td colspan="7"><em><?php esc_html_e('No card transactions yet.', 'october-events'); ?></em></td></tr>
        <?php else : foreach ($txns as $x) :
            $tickets = (int) $x->tickets;
            $active  = (int) $x->active;
            $status  = $active === 0 ? 'refunded' : ($active < $tickets ? 'part_refunded' : 'paid');
            $status_label = $active === 0
                ? __('Refunded', 'october-events')
                : ($active < $tickets ? __('Part refunded', 'october-events') : __('Paid', 'october-events'));
            $ref = strtoupper(substr((string) $x->payment_id, -8));
            $tk  = $txn_tickets[(string) $x->payment_id] ?? []; ?>
            <tr class="oe-tx oe-tx-<?php echo esc_attr($status); ?>">
                <td><code title="<?php echo esc_attr((string) $x->payment_id); ?>">…<?php echo esc_html($ref); ?></code></td>
                <td><?php echo esc_html((string) $x->name); ?><br><span class="description"><?php echo esc_html((string) $x->email); ?></span></td>
                <td><?php echo esc_html(get_the_title((int) $x->event_id) ?: ('#' . (int) $x->event_id)); ?></td>
                <td><?php echo (int) $active; ?><?php if ($active !== $tickets) : ?> <span class="description">/ <?php echo (int) $tickets; ?></span><?php endif; ?></td>
                <td><?php echo esc_html(number_format((float) $x->total, 2) . ' ' . strtoupper((string) $x->currency)); ?></td>
                <td><span class="oe-status oe-status-<?php echo esc_attr($status); ?>"><?php echo esc_html($status_label); ?></span></td>
                <td>
                    <?php if ($active > 0 && $tk) :
                        $panel_order_id = (int) $x->order_id;
                        $panel_tickets  = $tk;
                        $panel_label    = __('Refund…', 'october-events');
                        include OE_DIR . 'admin/views/_refund-panel.php';
                    else : ?>—<?php endif; ?>
                </td>
            </tr>
        <?php endforeach; endif; ?>
        </tbody>
    </table>
    <style>
        .oe-tx-paid > td { background:#eaf7ec !important; }
        .oe-tx-part_refunded > td { background:#fdf3e3 !important; }
        .oe-tx-refunded > td { background:#fdeceb !important; }
    </style>
<?php if (empty($oe_embed)) : ?>
</div>
<?php endif; ?>
